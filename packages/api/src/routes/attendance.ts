import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendAbsenceNoticePush, type AbsenceNoticeInput } from '../services/reminders';
import { getAppSettings, toSqlTime } from '../services/settings';
import { recordAudit, auditActorFromContext, diffRecords } from '../services/audit';
import { riskBand, type RiskFactor } from '../services/risk-score';
import { clockEffectiveDateSql } from '../lib/clock-date';
import { resolveDirectorateScope, DIRECTORATE_SCOPE_NONE } from '../lib/directorate-scope';

export const attendanceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireAdmin(c: { get: (key: 'session') => SessionData }) {
  const role = c.get('session').role;
  return role === 'superadmin' || role === 'admin';
}

// Read-only oversight gate for /today, /records, /by-directorate: the admin
// tier plus directors (scoped to their directorate; CD/HoS pass org-wide via
// the scope resolver's display_role handling).
function requireOversight(c: { get: (key: 'session') => SessionData }) {
  const role = c.get('session').role;
  return role === 'superadmin' || role === 'admin' || role === 'director';
}

type AppContext = Context<{ Bindings: Env; Variables: { session: SessionData } }>;

/**
 * Resolve the caller's directorate scope for the oversight endpoints.
 * Returns a directorate id (forced filter — overrides any client-passed
 * directorate_id), null when unscoped (admin tier / CD / HoS), or a 403
 * Response when a director has no linked directorate (fail-closed, NOT zeros).
 */
