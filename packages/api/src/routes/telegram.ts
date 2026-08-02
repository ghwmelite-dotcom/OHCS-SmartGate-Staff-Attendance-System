import type { Context } from 'hono';
import type { Env } from '../types';
import {
  sendTelegramMessage, parseCommand,
  answerCallbackQuery, editMessageText, editMessageCaption, parseArrivalCallback,
  ARRIVAL_ACTIONS, type ArrivalAction,
  AVAILABILITY_STATUSES, type AvailabilityStatus,
} from '../services/telegram';
import { recordAudit, systemActor } from '../services/audit';
import { timingSafeEqualStrings } from '../services/auth';

interface ArrivalCallbackQuery {
  id: string;
  from?: { id: number };
  data?: string;
  message?: { message_id: number; chat?: { id: number }; text?: string; caption?: string; photo?: unknown[] };
}

// Public — receives updates from Telegram
export async function telegramWebhook(c: Context<{ Bindings: Env }>) {
  // When TELEGRAM_WEBHOOK_SECRET is set, verify Telegram's
  // X-Telegram-Bot-Api-Secret-Token header (set when registering the webhook).
  // Until the secret is configured we leave the route open (current behaviour)
  // so existing deployments don't break — flip on by setting the secret.
  const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected) {
    const supplied = c.req.header('x-telegram-bot-api-secret-token');
    if (!supplied || !timingSafeEqualStrings(supplied, expected)) {
      return c.json({ ok: false }, 401);
    }
  } else if (c.env.ENVIRONMENT === 'production') {
    // In production the webhook secret is mandatory — refuse to process
    // updates when it is unset rather than leaving the endpoint open.
    return c.json({ ok: false }, 401);
  }

  const body = await c.req.json() as {
    callback_query?: ArrivalCallbackQuery;
    message?: { chat?: { id: number }; text?: string };
  };

  // Inline-keyboard taps arrive as callback_query updates — handle before messages.
  const cb = body.callback_query;
  if (cb?.data && cb.message) {
    await handleArrivalCallback(c, cb);
    return c.json({ ok: true });
  }

  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim();

  if (!chatId || !text) return c.json({ ok: true });

  const cmd = parseCommand(text);
  if (!cmd) return c.json({ ok: true }); // ignore non-command chatter

  switch (cmd.command) {
    case 'start':  await handleStart(c, chatId, cmd.args); break;
    case 'help':   await handleHelp(c, chatId); break;
    case 'link':   await handleLink(c, chatId); break;
    case 'status': await handleStatus(c, chatId); break;
    case 'unlink': await handleUnlink(c, chatId); break;
    case 'admin':  await handleAdmin(c, chatId); break;
    case 'stop':   await handleStop(c, chatId); break;
    case 'available': await handleAvailability(c, chatId, 'available'); break;
    case 'meeting':   await handleAvailability(c, chatId, 'in_meeting'); break;
    case 'out':       await handleAvailability(c, chatId, 'out_of_office'); break;
    default:
      await sendTelegramMessage({ chatId: String(chatId), text: 'I don’t recognise that command. Send /help to see what I can do.', token: c.env.TELEGRAM_BOT_TOKEN });
  }
  return c.json({ ok: true });
}

