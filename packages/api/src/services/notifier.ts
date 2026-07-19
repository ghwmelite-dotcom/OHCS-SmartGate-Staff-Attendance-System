import type { Env } from '../types';
import { sendTelegramMessage, buildArrivalKeyboard } from './telegram';
import { sendWebPush, type PushTarget } from '../lib/webpush';
import { escapeHtml } from '../lib/html';
import { devError } from '../lib/log';
import { recordNotifyOutcome, isDeadPushStatus } from '../lib/notify-metrics';

const PERSONAL_CATEGORIES = ['personal_visit'];

const PUSH_WHITELIST = new Set(['visitor_arrival', 'clock_reminder', 'late_clock_alert', 'monthly_report_ready', 'absence_notice', 'checkout_sweep']);

interface VisitNotifyData {
  visit_id: string;
  host_officer_id: string;
  first_name: string;
  last_name: string;
  organisation: string | null;
  purpose_raw: string | null;
  purpose_category: string | null;
  badge_code: string | null;
  check_in_at: string;
  directorate_id: string | null;
  directorate_abbr: string | null;
  check_in_source?: 'staff' | 'kiosk';
}

export function selectFanoutReceivers(receivers: { officer_id: string }[], hostOfficerId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of receivers) {
    if (r.officer_id === hostOfficerId || seen.has(r.officer_id)) continue;
    seen.add(r.officer_id);
    out.push(r.officer_id);
  }
  return out;
}

function formatVisitorMessage(data: VisitNotifyData, recipientType: 'host' | 'director'): string {
  const time = new Date(data.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  if (recipientType === 'host') {
    return [
      `\u{1F464} <b>You have a visitor</b>`,
      '',
      `<b>${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}</b>${data.organisation ? ` (${escapeHtml(data.organisation)})` : ''}`,
      data.purpose_raw ? `Purpose: ${escapeHtml(data.purpose_raw)}` : '',
      data.badge_code ? `Badge: <code>${escapeHtml(data.badge_code)}</code>` : '',
      '',
      `At Reception \u2022 ${time}`,
      '',
      `\u2014 OHCS VMS`,
    ].filter(Boolean).join('\n');
  }

  return [
    `\u{1F4CB} <b>Directorate Visitor</b>`,
    '',
    `<b>${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}</b>${data.organisation ? ` (${escapeHtml(data.organisation)})` : ''}`,
    data.purpose_raw ? `Purpose: ${escapeHtml(data.purpose_raw)}` : '',
    data.directorate_abbr ? `Directorate: ${escapeHtml(data.directorate_abbr)}` : '',
    '',
    `Checked in at ${time}`,
    '',
    `\u2014 OHCS VMS`,
  ].filter(Boolean).join('\n');
}

export async function notifyOnCheckIn(data: VisitNotifyData, env: Env): Promise<void> {
  const isPersonal = data.purpose_category ? PERSONAL_CATEGORIES.includes(data.purpose_category) : false;

  // --- 1. ALWAYS notify the host staff member ---
  await notifyHostStaff(data, env);

  // --- 1b. Kiosk only: also alert the rest of the directorate's reception team ---
  if (data.check_in_source === 'kiosk' && data.directorate_id) {
    const rows = await env.DB.prepare('SELECT officer_id FROM directorate_receivers WHERE directorate_id = ?')
      .bind(data.directorate_id).all<{ officer_id: string }>();
    for (const officerId of selectFanoutReceivers(rows.results ?? [], data.host_officer_id)) {
      await notifyOfficerOfVisit(officerId, data, env);
    }
  }

  // --- 2. If directorate business (NOT personal), notify Director/Deputy ---
  if (!isPersonal && data.directorate_id) {
    await notifyDirectorateLeadership(data, env);
  }
}

// Notify a specific officer of a visit (shared per-officer notify path).
// withKeyboard adds the arrival-action inline keyboard — host messages only
// (spec §1); receivers/leadership stay FYI.
async function notifyOfficerOfVisit(officerId: string, data: VisitNotifyData, env: Env, withKeyboard = false): Promise<void> {
  const officer = await env.DB.prepare(
    'SELECT id, name, email, telegram_chat_id FROM officers WHERE id = ?'
  ).bind(officerId).first<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null;
  }>();

  if (!officer) return;

  const replyMarkup = withKeyboard ? buildArrivalKeyboard(data.visit_id) : undefined;

  // Telegram to officer directly
  if (officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    const ok = await sendTelegramMessage({
      chatId: officer.telegram_chat_id,
      text: formatVisitorMessage(data, 'host'),
      token: env.TELEGRAM_BOT_TOKEN,
      replyMarkup,
    });
    await recordNotifyOutcome(env, 'telegram', ok);
  }

  // Also check if this officer has a user account with Telegram linked via KV
  const user = await findUserByOfficer(officer, env);
  if (!officer.telegram_chat_id && !user) {
    console.warn(JSON.stringify({ kind: 'notify', channel: 'none', ok: false, detail: 'unreachable', officer_id: officer.id, visit_id: data.visit_id }));
  }
  if (user) {
    const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
    if (kvChatId && kvChatId !== officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      const ok = await sendTelegramMessage({
        chatId: kvChatId,
        text: formatVisitorMessage(data, 'host'),
        token: env.TELEGRAM_BOT_TOKEN,
        replyMarkup,
      });
      await recordNotifyOutcome(env, 'telegram', ok);
    }

    // In-app notification
    await createInAppNotification(user.id, data, env);
  }
}

