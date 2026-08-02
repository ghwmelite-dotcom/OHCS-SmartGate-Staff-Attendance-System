import type { Env } from '../types';
import { sendTelegramMessage } from './telegram';
import { getAppSettings, toSqlTime } from './settings';
import { getOfficeStatus } from './office-hours';

type SummaryType = 'daily' | 'weekly' | 'monthly' | 'yearly';

function determineSummaryType(): SummaryType {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 5=Fri
  const date = now.getUTCDate();
  const month = now.getUTCMonth(); // 0=Jan
  const hour = now.getUTCHours();

  // Yearly: Jan 1 at 9 AM
  if (month === 0 && date === 1 && hour === 9) return 'yearly';
  // Monthly: 1st of month at 9 AM
  if (date === 1 && hour === 9) return 'monthly';
  // Weekly: Friday at 4 PM
  if (day === 5 && hour === 16) return 'weekly';
  // Default: daily
  return 'daily';
}

export async function sendDailySummary(env: Env): Promise<void> {
  const type = determineSummaryType();

  if (type === 'daily') {
    // Self-suppress on closed days — the cron schedule is the primary gate,
    // but a wrong weekday expression (or a manual trigger) must never spam a
    // weekend "0% present" report. Periodic reports (weekly/monthly/yearly)
    // intentionally fire regardless of the day they land on.
    const office = await getOfficeStatus(env);
    if (office.reason === 'weekend' || office.reason === 'holiday') return;
    await sendDailyReport(env);
  } else {
    await sendPeriodicReport(type, env);
  }
}

// Daily report — sent to admin subscribers
async function sendDailyReport(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const settings = await getAppSettings(env);
  const lateAfter = toSqlTime(settings.late_threshold_time);

  const [totalStaff, clockedIn, lateCount, noticedCount] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').first<{ c: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(today).first<{ c: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ? AND TIME(timestamp) > ?`
    ).bind(today, lateAfter).first<{ c: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM absence_notices
     WHERE ? >= notice_date AND ? < COALESCE(expected_return_date, date(notice_date, '+1 day'))`
    ).bind(today, today).first<{ c: number }>(),
  ]);

  const total = totalStaff?.c ?? 0;
  const present = clockedIn?.c ?? 0;
  const absent = total - present;
  const rate = total > 0 ? Math.round((present / total) * 100) : 0;

  const dirResults = await env.DB.prepare(
    `SELECT d.abbreviation, COUNT(DISTINCT u.id) as total, COUNT(DISTINCT ci.user_id) as present
     FROM directorates d
     LEFT JOIN users u ON u.directorate_id = d.id AND u.is_active = 1
     LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
     WHERE d.is_active = 1 GROUP BY d.id HAVING total > 0 ORDER BY d.abbreviation`
  ).bind(today).all();

  const dirLines = (dirResults.results ?? []).map((d: Record<string, unknown>) =>
    `  ${d.abbreviation}: ${d.present}/${d.total}`
  ).join('\n');

  const dateFormatted = new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const message = [
    `\u{1F4CA} <b>Daily Attendance</b>`,
    `${dateFormatted} \u2014 ${time}`,
    '',
    `\u2705 Present: <b>${present}</b>/${total} (${rate}%)`,
    `\u{1F534} Absent: <b>${absent}</b>`,
    lateCount?.c ? `\u26A0\uFE0F Late: <b>${lateCount.c}</b>` : '',
    noticedCount?.c ? `\u{1F4DD} Notified absent: <b>${noticedCount.c}</b>` : '',
    '',
    dirLines ? `<b>By Directorate:</b>\n${dirLines}` : '',
    '',
    `\u2014 OHCS Staff Attendance`,
  ].filter(Boolean).join('\n');

  await sendToAdminSubscribers(message, env);
}

// Weekly/Monthly/Yearly report — sent to Chief Director + admin subscribers
async function sendPeriodicReport(type: SummaryType, env: Env): Promise<void> {
  const now = new Date();
  const settings = await getAppSettings(env);
  const lateAfter = toSqlTime(settings.late_threshold_time);
  let fromDate: string;
  let label: string;

  if (type === 'weekly') {
    fromDate = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    label = 'Weekly Summary';
  } else if (type === 'monthly') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    fromDate = lastMonth.toISOString().slice(0, 10);
    label = 'Monthly Summary';
  } else {
    fromDate = `${now.getFullYear() - 1}-01-01`;
    label = 'Yearly Summary';
  }
  const toDate = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

  // Total visits in period
  const visits = await env.DB.prepare(
    `SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as unique_visitors
     FROM visits WHERE DATE(check_in_at) >= ? AND DATE(check_in_at) <= ?`
  ).bind(fromDate, toDate).first<{ total: number; unique_visitors: number }>();

  // Attendance stats
  const attendance = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id || DATE(timestamp)) as total_clockins,
            COUNT(DISTINCT CASE WHEN TIME(timestamp) > ? THEN user_id || DATE(timestamp) END) as late_clockins
     FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) >= ? AND DATE(timestamp) <= ?`
  ).bind(lateAfter, fromDate, toDate).first<{ total_clockins: number; late_clockins: number }>();

  // Top directorate by visits
  const topDir = await env.DB.prepare(
    `SELECT d.abbreviation, COUNT(*) as c FROM visits v
     JOIN directorates d ON v.directorate_id = d.id
     WHERE DATE(v.check_in_at) >= ? AND DATE(v.check_in_at) <= ?
     GROUP BY d.id ORDER BY c DESC LIMIT 1`
  ).bind(fromDate, toDate).first<{ abbreviation: string; c: number }>();

  const fromFormatted = new Date(fromDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const toFormatted = new Date(toDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const emoji = type === 'weekly' ? '\u{1F4C5}' : type === 'monthly' ? '\u{1F4C6}' : '\u{1F3C6}';

  const message = [
    `${emoji} <b>${label}</b>`,
    `${fromFormatted} \u2014 ${toFormatted}`,
    '',
    `<b>Visitors:</b>`,
    `  Total visits: ${visits?.total ?? 0}`,
    `  Unique visitors: ${visits?.unique_visitors ?? 0}`,
    topDir ? `  Busiest directorate: ${topDir.abbreviation} (${topDir.c} visits)` : '',
    '',
    `<b>Staff Attendance:</b>`,
    `  Total clock-ins: ${attendance?.total_clockins ?? 0}`,
    `  Late arrivals: ${attendance?.late_clockins ?? 0}`,
    '',
    `\u2014 OHCS SmartGate`,
  ].filter(Boolean).join('\n');

  await sendToAdminSubscribers(message, env);
}

// Send message to all admin Telegram subscribers
export async function sendToAdminSubscribers(message: string, env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  // Send to the primary admin subscriber
  const adminChatId = await env.KV.get('telegram-admin-chat-id');
  if (adminChatId) {
    await sendTelegramMessage({ chatId: adminChatId, text: message, token: env.TELEGRAM_BOT_TOKEN });
  }

  // Also send to any users with role director/superadmin who have Telegram linked
  const directors = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('superadmin', 'director') AND is_active = 1"
  ).all();

  for (const user of (directors.results ?? []) as Array<{ id: string }>) {
    const chatId = await env.KV.get(`telegram-user:${user.id}`);
    if (chatId && chatId !== adminChatId) {
      await sendTelegramMessage({ chatId, text: message, token: env.TELEGRAM_BOT_TOKEN });
    }
  }

  console.log(`[SUMMARY] ${message.split('\n')[0]} sent`);
}
