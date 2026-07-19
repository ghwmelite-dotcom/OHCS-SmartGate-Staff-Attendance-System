import type { Env } from '../types';
import { sendTypedNotification } from './notifier';
import { sendTelegramMessage } from './telegram';
import { escapeHtml } from '../lib/html';
import { recordNotifyOutcome } from '../lib/notify-metrics';

// Waiting-time SLA escalation (spec 2026-07-19-sla-and-evacuation-design §Feature A).
// A checked-in visitor with no host response for >= 30 min escalates to the host
// directorate's reception team (in-app + push) and the Telegram admin chat.
export interface SlaBreach {
  id: string;
  first_name: string;
  last_name: string;
  badge_code: string | null;
  host_name: string | null;
  directorate_id: string | null;
  directorate_abbr: string | null;
  check_in_at: string;
  wait_minutes: number;
}

// Waiting = status 'checked_in' AND host_response IS NULL. The threshold matches
// the red band on the dashboard; the cron only runs during office hours.
const SLA_MINUTES = 30;
// Per-visit dedupe: a visit alerts once, then goes quiet for 24h.
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const MAX_LISTED = 10;

// Pure message builder — unit-testable without DB/KV. Returns null when there
// are no breaches: silence means clean, nothing is sent.
export function buildSlaMessage(
  breaches: SlaBreach[],
): { title: string; body: string; telegram: string } | null {
  if (breaches.length === 0) return null;
  const n = breaches.length;
  const listed = breaches.slice(0, MAX_LISTED);
  const extra = n - listed.length;

  const plainLines = listed.map(
    (b) =>
      `• ${b.first_name} ${b.last_name}${b.badge_code ? ` — ${b.badge_code}` : ''} · waiting ${b.wait_minutes}m${b.host_name ? ` (host: ${b.host_name})` : ''}`,
  );
  if (extra > 0) plainLines.push(`• …and ${extra} more`);

  const tgLines = listed.map(
    (b) =>
      `• <b>${escapeHtml(b.first_name)} ${escapeHtml(b.last_name)}</b>${b.badge_code ? ` — <code>${escapeHtml(b.badge_code)}</code>` : ''} · waiting <b>${b.wait_minutes}m</b>${b.host_name ? ` (host: ${escapeHtml(b.host_name)})` : ''}${b.directorate_abbr ? ` [${escapeHtml(b.directorate_abbr)}]` : ''}`,
  );
  if (extra > 0) tgLines.push(`• …and ${extra} more`);

  const title = `${n} visitor${n === 1 ? '' : 's'} waiting ${SLA_MINUTES}+ min`;
  const body = [...plainLines, '', 'Open the dashboard to follow up.'].join('\n');
  const telegram = [
    `\u{23F0} <b>Waiting-Time SLA — OHCS VMS</b>`,
    '',
    `<b>${n}</b> visitor${n === 1 ? ' has' : 's have'} waited ${SLA_MINUTES}+ min with no host response:`,
    ...tgLines,
    '',
    'Open the dashboard to follow up.',
    '',
    `\u2014 OHCS VMS`,
  ].join('\n');
  return { title, body, telegram };
}

export async function runSlaEscalation(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - SLA_MINUTES * 60_000).toISOString();

  // Open visits = checked in, no host response yet, waiting past the threshold.
  const rows = await env.DB.prepare(
    `SELECT v.id, vis.first_name, vis.last_name, v.badge_code,
            COALESCE(o.name, v.host_name_manual) AS host_name,
            v.directorate_id, d.abbreviation AS directorate_abbr, v.check_in_at
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.status = 'checked_in' AND v.host_response IS NULL AND v.check_in_at <= ?
     ORDER BY v.check_in_at`
  ).bind(cutoff).all<Omit<SlaBreach, 'wait_minutes'>>();

  // Per-visit dedupe: only visits not alerted in the last 24h escalate.
  const breaches: SlaBreach[] = [];
  for (const r of rows.results ?? []) {
    if (await env.KV.get(`sla-alerted:${r.id}`)) continue;
    breaches.push({
      ...r,
      wait_minutes: Math.max(SLA_MINUTES, Math.floor((Date.now() - new Date(r.check_in_at).getTime()) / 60_000)),
    });
  }

  const messages = buildSlaMessage(breaches);
  if (!messages) {
    console.log('[SLA] clear');
    return;
  }

  // Channel 1: one sla_breach notification per directorate to its
  // directorate_receivers officers' user accounts (in-app + push). Non-fatal.
  try {
    const byDirectorate = new Map<string, SlaBreach[]>();
    for (const b of breaches) {
      if (!b.directorate_id) continue;
      const group = byDirectorate.get(b.directorate_id) ?? [];
      group.push(b);
      byDirectorate.set(b.directorate_id, group);
    }
    for (const [directorateId, group] of byDirectorate) {
      const groupMessages = buildSlaMessage(group);
      if (!groupMessages) continue;
      const receivers = await env.DB.prepare(
        'SELECT officer_id FROM directorate_receivers WHERE directorate_id = ?'
      ).bind(directorateId).all<{ officer_id: string }>();
      for (const receiver of receivers.results ?? []) {
        const userId = await findUserIdByOfficer(receiver.officer_id, env);
        if (!userId) continue;
        await sendTypedNotification(env, {
          userId,
          type: 'sla_breach',
          title: groupMessages.title,
          body: groupMessages.body,
          url: '/',
        });
      }
    }
  } catch (err) {
    console.error(`[SLA] in-app notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Channel 2: Telegram admin chat summary (same KV key the daily summary
  // uses). Non-fatal.
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
    console.error(`[SLA] telegram notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Mark every alerted visit so it stays quiet for the next 24h.
  for (const b of breaches) {
    await env.KV.put(`sla-alerted:${b.id}`, '1', { expirationTtl: DEDUPE_TTL_SECONDS });
  }

  console.log(`[SLA] escalated ${breaches.length} waiting visit(s)`);
}

// Mirror of notifier.ts's findUserByOfficer: officers link to user accounts by
// email, falling back to an exact name match.
async function findUserIdByOfficer(officerId: string, env: Env): Promise<string | null> {
  const officer = await env.DB.prepare('SELECT email, name FROM officers WHERE id = ?')
    .bind(officerId).first<{ email: string | null; name: string }>();
  if (!officer) return null;
  if (officer.email) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(officer.email).first<{ id: string }>();
    if (user) return user.id;
  }
  const byName = await env.DB.prepare('SELECT id FROM users WHERE name = ?')
    .bind(officer.name).first<{ id: string }>();
  return byName?.id ?? null;
}
