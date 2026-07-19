import type { Env } from '../types';
import { escapeHtml } from '../lib/html';

// Telegram Bot API inline keyboard (subset we use)
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

interface SendMessageParams {
  chatId: string;
  text: string;
  token: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export async function sendTelegramMessage({ chatId, text, token, replyMarkup }: SendMessageParams): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
    return res.ok;
  } catch (err) {
    console.error('[Telegram] Send failed:', err);
    return false;
  }
}

// Best-effort toast shown on the host's device after tapping an inline button.
export async function answerCallbackQuery({ token, callbackQueryId, text }: {
  token: string;
  callbackQueryId: string;
  text: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    if (!res.ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
    return res.ok;
  } catch (err) {
    console.error('[Telegram] answerCallbackQuery failed:', err);
    return false;
  }
}

// Replaces a message's text; omitting reply_markup drops its keyboard.
export async function editMessageText({ token, chatId, messageId, text }: {
  token: string;
  chatId: string;
  messageId: number;
  text: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
    return res.ok;
  } catch (err) {
    console.error('[Telegram] editMessageText failed:', err);
    return false;
  }
}

// Arrival-alert actions (spec §1) — callback_data stays ≤ 64 bytes via the `va:` prefix.
export const ARRIVAL_ACTIONS = {
  coming_down:  { emoji: '⬇️', label: 'Coming down', confirm: "Noted — visitor told you're coming down." },
  waiting_area: { emoji: '🪑', label: 'Waiting area', confirm: 'Noted — visitor will wait in the waiting area.' },
  reschedule:   { emoji: '📅', label: 'Reschedule', confirm: 'Noted — reception will reschedule the visit.' },
} as const;

export type ArrivalAction = keyof typeof ARRIVAL_ACTIONS;

export function buildArrivalKeyboard(visitId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      (Object.keys(ARRIVAL_ACTIONS) as ArrivalAction[]).map((action) => ({
        text: `${ARRIVAL_ACTIONS[action].emoji} ${ARRIVAL_ACTIONS[action].label}`,
        callback_data: `va:${visitId}:${action}`,
      })),
    ],
  };
}

export function parseArrivalCallback(data: string): { visitId: string; action: ArrivalAction } | null {
  const m = data.match(/^va:([^:]+):(coming_down|waiting_area|reschedule)$/);
  if (!m) return null;
  return { visitId: m[1]!, action: m[2]! as ArrivalAction };
}

export function formatVisitorArrivalMessage(visitor: {
  first_name: string;
  last_name: string;
  organisation: string | null;
  purpose_raw: string | null;
  badge_code: string | null;
  check_in_at: string;
  directorate_abbr: string | null;
}): string {
  const time = new Date(visitor.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const lines = [
    '\u{1F4CB} <b>Visitor Arrival \u2014 OHCS VMS</b>',
    '',
    `<b>${escapeHtml(visitor.first_name)} ${escapeHtml(visitor.last_name)}</b>${visitor.organisation ? ` (${escapeHtml(visitor.organisation)})` : ''}`,
  ];

  if (visitor.purpose_raw) lines.push(`Purpose: ${escapeHtml(visitor.purpose_raw)}`);
  if (visitor.badge_code) lines.push(`Badge: <code>${escapeHtml(visitor.badge_code)}</code>`);
  lines.push('');
  lines.push(`Checked in at ${time}${visitor.directorate_abbr ? ` \u2022 ${escapeHtml(visitor.directorate_abbr)} Reception` : ''}`);

  return lines.join('\n');
}

export function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const m = trimmed.slice(1).match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const command = m[1]!.split('@')[0]!.toLowerCase();
  if (!command) return null;
  return { command, args: (m[2] ?? '').trim() };
}

export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'start',  description: 'What this bot does' },
  { command: 'help',   description: 'Show all commands' },
  { command: 'link',   description: 'Link your Staff ID to receive alerts' },
  { command: 'status', description: 'Check your link & alert status' },
  { command: 'unlink', description: 'Stop receiving visitor alerts' },
  { command: 'admin',  description: 'Get daily attendance summaries' },
  { command: 'stop',   description: 'Stop daily summaries' },
];

// Publish the command menu to Telegram (global; persists until re-pushed). Best-effort.
export async function setBotCommands(env: { TELEGRAM_BOT_TOKEN: string }): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function generateLinkCode(chatId: string, env: Env): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await env.KV.put(`telegram-link:${code}`, chatId, { expirationTtl: 600 });
  return code;
}

export async function consumeLinkCode(code: string, env: Env): Promise<string | null> {
  const chatId = await env.KV.get(`telegram-link:${code}`);
  if (chatId) {
    await env.KV.delete(`telegram-link:${code}`);
  }
  return chatId;
}
