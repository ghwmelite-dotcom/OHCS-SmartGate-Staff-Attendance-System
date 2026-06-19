import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, created, notFound } from '../lib/response';
import { hashPin } from '../services/auth';
import { requireRole } from '../lib/require-role';
import { getAppSettings, toSqlTime } from '../services/settings';
import { runNssEndOfServiceCheck } from '../services/nss-eos';

export const adminNssRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const NSS_NUMBER_REGEX = /^NSS[A-Z]{3}\d{7}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Generate a 6-digit numeric initial PIN using the Web Crypto RNG.
 * Range [100000, 999999] inclusive.
 */
export function generateInitialPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 100000 + (buf[0]! % 900000);
  return n.toString();
}

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_REGEX.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Resolve the optional ?type= filter into a SQL WHERE clause over service-personnel types. */
export function personnelTypeWhere(typeParam: string | null | undefined): string {
  if (typeParam === 'nss') return `u.user_type = 'nss' AND u.intern_code IS NULL`;
  if (typeParam === 'intern') return `u.user_type = 'nss' AND u.intern_code IS NOT NULL`;
  return `u.user_type = 'nss'`;
}

export interface NssUserRow {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  role: string;
  grade: string | null;
  is_active: number;
  user_type: string;
  nss_number: string | null;
  nss_start_date: string | null;
  nss_end_date: string | null;
  intern_code: string | null;
  institution: string | null;
  programme: string | null;
  supervisor_user_id: string | null;
  supervisor_name: string | null;
  directorate_id: string | null;
  directorate_abbr: string | null;
  pin_acknowledged: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PERSONNEL_SELECT_COLUMNS = `
  u.id, u.name, u.email, u.staff_id, u.role, u.grade, u.is_active,
  u.user_type, u.nss_number, u.nss_start_date, u.nss_end_date,
  u.intern_code, u.institution, u.programme, u.supervisor_user_id,
  sup.name AS supervisor_name,
  u.directorate_id, d.abbreviation AS directorate_abbr,
  u.pin_acknowledged, u.last_login_at, u.created_at, u.updated_at
`;

/* ------------------------------------------------------------------ */
/*  Create — POST /api/admin/nss                                       */
/* ------------------------------------------------------------------ */

const createNssSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).toLowerCase().trim(),
  nss_number: z
    .string()
    .trim()
    .regex(NSS_NUMBER_REGEX, 'NSS number must match format NSSXXX0000000 (e.g. NSSGUE8364724)'),
  nss_start_date: z.string().refine(isValidIsoDate, 'nss_start_date must be ISO YYYY-MM-DD'),
  nss_end_date: z.string().refine(isValidIsoDate, 'nss_end_date must be ISO YYYY-MM-DD'),
  directorate_id: z.string().min(1, 'directorate_id is required'),
  grade: z.string().max(100).optional().or(z.literal('')),
});

