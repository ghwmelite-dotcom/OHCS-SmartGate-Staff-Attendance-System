import type { Env } from '../types';
import { sendTypedNotification } from './notifier';
import { devLog, devError } from '../lib/log';
import { getAppSettings, hhmmToMinutes } from './settings';
import { getOfficeStatus } from './office-hours';

/* ------------------------------------------------------------------ */
/*  Clock nudge ladder (spec: docs/superpowers/specs/2026-07-27-clock-nudge-ladder-design.md)
 *
 *  Cron ticks every 15 min; each tick maps to a 30-minute slot. A tick only
 *  acts when its slot is in the active window, and a per-user-per-slot KV key
 *  guarantees one send per slot per user (two ticks land in each slot).
 *  Compliance stops the ladder naturally: every tick re-queries clock status,
 *  so a user who clocked in at 08:20 never appears in the 08:30+ query.
 * ------------------------------------------------------------------ */

const MORNING_FIRST_SLOT = 8 * 60;   // 08:00
const MORNING_LAST_SLOT = 11 * 60;   // 11:00 inclusive
const EVENING_SLOTS = [17 * 60, 17 * 60 + 30] as const; // 17:00, 17:30

function slotOf(nowMin: number): number {
  return Math.floor(nowMin / 30) * 30;
}

/** Active morning slot for a given time, or null when outside 08:00–11:00. */
export function morningSlot(nowMin: number): number | null {
  const s = slotOf(nowMin);
  return s >= MORNING_FIRST_SLOT && s <= MORNING_LAST_SLOT ? s : null;
}

/** Active evening slot for a given time, or null when outside the 17:00/17:30 windows. */
export function eveningSlot(nowMin: number): number | null {
  const s = slotOf(nowMin);
  return (EVENING_SLOTS as readonly number[]).includes(s) ? s : null;
}

export interface NudgeMessage { title: string; body: string }

/** Morning message ladder: gentle before the late threshold, streak loss-
 *  aversion after it, and a clearly-final nudge in the 11:00 slot. */
export function buildClockInMessage(
  slot: number,
  thresholdMin: number,
  thresholdLabel: string,
  firstName: string,
  streak: number,
): NudgeMessage {
  if (slot >= MORNING_LAST_SLOT) {
    return {
      title: 'Last nudge for today',
      body: `${firstName}, you still haven't clocked in — tap to record your attendance.`,
    };
  }
  if (slot < thresholdMin) {
    return {
      title: `Good morning, ${firstName} ☀️`,
      body: 'Ready to clock in? One tap and you\u2019re set for the day.',
    };
  }
  if (streak > 1) {
    return {
      title: "You haven't clocked in yet",
      body: `Don't break your ${streak}-day streak 🔥 — tap to clock in now.`,
    };
  }
  return {
    title: "You haven't clocked in yet",
    body: `It's past ${thresholdLabel} — tap to clock in now.`,
  };
}

/** Evening message ladder. */
export function buildClockOutMessage(slot: number, firstName: string): NudgeMessage {
  if (slot >= EVENING_SLOTS[1]) {
    return {
      title: 'Still showing as in office',
      body: `${firstName}, tap to clock out and close your day.`,
    };
  }
  return {
    title: `Wrapping up, ${firstName}?`,
    body: "Don't forget to clock out before you leave.",
  };
}

/** Shared audience predicates: active, activated (pin_acknowledged), has an
 *  identifier, and not covered by an absence notice today. Parameters: date. */
const AUDIENCE_SQL = `
  FROM users u
  WHERE u.is_active = 1
    AND u.pin_acknowledged = 1
    AND (u.staff_id IS NOT NULL OR u.nss_number IS NOT NULL OR u.intern_code IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM absence_notices a
      WHERE a.user_id = u.id
        AND ? BETWEEN a.notice_date AND COALESCE(a.expected_return_date, a.notice_date)
    )`;

/** Morning audience: eligible users with NO clock_in today. Binds: date, date. */
export function buildClockInNudgeQuery(): string {
  return `SELECT u.id, u.name, u.current_streak ${AUDIENCE_SQL}
    AND NOT EXISTS (
      SELECT 1 FROM clock_records c
      WHERE c.user_id = u.id AND c.type = 'clock_in' AND DATE(c.timestamp) = ?
    )`;
}

