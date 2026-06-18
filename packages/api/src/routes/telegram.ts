import { z } from 'zod';
import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { generateLinkCode, consumeLinkCode, sendTelegramMessage, parseCommand } from '../services/telegram';
import { success, error } from '../lib/response';

// Public — receives updates from Telegram
export async function telegramWebhook(c: Context<{ Bindings: Env }>) {
  // When TELEGRAM_WEBHOOK_SECRET is set, verify Telegram's
  // X-Telegram-Bot-Api-Secret-Token header (set when registering the webhook).
  // Until the secret is configured we leave the route open (current behaviour)
  // so existing deployments don't break — flip on by setting the secret.
  const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected) {
    const supplied = c.req.header('x-telegram-bot-api-secret-token');
    if (supplied !== expected) {
      return c.json({ ok: false }, 401);
    }
  }

  const body = await c.req.json() as {
    message?: { chat?: { id: number }; text?: string };
  };

  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim();

  if (!chatId || !text) return c.json({ ok: true });

  const cmd = parseCommand(text);
  if (!cmd) return c.json({ ok: true }); // ignore non-command chatter

  switch (cmd.command) {
    case 'start':  await handleStart(c, chatId, cmd.args); break;
    case 'help':   await handleHelp(c, chatId); break;
    case 'link':   await handleLink(c, chatId, cmd.args); break;
    case 'status': await handleStatus(c, chatId); break;
    case 'unlink': await handleUnlink(c, chatId); break;
    case 'admin':  await handleAdmin(c, chatId); break;
    case 'stop':   await handleStop(c, chatId); break;
    default:
      await sendTelegramMessage({ chatId: String(chatId), text: 'I don’t recognise that command. Send /help to see what I can do.', token: c.env.TELEGRAM_BOT_TOKEN });
  }
  return c.json({ ok: true });
}

type Ctx = Context<{ Bindings: Env }>;

async function handleStart(c: Ctx, chatId: number, args: string): Promise<void> {
  if (args) {
    const officerId = await c.env.KV.get(`officer-link:${args}`);
    if (officerId) {
      await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?').bind(String(chatId), officerId).run();
      await c.env.KV.delete(`officer-link:${args}`);
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
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [
      `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot</b>`,
      '',
      `I send visitor-arrival alerts and daily attendance summaries.`,
      '',
      `Send /help to see everything I can do, or /link &lt;StaffID&gt; to start receiving alerts.`,
    ].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleHelp(c: Ctx, chatId: number): Promise<void> {
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [
      `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot — Commands</b>`,
      '',
      `/link &lt;StaffID&gt; — Link your account to receive alerts`,
      `/status — Check your link &amp; alert status`,
      `/unlink — Stop receiving visitor alerts`,
      `/admin — Get daily attendance summaries`,
      `/stop — Stop daily summaries`,
      `/help — Show this list`,
    ].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleLink(c: Ctx, chatId: number, args: string): Promise<void> {
  const staffId = args.trim().toUpperCase();
  if (!staffId) {
    await sendTelegramMessage({ chatId: String(chatId), text: `Please include your Staff ID.\n\nExample: <code>/link 1334685</code>`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  const user = await c.env.DB.prepare('SELECT id, name, email FROM users WHERE staff_id = ?').bind(staffId).first<{ id: string; name: string; email: string }>();
  if (!user) {
    await sendTelegramMessage({ chatId: String(chatId), text: `❌ Staff ID <code>${staffId}</code> not found. Check your ID and try again.`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE email = ? OR name = ?').bind(user.email, user.name).first<{ id: string }>();
  if (officer) {
    await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?').bind(String(chatId), officer.id).run();
  }
  await c.env.KV.put(`telegram-user:${user.id}`, String(chatId));
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [`✅ <b>Linked successfully!</b>`, '', `\u{1F464} ${user.name}`, `\u{1F4CB} Staff ID: ${staffId}`, '', `You'll now receive visitor arrival notifications. Send /admin for daily summaries.`].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleStatus(c: Ctx, chatId: number): Promise<void> {
  const officer = await c.env.DB.prepare(
    `SELECT o.name, d.abbreviation AS dir FROM officers o LEFT JOIN directorates d ON o.directorate_id = d.id WHERE o.telegram_chat_id = ? LIMIT 1`
  ).bind(String(chatId)).first<{ name: string; dir: string | null }>();
  const summariesOn = (await c.env.KV.get('telegram-admin-chat-id')) === String(chatId);
  const lines = [`\u{1F4CB} <b>Your status</b>`, ''];
  lines.push(officer
    ? `Visitor alerts: <b>ON</b> — linked as ${officer.name}${officer.dir ? ` (${officer.dir})` : ''}.`
    : `Visitor alerts: <b>OFF</b> — not linked. Send /link &lt;StaffID&gt;, or use the link from reception.`);
  lines.push(`Daily summaries: <b>${summariesOn ? 'ON' : 'OFF'}</b>.`);
  await sendTelegramMessage({ chatId: String(chatId), text: lines.join('\n'), token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleUnlink(c: Ctx, chatId: number): Promise<void> {
  const rows = (await c.env.DB.prepare('SELECT id, email, name FROM officers WHERE telegram_chat_id = ?').bind(String(chatId)).all<{ id: string; email: string | null; name: string }>()).results ?? [];
  if (rows.length === 0) {
    await sendTelegramMessage({ chatId: String(chatId), text: `You aren’t linked, so there’s nothing to unlink.`, token: c.env.TELEGRAM_BOT_TOKEN });
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
  await sendTelegramMessage({ chatId: String(chatId), text: `Done — you’ll no longer receive visitor alerts. Re-link any time with /link or a fresh link from reception.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleAdmin(c: Ctx, chatId: number): Promise<void> {
  await c.env.KV.put('telegram-admin-chat-id', String(chatId));
  await sendTelegramMessage({ chatId: String(chatId), text: `✅ <b>Daily summaries enabled!</b>\n\nYou’ll receive attendance reports at 9:00 AM (Mon–Fri).\n\nSend /stop to unsubscribe.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleStop(c: Ctx, chatId: number): Promise<void> {
  await c.env.KV.delete('telegram-admin-chat-id');
  await sendTelegramMessage({ chatId: String(chatId), text: `Daily summaries disabled. Send /admin to re-enable.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

// Protected — link Telegram account to officer
const linkSchema = z.object({ code: z.string().min(1) });

export async function telegramLinkRoute(c: Context<{ Bindings: Env; Variables: { session: SessionData } }>) {
  const body = await c.req.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 'VALIDATION_ERROR', 'Missing link code', 400);
  }

  const { code } = parsed.data;
  const session = c.get('session');

  const chatId = await consumeLinkCode(code, c.env);
  if (!chatId) {
    return error(c, 'INVALID_CODE', 'Link code is invalid or expired', 400);
  }

  const officer = await c.env.DB.prepare(
    'SELECT id FROM officers WHERE email = ?'
  ).bind(session.email).first<{ id: string }>();

  if (!officer) {
    return error(c, 'NOT_OFFICER', 'No officer record found for your account', 404);
  }

  await c.env.DB.prepare(
    'UPDATE officers SET telegram_chat_id = ? WHERE id = ?'
  ).bind(chatId, officer.id).run();

  await sendTelegramMessage({
    chatId,
    text: `✅ Account linked! You'll now receive visitor arrival notifications for <b>${session.name}</b>.`,
    token: c.env.TELEGRAM_BOT_TOKEN,
  });

  return success(c, { message: 'Telegram account linked successfully' });
}
