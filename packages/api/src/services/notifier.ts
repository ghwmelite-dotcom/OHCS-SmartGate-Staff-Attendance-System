import type { Env } from '../types';
import { sendTelegramMessage, buildArrivalKeyboard, sendTelegramMessageWithId, sendTelegramPhoto, recordArrivalMessages, type ArrivalMessageRef, type InlineKeyboardMarkup } from './telegram';
import { sendWebPush, type PushTarget } from '../lib/webpush';
import { escapeHtml } from '../lib/html';
import { devError } from '../lib/log';
import { recordNotifyOutcome, isDeadPushStatus } from '../lib/notify-metrics';

const PERSONAL_CATEGORIES = ['personal_visit'];

const PUSH_WHITELIST = new Set(['visitor_arrival', 'clock_reminder', 'late_clock_alert', 'monthly_report_ready', 'absence_notice', 'checkout_sweep', 'sla_breach', 'watchlist_alert', 'survey_low_rating']);

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
  /** R2 key of the visitor's kiosk photo — arrival alerts send it when present. */
  photo_url?: string | null;
  /** Delegation party: total headcount INCLUDING the lead (NULL ⇒ solo). */
  party_size?: number | null;
  /** JSON array of accompanying member names (lead excluded). */
  party_names?: string | null;
  /** Resolved in notifyOnCheckIn — fanout format + status line. */
  host_name?: string | null;
  host_availability?: 'available' | 'in_meeting' | 'out_of_office' | null;
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

// Delegation party line — "With 2 others: Ama B, Kofi D". party_size includes
// the lead; party_names is a JSON array of the accompanying members.
export function partyLine(data: VisitNotifyData): string | null {
  const size = data.party_size ?? 0;
  if (!size || size <= 1) return null;
  const others = size - 1;
  let names: string[] = [];
  try { names = JSON.parse(data.party_names ?? '[]') as string[]; } catch { /* malformed → count only */ }
  const suffix = names.length ? `: ${names.map((n) => escapeHtml(String(n))).join(', ')}` : '';
  return `With ${others} other${others > 1 ? 's' : ''}${suffix}`;
}

const AVAILABILITY_LABELS: Record<string, string> = {
  in_meeting: 'In a meeting',
  out_of_office: 'Out of office',
};