// Notify the specific staff member being visited
async function notifyHostStaff(data: VisitNotifyData, env: Env): Promise<void> {
  await notifyOfficerOfVisit(data.host_officer_id, data, env, true);
}

// Notify Director and Deputy Director of the directorate
async function notifyDirectorateLeadership(data: VisitNotifyData, env: Env): Promise<void> {
  // Find directors/deputies in this directorate
  const leaders = await env.DB.prepare(
    `SELECT o.id, o.name, o.email, o.telegram_chat_id, o.title
     FROM officers o
     WHERE o.directorate_id = ? AND (
       o.title LIKE '%Director%' OR o.title LIKE '%Deputy%' OR
       o.title LIKE '%Head%' OR o.title LIKE '%Chief%'
     )`
  ).bind(data.directorate_id).all();

  const hostOfficer = await env.DB.prepare('SELECT name FROM officers WHERE id = ?')
    .bind(data.host_officer_id).first<{ name: string }>();

  for (const leader of (leaders.results ?? []) as Array<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null; title: string;
  }>) {
    // Don't notify the leader if they ARE the host
    if (leader.id === data.host_officer_id) continue;

    // Telegram notification
    if (leader.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      const ok = await sendTelegramMessage({
        chatId: leader.telegram_chat_id,
        text: formatVisitorMessage(data, 'director'),
        token: env.TELEGRAM_BOT_TOKEN,
      });
      await recordNotifyOutcome(env, 'telegram', ok);
    }

    // Check KV for user-linked Telegram
    const user = await findUserByOfficer(leader, env);
    if (!leader.telegram_chat_id && !user) {
      console.warn(JSON.stringify({ kind: 'notify', channel: 'none', ok: false, detail: 'unreachable', officer_id: leader.id, visit_id: data.visit_id }));
    }
    if (user) {
      const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
      if (kvChatId && kvChatId !== leader.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
        const ok = await sendTelegramMessage({
          chatId: kvChatId,
          text: formatVisitorMessage(data, 'director'),
          token: env.TELEGRAM_BOT_TOKEN,
        });
        await recordNotifyOutcome(env, 'telegram', ok);
      }

      // In-app notification
      await createInAppNotification(user.id, data, env, `Directorate visitor for ${hostOfficer?.name ?? 'staff'}`);
    }
  }
}

// Helper: find user account linked to an officer
async function findUserByOfficer(
  officer: { email: string | null; name: string },
  env: Env
): Promise<{ id: string } | null> {
  if (officer.email) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(officer.email).first<{ id: string }>();
    if (user) return user;
  }
  return env.DB.prepare('SELECT id FROM users WHERE name = ?')
    .bind(officer.name).first<{ id: string }>();
}

export async function sendTypedNotification(env: Env, opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
  url: string;
  visitId?: string | null;
}): Promise<void> {
  const notifId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(notifId, opts.userId, opts.type, opts.title, opts.body, opts.visitId ?? null).run();

  if (PUSH_WHITELIST.has(opts.type)) {
    const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(opts.userId).all<{ endpoint: string; p256dh: string; auth: string }>();
    await Promise.all(
      (subs.results ?? []).map(async (s) => {
        const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
        try {
          const status = await sendWebPush(target, { title: opts.title, body: opts.body, url: opts.url, type: opts.type }, env);
          if (isDeadPushStatus(status)) {
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
            console.warn(JSON.stringify({ kind: 'notify', channel: 'push', ok: false, detail: `cleaned ${status}` }));
          }
        } catch (err) {
          await recordNotifyOutcome(env, 'push', false, 'exception');
          devError(env, '[webpush] send threw', err);
        }
      }),
    );
  }
}

// Helper: create in-app notification
async function createInAppNotification(
  userId: string,
  data: VisitNotifyData,
  env: Env,
  customBody?: string
): Promise<void> {
  const title = `Visitor: ${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}`;
  const body = customBody ?? `${data.organisation ? `From ${data.organisation} \u2014 ` : ''}${data.purpose_raw || 'No purpose stated'}`;
  const url = data.visit_id ? `/visit/${data.visit_id}` : '/';
  await sendTypedNotification(env, {
    userId,
    type: 'visitor_arrival',
    title,
    body,
    url,
    visitId: data.visit_id,
  });
}