// Public — receives updates from Telegram for the DEDICATED attendance bot
// (@RSIMDAttendanceAlertsBot). Scope: staff clock-reminder linking ONLY — it
// handles /start <token> deep-links in the shared telegram-user-link:*
// namespace and nothing else. Officer-link tokens, /link, arrival callbacks
// and every other command stay on the main bot's webhook above.
export async function telegramAttendanceWebhook(c: Context<{ Bindings: Env }>) {
  // Same secret discipline as the main webhook: when the secret is set,
  // Telegram's X-Telegram-Bot-Api-Secret-Token header must match; in
  // production an unset secret refuses updates rather than leaving the
  // endpoint open.
  const expected = c.env.TELEGRAM_ATTENDANCE_WEBHOOK_SECRET;
  if (expected) {
    const supplied = c.req.header('x-telegram-bot-api-secret-token');
    if (!supplied || !timingSafeEqualStrings(supplied, expected)) {
      return c.json({ ok: false }, 401);
    }
  } else if (c.env.ENVIRONMENT === 'production') {
    return c.json({ ok: false }, 401);
  }

  const body = await c.req.json() as {
    message?: { chat?: { id: number }; text?: string };
  };

  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim();

  if (!chatId || !text) return c.json({ ok: true });

  const cmd = parseCommand(text);
  // Until the attendance token secret is set, sends go out via the main bot
  // token — the shared KV link store keeps both bots working.
  const token = c.env.TELEGRAM_ATTENDANCE_BOT_TOKEN || c.env.TELEGRAM_BOT_TOKEN;
  if (cmd?.command === 'start') {
    if (cmd.args && await handleUserLinkStart(c, chatId, cmd.args, token)) {
      return c.json({ ok: true });
    }
    // No token, or unknown/expired → harmless greeting (no error leak).
    await sendGreeting(c, chatId, token, 'attendance');
  }
  // Every other command/update is a no-op here — main-bot territory.
  return c.json({ ok: true });
}

type Ctx = Context<{ Bindings: Env }>;

// Host tapped an arrival-alert inline button (spec §4). First response wins;
// every callback gets an answer so Telegram stops retrying — failures are logged, never fatal.
async function handleArrivalCallback(c: Ctx, cb: ArrivalCallbackQuery): Promise<void> {
  const parsed = parseArrivalCallback(cb.data ?? '');
  if (!parsed) return; // not one of our arrival buttons — other keyboards may exist later
  const msg = cb.message;
  if (!msg) return;
  const { visitId, action } = parsed;
  const answer = (text: string) =>
    answerCallbackQuery({ token: c.env.TELEGRAM_BOT_TOKEN, callbackQueryId: cb.id, text });

  try {
    const visit = await c.env.DB.prepare(
      `SELECT v.id, v.host_officer_id, v.host_response, o.telegram_chat_id, o.email, o.name
       FROM visits v JOIN officers o ON o.id = v.host_officer_id WHERE v.id = ?`
    ).bind(visitId).first<{
      id: string; host_officer_id: string | null; host_response: string | null;
      telegram_chat_id: string | null; email: string | null; name: string;
    }>();
    if (!visit) {
      await answer('This visit could not be found.');
      return;
    }

    // Authorization: the tap must come from the host's own linked chat —
    // forwarded messages keep working keyboards, so verify `from` every time.
    const chatId = String(cb.from?.id ?? '');
    let authorized = chatId !== '' && chatId === visit.telegram_chat_id;
    if (!authorized) {
      let user = visit.email ? await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(visit.email).first<{ id: string }>() : null;
      if (!user) user = await c.env.DB.prepare('SELECT id FROM users WHERE name = ?').bind(visit.name).first<{ id: string }>();
      if (user) authorized = (await c.env.KV.get(`telegram-user:${user.id}`)) === chatId;
    }
    if (!authorized) {
      await answer('This alert isn’t for you.');
      return;
    }

    // First response wins — later taps (either button, any device) change nothing.
    if (visit.host_response) {
      const existing = ARRIVAL_ACTIONS[visit.host_response as ArrivalAction];
      await answer(`Already responded: ${existing?.label ?? visit.host_response}.`);
      return;
    }

    await c.env.DB.prepare(
      'UPDATE visits SET host_response = ?, host_response_at = ?, host_response_by = ? WHERE id = ?'
    ).bind(action, new Date().toISOString(), chatId, visitId).run();

    const { label, confirm } = ARRIVAL_ACTIONS[action];
    await answer(confirm);

    // Append the decision to the original message; omitting reply_markup drops
    // the keyboard. Photo arrivals carry the text as a CAPTION — Telegram
    // rejects editMessageText on media messages, so switch methods + source.
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const decided = `${(msg.text ?? msg.caption ?? '')}\n\n✅ ${label} — ${time}`;
    if (Array.isArray(msg.photo)) {
      await editMessageCaption({
        token: c.env.TELEGRAM_BOT_TOKEN,
        chatId: String(msg.chat?.id ?? ''),
        messageId: msg.message_id,
        caption: decided,
      });
    } else {
      await editMessageText({
        token: c.env.TELEGRAM_BOT_TOKEN,
        chatId: String(msg.chat?.id ?? ''),
        messageId: msg.message_id,
        text: decided,
      });
    }

    await recordAudit(c.env, systemActor('telegram-webhook', c.req.header('cf-connecting-ip') ?? null), {
      action: 'visit.host_response', entityType: 'visit', entityId: visitId,
      summary: `Host responded "${label}" via Telegram (chat ${chatId})`,
    });
  } catch (err) {
    console.error('[Telegram] Arrival callback failed:', err);
    await answer('Something went wrong — please try again.');
  }
}

