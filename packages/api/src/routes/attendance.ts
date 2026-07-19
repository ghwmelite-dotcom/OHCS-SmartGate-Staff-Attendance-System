import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendAbsenceNoticePush, type AbsenceNoticeInput } from '../services/reminders';
import { getAppSettings, toSqlTime } from '../services/settings';
import { recordAudit, auditActorFromContext, diffRecords } from '../services/audit';
import { riskBand, type RiskFactor } from '../services/risk-score';

export const attendanceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireAdmin(c: { get: (key: 'session') => SessionData }) {
  const role = c.get('session').role;
  return role === 'superadmin' || role === 'admin';
}

type UserTypeSegment = 'staff' | 'nss' | 'intern' | 'all';

/**
 * Parse the optional ?user_type query into a normalised segment.
 * Default 'staff' preserves the historical behaviour for callers that
 * don't pass the param.
 */
function parseUserTypeSegment(raw: string | undefined): UserTypeSegment {
  if (raw === 'nss' || raw === 'intern' || raw === 'all') return raw;
  return 'staff';
}

/**
 * Build the user_type filter for a population query over the `users` table,
 * for a given table alias. Interns share user_type='nss' and are distinguished
 * by a non-null intern_code:
 *   staff  → user_type = 'staff'
 *   nss    → real NSS only   → user_type = 'nss' AND intern_code IS NULL
 *   intern → interns only    → user_type = 'nss' AND intern_code IS NOT NULL
 *   all    → no filter
 * Returns a fixed clause string (no user input interpolated) — the caller binds NO params.
 */
function userTypeClause(segment: UserTypeSegment, alias: string): string {
  switch (segment) {
    case 'staff':
      return `${alias}.user_type = 'staff'`;
    case 'nss':
      return `${alias}.user_type = 'nss' AND ${alias}.intern_code IS NULL`;
    case 'intern':
      return `${alias}.user_type = 'nss' AND ${alias}.intern_code IS NOT NULL`;
    case 'all':
    default:
      return '';
  }
}

// Today's attendance overview
attendanceRoutes.get('/today', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const today = new Date().toISOString().slice(0, 10);
  const segment = parseUserTypeSegment(c.req.query('user_type'));
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);
  const endAt = toSqlTime(settings.work_end_time);

  // user_type filter on the population (total_staff) and on the joined users for clock counts.
  // Fixed clause strings only — no user input is interpolated/bound.
  const populationClause = userTypeClause(segment, 'users');
  const userTypeUserSql = populationClause ? `AND ${populationClause}` : '';

  // For clock counts we must join clock_records to users to filter by user_type.
  const existsClause = userTypeClause(segment, 'u');
  const userTypeJoinSql = existsClause
    ? `AND EXISTS (SELECT 1 FROM users u WHERE u.id = cr.user_id AND ${existsClause})`
    : '';

  const [totalStaff, clockedIn, clockedOut, lateArrivals, earlyDepartures] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM users WHERE is_active = 1 ${userTypeUserSql}`)
      .first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ? ${userTypeJoinSql}`
    ).bind(today).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_out' AND DATE(cr.timestamp) = ? ${userTypeJoinSql}`
    ).bind(today).first<{ count: number }>(),

    // Late = clocked in after configured late threshold
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ? AND TIME(cr.timestamp) > ? ${userTypeJoinSql}`
    ).bind(today, lateAfter).first<{ count: number }>(),

    // Early departure = clocked out before work_end_time
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_out' AND DATE(cr.timestamp) = ? AND TIME(cr.timestamp) < ? ${userTypeJoinSql}`
    ).bind(today, endAt).first<{ count: number }>(),
  ]);

  const total = totalStaff?.count ?? 0;
  const present = clockedIn?.count ?? 0;

  return success(c, {
    total_staff: total,
    clocked_in: present,
    clocked_out: clockedOut?.count ?? 0,
    not_clocked_in: total - present,
    late_arrivals: lateArrivals?.count ?? 0,
    early_departures: earlyDepartures?.count ?? 0,
    attendance_rate: total > 0 ? Math.round((present / total) * 100) : 0,
  });
});