adminNssRoutes.post('/', zValidator('json', createNssSchema), async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const body = c.req.valid('json');

  if (body.nss_end_date <= body.nss_start_date) {
    return error(c, 'INVALID_RANGE', 'nss_end_date must be after nss_start_date', 400);
  }

  // Verify directorate exists
  const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?')
    .bind(body.directorate_id)
    .first<{ id: string }>();
  if (!dir) return error(c, 'INVALID_DIRECTORATE', 'directorate_id does not reference an existing directorate', 400);

  // Uniqueness — email
  const existingEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email)
    .first();
  if (existingEmail) return error(c, 'DUPLICATE_EMAIL', 'A user with this email already exists', 409);

  // Uniqueness — nss_number
  const existingNss = await c.env.DB.prepare('SELECT id FROM users WHERE nss_number = ?')
    .bind(body.nss_number)
    .first();
  if (existingNss) return error(c, 'DUPLICATE_NSS_NUMBER', 'A user with this NSS number already exists', 409);

  const id = crypto.randomUUID().replace(/-/g, '');
  const initialPin = generateInitialPin();
  const pinHash = await hashPin(initialPin);

  await c.env.DB.prepare(
    `INSERT INTO users
       (id, name, email, pin_hash, pin_acknowledged, role, grade, directorate_id,
        user_type, nss_number, nss_start_date, nss_end_date, is_active)
     VALUES (?, ?, ?, ?, 0, 'staff', ?, ?, 'nss', ?, ?, ?, 1)`
  )
    .bind(
      id,
      body.name,
      body.email,
      pinHash,
      body.grade || null,
      body.directorate_id,
      body.nss_number,
      body.nss_start_date,
      body.nss_end_date,
    )
    .run();

  const user = await c.env.DB.prepare(
    `SELECT ${PERSONNEL_SELECT_COLUMNS}
     FROM users u
     LEFT JOIN directorates d ON u.directorate_id = d.id
     LEFT JOIN users sup ON sup.id = u.supervisor_user_id
     WHERE u.id = ?`
  )
    .bind(id)
    .first<NssUserRow>();

  return created(c, { user, initial_pin: initialPin });
});

/* ------------------------------------------------------------------ */
/*  List — GET /api/admin/nss                                          */
/* ------------------------------------------------------------------ */

adminNssRoutes.get('/', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const directorateId = c.req.query('directorate_id') ?? null;
  const status = (c.req.query('status') ?? 'active') as 'active' | 'expiring' | 'ended' | 'all';
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);

  const where: string[] = [personnelTypeWhere(c.req.query('type'))];
  const params: unknown[] = [];

  if (directorateId) { where.push('u.directorate_id = ?'); params.push(directorateId); }

  if (status === 'active') {
    where.push('u.is_active = 1');
    where.push('(u.nss_end_date IS NULL OR u.nss_end_date >= ?)');
    params.push(today);
  } else if (status === 'expiring') {
    where.push('u.is_active = 1');
    where.push('u.nss_end_date IS NOT NULL AND u.nss_end_date >= ? AND u.nss_end_date <= ?');
    params.push(today, in30);
  } else if (status === 'ended') {
    where.push('u.nss_end_date IS NOT NULL AND u.nss_end_date < ?');
    params.push(today);
  }
  // 'all' adds no further constraints.

  if (q) {
    where.push('(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.nss_number) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const sql = `
    SELECT ${PERSONNEL_SELECT_COLUMNS}
    FROM users u
    LEFT JOIN directorates d ON u.directorate_id = d.id
    LEFT JOIN users sup ON sup.id = u.supervisor_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const result = await c.env.DB.prepare(sql).bind(...params).all<NssUserRow>();
  return success(c, result.results ?? []);
});

/* ------------------------------------------------------------------ */
/*  Today board — GET /api/admin/nss/today                             */
/*                                                                      */
/*  Active NSS personnel + today's clock_in / clock_out / late flag.    */
/*  Late uses the configured late_threshold_time from app_settings.    */
/* ------------------------------------------------------------------ */

interface NssTodayRow {
  user_id: string;
  name: string;
  user_type: string;
  intern_code: string | null;
  nss_number: string | null;
  directorate_abbr: string | null;
  nss_end_date: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  is_late: number;
}

adminNssRoutes.get('/today', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const today = new Date().toISOString().slice(0, 10);
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);
  const typeClause = personnelTypeWhere(c.req.query('type'));

  const sql = `
    SELECT u.id AS user_id, u.name, u.user_type, u.intern_code, u.nss_number,
           d.abbreviation AS directorate_abbr,
           u.nss_end_date,
           ci.timestamp AS clock_in_at,
           co.timestamp AS clock_out_at,
           CASE WHEN ci.timestamp IS NOT NULL AND TIME(ci.timestamp) > ? THEN 1 ELSE 0 END AS is_late
    FROM users u
    LEFT JOIN directorates d ON u.directorate_id = d.id
    LEFT JOIN clock_records ci
      ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
    LEFT JOIN clock_records co
      ON co.user_id = u.id AND co.type = 'clock_out' AND DATE(co.timestamp) = ?
    WHERE ${typeClause}
      AND u.is_active = 1
      AND (u.nss_end_date IS NULL OR u.nss_end_date >= ?)
    ORDER BY u.name ASC
  `;

  const result = await c.env.DB
    .prepare(sql)
    .bind(lateAfter, today, today, today)
    .all<NssTodayRow>();

  return success(c, result.results ?? []);
});