// Exported for tests. recipientType: the host gets the action wording; fanout
// (directorate receivers) gets the "covering for the host" wording + status
// line; director/leadership stays FYI.
export function formatVisitorMessage(data: VisitNotifyData, recipientType: 'host' | 'fanout' | 'director'): string {
  const time = new Date(data.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const party = partyLine(data);
  const nameLine = `<b>${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}</b>${data.organisation ? ` (${escapeHtml(data.organisation)})` : ''}`;

  if (recipientType === 'host' || recipientType === 'fanout') {
    const header = recipientType === 'host'
      ? `\u{1F464} <b>You have a visitor</b>`
      : `\u{1F464} <b>Visitor for ${data.host_name ? escapeHtml(data.host_name) : 'your directorate'}</b>`;
    const status = recipientType === 'fanout' && data.host_availability && data.host_availability !== 'available'
      ? `Host status: ${AVAILABILITY_LABELS[data.host_availability] ?? data.host_availability} — you're receiving this as cover`
      : null;
    return [
      header,
      '',
      nameLine,
      party,
      data.purpose_raw ? `Purpose: ${escapeHtml(data.purpose_raw)}` : '',
      data.badge_code ? `Badge: <code>${escapeHtml(data.badge_code)}</code>` : '',
      '',
      `At Reception \u2022 ${time}`,
      status,
      '',
      `\u2014 OHCS VMS`,
    ].filter(Boolean).join('\n');
  }

  return [
    `\u{1F4CB} <b>Directorate Visitor</b>`,
    '',
    nameLine,
    party,
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
  const refs: ArrivalMessageRef[] = [];

  // Resolve the host's name + availability once — the fanout format and its
  // "receiving this as cover" status line both need it.
  if (data.host_officer_id) {
    const host = await env.DB.prepare('SELECT name, availability_status FROM officers WHERE id = ?')
      .bind(data.host_officer_id)
      .first<{ name: string; availability_status: string | null }>();
    data.host_name = host?.name ?? null;
    data.host_availability = (host?.availability_status as VisitNotifyData['host_availability']) ?? null;
  }

  // --- 1. ALWAYS notify the host staff member ---
  refs.push(...await notifyHostStaff(data, env));

  // --- 1b. Kiosk only: also alert the rest of the directorate's reception team ---
  if (data.check_in_source === 'kiosk' && data.directorate_id) {
    const rows = await env.DB.prepare('SELECT officer_id FROM directorate_receivers WHERE directorate_id = ?')
      .bind(data.directorate_id).all<{ officer_id: string }>();
    for (const officerId of selectFanoutReceivers(rows.results ?? [], data.host_officer_id)) {
      refs.push(...await notifyOfficerOfVisit(officerId, data, env, false, 'fanout'));
    }
  }

  // --- 2. If directorate business (NOT personal), notify Director/Deputy ---
  if (!isPersonal && data.directorate_id) {
    refs.push(...await notifyDirectorateLeadership(data, env));
  }

  // Track the thread so checkout can rewrite every arrival message (visit-ended).
  await recordArrivalMessages(env, data.visit_id, refs);
}

// Photo-or-text arrival send. Fetches the visitor's kiosk photo from R2 when
// present; any failure (no photo, R2 miss, Telegram reject) falls back to a
// plain text message. Returns the message_id + whether it was a photo so the
// checkout close-out can edit the right field (caption vs text).
async function sendArrivalAlert(env: Env, opts: {
  chatId: string;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
  photoKey?: string | null;
}): Promise<{ messageId: number; photo: boolean } | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (opts.photoKey) {
    try {
      const obj = await env.STORAGE.get(opts.photoKey);
      if (obj) {
        const r = await sendTelegramPhoto({
          chatId: opts.chatId,
          photo: await obj.arrayBuffer(),
          caption: opts.text,
          token: env.TELEGRAM_BOT_TOKEN,
          replyMarkup: opts.replyMarkup,
        });
        await recordNotifyOutcome(env, 'telegram', r.ok);
        if (r.ok) return r.messageId ? { messageId: r.messageId, photo: true } : null;
      }
    } catch { /* fall through to plain text */ }
  }
  const r = await sendTelegramMessageWithId({
    chatId: opts.chatId, text: opts.text, token: env.TELEGRAM_BOT_TOKEN, replyMarkup: opts.replyMarkup,
  });
  await recordNotifyOutcome(env, 'telegram', r.ok);
  return r.ok && r.messageId ? { messageId: r.messageId, photo: false } : null;
}

// Notify a specific officer of a visit (shared per-officer notify path).
// withKeyboard adds the arrival-action inline keyboard — host messages only
// (spec §1); receivers/leadership stay FYI. Returns the sent Telegram message
// refs for the visit-ended thread close-out.
async function notifyOfficerOfVisit(
  officerId: string,
  data: VisitNotifyData,
  env: Env,
  withKeyboard = false,
  format: 'host' | 'fanout' = 'host',
): Promise<ArrivalMessageRef[]> {
  const refs: ArrivalMessageRef[] = [];
  const officer = await env.DB.prepare(
    'SELECT id, name, email, telegram_chat_id FROM officers WHERE id = ?'
  ).bind(officerId).first<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null;
  }>();

  if (!officer) return refs;

  const replyMarkup = withKeyboard ? buildArrivalKeyboard(data.visit_id) : undefined;
  const text = formatVisitorMessage(data, format);

  // Telegram to officer directly
  if (officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    const sent = await sendArrivalAlert(env, {
      chatId: officer.telegram_chat_id, text, replyMarkup, photoKey: data.photo_url,
    });
    if (sent) refs.push({ c: officer.telegram_chat_id, m: sent.messageId, p: sent.photo ? 1 : 0 });
  }

  // Also check if this officer has a user account with Telegram linked via KV
  const user = await findUserByOfficer(officer, env);
  if (!officer.telegram_chat_id && !user) {
    console.warn(JSON.stringify({ kind: 'notify', channel: 'none', ok: false, detail: 'unreachable', officer_id: officer.id, visit_id: data.visit_id }));
  }
  if (user) {
    const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
    if (kvChatId && kvChatId !== officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      const sent = await sendArrivalAlert(env, {
        chatId: kvChatId, text, replyMarkup, photoKey: data.photo_url,
      });
      if (sent) refs.push({ c: kvChatId, m: sent.messageId, p: sent.photo ? 1 : 0 });
    }

    // In-app notification
    await createInAppNotification(user.id, data, env);
  }
  return refs;
}