/** Evening audience: eligible users WITH a clock_in and NO clock_out today.
 *  Binds: date, date, date. */
export function buildClockOutNudgeQuery(): string {
  return `SELECT u.id, u.name ${AUDIENCE_SQL}
    AND EXISTS (
      SELECT 1 FROM clock_records c
      WHERE c.user_id = u.id AND c.type = 'clock_in' AND DATE(c.timestamp) = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM clock_records c
      WHERE c.user_id = u.id AND c.type = 'clock_out' AND DATE(c.timestamp) = ?
    )`;
}

/** Holiday/weekend suppression (Ghana = UTC, so UTC getters are local time). */
async function isOfficeDay(env: Env, now: Date): Promise<boolean> {
  const status = await getOfficeStatus(env, now);
  return status.reason !== 'holiday' && status.reason !== 'weekend';
}

interface NudgeTarget { id: string; name: string }

async function sendSlotNudges<T extends NudgeTarget>(
  env: Env,
  targets: T[],
  direction: 'in' | 'out',
  date: string,
  slot: number,
  build: (u: T) => NudgeMessage,
): Promise<number> {
  let sent = 0;
  await Promise.all(
    targets.map(async (u) => {
      const key = `reminder:${direction}:${u.id}:${date}:${slot}`;
      if (await env.KV.get(key)) return;
      await env.KV.put(key, '1', { expirationTtl: 86400 });
      const msg = build(u);
      await sendTypedNotification(env, {
        userId: u.id,
        type: direction === 'in' ? 'clock_reminder' : 'clock_out_reminder',
        title: msg.title,
        body: msg.body,
        url: '/',
      }).catch((err) => devError(env, `[reminders] clock_${direction}_nudge failed`, err));
      sent++;
    }),
  );
  return sent;
}

/**
 * Morning clock-in ladder — fired by the weekday `*\/15 8-10` + `0 11` crons.
 * Nudges every 30 min from 08:00 to 11:00, stopping as soon as the officer
 * clocks in (status is re-queried every tick).
 */
export async function sendClockReminders(env: Env, now: Date = new Date()): Promise<void> {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slot = morningSlot(nowMin);
  if (slot === null) return;
  if (!(await isOfficeDay(env, now))) return;

  const settings = await getAppSettings(env);
  const thresholdMin = hhmmToMinutes(settings.late_threshold_time);
  const date = now.toISOString().slice(0, 10);

  const rows = await env.DB.prepare(buildClockInNudgeQuery())
    .bind(date, date)
    .all<NudgeTarget & { current_streak: number }>();

  const sent = await sendSlotNudges(env, rows.results ?? [], 'in', date, slot, (u) =>
    buildClockInMessage(
      slot,
      thresholdMin,
      settings.late_threshold_time,
      u.name.split(' ')[0] || 'there',
      (u as NudgeTarget & { current_streak: number }).current_streak ?? 0,
    ),
  );
  devLog(env, `[reminders] clock-in nudge slot=${slot} sent=${sent}`);
}

/**
 * Evening clock-out ladder — fired by the weekday `*\/15 17-18` cron. Nudges
 * in the 17:00 and 17:30 slots to anyone clocked in but not yet clocked out.
 */
export async function sendClockOutReminders(env: Env, now: Date = new Date()): Promise<void> {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slot = eveningSlot(nowMin);
  if (slot === null) return;
  if (!(await isOfficeDay(env, now))) return;

  const date = now.toISOString().slice(0, 10);
  const rows = await env.DB.prepare(buildClockOutNudgeQuery())
    .bind(date, date, date)
    .all<NudgeTarget>();

  const sent = await sendSlotNudges(env, rows.results ?? [], 'out', date, slot, (u) =>
    buildClockOutMessage(slot, u.name.split(' ')[0] || 'there'),
  );
  devLog(env, `[reminders] clock-out nudge slot=${slot} sent=${sent}`);
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