/* ------------------------------------------------------------------ */
/*  Range export — GET /api/admin/nss/export                           */
/*                                                                      */
/*  Roll-up of NSS attendance over a date range, optionally scoped to  */
/*  one directorate. Used by HR to download NSS-only PDFs/             */
/*  CSVs.                                                               */
/* ------------------------------------------------------------------ */

interface NssExportRow {
  user_id: string;
  name: string;
  nss_number: string | null;
  directorate_abbr: string | null;
  nss_start_date: string | null;
  nss_end_date: string | null;
  current_streak: number;
  clock_ins: number;
  late_count: number;
  absent_days: number;
}

adminNssRoutes.get('/export', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const from = c.req.query('from');
  const to = c.req.query('to');
  const directorateId = c.req.query('directorate_id') ?? null;

  if (!from || !to) {
    return error(c, 'MISSING_RANGE', 'Both from and to query params are required (YYYY-MM-DD)', 400);
  }
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return error(c, 'INVALID_DATE', 'from and to must be ISO YYYY-MM-DD', 400);
  }
  if (to < from) {
    return error(c, 'INVALID_RANGE', '"to" must be on or after "from"', 400);
  }

  // Cap span at 366 days inclusive.
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  const spanDays = Math.round((toMs - fromMs) / 86400_000) + 1;
  if (spanDays > 366) {
    return error(c, 'RANGE_TOO_LARGE', 'Date range may not exceed 366 days', 400);
  }

  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);

  // Working days in the requested range = Monday..Friday count between [from, to] inclusive.
  // Computed in JS to avoid SQLite timezone surprises. This is the *headline* figure shown
  // in the export summary; per-user denominators are clamped further below to each user's
  // actual posting window (so an NSS user who started mid-range isn't unfairly counted absent
  // for days before their nss_start_date).
  let workingDays = 0;
  for (let t = fromMs; t <= toMs; t += 86400_000) {
    const dow = new Date(t).getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) workingDays += 1;
  }

  // Helper — Monday..Friday count between two ISO dates inclusive.
  // Returns 0 if the clamped window is empty (e.g. posting starts after `to`).
  function workingDaysBetween(startIso: string, endIso: string): number {
    const startMs = new Date(`${startIso}T00:00:00Z`).getTime();
    const endMs = new Date(`${endIso}T00:00:00Z`).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return 0;
    let n = 0;
    for (let t = startMs; t <= endMs; t += 86400_000) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6) n += 1;
    }
    return n;
  }

  // Aggregate per-user clock activity inside the range.
  // We only count one clock-in per (user, day) for the totals.
  const typeClause = personnelTypeWhere(c.req.query('type'));
  const where: string[] = [typeClause];
  const params: unknown[] = [];

  if (directorateId) {
    where.push('u.directorate_id = ?');
    params.push(directorateId);
  }

  const sql = `
    WITH nss_clock_in_days AS (
      SELECT cr.user_id, DATE(cr.timestamp) AS d, MIN(TIME(cr.timestamp)) AS first_in
      FROM clock_records cr
      INNER JOIN users u ON u.id = cr.user_id AND ${typeClause}
      WHERE cr.type = 'clock_in'
        AND DATE(cr.timestamp) BETWEEN ? AND ?
      GROUP BY cr.user_id, DATE(cr.timestamp)
    )
    SELECT u.id AS user_id, u.name, u.nss_number,
           d.abbreviation AS directorate_abbr,
           u.nss_start_date, u.nss_end_date, u.current_streak,
           COALESCE(COUNT(ci.d), 0) AS clock_ins,
           COALESCE(SUM(CASE WHEN ci.first_in > ? THEN 1 ELSE 0 END), 0) AS late_count
    FROM users u
    LEFT JOIN directorates d ON u.directorate_id = d.id
    LEFT JOIN nss_clock_in_days ci ON ci.user_id = u.id
    WHERE ${where.join(' AND ')}
    GROUP BY u.id
    ORDER BY d.abbreviation ASC, u.name ASC
  `;

  const result = await c.env.DB
    .prepare(sql)
    .bind(from, to, lateAfter, ...params)
    .all<{
      user_id: string;
      name: string;
      nss_number: string | null;
      directorate_abbr: string | null;
      nss_start_date: string | null;
      nss_end_date: string | null;
      current_streak: number;
      clock_ins: number;
      late_count: number;
    }>();

  const rows: NssExportRow[] = (result.results ?? []).map(r => {
    // Clamp the per-user working-days denominator to the intersection of
    // [from, to] and the NSS user's actual posting window
    // [nss_start_date, nss_end_date]. Without this an NSS user who started
    // mid-range would be marked absent for every working day before they
    // even arrived (and same after their service ends).
    //
    // Pseudocode:
    //   effectiveStart = max(from, nss_start_date ?? from)
    //   effectiveEnd   = min(to,   nss_end_date   ?? to)
    //   userWorkingDays = workingDaysBetween(effectiveStart, effectiveEnd)  // 0 if empty
    //   absent_days     = max(0, userWorkingDays - clock_ins)
    const effectiveStart = r.nss_start_date && r.nss_start_date > from ? r.nss_start_date : from;
    const effectiveEnd = r.nss_end_date && r.nss_end_date < to ? r.nss_end_date : to;
    const userWorkingDays = workingDaysBetween(effectiveStart, effectiveEnd);

    return {
      user_id: r.user_id,
      name: r.name,
      nss_number: r.nss_number,
      directorate_abbr: r.directorate_abbr,
      nss_start_date: r.nss_start_date,
      nss_end_date: r.nss_end_date,
      current_streak: r.current_streak ?? 0,
      clock_ins: r.clock_ins ?? 0,
      late_count: r.late_count ?? 0,
      absent_days: Math.max(0, userWorkingDays - (r.clock_ins ?? 0)),
    };
  });

  return success(c, {
    range: { from, to, working_days: workingDays },
    directorate_id: directorateId,
    total_users: rows.length,
    rows,
  });
});

