import type { Env } from '../types';
import { SELECT_VISIT_WITH_JOINS } from './visit-queries';
import { closeArrivalThread } from './telegram';

export type CheckOutOutcome =
  | { ok: true; visit: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CHECKED_OUT' };

export async function checkOutById(env: Env, visitId: string): Promise<CheckOutOutcome> {
  const visit = await env.DB.prepare('SELECT id, check_in_at, status FROM visits WHERE id = ?')
    .bind(visitId)
    .first<{ id: string; check_in_at: string; status: string }>();
  if (!visit) return { ok: false, code: 'NOT_FOUND' };
  if (visit.status !== 'checked_in') return { ok: false, code: 'ALREADY_CHECKED_OUT' };

  const checkOutAt = new Date().toISOString();
  const durationMinutes = Math.round(
    (new Date(checkOutAt).getTime() - new Date(visit.check_in_at).getTime()) / 60000
  );

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

// PIN-based checkout: matches only checked-in visits from today so stale PINs
// from previous visits (same visitor, same day) never accidentally match.
export async function checkOutByPin(env: Env, pin: string): Promise<CheckOutOutcome> {
  const row = await env.DB.prepare(
    `SELECT id FROM visits
     WHERE checkout_pin = ? AND status = 'checked_in'
       AND date(check_in_at) = date('now')
     LIMIT 1`
  ).bind(pin).first<{ id: string }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  return checkOutById(env, row.id);
}
