import type { Env } from '../types';
import { verifyPin, timingSafeEqualStrings } from './auth';
import { getAppSettings } from './settings';

export interface OverrideResult {
  ok: boolean;
  officerId: string | null;   // null when matched via the shared fallback PIN
  label: string;              // officer name, or 'reception (shared PIN)', or '' when no match
}

const NO_MATCH: OverrideResult = { ok: false, officerId: null, label: '' };

/**
 * Resolve a kiosk override PIN to the officer who owns it (per-officer PINs are
 * PBKDF2-hashed), falling back to the shared app_settings PIN. Returns who
 * approved so the override can be attributed in the audit log.
 *
 * Deploy-safe: if the officers.override_pin_hash column doesn't exist yet
 * (migration not applied), the per-officer lookup is skipped and only the shared
 * PIN is honoured.
 */
export async function resolveOverride(env: Env, suppliedPin: string): Promise<OverrideResult> {
  const pin = (suppliedPin ?? '').trim();
  if (!pin) return NO_MATCH;

  // 1) Per-officer PINs — verify against each officer that has one set.
  try {
    const rows = await env.DB.prepare(
      'SELECT id, name, override_pin_hash FROM officers WHERE override_pin_hash IS NOT NULL'
    ).all<{ id: string; name: string; override_pin_hash: string }>();
    for (const o of rows.results ?? []) {
      if (await verifyPin(pin, o.override_pin_hash)) {
        return { ok: true, officerId: o.id, label: o.name };
      }
    }
  } catch {
    // override_pin_hash column not present yet — fall through to the shared PIN.
  }

  // 2) Shared fallback PIN (plaintext in app_settings) — anonymous.
  const settings = await getAppSettings(env);
  const shared = settings.reception_override_pin;
  if (shared && timingSafeEqualStrings(pin, shared)) {
    return { ok: true, officerId: null, label: 'reception (shared PIN)' };
  }

  return NO_MATCH;
}