// Today's detailed records
attendanceRoutes.get('/records', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const directorateId = c.req.query('directorate_id');
  const segment = parseUserTypeSegment(c.req.query('user_type'));
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);
  const endAt = toSqlTime(settings.work_end_time);

  let sql = `SELECT u.id as user_id, u.name, u.staff_id, u.role, u.user_type,
                    d.abbreviation as directorate_abbr,
                    ci.timestamp as clock_in_time, co.timestamp as clock_out_time,
                    ci.photo_url as clock_in_photo,
                    ci.reauth_method as clock_in_reauth_method,
                    co.reauth_method as clock_out_reauth_method,
                    ci.liveness_decision as liveness_decision,
                    ci.liveness_signature as liveness_signature,
                    ci.presence_method as presence_method,
                    ci.presence_token_window as presence_token_window,
                    ci.risk_score as risk_score,
                    ci.risk_factors as risk_factors,
                    ci.risk_disposition as risk_disposition,
                    ci.id as clock_in_id,
                    CASE WHEN TIME(ci.timestamp) > ? THEN 1 ELSE 0 END as is_late,
                    CASE WHEN co.timestamp IS NOT NULL AND TIME(co.timestamp) < ? THEN 1 ELSE 0 END as is_early_departure,
                    u.current_streak
             FROM users u
             LEFT JOIN directorates d ON u.directorate_id = d.id
             LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
             LEFT JOIN clock_records co ON co.user_id = u.id AND co.type = 'clock_out' AND DATE(co.timestamp) = ?
             WHERE u.is_active = 1`;
  const params: unknown[] = [lateAfter, endAt, date, date];

  const recordsClause = userTypeClause(segment, 'u');
  if (recordsClause) {
    sql += ` AND ${recordsClause}`;
  }

  if (directorateId) {
    sql += ' AND u.directorate_id = ?';
    params.push(directorateId);
  }

  sql += ' ORDER BY ci.timestamp ASC, u.name ASC';

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

// Risk-score distribution — the shadow-phase calibration instrument (spec §4:
// bands, histogram, per-directorate breakdown, top factors by frequency).
// Aggregates in JS, mirroring /clock/admin/liveness-metrics. ?days default 14, clamp 1-30.
attendanceRoutes.get('/risk-distribution', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const days = Math.min(30, Math.max(1, Number(c.req.query('days') ?? 14)));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const rows = await c.env.DB.prepare(
    `SELECT cr.risk_score, cr.risk_factors, d.abbreviation
     FROM clock_records cr
     JOIN users u ON u.id = cr.user_id
     LEFT JOIN directorates d ON d.id = u.directorate_id
     WHERE cr.risk_score IS NOT NULL AND cr.timestamp >= ?`
  ).bind(since).all<{ risk_score: number; risk_factors: string | null; abbreviation: string | null }>();

  const all = rows.results ?? [];
  const bands = { clear: 0, review: 0, high: 0 };
  const histogram = Array.from({ length: 10 }, (_, i) => ({ min: i * 10, max: i * 10 + 9, count: 0 }));
  const perDirectorate = new Map<string | null, { abbreviation: string | null; scored: number; score_sum: number; clear: number; review: number; high: number }>();
  const factorCounts = new Map<string, { name: string; condition: string; count: number; total_weight: number }>();

  for (const r of all) {
    const band = riskBand(r.risk_score);
    bands[band] += 1;
    // Score 100 falls in the last bucket (labelled 90-99) — clamped, like the score itself.
    histogram[Math.min(9, Math.floor(r.risk_score / 10))]!.count += 1;

    const dir = perDirectorate.get(r.abbreviation)
      ?? { abbreviation: r.abbreviation, scored: 0, score_sum: 0, clear: 0, review: 0, high: 0 };
    dir.scored += 1;
    dir.score_sum += r.risk_score;
    dir[band] += 1;
    perDirectorate.set(r.abbreviation, dir);

    if (r.risk_factors) {
      try {
        for (const f of JSON.parse(r.risk_factors) as RiskFactor[]) {
          const key = `${f.name}:${f.condition}`;
          const slot = factorCounts.get(key) ?? { name: f.name, condition: f.condition, count: 0, total_weight: 0 };
          slot.count += 1;
          slot.total_weight += f.weight;
          factorCounts.set(key, slot);
        }
      } catch { /* ignore parse errors — same discipline as liveness-metrics */ }
    }
  }

  const per_directorate = [...perDirectorate.values()]
    .map((d) => ({
      abbreviation: d.abbreviation,
      scored: d.scored,
      avg_score: Math.round((d.score_sum / d.scored) * 10) / 10,
      clear: d.clear,
      review: d.review,
      high: d.high,
    }))
    .sort((a, b) => String(a.abbreviation ?? '').localeCompare(String(b.abbreviation ?? '')));

  const top_factors = [...factorCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return success(c, { days, since, total_scored: all.length, bands, histogram, per_directorate, top_factors });
});