/* ------------------------------------------------------------------ */
/*  Manual end-of-service trigger — POST /api/admin/nss/run-eos         */
/*                                                                      */
/*  Runs the same routine as the 00:30 UTC cron: auto-deactivates any  */
/*  NSS user past nss_end_date and dispatches the "ending this week"   */
/*  Telegram digest to admin subscribers. Used as a smoke-test path    */
/*  after deploy and as an on-demand admin escape hatch.               */
/* ------------------------------------------------------------------ */

adminNssRoutes.post('/run-eos', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const result = await runNssEndOfServiceCheck(c.env);
  return success(c, result);
});

/* ------------------------------------------------------------------ */
/*  Recent clock activity — GET /api/admin/nss/:id/activity            */
/*                                                                      */
/*  Last 14 days of clock_records for an NSS user.                     */
/* ------------------------------------------------------------------ */

interface NssActivityRow {
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  is_late: number;
}

adminNssRoutes.get('/:id/activity', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const existing = await c.env.DB
    .prepare(`SELECT id, user_type FROM users WHERE id = ?`)
    .bind(id)
    .first<{ id: string; user_type: string }>();

  if (!existing) return notFound(c, 'Personnel');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_PERSONNEL', 'Target user is not service personnel', 400);
  }

  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);

  // Pull all clock records in the last 14 days, group by date in JS.
  const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10);
  const records = await c.env.DB
    .prepare(
      `SELECT DATE(timestamp) AS date, type, TIME(timestamp) AS time
       FROM clock_records
       WHERE user_id = ? AND DATE(timestamp) >= ?
       ORDER BY timestamp DESC`
    )
    .bind(id, since)
    .all<{ date: string; type: string; time: string }>();

  const days = new Map<string, NssActivityRow>();
  for (const r of records.results ?? []) {
    const day = days.get(r.date) ?? { date: r.date, clock_in: null, clock_out: null, is_late: 0 };
    if (r.type === 'clock_in') {
      day.clock_in = r.time;
      day.is_late = r.time > lateAfter ? 1 : 0;
    } else if (r.type === 'clock_out') {
      day.clock_out = r.time;
    }
    days.set(r.date, day);
  }

  const out = Array.from(days.values()).sort((a, b) => b.date.localeCompare(a.date));
  return success(c, out);
});

