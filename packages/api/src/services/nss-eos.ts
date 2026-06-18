import type { Env } from '../types';
import { escapeHtml } from '../lib/html';
import { sendToAdminSubscribers } from './daily-summary';

/**
 * NSS End-of-Service automation.
 *
 * Two responsibilities, executed once daily by the 00:30 UTC cron:
 *
 *   1. Auto-deactivate any NSS user whose `nss_end_date` is now in the past.
 *      Records remain intact; only `is_active` flips to 0.
 *   2. Notify admins via Telegram about NSS personnel finishing in the next
 *      7 days, so handover, certification and PIN deactivation can be planned.
 *
 * The function is also reachable on-demand via the manual-trigger endpoint
 * `POST /api/admin/nss/run-eos` — useful for smoke-testing right after deploy.
 */

interface ExpiringRow {
  name: string;
  nss_number: string | null;
  intern_code: string | null;
  directorate_abbr: string | null;
  nss_end_date: string;
  user_type: string;
}

export interface NssEosResult {
  deactivated: number;
  expiring_soon: number;
}

const MAX_LIST_NAMES = 20;

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

function formatDateGB(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function buildMessage(rows: ExpiringRow[], deactivated: number): string {
  const lines: string[] = [];
  lines.push('⏰ <b>Service Personnel Ending — This Week</b>');
  lines.push(
    `${rows.length} service personnel (NSS & interns) finish in the next 7 days.`,
  );
  lines.push('');

  for (const r of rows.slice(0, MAX_LIST_NAMES)) {
    const name = escapeHtml(r.name);
    const dir = r.directorate_abbr ? escapeHtml(r.directorate_abbr) : '—';
    const ends = formatDateGB(r.nss_end_date);
    const typeTag = r.user_type === 'intern' ? 'Intern' : 'NSS';
    const idLabel = r.user_type === 'intern'
      ? (r.intern_code ? escapeHtml(r.intern_code) : '—')
      : (r.nss_number ? escapeHtml(r.nss_number) : '—');
    lines.push(`• ${name} (${idLabel}) — ${dir} — ${typeTag} — ends ${ends}`);
  }

  if (rows.length > MAX_LIST_NAMES) {
    lines.push(`… and ${rows.length - MAX_LIST_NAMES} more`);
  }

  lines.push('');
  if (deactivated > 0) {
    lines.push(`Auto-deactivated today: ${deactivated}`);
    lines.push('');
  }
  lines.push('— OHCS Staff Attendance');

  return lines.join('\n');
}

/**
 * Deactivate NSS users whose service has ended, then dispatch the
 * "ending this week" digest to admin Telegram subscribers (if any).
 *
 * Always returns the counts so the caller can log/respond with them.
 */
export async function runNssEndOfServiceCheck(env: Env): Promise<NssEosResult> {
  const today = todayUtcIso();
  const inSevenDays = isoPlusDays(7);

  // 1) Auto-deactivate anyone whose posting end date is now in the past.
  const updateRes = await env.DB
    .prepare(
      `UPDATE users
          SET is_active = 0,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE user_type IN ('nss','intern')
          AND is_active = 1
          AND nss_end_date IS NOT NULL
          AND nss_end_date < ?`,
    )
    .bind(today)
    .run();

  // D1's `meta.changes` reports affected rows. Treat unknown as 0.
  const deactivated = Number((updateRes.meta as { changes?: number } | undefined)?.changes ?? 0);

  // 2) Pull NSS users finishing in [today, today + 7 days].
  const expiringRes = await env.DB
    .prepare(
      `SELECT u.name,
              u.nss_number,
              u.intern_code,
              d.abbreviation AS directorate_abbr,
              u.nss_end_date,
              u.user_type
         FROM users u
         LEFT JOIN directorates d ON u.directorate_id = d.id
        WHERE u.user_type IN ('nss','intern')
          AND u.is_active = 1
          AND u.nss_end_date IS NOT NULL
          AND u.nss_end_date >= ?
          AND u.nss_end_date <= ?
        ORDER BY u.nss_end_date ASC, u.name ASC`,
    )
    .bind(today, inSevenDays)
    .all<ExpiringRow>();

  const expiring = (expiringRes.results ?? []) as ExpiringRow[];

  // 3) Dispatch admin Telegram message if anyone is in the window.
  if (expiring.length > 0) {
    const message = buildMessage(expiring, deactivated);
    await sendToAdminSubscribers(message, env);
  } else if (deactivated > 0) {
    // Edge case: someone ended yesterday but nobody is finishing this week.
    // Still tell admins so the deactivation isn't silent.
    const lines = [
      '⏰ <b>Service Personnel Ending</b>',
      `Auto-deactivated today: ${deactivated}`,
      '',
      'No service personnel finish in the next 7 days.',
      '',
      '— OHCS Staff Attendance',
    ];
    await sendToAdminSubscribers(lines.join('\n'), env);
  }

  console.log(
    `[NSS-EOS] deactivated=${deactivated} expiring_soon=${expiring.length}`,
  );

  return { deactivated, expiring_soon: expiring.length };
}
