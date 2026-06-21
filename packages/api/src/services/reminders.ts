import type { Env } from '../types';
import { sendTypedNotification } from './notifier';
import { devLog, devError } from '../lib/log';
import { getAppSettings, hhmmToMinutes } from './settings';

/**
 * Fired by a frequent weekday cron (*\/15 7-9) and self-gates on the admin-
 * configurable late_threshold_time. Sends a push + in-app reminder to every
 * active staff member who hasn't clocked in yet today. Deduped via KV so it
 * only fires once per day even if multiple ticks fall in the fire window.
 */
export async function sendClockReminders(env: Env): Promise<void> {
  const settings = await getAppSettings(env);
  const thresholdMin = hhmmToMinutes(settings.late_threshold_time);
  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Only fire at-or-past the configured late threshold
  if (nowMin < thresholdMin) return;

  const today = now.toISOString().slice(0, 10);
  const dedupeKey = `reminder-sent:${today}`;
  if (await env.KV.get(dedupeKey)) return;
  await env.KV.put(dedupeKey, '1', { expirationTtl: 86400 });

  const rows = await env.DB.prepare(
    `SELECT u.id, u.name FROM users u
     WHERE u.is_active = 1
       AND (u.staff_id IS NOT NULL OR u.nss_number IS NOT NULL OR u.intern_code IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM clock_records c
         WHERE c.user_id = u.id AND c.type = 'clock_in' AND DATE(c.timestamp) = ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM absence_notices a
         WHERE a.user_id = u.id
           AND ? BETWEEN a.notice_date AND COALESCE(a.expected_return_date, a.notice_date)
       )`
  ).bind(today, today).all<{ id: string; name: string }>();

  await Promise.all(
    (rows.results ?? []).map((u) => {
      const firstName = u.name.split(' ')[0] || 'there';
      return sendTypedNotification(env, {
        userId: u.id,
        type: 'clock_reminder',
        title: "Don't forget to clock in",
        body: `Have a good day, ${firstName}.`,
        url: '/',
      }).catch((err) => devError(env, '[reminders] clock_reminder failed', err));
    }),
  );
  devLog(env, `[reminders] sent clock_reminder to ${rows.results?.length ?? 0} users`);
}

/**
 * Fired from POST /clock when a clock_in lands after 08:30.
 * Notifies directorate directors + superadmins (minus the clocker themselves).
 */
export async function sendLateClockAlert(env: Env, userId: string, clockedAtISO: string): Promise<void> {
  const clocker = await env.DB.prepare(
    'SELECT name, directorate_id FROM users WHERE id = ?'
  ).bind(userId).first<{ name: string; directorate_id: string | null }>();
  if (!clocker) return;

  const recipients = await env.DB.prepare(
    `SELECT id FROM users
     WHERE is_active = 1 AND id != ?
       AND (
         (role = 'director' AND directorate_id = ?)
         OR role = 'superadmin'
       )`
  ).bind(userId, clocker.directorate_id ?? '').all<{ id: string }>();

  const settings = await getAppSettings(env);
  const thresholdMin = hhmmToMinutes(settings.late_threshold_time);

  const at = new Date(clockedAtISO);
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  const minOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
  const minutesLate = Math.max(0, minOfDay - thresholdMin);

  await Promise.all(
    (recipients.results ?? []).map((r) =>
      sendTypedNotification(env, {
        userId: r.id,
        type: 'late_clock_alert',
        title: `${clocker.name} clocked in late`,
        body: `Clocked in at ${hh}:${mm} (${minutesLate} minutes late).`,
        url: '/attendance',
      }).catch((err) => devError(env, '[reminders] late_clock_alert failed', err)),
    ),
  );
  devLog(env, `[reminders] late_clock_alert for ${clocker.name} sent to ${recipients.results?.length ?? 0} recipients`);
}

/**
 * 1st-of-month 09:00 cron.
 * Notifies directors + superadmins that the monthly attendance rollup is
 * available (the Telegram summary has already fired via sendDailySummary).
 */
export async function sendMonthlyReportReady(env: Env): Promise<void> {
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthName = lastMonth.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = lastMonth.getUTCFullYear();

  const recipients = await env.DB.prepare(
    "SELECT id FROM users WHERE is_active = 1 AND role IN ('director', 'superadmin')"
  ).all<{ id: string }>();

  await Promise.all(
    (recipients.results ?? []).map((r) =>
      sendTypedNotification(env, {
        userId: r.id,
        type: 'monthly_report_ready',
        title: 'Monthly attendance summary ready',
        body: `${monthName} ${year} rollup is available.`,
        url: '/attendance',
      }).catch((err) => devError(env, '[reminders] monthly_report_ready failed', err)),
    ),
  );
  devLog(env, `[reminders] monthly_report_ready sent to ${recipients.results?.length ?? 0} recipients`);
}

export interface AbsenceNoticeInput {
  id: string;
  user_id: string;
  reason: 'sick' | 'family_emergency' | 'transport' | 'other';
  note: string | null;
  notice_date: string;
  expected_return_date: string | null;
}

const REASON_LABELS: Record<AbsenceNoticeInput['reason'], string> = {
  sick: 'Sick',
  family_emergency: 'Family emergency',
  transport: 'Transport',
  other: 'Absent',
};

/**
 * Fired from POST /attendance/absence-notice.
 * Notifies directorate directors + superadmins that a staff member has
 * reported an absence for today (and possibly beyond).
 */
export async function sendAbsenceNoticePush(env: Env, notice: AbsenceNoticeInput): Promise<void> {
  const user = await env.DB.prepare(
    'SELECT name, directorate_id FROM users WHERE id = ?'
  ).bind(notice.user_id).first<{ name: string; directorate_id: string | null }>();
  if (!user) return;

  const recipients = await env.DB.prepare(
    `SELECT id FROM users
     WHERE is_active = 1 AND id != ?
       AND (
         (role = 'director' AND directorate_id = ?)
         OR role = 'superadmin'
       )`
  ).bind(notice.user_id, user.directorate_id ?? '').all<{ id: string }>();

  const label = REASON_LABELS[notice.reason];
  const body = notice.note ? `${label} — ${notice.note}` : label;

  let title: string;
  if (notice.expected_return_date) {
    const rd = new Date(notice.expected_return_date + 'T00:00:00Z');
    const dateFmt = rd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    title = `${user.name} out until ${dateFmt}`;
  } else {
    title = `${user.name} won't be in today`;
  }

  await Promise.all(
    (recipients.results ?? []).map((r) =>
      sendTypedNotification(env, {
        userId: r.id,
        type: 'absence_notice',
        title,
        body,
        url: '/attendance',
      }).catch((err) => devError(env, '[reminders] absence_notice failed', err)),
    ),
  );
  devLog(env, `[reminders] absence_notice for ${user.name} sent to ${recipients.results?.length ?? 0} recipients`);
}