/* ------------------------------------------------------------------ */
/*  Detail — GET /api/admin/nss/:id                                    */
/* ------------------------------------------------------------------ */

adminNssRoutes.get('/:id', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT ${PERSONNEL_SELECT_COLUMNS}
     FROM users u
     LEFT JOIN directorates d ON u.directorate_id = d.id
     LEFT JOIN users sup ON sup.id = u.supervisor_user_id
     WHERE u.id = ? AND u.user_type = 'nss'`
  )
    .bind(id)
    .first<NssUserRow>();

  if (!row) return notFound(c, 'Personnel');
  return success(c, row);
});

/* ------------------------------------------------------------------ */
/*  Update — PATCH /api/admin/nss/:id                                  */
/* ------------------------------------------------------------------ */

const updateNssSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  grade: z.string().max(100).optional().or(z.literal('')),
  directorate_id: z.string().min(1).optional(),
  nss_start_date: z.string().refine(isValidIsoDate, 'nss_start_date must be ISO YYYY-MM-DD').optional(),
  nss_end_date: z.string().refine(isValidIsoDate, 'nss_end_date must be ISO YYYY-MM-DD').optional(),
  is_active: z.number().min(0).max(1).optional(),
  institution: z.string().max(200).optional().or(z.literal('')),
  programme: z.string().max(200).optional().or(z.literal('')),
  supervisor_user_id: z.string().max(64).optional().or(z.literal('')),
});

adminNssRoutes.patch('/:id', zValidator('json', updateNssSchema), async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    `SELECT id, user_type, nss_start_date, nss_end_date FROM users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; user_type: string; nss_start_date: string | null; nss_end_date: string | null }>();

  if (!existing) return notFound(c, 'Personnel');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_PERSONNEL', 'Target user is not service personnel', 400);
  }

  // Resolved final dates (after edits) — used to validate ordering.
  const finalStart = body.nss_start_date ?? existing.nss_start_date;
  const finalEnd = body.nss_end_date ?? existing.nss_end_date;
  if (finalStart && finalEnd && finalEnd <= finalStart) {
    return error(c, 'INVALID_RANGE', 'nss_end_date must be after nss_start_date', 400);
  }

  if (body.directorate_id !== undefined) {
    const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?')
      .bind(body.directorate_id)
      .first();
    if (!dir) return error(c, 'INVALID_DIRECTORATE', 'directorate_id does not reference an existing directorate', 400);
  }

  if (body.supervisor_user_id !== undefined && body.supervisor_user_id) {
    const sup = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ? AND user_type = 'staff'`)
      .bind(body.supervisor_user_id)
      .first();
    if (!sup) return error(c, 'INVALID_SUPERVISOR', 'supervisor_user_id must reference an existing staff user', 400);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.grade !== undefined) { fields.push('grade = ?'); values.push(body.grade || null); }
  if (body.directorate_id !== undefined) { fields.push('directorate_id = ?'); values.push(body.directorate_id); }
  if (body.nss_start_date !== undefined) { fields.push('nss_start_date = ?'); values.push(body.nss_start_date); }
  if (body.nss_end_date !== undefined) { fields.push('nss_end_date = ?'); values.push(body.nss_end_date); }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active); }
  if (body.institution !== undefined) { fields.push('institution = ?'); values.push(body.institution || null); }
  if (body.programme !== undefined) { fields.push('programme = ?'); values.push(body.programme || null); }
  if (body.supervisor_user_id !== undefined) { fields.push('supervisor_user_id = ?'); values.push(body.supervisor_user_id || null); }

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  if (fields.length > 1) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const row = await c.env.DB.prepare(
    `SELECT ${PERSONNEL_SELECT_COLUMNS}
     FROM users u
     LEFT JOIN directorates d ON u.directorate_id = d.id
     LEFT JOIN users sup ON sup.id = u.supervisor_user_id
     WHERE u.id = ?`
  )
    .bind(id)
    .first<NssUserRow>();

  return success(c, row);
});

/* ------------------------------------------------------------------ */
/*  Soft delete — DELETE /api/admin/nss/:id                            */
/* ------------------------------------------------------------------ */

adminNssRoutes.delete('/:id', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, user_type FROM users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; user_type: string }>();

  if (!existing) return notFound(c, 'Personnel');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_PERSONNEL', 'Target user is not service personnel', 400);
  }

  await c.env.DB.prepare(
    `UPDATE users SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  )
    .bind(id)
    .run();

  return success(c, { message: 'Personnel deactivated' });
});

