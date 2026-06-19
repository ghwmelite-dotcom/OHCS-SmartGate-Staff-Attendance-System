import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendAbsenceNoticePush, type AbsenceNoticeInput } from '../services/reminders';
import { getAppSettings, toSqlTime } from '../services/settings';

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
 * Append a user_type filter clause to existing SQL conditions.
 * Returns the SQL fragment (already prefixed with AND when needed) and the bind value (if any).
 */
function userTypeWhereClause(segment: UserTypeSegment): { clause: string; param?: string } {
  if (segment === 'all') return { clause: '' };
  return { clause: 'AND u.user_type = ?', param: segment };
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
  const userTypeUserSql = segment === 'all' ? '' : 'AND user_type = ?';
  const totalStaffParams = segment === 'all' ? [] : [segment];

  // For clock counts we must join clock_records to users to filter by user_type.
  const userTypeJoinSql = segment === 'all'
    ? ''
    : `AND EXISTS (SELECT 1 FROM users u WHERE u.id = cr.user_id AND u.user_type = ?)`;
  const userTypeJoinParams = segment === 'all' ? [] : [segment];

  const [totalStaff, clockedIn, clockedOut, lateArrivals, earlyDepartures] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM users WHERE is_active = 1 ${userTypeUserSql}`)
      .bind(...totalStaffParams)
      .first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ? ${userTypeJoinSql}`
    ).bind(today, ...userTypeJoinParams).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_out' AND DATE(cr.timestamp) = ? ${userTypeJoinSql}`
    ).bind(today, ...userTypeJoinParams).first<{ count: number }>(),

    // Late = clocked in after configured late threshold
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_in' AND DATE(cr.timestamp) = ? AND TIME(cr.timestamp) > ? ${userTypeJoinSql}`
    ).bind(today, lateAfter, ...userTypeJoinParams).first<{ count: number }>(),

    // Early departure = clocked out before work_end_time
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT cr.user_id) as count FROM clock_records cr
       WHERE cr.type = 'clock_out' AND DATE(cr.timestamp) = ? AND TIME(cr.timestamp) < ? ${userTypeJoinSql}`
    ).bind(today, endAt, ...userTypeJoinParams).first<{ count: number }>(),
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
                    ci.prompt_value as clock_in_prompt, ci.reauth_method as clock_in_reauth_method,
                    co.prompt_value as clock_out_prompt, co.reauth_method as clock_out_reauth_method,
                    ci.liveness_decision as liveness_decision,
                    ci.liveness_signature as liveness_signature,
                    CASE WHEN TIME(ci.timestamp) > ? THEN 1 ELSE 0 END as is_late,
                    CASE WHEN co.timestamp IS NOT NULL AND TIME(co.timestamp) < ? THEN 1 ELSE 0 END as is_early_departure,
                    u.current_streak
             FROM users u
             LEFT JOIN directorates d ON u.directorate_id = d.id
             LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
             LEFT JOIN clock_records co ON co.user_id = u.id AND co.type = 'clock_out' AND DATE(co.timestamp) = ?
             WHERE u.is_active = 1`;
  const params: unknown[] = [lateAfter, endAt, date, date];

  const userTypeWhere = userTypeWhereClause(segment);
  if (userTypeWhere.clause) {
    sql += ` ${userTypeWhere.clause}`;
    params.push(userTypeWhere.param!);
  }

  if (directorateId) {
    sql += ' AND u.directorate_id = ?';
    params.push(directorateId);
  }

  sql += ' ORDER BY ci.timestamp ASC, u.name ASC';

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

// Directorate breakdown
attendanceRoutes.get('/by-directorate', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const segment = parseUserTypeSegment(c.req.query('user_type'));
  const settings = await getAppSettings(c.env);
  const lateAfter = toSqlTime(settings.late_threshold_time);

  // Filter the user join itself by user_type so directorate counts match the segment.
  const userTypeJoin = segment === 'all' ? '' : 'AND u.user_type = ?';
  const params: unknown[] = [lateAfter];
  if (segment !== 'all') params.push(segment);
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

attendanceRoutes.post('/leave/:id/approve', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const id = c.req.param('id');
  const session = c.get('session');

  await c.env.DB.prepare(
    "UPDATE leave_requests SET status = 'approved', approved_by = ? WHERE id = ?"
  ).bind(session.userId, id).run();

  return success(c, { message: 'Leave approved' });
});

attendanceRoutes.post('/leave/:id/reject', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const id = c.req.param('id');
  const session = c.get('session');

  await c.env.DB.prepare(
    "UPDATE leave_requests SET status = 'rejected', approved_by = ? WHERE id = ?"
  ).bind(session.userId, id).run();

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