async function oversightScope(c: AppContext): Promise<string | null | Response> {
  const scope = await resolveDirectorateScope(c);
  if (scope === DIRECTORATE_SCOPE_NONE) {
    return error(c, 'FORBIDDEN', 'Director account has no linked directorate', 403);
  }
  return scope;
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

// Attendance overview for a date (default: today)
attendanceRoutes.get('/today', async (c) => {
  if (!requireOversight(c)) return error(c, 'FORBIDDEN', 'Admin or director access required', 403);
  const scoped = await oversightScope(c);
  if (scoped instanceof Response) return scoped;
  const scope = scoped; // directorate id (forced) | null (unscoped)
  const today = new Date().toISOString().slice(0, 10);
  const dateParam = c.req.query('date');
  if (dateParam !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return error(c, 'BAD_DATE', 'date must be YYYY-MM-DD', 400);
  }
  const date = dateParam ?? today;
  // Past-date registers include deactivated users who have a clock record that
  // day (same population rule as /records); today stays active-only.
  const isPast = date < today;
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

  // Director scoping: population and every clock count are forced to the
  // caller's directorate (resolved server-side; client params can't widen it).
  const populationScopeSql = scope ? 'AND users.directorate_id = ?' : '';
  const clockScopeSql = scope
    ? 'AND EXISTS (SELECT 1 FROM users su WHERE su.id = cr.user_id AND su.directorate_id = ?)'
    : '';
  // Scope params bind LAST (the scope clauses are appended after all others).
  const withScope = (params: unknown[]) => (scope ? [...params, scope] : params);

  // Clock rows are matched by their EFFECTIVE date (device_info.capturedDate ??
  // server timestamp date) so offline replays count toward the capture day —
  // this keeps the counts in agreement with the /records register.
  const crDate = clockEffectiveDateSql('cr');

  // Population: today (and future) = active users; past dates = active users
  // OR anyone with a clock-in that day (deactivated staff stay on the days
  // they actually worked), mirroring /records.
  const populationSql = isPast
    ? `SELECT COUNT(*) as count FROM users
       WHERE (is_active = 1 OR EXISTS (
         SELECT 1 FROM clock_records crp
         WHERE crp.user_id = users.id AND crp.type = 'clock_in' AND ${clockEffectiveDateSql('crp')} = ?
       )) ${userTypeUserSql} ${populationScopeSql}`
    : `SELECT COUNT(*) as count FROM users WHERE is_active = 1 ${userTypeUserSql} ${populationScopeSql}`;

  const [totalStaff, clockedIn, clockedOut, lateArrivals, earlyDepartures] = await Promise.all([
    isPast
      ? c.env.DB.prepare(populationSql).bind(...withScope([date])).first<{ count: number }>()
      : c.env.DB.prepare(populationSql).bind(...withScope([])).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_in' AND ${crDate} = ? ${userTypeJoinSql} ${clockScopeSql}`
    ).bind(...withScope([date])).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_out' AND ${crDate} = ? ${userTypeJoinSql} ${clockScopeSql}`
    ).bind(...withScope([date])).first<{ count: number }>(),

    // Late = clocked in after configured late threshold
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_in' AND ${crDate} = ? AND TIME(cr.timestamp) > ? ${userTypeJoinSql} ${clockScopeSql}`
    ).bind(...withScope([date, lateAfter])).first<{ count: number }>(),

    // Early departure = clocked out before work_end_time
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_out' AND ${crDate} = ? AND TIME(cr.timestamp) < ? ${userTypeJoinSql} ${clockScopeSql}`
    ).bind(...withScope([date, endAt])).first<{ count: number }>(),
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
  if (!requireOversight(c)) return error(c, 'FORBIDDEN', 'Admin or director access required', 403);
  const scoped = await oversightScope(c);
  if (scoped instanceof Response) return scoped;

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  // Past-date registers include deactivated users who have a clock record that
  // day; today's register keeps the active-only population exactly as before.
  const isPast = date < new Date().toISOString().slice(0, 10);
  // A director's resolved scope overrides any client-passed directorate_id.
  const directorateId = scoped ?? c.req.query('directorate_id');
  const segment = parseUserTypeSegment(c.req.query('user_type'));
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);
  const endAt = toSqlTime(settings.work_end_time);

  // Match clock rows by their EFFECTIVE date (device_info.capturedDate ??
  // server timestamp date) so offline replays are attributed to the capture day.
  const ciDate = clockEffectiveDateSql('ci');
  const coDate = clockEffectiveDateSql('co');

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
                    a.reason as absence_reason, a.note as absence_note,
                    CASE WHEN TIME(ci.timestamp) > ? THEN 1 ELSE 0 END as is_late,
                    CASE WHEN co.timestamp IS NOT NULL AND TIME(co.timestamp) < ? THEN 1 ELSE 0 END as is_early_departure,
                    u.current_streak
             FROM users u
             LEFT JOIN directorates d ON u.directorate_id = d.id
             LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND ${ciDate} = ?
             LEFT JOIN clock_records co ON co.user_id = u.id AND co.type = 'clock_out' AND ${coDate} = ?
             LEFT JOIN absence_notices a ON a.id = (
               SELECT a2.id FROM absence_notices a2
               WHERE a2.user_id = u.id
                 AND a2.notice_date <= ? AND ? < COALESCE(a2.expected_return_date, DATE(a2.notice_date, '+1 day'))
               ORDER BY a2.created_at DESC LIMIT 1
             )
             WHERE ${isPast ? '(u.is_active = 1 OR ci.id IS NOT NULL)' : 'u.is_active = 1'}`;
  const params: unknown[] = [lateAfter, endAt, date, date, date, date];

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

// Range export — one row per user × day across a span (plan 2026-08-03
// attendance-range-export). Powers the web AttendanceTab range CSV/PDF
// exports; single-date /records (with embedded photos) is unchanged.
//
// Implementation: users CROSS JOIN a recursive date CTE, LEFT JOINing the
// day's clock-in / clock-out rows by the shared effective-date expression and
// the latest applicable absence notice (same correlated subquery as /records).
// Chosen over JS assembly so the population rule, effective-date attribution
// and latest-notice-wins logic stay byte-identical to /records in one query;
// a year × ~160 users ≈ 58k rows is well inside D1's .all() comfort zone.
attendanceRoutes.get('/export', async (c) => {
  if (!requireOversight(c)) return error(c, 'FORBIDDEN', 'Admin or director access required', 403);
  const scoped = await oversightScope(c);
  if (scoped instanceof Response) return scoped;

  const from = c.req.query('from');
  const to = c.req.query('to');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return error(c, 'BAD_DATE', 'from and to are required, YYYY-MM-DD', 400);
  }
  if (from > to) {
    return error(c, 'BAD_RANGE', 'from must be on or before to', 400);
  }
  // Inclusive day count; ISO strings parse as UTC midnight so the diff is exact.
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (spanDays > 366) {
    return error(c, 'BAD_RANGE', 'Date range too large (max 366 days)', 400);
  }

  // A director's resolved scope overrides any client-passed directorate_id.
  const directorateId = scoped ?? c.req.query('directorate_id');
  // Exports default to the whole population ('all') — analysis wants everyone;
  // an explicit segment goes through the same parser as /records.
  const rawSegment = c.req.query('user_type');
  const segment: UserTypeSegment = rawSegment === undefined ? 'all' : parseUserTypeSegment(rawSegment);
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);
  const endAt = toSqlTime(settings.work_end_time);

  const ciDate = clockEffectiveDateSql('ci');
  const coDate = clockEffectiveDateSql('co');

  // Population mirrors /records past-date semantics, extended to notices:
  // active users appear on every day of the span; deactivated users appear
  // only on days they clocked in or had a covering absence notice.
  let sql = `WITH RECURSIVE days(d) AS (
               SELECT ? UNION ALL SELECT DATE(d, '+1 day') FROM days WHERE d < ?
             )
             SELECT days.d as date, u.id as user_id, u.name,
                    COALESCE(u.staff_id, u.nss_number, u.intern_code) as identifier,
                    dir.abbreviation as directorate_abbr,
                    ci.timestamp as clock_in_time, co.timestamp as clock_out_time,
                    CASE WHEN ci.timestamp IS NOT NULL AND TIME(ci.timestamp) > ? THEN 1 ELSE 0 END as is_late,
                    CASE WHEN co.timestamp IS NOT NULL AND TIME(co.timestamp) < ? THEN 1 ELSE 0 END as is_early_departure,
                    ci.presence_method as presence_method,
                    a.reason as absence_reason, a.note as absence_note,
                    CASE WHEN ci.photo_url IS NOT NULL THEN 1 ELSE 0 END as has_photo
             FROM days
             CROSS JOIN users u
             LEFT JOIN directorates dir ON u.directorate_id = dir.id
             LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND ${ciDate} = days.d
             LEFT JOIN clock_records co ON co.user_id = u.id AND co.type = 'clock_out' AND ${coDate} = days.d
             LEFT JOIN absence_notices a ON a.id = (
               SELECT a2.id FROM absence_notices a2
               WHERE a2.user_id = u.id
                 AND a2.notice_date <= days.d AND days.d < COALESCE(a2.expected_return_date, DATE(a2.notice_date, '+1 day'))
               ORDER BY a2.created_at DESC LIMIT 1
             )
             WHERE (u.is_active = 1 OR ci.id IS NOT NULL OR a.id IS NOT NULL)`;
  const params: unknown[] = [from, to, lateAfter, endAt];

  const exportClause = userTypeClause(segment, 'u');
  if (exportClause) {
    sql += ` AND ${exportClause}`;
  }

  if (directorateId) {
    sql += ' AND u.directorate_id = ?';
    params.push(directorateId);
  }

  sql += ' ORDER BY days.d ASC, u.name ASC';

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
  if (!requireOversight(c)) return error(c, 'FORBIDDEN', 'Admin or director access required', 403);
  const scoped = await oversightScope(c);
  if (scoped instanceof Response) return scoped;

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
  // A scoped director's breakdown collapses to their own entity's card.
  const scopeWhere = scoped ? ' AND d.id = ?' : '';
  if (scoped) params.push(scoped);

  // Clock rows match by their EFFECTIVE date (device_info.capturedDate ??
  // server timestamp date) — same attribution rule as /records and /today.
  const results = await c.env.DB.prepare(
    `SELECT d.abbreviation, d.name,
            COUNT(DISTINCT u.id) as total_staff,
            COUNT(DISTINCT ci.user_id) as present,
            COUNT(DISTINCT CASE WHEN TIME(ci.timestamp) > ? THEN ci.user_id END) as late
     FROM directorates d
     LEFT JOIN users u ON u.directorate_id = d.id AND u.is_active = 1 ${userTypeJoin}
     LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND ${clockEffectiveDateSql('ci')} = ?
     WHERE d.is_active = 1${scopeWhere}
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

  // Group days by the EFFECTIVE date (device_info.capturedDate ?? server
  // timestamp date) so offline replays land on the day they happened —
  // same attribution rule as /records, /today and /by-directorate.
  const effDate = clockEffectiveDateSql('clock_records');
  const records = await c.env.DB.prepare(
    `SELECT ${effDate} as date, type, TIME(timestamp) as time
     FROM clock_records WHERE user_id = ? AND strftime('%Y-%m', ${effDate}) = ?
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

// Premium refinement (spec 2026-08-02-absence-notice-premium-design): note and
// expected_return_date are BOTH required — a notice without a "why" and a
// "first day back" is noise to the head receiving it.
const absenceNoticeSchema = z.object({
  reason: z.enum(['sick', 'family_emergency', 'transport', 'other']),
  note: z.string().trim().min(2).max(200),
  expected_return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Longer absences belong to the leave-requests workflow.
const ABSENCE_MAX_RETURN_DAYS = 30;

attendanceRoutes.post('/absence-notice', zValidator('json', absenceNoticeSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const today = new Date().toISOString().slice(0, 10);

  // expected_return_date is the day they're BACK at work (exclusive — they are not absent on that day),
  // so it must be strictly after today, and no further out than ABSENCE_MAX_RETURN_DAYS.
  if (body.expected_return_date <= today) {
    return error(c, 'INVALID_DATE', 'Expected return date must be after today', 400);
  }
  const maxReturn = new Date(Date.now() + ABSENCE_MAX_RETURN_DAYS * 86400_000).toISOString().slice(0, 10);
  if (body.expected_return_date > maxReturn) {
    return error(c, 'INVALID_DATE', `Expected return date must be within ${ABSENCE_MAX_RETURN_DAYS} days — use a leave request for longer absences`, 400);
  }

  // One active notice per user per day (upsert, no migration), race-safe:
  // UPDATE first; when no row existed, INSERT ... WHERE NOT EXISTS so two
  // concurrent submits can't both pass a read-then-insert check; if that
  // INSERT still made 0 changes the concurrent row landed in between — the
  // row exists now, so UPDATE it. No un-retractable duplicates.
  const attemptedId = crypto.randomUUID().replace(/-/g, '');
  let created = false;
  const upd = await c.env.DB.prepare(
    'UPDATE absence_notices SET reason = ?, note = ?, expected_return_date = ? WHERE user_id = ? AND notice_date = ?'
  ).bind(body.reason, body.note, body.expected_return_date, session.userId, today).run();
  if ((upd.meta?.changes ?? 0) === 0) {
    const ins = await c.env.DB.prepare(
      `INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM absence_notices WHERE user_id = ? AND notice_date = ?)`
    ).bind(attemptedId, session.userId, body.reason, body.note, today, body.expected_return_date, session.userId, today).run();
    if ((ins.meta?.changes ?? 0) > 0) {
      created = true;
    } else {
      // Lost the race — the concurrent insert landed between our two statements.
      await c.env.DB.prepare(
        'UPDATE absence_notices SET reason = ?, note = ?, expected_return_date = ? WHERE user_id = ? AND notice_date = ?'
      ).bind(body.reason, body.note, body.expected_return_date, session.userId, today).run();
    }
  }

  // The surviving row's id (the winner's on a lost race) rides the response.
  const row = await c.env.DB.prepare(
    'SELECT id FROM absence_notices WHERE user_id = ? AND notice_date = ?'
  ).bind(session.userId, today).first<{ id: string }>();
  const id = row?.id ?? attemptedId;

  const notice: AbsenceNoticeInput = {
    id,
    user_id: session.userId,
    reason: body.reason,
    note: body.note,
    notice_date: today,
    expected_return_date: body.expected_return_date,
  };

  await recordAudit(c.env, auditActorFromContext(c), {
    action: created ? 'absence.submit' : 'absence.update',
    entityType: 'absence_notice',
    entityId: id,
    summary: created
      ? `Reported absence: ${body.reason}, back ${body.expected_return_date}`
      : `Updated absence notice: ${body.reason}, back ${body.expected_return_date}`,
  });

  c.executionCtx.waitUntil(sendAbsenceNoticePush(c.env, notice));

  return success(c, notice);
});

// Retract a same-day notice (premium refinement). Same-day only by construction:
// it deletes the caller's row for today and 404s when there is none.
attendanceRoutes.delete('/absence-notice/today', async (c) => {
  const session = c.get('session');
  const today = new Date().toISOString().slice(0, 10);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM absence_notices WHERE user_id = ? AND notice_date = ?'
  ).bind(session.userId, today).first<{ id: string }>();
  if (!existing) return error(c, 'NOT_FOUND', 'No absence notice for today', 404);

  await c.env.DB.prepare('DELETE FROM absence_notices WHERE id = ?').bind(existing.id).run();
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'absence.retract',
    entityType: 'absence_notice',
    entityId: existing.id,
    summary: 'Withdrew absence notice',
  });

  return success(c, { deleted: true });
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