/* ------------------------------------------------------------------ */
/*  Reset PIN — POST /api/admin/nss/:id/reset-pin                      */
/* ------------------------------------------------------------------ */

adminNssRoutes.post('/:id/reset-pin', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, user_type FROM users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; user_type: string }>();

  if (!existing) return notFound(c, 'Personnel');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_PERSONNEL', 'Target user is not service personnel', 400);
  }

  const initialPin = generateInitialPin();
  const pinHash = await hashPin(initialPin);

  await c.env.DB.prepare(
    `UPDATE users
        SET pin_hash = ?, pin_acknowledged = 0,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?`
  )
    .bind(pinHash, id)
    .run();

  return success(c, { initial_pin: initialPin });
});

/* ------------------------------------------------------------------ */
/*  Bulk import — POST /api/admin/nss/bulk-import                       */
/*                                                                      */
/*  Accepts either:                                                     */
/*    { csv: "header,...\nrow,..." }    — CSV string                    */
/*    { rows: [ { ... } ] }              — pre-parsed rows               */
/* ------------------------------------------------------------------ */

interface BulkImportRow {
  name?: string;
  email?: string;
  nss_number?: string;
  nss_start_date?: string;
  nss_end_date?: string;
  directorate_abbreviation?: string;
}

const NSS_BULK_HEADERS = [
  'name',
  'email',
  'nss_number',
  'nss_start_date',
  'nss_end_date',
  'directorate_abbreviation',
] as const;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function parseCsv(text: string): BulkImportRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows: BulkImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    rows.push(row as BulkImportRow);
  }
  return rows;
}