// Manual-review disposition of a risk-flagged clock row (spec §4 — audited).
const riskDispositionSchema = z.object({ disposition: z.enum(['dismissed', 'escalated']) });

attendanceRoutes.post('/records/:clockId/risk-disposition', zValidator('json', riskDispositionSchema), async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const clockId = c.req.param('clockId');
  const { disposition } = c.req.valid('json');

  const before = await c.env.DB.prepare(
    'SELECT id, risk_score, risk_disposition FROM clock_records WHERE id = ?'
  ).bind(clockId).first<{ id: string; risk_score: number | null; risk_disposition: string | null }>();
  if (!before || before.risk_score === null) {
    return error(c, 'NOT_FOUND', 'Clock record not found (or not risk-scored)', 404);
  }

  await c.env.DB.prepare('UPDATE clock_records SET risk_disposition = ? WHERE id = ?')
    .bind(disposition, clockId).run();

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'clock.risk_disposition', entityType: 'clock_record', entityId: clockId,
    summary: `Risk disposition '${disposition}' on clock record (score ${before.risk_score})`,
    changes: diffRecords(before, { ...before, risk_disposition: disposition }, ['risk_disposition']),
  });

  return success(c, { id: clockId, risk_disposition: disposition });
});

// Directorate breakdown
attendanceRoutes.get('/by-directorate', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const segment = parseUserTypeSegment(c.req.query('user_type'));
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);

  // Filter the user join itself by user_type so directorate counts match the segment.
  // Fixed clause string only — no user input is bound.
  const byDirClause = userTypeClause(segment, 'u');
  const userTypeJoin = byDirClause ? `AND ${byDirClause}` : '';
  const params: unknown[] = [lateAfter];
  params.push(date);

  const results = await c.env.DB.prepare(
    `SELECT d.abbreviation, d.name,
            COUNT(DISTINCT u.id) as total_staff,
            COUNT(DISTINCT ci.user_id) as present,
            COUNT(DISTINCT CASE WHEN TIME(ci.timestamp) > ? THEN ci.user_id END) as late
     FROM directorates d
     LEFT JOIN users u ON u.directorate_id = d.id AND u.is_active = 1 ${userTypeJoin}
     LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
     WHERE d.is_active = 1
     GROUP BY d.id
     ORDER BY d.abbreviation`
  ).bind(...params).all();

  return success(c, results.results ?? []);
});

// Monthly summary for a user
attendanceRoutes.get('/user/:userId/monthly', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const userId = c.req.param('userId');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7); // YYYY-MM

  const records = await c.env.DB.prepare(
    `SELECT DATE(timestamp) as date, type, TIME(timestamp) as time
     FROM clock_records WHERE user_id = ? AND strftime('%Y-%m', timestamp) = ?
     ORDER BY timestamp`
  ).bind(userId, month).all();

  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(userId).first();

  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);

  // Group by date
  const days: Record<string, { clock_in?: string; clock_out?: string; is_late: boolean }> = {};
  for (const r of (records.results ?? []) as Array<{ date: string; type: string; time: string }>) {
    if (!days[r.date]) days[r.date] = { is_late: false };
    if (r.type === 'clock_in') {
      days[r.date]!.clock_in = r.time;
      days[r.date]!.is_late = r.time > lateAfter;
    }
    if (r.type === 'clock_out') days[r.date]!.clock_out = r.time;
  }

  const totalDays = Object.keys(days).length;
  const lateDays = Object.values(days).filter(d => d.is_late).length;

  return success(c, {
    user,
    month,
    total_days_present: totalDays,
    late_days: lateDays,
    on_time_days: totalDays - lateDays,
    daily_records: days,
  });
});

// Leave requests
const leaveSchema = z.object({
  type: z.enum(['annual', 'sick', 'permission', 'compassionate', 'maternity', 'study']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).optional(),
});

attendanceRoutes.post('/leave', zValidator('json', leaveSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    'INSERT INTO leave_requests (id, user_id, type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, session.userId, body.type, body.start_date, body.end_date, body.reason || null).run();

  return success(c, { id, status: 'pending' });
});

