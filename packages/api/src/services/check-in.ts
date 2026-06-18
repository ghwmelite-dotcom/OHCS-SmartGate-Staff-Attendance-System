import type { Env } from '../types';
import { classifyAndUpdate } from './classifier';
import { notifyOnCheckIn } from './notifier';
import { SELECT_VISIT_WITH_JOINS } from './visit-queries';

export interface CheckInParams {
  visitor_id: string;
  host_officer_id?: string | null;
  host_name_manual?: string | null;
  directorate_id?: string | null;
  purpose_raw?: string | null;
  purpose_category?: string | null;
  idempotency_key?: string | null;
  id_photo_check?: string | null;
  created_by: string | null;
  check_in_source: 'staff' | 'kiosk';
}

export type CheckInOutcome =
  | { ok: true; visit: Record<string, unknown>; deduped: boolean }
  | { ok: false; code: 'VISITOR_NOT_FOUND' };

// Pure, testable badge-code builder. `timestamp` is ms since epoch, `rand` is
// at least 2 random bytes.
export function generateBadgeCode(timestamp: number, rand: Uint8Array): string {
  const randomSuffix = Array.from(rand).map((b) => b.toString(36)).join('').slice(0, 4).toUpperCase();
  return `SG-${timestamp.toString(36).toUpperCase()}${randomSuffix}`;
}

export async function performCheckIn(
  env: Env,
  ctx: ExecutionContext,
  params: CheckInParams,
): Promise<CheckInOutcome> {
  const visitor = await env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(params.visitor_id).first();
  if (!visitor) return { ok: false, code: 'VISITOR_NOT_FOUND' };

  if (params.idempotency_key) {
    const existing = await env.DB.prepare('SELECT id FROM visits WHERE idempotency_key = ? LIMIT 1')
      .bind(params.idempotency_key)
      .first<{ id: string }>();
    if (existing) {
      const dup = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(existing.id).first();
      return { ok: true, visit: (dup ?? {}) as Record<string, unknown>, deduped: true };
    }
  }

  const visitId = crypto.randomUUID().replace(/-/g, '');
  const badgeCode = generateBadgeCode(Date.now(), crypto.getRandomValues(new Uint8Array(2)));

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, host_name_manual, directorate_id, purpose_raw, purpose_category, badge_code, status, created_by, idempotency_key, check_in_source, id_photo_check)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?, ?, ?)`
    ).bind(
      visitId, params.visitor_id, params.host_officer_id || null, params.host_name_manual || null,
      params.directorate_id || null, params.purpose_raw || null, params.purpose_category || null,
      badgeCode, params.created_by, params.idempotency_key ?? null, params.check_in_source,
      params.id_photo_check ?? null,
    ),
    env.DB.prepare(
      `UPDATE visitors SET total_visits = total_visits + 1, last_visit_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).bind(params.visitor_id),
  ]);

  const visit = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(visitId).first();

  if (params.purpose_raw) {
    ctx.waitUntil(classifyAndUpdate(visitId, params.purpose_raw, params.directorate_id || null, env));
  }

  if (visit && (params.host_officer_id || params.check_in_source === 'kiosk')) {
    const v = visit as Record<string, unknown>;
    ctx.waitUntil(
      notifyOnCheckIn({
        visit_id: visitId,
        host_officer_id: params.host_officer_id || '',
        first_name: String(v.first_name ?? ''),
        last_name: String(v.last_name ?? ''),
        organisation: (v.organisation as string | null) ?? null,
        purpose_raw: params.purpose_raw || null,
        purpose_category: params.purpose_category || null,
        badge_code: badgeCode,
        check_in_at: String(v.check_in_at ?? ''),
        directorate_id: params.directorate_id || null,
        directorate_abbr: (v.directorate_abbr as string | null) ?? null,
        check_in_source: params.check_in_source,
      }, env)
    );
  }

  return { ok: true, visit: (visit ?? {}) as Record<string, unknown>, deduped: false };
}
