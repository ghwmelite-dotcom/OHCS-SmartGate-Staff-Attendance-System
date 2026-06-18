import type { Env } from '../types';
import { escapeHtml } from '../lib/html';

interface SendMessageParams {
  chatId: string;
  text: string;
  token: string;
}

export async function sendTelegramMessage({ chatId, text, token }: SendMessageParams): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
    return res.ok;
  } catch (err) {
    console.error('[Telegram] Send failed:', err);
    return false;
  }
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

export function parseStartToken(text: string): string | null {
  if (!text.startsWith('/start')) return null;
  const rest = text.slice('/start'.length).trim();
  if (!rest) return null;
  return rest.split(/\s+/)[0] ?? null;
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
