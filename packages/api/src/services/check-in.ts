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
  party_size?: number | null;
  party_names?: string[] | null;
  created_by: string | null;
  check_in_source: 'staff' | 'kiosk';
}

export type CheckInOutcome =
  | { ok: true; visit: Record<string, unknown>; deduped: boolean; flag: string | null }
  | { ok: false; code: 'VISITOR_NOT_FOUND' };

// Pure, testable badge-code builder. `timestamp` is ms since epoch, `rand` is
// at least 5 random bytes. Codes are prefixed `OHCS-`. (Older badges issued as
// `SG-…` remain valid — the scanner/checkout look codes up verbatim; see
// packages/web/src/lib/badgeCode.ts which accepts both prefixes.)
//
// The random suffix is the full 5-byte (40-bit) value rendered as fixed-width
// base36 (8 chars, zero-padded), uppercased — no lossy `.slice(0,4)` truncation.
// 40 bits of entropy makes per-badge collisions astronomically unlikely while
// keeping the suffix `[0-9A-Z]` so the scanner regex still matches.
// Six-digit numeric PIN for phone-free kiosk checkout (100000–999999).
export function generateCheckoutPin(): string {
  const n = (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000) + 100000;
  return String(n);
}

export function generateBadgeCode(timestamp: number, rand: Uint8Array): string {
  let n = 0;
  // Use up to 5 bytes (40 bits) — stays within Number's exact-integer range.
  for (let i = 0; i < Math.min(rand.length, 5); i++) {
    n = n * 256 + (rand[i] ?? 0);
  }
  const randomSuffix = n.toString(36).toUpperCase().padStart(8, '0');
  return `OHCS-${timestamp.toString(36).toUpperCase()}${randomSuffix}`;
}

export async function performCheckIn(
  env: Env,
  ctx: ExecutionContext,
  params: CheckInParams,
): Promise<CheckInOutcome> {
  // flag rides along so the route can fire watchlist alerts (VIP/banned) after
  // the visit row exists — the service itself never blocks a check-in.
  const visitor = await env.DB.prepare('SELECT id, flag FROM visitors WHERE id = ?')
    .bind(params.visitor_id).first<{ id: string; flag: string | null }>();
  if (!visitor) return { ok: false, code: 'VISITOR_NOT_FOUND' };

  // Re-read an existing visit by idempotency key and return it in the dedup-hit
  // success shape. Shared by the pre-check and the UNIQUE-violation recovery path.
  const returnExistingByKey = async (key: string): Promise<CheckInOutcome | null> => {
    const existing = await env.DB.prepare('SELECT id FROM visits WHERE idempotency_key = ? LIMIT 1')
      .bind(key)
      .first<{ id: string }>();
    if (!existing) return null;
    const dup = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(existing.id).first();
    return { ok: true, visit: (dup ?? {}) as Record<string, unknown>, deduped: true, flag: visitor.flag ?? null };
  };

  if (params.idempotency_key) {
    const hit = await returnExistingByKey(params.idempotency_key);
    if (hit) return hit;
  }

  const visitId = crypto.randomUUID().replace(/-/g, '');
  let badgeCode = generateBadgeCode(Date.now(), crypto.getRandomValues(new Uint8Array(5)));
  let pin = generateCheckoutPin();

  // Delegation mode: solo visits stay NULL (reads as party of 1); member names
  // persist as a JSON array (lead excluded).
  const partySize = params.party_size && params.party_size > 1 ? params.party_size : null;
  const partyNames = params.party_names && params.party_names.length > 0
    ? JSON.stringify(params.party_names)
    : null;

  const insertBatch = (code: string, checkoutPin: string) =>
    env.DB.batch([
      env.DB.prepare(
        `INSERT INTO visits (id, visitor_id, host_officer_id, host_name_manual, directorate_id, purpose_raw, purpose_category, badge_code, checkout_pin, status, created_by, idempotency_key, check_in_source, id_photo_check, party_size, party_names)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?, ?, ?, ?, ?)`
      ).bind(
        visitId, params.visitor_id, params.host_officer_id || null, params.host_name_manual || null,
        params.directorate_id || null, params.purpose_raw || null, params.purpose_category || null,
        code, checkoutPin, params.created_by, params.idempotency_key ?? null, params.check_in_source,
        params.id_photo_check ?? null, partySize, partyNames,
      ),
      env.DB.prepare(
        `UPDATE visitors SET total_visits = total_visits + 1, last_visit_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
      ).bind(params.visitor_id),
    ]);

  try {
    await insertBatch(badgeCode, pin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Idempotency-key race: another concurrent check-in won the insert. Re-read
    // and return the existing visit in the same shape as the dedup-hit path.
    if (params.idempotency_key && /UNIQUE/i.test(msg) && /idempotency_key/i.test(msg)) {
      const hit = await returnExistingByKey(params.idempotency_key);
      if (hit) return hit;
    }
    // Collision retry: regenerate both badge code and checkout PIN.
    if (/UNIQUE/i.test(msg) && (/badge_code/i.test(msg) || /checkout_pin/i.test(msg))) {
      badgeCode = generateBadgeCode(Date.now(), crypto.getRandomValues(new Uint8Array(5)));
      pin = generateCheckoutPin();
      await insertBatch(badgeCode, pin);
    } else {
      throw e;
    }
  }

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

  return { ok: true, visit: (visit ?? {}) as Record<string, unknown>, deduped: false, flag: visitor.flag ?? null };
}