async function handleStart(c: Ctx, chatId: number, args: string): Promise<void> {
  if (args) {
    // User-level link token (spec §6.2) — minted by POST /api/notifications/telegram/link-token.
    if (await handleUserLinkStart(c, chatId, args, c.env.TELEGRAM_BOT_TOKEN)) return;
    const officerId = await c.env.KV.get(`officer-link:${args}`);
    if (officerId) {
      await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?').bind(String(chatId), officerId).run();
      await c.env.KV.delete(`officer-link:${args}`);
      await recordAudit(c.env, systemActor('telegram-webhook', c.req.header('cf-connecting-ip') ?? null), {
        action: 'telegram.link', entityType: 'officer', entityId: officerId,
        summary: `Officer Telegram chat linked via one-time reception link (chat ${chatId})`,
      });
      const row = await c.env.DB.prepare(
        `SELECT o.name, d.abbreviation AS dir FROM officers o LEFT JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
      ).bind(officerId).first<{ name: string; dir: string | null }>();
      await sendTelegramMessage({
        chatId: String(chatId),
        text: `✅ <b>Linked!</b>\n\n${row?.name ?? 'You'} will now receive visitor arrival alerts${row?.dir ? ` for ${row.dir}` : ''}.`,
        token: c.env.TELEGRAM_BOT_TOKEN,
      });
      return;
    }
    // invalid/expired token → fall through to the greeting (no error leak)
  }
  await sendGreeting(c, chatId, c.env.TELEGRAM_BOT_TOKEN);
}

// /start <token> branch for user-level link tokens (spec §6.2) — minted by
// POST /api/notifications/telegram/link-token into the shared
// telegram-user-link:* KV namespace. Both webhooks (main bot + dedicated
// attendance bot) use this; the caller passes the bot token the confirmation
// is sent with. Returns false for unknown/expired tokens so the caller falls
// through to the greeting.
export async function handleUserLinkStart(c: Ctx, chatId: number, args: string, token: string): Promise<boolean> {
  const userId = await c.env.KV.get(`telegram-user-link:${args}`);
  if (!userId) return false;
  await c.env.KV.put(`telegram-user:${userId}`, String(chatId));
  // Reverse lookup used to gate /admin (chat → user → role check).
  await c.env.KV.put(`telegram-chat:${chatId}`, userId);
  await c.env.KV.delete(`telegram-user-link:${args}`);
  // If this user maps to an officer record (by email, then name), mirror the
  // chat onto the officer so they ALSO get visitor arrival alerts.
  const u = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(userId).first<{ name: string; email: string | null }>();
  let officerMirrored = false;
  if (u) {
    const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE email = ? OR name = ?').bind(u.email, u.name).first<{ id: string }>();
    if (officer) {
      await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?').bind(String(chatId), officer.id).run();
      officerMirrored = true;
    }
  }
  await recordAudit(c.env, systemActor('telegram-webhook', c.req.header('cf-connecting-ip') ?? null), {
    action: 'telegram.link', entityType: 'user', entityId: userId,
    summary: `Telegram chat linked (chat ${chatId})${officerMirrored ? '; officer record mirrored' : ''}`,
  });
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [`✅ <b>Connected!</b>`, '', `You'll now get your clock-in and clock-out reminders here on Telegram.`].join('\n'),
    token,
  });
  return true;
}

// Harmless greeting — the fall-through for /start without a (valid) token.
// Shared by both webhooks so an unknown token never leaks an error; the
// attendance bot gets its own copy so it doesn't introduce itself as SmartGate.
export async function sendGreeting(c: Ctx, chatId: number, token: string, kind: 'smartgate' | 'attendance' = 'smartgate'): Promise<void> {
  const text = kind === 'attendance'
    ? [
        `⏰ <b>Attendance Alerts</b>`,
        '',
        `I send your clock-in and clock-out reminders. Link your staff account from the attendance app to get started.`,
      ].join('\n')
    : [
        `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot</b>`,
        '',
        `I send visitor-arrival alerts and daily attendance summaries.`,
        '',
        `Send /help to see everything I can do, or /link for linking instructions.`,
      ].join('\n');
  await sendTelegramMessage({ chatId: String(chatId), text, token });
}

async function handleHelp(c: Ctx, chatId: number): Promise<void> {
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [
      `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot — Commands</b>`,
      '',
      `/link — Linking instructions (one-time link from the dashboard or attendance app)`,
      `/status — Check your link &amp; alert status`,
      `/available — Mark yourself available`,
      `/meeting — Mark yourself in a meeting`,
      `/out — Mark yourself out of office`,
      `/unlink — Stop receiving visitor alerts`,
      `/admin — Get daily summaries (linked administrators only)`,
      `/stop — Stop daily summaries`,
      `/help — Show this list`,
    ].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

// /link <StaffID> used to link any chat to any account with zero identity
// proof (security audit, 2026-08-01) — removed. Linking now requires a
// one-time token: officers via the admin dashboard (officer-link / deep-link
// flow), staff via the attendance app for clock reminders. This handler only
// explains that; it performs NO writes and NO lookups — the reply is uniform
// whether or not the supplied ID exists (no staff-ID enumeration oracle).
async function handleLink(c: Ctx, chatId: number): Promise<void> {
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [
      `🔒 <b>Linking has moved.</b>`,
      '',
      `For security, /link no longer connects accounts. Use a one-time link instead:`,
      `• <b>Officers</b> — open the one-time link from the admin dashboard to get visitor alerts.`,
      `• <b>Staff</b> — link from the staff attendance app to get clock reminders.`,
    ].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleStatus(c: Ctx, chatId: number): Promise<void> {
  const officer = await c.env.DB.prepare(
    `SELECT o.name, d.abbreviation AS dir, o.availability_status FROM officers o LEFT JOIN directorates d ON o.directorate_id = d.id WHERE o.telegram_chat_id = ? LIMIT 1`
  ).bind(String(chatId)).first<{ name: string; dir: string | null; availability_status: AvailabilityStatus | null }>();
  const summariesOn = (await c.env.KV.get('telegram-admin-chat-id')) === String(chatId);
  const lines = [`\u{1F4CB} <b>Your status</b>`, ''];
  lines.push(officer
    ? `Visitor alerts: <b>ON</b> — linked as ${officer.name}${officer.dir ? ` (${officer.dir})` : ''}.`
    : `Visitor alerts: <b>OFF</b> — not linked. Use the one-time link from the admin dashboard or attendance app.`);
  if (officer) {
    const avail = AVAILABILITY_STATUSES[officer.availability_status ?? 'available'];
    lines.push(`Availability: ${avail.emoji} <b>${avail.label}</b> — change with /available, /meeting, /out.`);
  }
  lines.push(`Daily summaries: <b>${summariesOn ? 'ON' : 'OFF'}</b>.`);
  await sendTelegramMessage({ chatId: String(chatId), text: lines.join('\n'), token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleUnlink(c: Ctx, chatId: number): Promise<void> {
  // Reverse lookup key always belongs to this chat — drop it regardless of
  // whether an officer record is mirrored.
  await c.env.KV.delete(`telegram-chat:${chatId}`);
  // An admin who unlinks must not strand the daily-summary registration on a
  // chat they no longer control — clear it too.
  const adminCleared = (await c.env.KV.get('telegram-admin-chat-id')) === String(chatId);
  if (adminCleared) await c.env.KV.delete('telegram-admin-chat-id');
  const rows = (await c.env.DB.prepare('SELECT id, email, name FROM officers WHERE telegram_chat_id = ?').bind(String(chatId)).all<{ id: string; email: string | null; name: string }>()).results ?? [];
  if (rows.length === 0) {
    await sendTelegramMessage({ chatId: String(chatId), text: `You aren’t linked, so there’s nothing to unlink.${adminCleared ? ' Daily summaries also stopped.' : ''}`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  for (const o of rows) {
    let user = o.email ? await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(o.email).first<{ id: string }>() : null;
    if (!user) user = await c.env.DB.prepare('SELECT id FROM users WHERE name = ?').bind(o.name).first<{ id: string }>();
    if (user && (await c.env.KV.get(`telegram-user:${user.id}`)) === String(chatId)) {
      await c.env.KV.delete(`telegram-user:${user.id}`);
    }
  }
  await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').bind(String(chatId)).run();
  await sendTelegramMessage({ chatId: String(chatId), text: `Done — you’ll no longer receive visitor alerts.${adminCleared ? ' Daily summaries also stopped.' : ''} Re-link any time with a fresh one-time link from the dashboard or attendance app.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

// Daily-summary registration is admin-only (security audit, 2026-08-01):
// the sender's chat must be linked (telegram-chat: reverse key) to a user
// whose role is admin/superadmin — the admin chat receives daily summaries
// plus VIP/watchlist alerts.
async function handleAdmin(c: Ctx, chatId: number): Promise<void> {
  const userId = await c.env.KV.get(`telegram-chat:${chatId}`);
  const user = userId
    ? await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>()
    : null;
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    await sendTelegramMessage({
      chatId: String(chatId),
      text: `Daily summaries are for OHCS administrators. Link your administrator account from the dashboard (one-time link), then send /admin again.`,
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
    return;
  }
  await c.env.KV.put('telegram-admin-chat-id', String(chatId));
  await sendTelegramMessage({ chatId: String(chatId), text: `✅ <b>Daily summaries enabled!</b>\n\nYou’ll receive attendance reports at 9:00 AM (Mon–Fri).\n\nSend /stop to unsubscribe.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleStop(c: Ctx, chatId: number): Promise<void> {
  // Only the registered admin chat may unsubscribe itself — anyone else gets
  // a refusal and the registration stays intact.
  if ((await c.env.KV.get('telegram-admin-chat-id')) !== String(chatId)) {
    await sendTelegramMessage({ chatId: String(chatId), text: `Only the subscribed administrator chat can stop daily summaries.`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  await c.env.KV.delete('telegram-admin-chat-id');
  await sendTelegramMessage({ chatId: String(chatId), text: `Daily summaries disabled. Send /admin to re-enable.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

// Host availability commands (spec: 2026-07-19-host-availability-design) —
// /available, /meeting, /out set the linked officer's availability_status.
async function handleAvailability(c: Ctx, chatId: number, status: AvailabilityStatus): Promise<void> {
  const officer = await c.env.DB.prepare(
    'SELECT id, name FROM officers WHERE telegram_chat_id = ? LIMIT 1'
  ).bind(String(chatId)).first<{ id: string; name: string }>();
  if (!officer) {
    await sendTelegramMessage({
      chatId: String(chatId),
      text: `Your chat isn’t linked to an officer record yet — link first with the one-time link from the admin dashboard or attendance app.`,
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
    return;
  }
  await c.env.DB.prepare(
    `UPDATE officers SET availability_status = ?, availability_updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).bind(status, officer.id).run();
  const { emoji, label } = AVAILABILITY_STATUSES[status];
  await sendTelegramMessage({
    chatId: String(chatId),
    text: status === 'available'
      ? `${emoji} Availability set to <b>${label}</b>.`
      : `${emoji} Availability set to <b>${label}</b>. Send /available when you're back.`,
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}