attendanceRoutes.get('/leave', async (c) => {
  const session = c.get('session');
  const isAdmin = session.role === 'superadmin' || session.role === 'admin';

  let sql: string;
  const params: unknown[] = [];

  if (isAdmin) {
    sql = `SELECT lr.*, u.name, u.staff_id FROM leave_requests lr JOIN users u ON lr.user_id = u.id ORDER BY lr.created_at DESC LIMIT 50`;
  } else {
    sql = `SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`;
    params.push(session.userId);
  }

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

/**
 * Shared decision guard for leave approve/reject:
 *  - existence: 404 if no such request
 *  - self-approval: 403 if the approver is the request owner
 *  - state: 409 if the request is no longer pending (already decided)
 * The UPDATE is scoped `WHERE id = ? AND status = 'pending'` and we re-check
 * meta.changes so two concurrent decisions can't both succeed.
 * leave_requests has `approved_by` (per schema) but NO decided_at column, so we
 * only record approved_by. Returns a Response on rejection, or null to proceed.
 */
async function guardLeaveDecision(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>,
  id: string,
  approverId: string,
): Promise<Response | null> {
  const existing = await c.env.DB.prepare(
    'SELECT id, user_id, status FROM leave_requests WHERE id = ?'
  ).bind(id).first<{ id: string; user_id: string; status: string }>();

  if (!existing) return error(c, 'NOT_FOUND', 'Leave request not found', 404);
  if (existing.user_id === approverId) {
    return error(c, 'SELF_APPROVAL', 'You cannot decide on your own leave request', 403);
  }
  if (existing.status !== 'pending') {
    return error(c, 'ALREADY_DECIDED', `Leave request is already ${existing.status}`, 409);
  }
  return null;
}

attendanceRoutes.post('/leave/:id/approve', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const id = c.req.param('id');
  const session = c.get('session');

  const guard = await guardLeaveDecision(c, id, session.userId);
  if (guard) return guard;

  const result = await c.env.DB.prepare(
    "UPDATE leave_requests SET status = 'approved', approved_by = ? WHERE id = ? AND status = 'pending'"
  ).bind(session.userId, id).run();

  // Lost the race to a concurrent decision between the guard read and this write.
  if ((result.meta?.changes ?? 0) === 0) {
    return error(c, 'ALREADY_DECIDED', 'Leave request has already been decided', 409);
  }

  return success(c, { message: 'Leave approved' });
});

attendanceRoutes.post('/leave/:id/reject', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const id = c.req.param('id');
  const session = c.get('session');

  const guard = await guardLeaveDecision(c, id, session.userId);
  if (guard) return guard;

  const result = await c.env.DB.prepare(
    "UPDATE leave_requests SET status = 'rejected', approved_by = ? WHERE id = ? AND status = 'pending'"
  ).bind(session.userId, id).run();

  if ((result.meta?.changes ?? 0) === 0) {
    return error(c, 'ALREADY_DECIDED', 'Leave request has already been decided', 409);
  }

  return success(c, { message: 'Leave rejected' });
});

const absenceNoticeSchema = z.object({
  reason: z.enum(['sick', 'family_emergency', 'transport', 'other']),
  note: z.string().max(200).optional(),
  expected_return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

attendanceRoutes.post('/absence-notice', zValidator('json', absenceNoticeSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const today = new Date().toISOString().slice(0, 10);

  // expected_return_date is the day they're BACK at work (exclusive — they are not absent on that day),
  // so it must be strictly after today.
  if (body.expected_return_date && body.expected_return_date <= today) {
    return error(c, 'INVALID_DATE', 'Expected return date must be after today', 400);
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, session.userId, body.reason, body.note ?? null, today, body.expected_return_date ?? null).run();

  const notice: AbsenceNoticeInput = {
    id,
    user_id: session.userId,
    reason: body.reason,
    note: body.note ?? null,
    notice_date: today,
    expected_return_date: body.expected_return_date ?? null,
  };

  c.executionCtx.waitUntil(sendAbsenceNoticePush(c.env, notice));

  return success(c, notice);
});

attendanceRoutes.get('/absence-notice/today', async (c) => {
  const session = c.get('session');
  const today = new Date().toISOString().slice(0, 10);

  // Active absence spans [notice_date, expected_return_date). If return date is null,
  // the notice covers only notice_date itself.
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, reason, note, notice_date, expected_return_date, created_at
     FROM absence_notices
     WHERE user_id = ?
       AND ? >= notice_date
       AND ? < COALESCE(expected_return_date, DATE(notice_date, '+1 day'))
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(session.userId, today, today).first();

  return success(c, row ?? null);
});
