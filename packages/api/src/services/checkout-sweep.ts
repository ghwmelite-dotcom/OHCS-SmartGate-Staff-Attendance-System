import type { Env } from '../types';
import { getOfficeStatus, type OfficeStatus } from './office-hours';
import { sendTypedNotification } from './notifier';
import { sendTelegramMessage } from './telegram';
import { escapeHtml } from '../lib/html';
import { recordNotifyOutcome } from '../lib/notify-metrics';

// End-of-day checkout sweep (spec 2026-07-19-auto-checkout-sweep-design §1).
// Flags visitors still marked in building after close; humans do the checkout.
export interface OpenVisit {
  id: string;
  first_name: string;
  last_name: string;
  badge_code: string | null;
  host_name: string | null;
  check_in_at: string;
}

const MAX_LISTED = 10;

// The sweep cron fires at 17:15 on weekdays — i.e. AFTER the default 17:00
// close — so "closed" here can only mean weekend/holiday (the genuinely
// no-work days). before_hours/after_hours must still run: end of day is
// exactly when the sweep is useful.
export function shouldRunSweep(status: OfficeStatus): boolean {
  return status.reason !== 'weekend' && status.reason !== 'holiday';
}

// Pure message builder — unit-testable without DB/KV. Returns null when there
// are no open visits: silence means clean, nothing is sent.
export function buildSweepMessages(
  visits: OpenVisit[],
): { title: string; body: string; telegram: string } | null {
  if (visits.length === 0) return null;
  const n = visits.length;
  const listed = visits.slice(0, MAX_LISTED);
  const extra = n - listed.length;

  const plainLines = listed.map(
    (v) => `• ${v.first_name} ${v.last_name}${v.badge_code ? ` — ${v.badge_code}` : ''}`,
  );
  if (extra > 0) plainLines.push(`• …and ${extra} more`);

  const tgLines = listed.map(
    (v) =>
      `• <b>${escapeHtml(v.first_name)} ${escapeHtml(v.last_name)}</b>${v.badge_code ? ` — <code>${escapeHtml(v.badge_code)}</code>` : ''}`,
  );
  if (extra > 0) tgLines.push(`• …and ${extra} more`);

  const title = `${n} visitor${n === 1 ? '' : 's'} still in building`;
  const body = [...plainLines, '', 'Open the dashboard to check them out.'].join('\n');
  const telegram = [
    `\u{1F306} <b>End-of-Day Sweep — OHCS VMS</b>`,
    '',
    `<b>${n}</b> visitor${n === 1 ? ' is' : 's are'} still marked in building:`,
    ...tgLines,
    '',
    'Open the dashboard to check them out.',
    '',
    `\u2014 OHCS VMS`,
  ].join('\n');
  return { title, body, telegram };
}

export async function runCheckoutSweep(env: Env): Promise<void> {
  const status = await getOfficeStatus(env);
  if (!shouldRunSweep(status)) {
    console.log(`[SWEEP] skipped — office closed (${status.reason})`);
    return;
  }

  // Open visits = status 'checked_in' (the same definition /api/visits/active
  // uses). All of them, not just today's — yesterday's stragglers are the
  // whole point.
  const rows = await env.DB.prepare(
    `SELECT v.id, vis.first_name, vis.last_name, v.badge_code,
            COALESCE(o.name, v.host_name_manual) AS host_name, v.check_in_at
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     WHERE v.status = 'checked_in'
     ORDER BY v.check_in_at`
  ).all<OpenVisit>();
  const open = rows.results ?? [];

  const messages = buildSweepMessages(open);
  if (!messages) {
    console.log('[SWEEP] clear');
    return;
  }

  // Channel 1: in-app + push to reception/admin users. Non-fatal.
  try {
    const users = await env.DB.prepare(
      "SELECT id FROM users WHERE role IN ('receptionist', 'admin', 'superadmin') AND is_active = 1"
    ).all<{ id: string }>();
    for (const u of users.results ?? []) {
      await sendTypedNotification(env, {
        userId: u.id,
        type: 'checkout_sweep',
        title: messages.title,
        body: messages.body,
        url: '/',
      });
    }
  } catch (err) {
    console.error(`[SWEEP] in-app notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Channel 2: Telegram admin chat (same KV key the daily summary uses). Non-fatal.
  try {
    const adminChatId = await env.KV.get('telegram-admin-chat-id');
    if (adminChatId && env.TELEGRAM_BOT_TOKEN) {
      const ok = await sendTelegramMessage({
        chatId: adminChatId,
        text: messages.telegram,
        token: env.TELEGRAM_BOT_TOKEN,
      });
      await recordNotifyOutcome(env, 'telegram', ok);
    }
  } catch (err) {
    console.error(`[SWEEP] telegram notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`[SWEEP] flagged ${open.length} open visit(s)`);
}
