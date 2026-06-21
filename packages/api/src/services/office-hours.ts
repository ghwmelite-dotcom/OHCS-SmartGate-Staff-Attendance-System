import type { Env } from '../types';
import { getAppSettings, hhmmToMinutes } from './settings';

export type OfficeStatusReason = 'open' | 'before_hours' | 'after_hours' | 'weekend' | 'holiday';

export interface OfficeStatus {
  open: boolean;
  reason: OfficeStatusReason;
  holiday_name: string | null;
  work_start: string;   // "HH:MM"
  work_end: string;     // "HH:MM"
  date: string;         // "YYYY-MM-DD" (Ghana local)
  weekday: number;      // 0 = Sun … 6 = Sat
  server_time: string;  // ISO
}

// Ghana observes GMT (UTC+0) year-round, so the UTC getters on `now` already
// give Ghana local time — no offset/DST handling needed. Closed if (in priority
// order) it's a listed public holiday, a weekend, or outside the configured
// working-hours window.
export async function getOfficeStatus(env: Env, now: Date = new Date()): Promise<OfficeStatus> {
  const settings = await getAppSettings(env);

  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;
  const weekday = now.getUTCDay();

  const base = {
    holiday_name: null as string | null,
    work_start: settings.work_start_time,
    work_end: settings.work_end_time,
    date,
    weekday,
    server_time: now.toISOString(),
  };

  // Resilient holiday lookup: if the `holidays` table doesn't exist yet (migration
  // not applied) or the query errors, degrade to "no holiday" rather than throwing —
  // this query is on the kiosk check-in path and must never break a check-in.
  let holiday: { name: string } | null = null;
  try {
    holiday = await env.DB.prepare('SELECT name FROM holidays WHERE date = ?')
      .bind(date).first<{ name: string }>();
  } catch {
    holiday = null;
  }
  if (holiday) return { ...base, open: false, reason: 'holiday', holiday_name: holiday.name };

  if (weekday === 0 || weekday === 6) return { ...base, open: false, reason: 'weekend' };

  const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minutesNow < hhmmToMinutes(settings.work_start_time)) return { ...base, open: false, reason: 'before_hours' };
  if (minutesNow >= hhmmToMinutes(settings.work_end_time)) return { ...base, open: false, reason: 'after_hours' };

  return { ...base, open: true, reason: 'open' };
}

// Human-readable reason shown to the receptionist when a check-in is attempted
// while the office is closed.
export function officeClosedMessage(s: OfficeStatus): string {
  switch (s.reason) {
    case 'holiday':
      return `The office is closed today${s.holiday_name ? ` for ${s.holiday_name}` : ''}. Ask reception to authorise this check-in.`;
    case 'weekend':
      return `The office is closed for the weekend. Ask reception to authorise this check-in.`;
    case 'before_hours':
      return `The office opens at ${s.work_start}. Ask reception to authorise this early check-in.`;
    case 'after_hours':
      return `The office has closed for the day (after ${s.work_end}). Ask reception to authorise this check-in.`;
    default:
      return `The office is currently closed. Ask reception to authorise this check-in.`;
  }
}