// Notify the specific staff member being visited
async function notifyHostStaff(data: VisitNotifyData, env: Env): Promise<ArrivalMessageRef[]> {
  return notifyOfficerOfVisit(data.host_officer_id, data, env, true);
}

// Notify Director and Deputy Director of the directorate
async function notifyDirectorateLeadership(data: VisitNotifyData, env: Env): Promise<ArrivalMessageRef[]> {
  const refs: ArrivalMessageRef[] = [];
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
      const sent = await sendArrivalAlert(env, {
        chatId: leader.telegram_chat_id,
        text: formatVisitorMessage(data, 'director'),
        photoKey: data.photo_url,
      });
      if (sent) refs.push({ c: leader.telegram_chat_id, m: sent.messageId, p: sent.photo ? 1 : 0 });
    }

    // Check KV for user-linked Telegram
    const user = await findUserByOfficer(leader, env);
    if (!leader.telegram_chat_id && !user) {
      console.warn(JSON.stringify({ kind: 'notify', channel: 'none', ok: false, detail: 'unreachable', officer_id: leader.id, visit_id: data.visit_id }));
    }
    if (user) {
      const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
      if (kvChatId && kvChatId !== leader.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
        const sent = await sendArrivalAlert(env, {
          chatId: kvChatId,
          text: formatVisitorMessage(data, 'director'),
          photoKey: data.photo_url,
        });
        if (sent) refs.push({ c: kvChatId, m: sent.messageId, p: sent.photo ? 1 : 0 });
      }

      // In-app notification
      await createInAppNotification(user.id, data, env, `Directorate visitor for ${hostOfficer?.name ?? 'staff'}`);
    }
  }
  return refs;
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

// ---------------------------------------------------------------------------
// Watchlist alerts (spec 2026-07-19-delegation-and-watchlist-design §B).
// Fired by the check-in route AFTER the visit row exists. Both kinds share the
// in-app type `watchlist_alert` (already push-whitelisted) and the Telegram
// admin chat. Neither ever blocks or visibly alters the check-in itself.
// ---------------------------------------------------------------------------

export interface WatchlistVisitorInfo {
  first_name: string;
  last_name: string;
  flag: string | null;
}

export interface WatchlistVisitInfo {
  id: string;
  host_name: string | null;
  directorate_id: string | null;
}

