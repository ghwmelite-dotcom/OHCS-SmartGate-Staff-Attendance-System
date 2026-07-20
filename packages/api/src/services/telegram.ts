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

export interface TelegramSendResult {
  ok: boolean;
  /** Telegram message_id when the send succeeded — needed to edit the message later. */
  messageId: number | null;
}

// sendMessage variant that returns the message_id. The arrival-alert path uses
// it so a later checkout can find and edit the exact message (visit-ended).
export async function sendTelegramMessageWithId({ chatId, text, token, replyMarkup }: SendMessageParams): Promise<TelegramSendResult> {
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
    if (!res.ok) {
      console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
      return { ok: false, messageId: null };
    }
    try {
      const json = await res.json() as { ok?: boolean; result?: { message_id?: number } };
      return { ok: json.ok !== false, messageId: json.result?.message_id ?? null };
    } catch {
      // 2xx with an unparseable body — the message was sent, just untracked.
      return { ok: true, messageId: null };
    }
  } catch (err) {
    console.error('[Telegram] Send failed:', err);
    return { ok: false, messageId: null };
  }
}

export async function sendTelegramMessage(params: SendMessageParams): Promise<boolean> {
  return (await sendTelegramMessageWithId(params)).ok;
}

// Photo variant — arrival alerts carry the visitor's kiosk photo so the host
// can recognise (and sanity-check) who is waiting. Caption rides the same
// HTML text; Telegram caps captions at 1024 chars. reply_markup works too.
export async function sendTelegramPhoto({ chatId, photo, caption, token, replyMarkup }: {
  chatId: string;
  photo: ArrayBuffer;
  caption: string;
  token: string;
  replyMarkup?: InlineKeyboardMarkup;
}): Promise<TelegramSendResult> {
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    form.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'visitor.jpg');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    if (!res.ok) {
      console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
      return { ok: false, messageId: null };
    }
    try {
      const json = await res.json() as { ok?: boolean; result?: { message_id?: number } };
      return { ok: json.ok !== false, messageId: json.result?.message_id ?? null };
    } catch {
      // 2xx with an unparseable body — the message was sent, just untracked.
      return { ok: true, messageId: null };
    }
  } catch (err) {
    console.error('[Telegram] sendPhoto failed:', err);
    return { ok: false, messageId: null };
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

// Media messages (sendPhoto) have no text to edit — their caption is the
// editable field. Same keyboard-drop semantics as editMessageText.
export async function editMessageCaption({ token, chatId, messageId, caption }: {
  token: string;
  chatId: string;
  messageId: number;
  caption: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        caption: caption.slice(0, 1024),
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
    return res.ok;
  } catch (err) {
    console.error('[Telegram] editMessageCaption failed:', err);
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

// Host availability (spec: 2026-07-19-host-availability-design) — set via the
// /available, /meeting, /out bot commands; NULL in the DB reads as 'available'.
export const AVAILABILITY_STATUSES = {
  available:     { emoji: '🟢', label: 'Available' },
  in_meeting:    { emoji: '🟡', label: 'In a meeting' },
  out_of_office: { emoji: '⚪', label: 'Out of office' },
} as const;

export type AvailabilityStatus = keyof typeof AVAILABILITY_STATUSES;

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
  { command: 'available', description: 'Mark yourself available' },
  { command: 'meeting',   description: 'Mark yourself in a meeting' },
  { command: 'out',       description: 'Mark yourself out of office' },
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


/* ---- Arrival thread tracking (visit-ended edits) ----
   Every Telegram arrival message sent for a visit is recorded in KV so a
   later checkout can rewrite the whole thread to its closed state. KV (not a
   column) because the refs are ephemeral — 36h TTL, visits never span longer. */

export interface ArrivalMessageRef { c: string; m: number; p?: 1 | 0 }

const ARRIVAL_THREAD_TTL_S = 129_600; // 36h

export async function recordArrivalMessages(env: Env, visitId: string, refs: ArrivalMessageRef[]): Promise<void> {
  if (refs.length === 0) return;
  await env.KV.put(`tg-arrival:${visitId}`, JSON.stringify(refs), { expirationTtl: ARRIVAL_THREAD_TTL_S });
}

export function formatDurationMinutes(min: number | null): string {
  if (min == null || min < 0) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// Rewrites every Telegram arrival message for a visit to its closed state and
// drops the keyboards. Photo messages are edited via caption (Telegram rule).
// Best-effort — called after checkout; failures are logged, never thrown.
export async function closeArrivalThread(env: Env, visit: {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  organisation?: string | null;
  check_out_at?: string | null;
  duration_minutes?: number | null;
}): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const key = `tg-arrival:${visit.id}`;
  const raw = await env.KV.get(key);
  if (!raw) return;
  await env.KV.delete(key);

  let refs: ArrivalMessageRef[] = [];
  try { refs = JSON.parse(raw) as ArrivalMessageRef[]; } catch { /* malformed → nothing to edit */ }
  if (refs.length === 0) return;

  const name = [visit.first_name, visit.last_name].filter(Boolean).join(' ').trim() || 'Visitor';
  const org = visit.organisation ? ` (${visit.organisation})` : '';
  const time = visit.check_out_at
    ? new Date(visit.check_out_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '';
  const duration = formatDurationMinutes(visit.duration_minutes ?? null);

  const lines = [`\u{2705} <b>Visit ended</b> — ${escapeHtml(name)}${escapeHtml(org)}`];
  const meta = [time ? `Checked out ${time}` : '', duration].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  lines.push('', `\u2014 OHCS VMS`);
  const text = lines.join('\n');

  await Promise.all(refs.map(async ({ c, m, p }) => {
    const ok = p
      ? await editMessageCaption({ token: env.TELEGRAM_BOT_TOKEN!, chatId: c, messageId: m, caption: text })
      : await editMessageText({ token: env.TELEGRAM_BOT_TOKEN!, chatId: c, messageId: m, text });
    if (!ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: 'closeArrivalThread edit failed', visit_id: visit.id }));
  }));
}