adminNssRoutes.post('/bulk-import', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  let payload: { csv?: string; rows?: unknown[] };
  try {
    payload = (await c.req.json()) as { csv?: string; rows?: unknown[] };
  } catch {
    return error(c, 'BAD_JSON', 'Body must be valid JSON: { csv } or { rows }', 400);
  }

  let rows: BulkImportRow[] = [];
  if (typeof payload.csv === 'string' && payload.csv.trim().length > 0) {
    rows = parseCsv(payload.csv);
  } else if (Array.isArray(payload.rows)) {
    rows = payload.rows as BulkImportRow[];
  } else {
    return error(c, 'EMPTY', 'Provide either "csv" string or "rows" array', 400);
  }

  if (rows.length === 0) return error(c, 'EMPTY', 'No rows to import', 400);
  if (rows.length > 200) return error(c, 'TOO_MANY', 'Maximum 200 rows per import', 400);

  // Pre-fetch directorate abbreviation -> id map for performance & consistency.
  const dirRes = await c.env.DB.prepare('SELECT id, abbreviation FROM directorates').all<{ id: string; abbreviation: string }>();
  const dirMap = new Map<string, string>();
  for (const d of dirRes.results ?? []) {
    dirMap.set(d.abbreviation.toUpperCase(), d.id);
  }

  const skipped: Array<{ row: number; reason: string }> = [];
  const inserted: Array<{ row: number; id: string; name: string; email: string; nss_number: string; initial_pin: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for 1-indexed, +1 for header
    const r = rows[i] ?? {};

    const name = (r.name ?? '').toString().trim();
    const email = (r.email ?? '').toString().trim().toLowerCase();
    const nss_number = (r.nss_number ?? '').toString().trim();
    const nss_start_date = (r.nss_start_date ?? '').toString().trim();
    const nss_end_date = (r.nss_end_date ?? '').toString().trim();
    const dirAbbrRaw = (r.directorate_abbreviation ?? '').toString().trim();
    const dirAbbr = dirAbbrRaw.toUpperCase();

    if (!name) { skipped.push({ row: rowNumber, reason: 'name is required' }); continue; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ row: rowNumber, reason: 'invalid email' }); continue;
    }
    if (!NSS_NUMBER_REGEX.test(nss_number)) {
      skipped.push({ row: rowNumber, reason: 'nss_number must match NSSXXX0000000' }); continue;
    }
    if (!isValidIsoDate(nss_start_date)) {
      skipped.push({ row: rowNumber, reason: 'nss_start_date must be ISO YYYY-MM-DD' }); continue;
    }
    if (!isValidIsoDate(nss_end_date)) {
      skipped.push({ row: rowNumber, reason: 'nss_end_date must be ISO YYYY-MM-DD' }); continue;
    }
    if (nss_end_date <= nss_start_date) {
      skipped.push({ row: rowNumber, reason: 'nss_end_date must be after nss_start_date' }); continue;
    }
    const directorateId = dirMap.get(dirAbbr);
    if (!directorateId) {
      skipped.push({ row: rowNumber, reason: `unknown directorate_abbreviation: ${dirAbbrRaw}` }); continue;
    }

    // Uniqueness — email
    const dupEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (dupEmail) { skipped.push({ row: rowNumber, reason: `duplicate email: ${email}` }); continue; }

    // Uniqueness — nss_number
    const dupNss = await c.env.DB.prepare('SELECT id FROM users WHERE nss_number = ?').bind(nss_number).first();
    if (dupNss) { skipped.push({ row: rowNumber, reason: `duplicate nss_number: ${nss_number}` }); continue; }

    const id = crypto.randomUUID().replace(/-/g, '');
    const initialPin = generateInitialPin();
    const pinHash = await hashPin(initialPin);

    await c.env.DB.prepare(
      `INSERT INTO users
         (id, name, email, pin_hash, pin_acknowledged, role, directorate_id,
          user_type, nss_number, nss_start_date, nss_end_date, is_active)
       VALUES (?, ?, ?, ?, 0, 'staff', ?, 'nss', ?, ?, ?, 1)`
    )
      .bind(id, name, email, pinHash, directorateId, nss_number, nss_start_date, nss_end_date)
      .run();

    inserted.push({ row: rowNumber, id, name, email, nss_number, initial_pin: initialPin });
  }

  return success(c, {
    inserted: inserted.length,
    skipped,
    pins: inserted.map(({ row, name, email, nss_number, initial_pin }) => ({ row, name, email, nss_number, initial_pin })),
  });
});

export const NSS_BULK_IMPORT_HEADERS = NSS_BULK_HEADERS;