export async function notifyWatchlist(
  env: Env,
  visitor: WatchlistVisitorInfo,
  visit: WatchlistVisitInfo,
): Promise<void> {
  if (visitor.flag !== 'vip' && visitor.flag !== 'banned') return;
  const name = `${visitor.first_name} ${visitor.last_name}`.trim();

  if (visitor.flag === 'vip') {
    // VIP: directorate leadership (same title query the arrival fanout uses) +
    // Telegram admin chat, so the visit gets expedited.
    const title = `VIP arrival: ${name}`;
    const body = `${name} has arrived${visit.host_name ? ` for ${visit.host_name}` : ''} — please expedite.`;
    const telegram = [
      `\u{2B50} <b>VIP Arrival — OHCS VMS</b>`,
      '',
      `VIP <b>${escapeHtml(name)}</b> has arrived${visit.host_name ? ` for <b>${escapeHtml(visit.host_name)}</b>` : ''}.`,
      'Please expedite.',
      '',
      `\u2014 OHCS VMS`,
    ].join('\n');

    if (visit.directorate_id) {
      const leaders = await env.DB.prepare(
        `SELECT o.id, o.name, o.email, o.telegram_chat_id
         FROM officers o
         WHERE o.directorate_id = ? AND (
           o.title LIKE '%Director%' OR o.title LIKE '%Deputy%' OR
           o.title LIKE '%Head%' OR o.title LIKE '%Chief%'
         )`
      ).bind(visit.directorate_id).all<{ id: string; name: string; email: string | null; telegram_chat_id: string | null }>();

      for (const leader of leaders.results ?? []) {
        if (leader.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
          const ok = await sendTelegramMessage({
            chatId: leader.telegram_chat_id,
            text: telegram,
            token: env.TELEGRAM_BOT_TOKEN,
          });
          await recordNotifyOutcome(env, 'telegram', ok);
        }
        const user = await findUserByOfficer(leader, env);
        if (user) {
          await sendTypedNotification(env, {
            userId: user.id,
            type: 'watchlist_alert',
            title,
            body,
            url: `/visit/${visit.id}`,
            visitId: visit.id,
          });
        }
      }
    }
    await notifyTelegramAdminChat(env, telegram);
    return;
  }

  // Banned: poker face at the desk — silent alert to reception/admin users +
  // Telegram admin chat. Security handles it in person.
  const title = 'Flagged visitor checked in';
  const body = `⚠️ Flagged visitor ${name} (banned) just checked in — assess discreetly.`;
  const telegram = [
    `\u{26A0}\u{FE0F} <b>Flagged Visitor — OHCS VMS</b>`,
    '',
    `Flagged visitor <b>${escapeHtml(name)}</b> (banned) just checked in${visit.host_name ? ` to see <b>${escapeHtml(visit.host_name)}</b>` : ''}.`,
    'Assess discreetly — the visitor has not been alerted.',
    '',
    `\u2014 OHCS VMS`,
  ].join('\n');

  const users = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('receptionist', 'admin', 'superadmin') AND is_active = 1"
  ).all<{ id: string }>();
  for (const u of users.results ?? []) {
    await sendTypedNotification(env, {
      userId: u.id,
      type: 'watchlist_alert',
      title,
      body,
      url: `/visit/${visit.id}`,
      visitId: visit.id,
    });
  }
  await notifyTelegramAdminChat(env, telegram);
}

// Telegram admin chat (same KV key the daily summary / checkout sweep use).
async function notifyTelegramAdminChat(env: Env, text: string): Promise<void> {
  const adminChatId = await env.KV.get('telegram-admin-chat-id');
  if (adminChatId && env.TELEGRAM_BOT_TOKEN) {
    const ok = await sendTelegramMessage({ chatId: adminChatId, text, token: env.TELEGRAM_BOT_TOKEN });
    await recordNotifyOutcome(env, 'telegram', ok);
  }
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

// Low survey rating (≤2 stars) — the actionable loop for the Client Service
// tier: in-app + push to reception/admin users, pointing at the Feedback page.
// Spec: 2026-07-20-visitor-satisfaction-survey-design.
export async function notifyLowSurveyRating(env: Env, opts: {
  visitId: string;
  rating: number;
  comment: string | null;
}): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT vis.id AS visit_id, v.first_name, v.last_name, d.abbreviation AS directorate_abbr
     FROM visits vis
     JOIN visitors v ON v.id = vis.visitor_id
     LEFT JOIN directorates d ON d.id = vis.directorate_id
     WHERE vis.id = ?`
  ).bind(opts.visitId).first<{ visit_id: string; first_name: string; last_name: string; directorate_abbr: string | null }>();

  const name = row ? `${row.first_name} ${row.last_name}` : 'A visitor';
  const stars = `${'★'.repeat(opts.rating)}${'☆'.repeat(5 - opts.rating)}`;
  const excerpt = opts.comment?.trim() ? ` — "${opts.comment.trim().slice(0, 140)}"` : '';
  const where = row?.directorate_abbr ? ` (${row.directorate_abbr})` : '';

  const users = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('receptionist', 'admin', 'superadmin') AND is_active = 1"
  ).all<{ id: string }>();
  for (const u of users.results ?? []) {
    await sendTypedNotification(env, {
      userId: u.id,
      type: 'survey_low_rating',
      title: `Low visit rating: ${opts.rating}/5`,
      body: `${name}${where} rated their visit ${stars}${excerpt}. Follow up via the Feedback page.`,
      url: '/feedback',
      visitId: opts.visitId,
    });
  }
}
