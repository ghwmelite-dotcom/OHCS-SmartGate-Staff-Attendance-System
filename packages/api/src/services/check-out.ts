import type { Env } from '../types';
import { SELECT_VISIT_WITH_JOINS } from './visit-queries';
import { closeArrivalThread } from './telegram';
import { parseCapturedAt } from '../lib/clock-date';

export type CheckOutOutcome =
  | { ok: true; visit: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CHECKED_OUT' };

// capturedAt: client capture time from an offline visit-queue replay.
// Validated server-side ([now-48h, now+5min], else ignored) and honored as
// check_out_at so a tap made at 17:05 that drains at 18:20 records ~17:05.
export async function checkOutById(env: Env, visitId: string, capturedAt?: string | null): Promise<CheckOutOutcome> {
  const visit = await env.DB.prepare('SELECT id, check_in_at, status FROM visits WHERE id = ?')
    .bind(visitId)
    .first<{ id: string; check_in_at: string; status: string }>();
  if (!visit) return { ok: false, code: 'NOT_FOUND' };
  if (visit.status !== 'checked_in') return { ok: false, code: 'ALREADY_CHECKED_OUT' };

  const checkOutAt = parseCapturedAt(capturedAt ?? undefined) ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  // Clamp at 0 — a validated-but-early captured_at must never write a
  // negative duration.
  const durationMinutes = Math.max(0, Math.round(
    (new Date(checkOutAt).getTime() - new Date(visit.check_in_at).getTime()) / 60000
  ));

  const res = await env.DB.prepare(
    `UPDATE visits SET status = 'checked_out', check_out_at = ?, duration_minutes = ? WHERE id = ? AND status = 'checked_in'`
  ).bind(checkOutAt, durationMinutes, visitId).run();

  // Lost a concurrent checkout race — another request already checked this visit out.
  if (res.meta?.changes === 0) return { ok: false, code: 'ALREADY_CHECKED_OUT' };

  const updated = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(visitId).first();

  // Close the Telegram arrival thread — rewrites the host/fanout/leadership
  // arrival messages to "Visit ended" and drops their keyboards. Best-effort;
  // a Telegram hiccup must never fail a checkout.
  if (updated) {
    try {
      await closeArrivalThread(env, updated as Parameters<typeof closeArrivalThread>[1]);
    } catch (err) {
      console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: 'closeArrivalThread threw', visit_id: visitId, error: String(err) }));
    }
  }

  return { ok: true, visit: (updated ?? {}) as Record<string, unknown> };
}

export async function checkOutByBadgeCode(env: Env, badgeCode: string): Promise<CheckOutOutcome> {
  const row = await env.DB.prepare('SELECT id FROM visits WHERE badge_code = ?')
    .bind(badgeCode)
    .first<{ id: string }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  return checkOutById(env, row.id);
}

// PIN-based checkout: matches checked-in visits from the last 24 HOURS (not
// calendar-today — the old date('now') rule meant yesterday's stragglers
// could never be PIN-checked-out the next morning). Still bounded, so stale
// PINs from older visits never match. julianday comparison because
// check_in_at is ISO-8601 ('T'/'Z') while datetime('now') is not.
export async function checkOutByPin(env: Env, pin: string): Promise<CheckOutOutcome> {
  const row = await env.DB.prepare(
    `SELECT id FROM visits
     WHERE checkout_pin = ? AND status = 'checked_in'
       AND julianday(check_in_at) >= julianday('now', '-24 hours')
     LIMIT 1`
  ).bind(pin).first<{ id: string }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  return checkOutById(env, row.id);
}
