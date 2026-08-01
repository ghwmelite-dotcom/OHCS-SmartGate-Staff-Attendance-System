import type { Env } from '../types';
import { verifyPin, hashPin, timingSafeEqualStrings } from './auth';
import { getAppSettings, invalidateSettingsCache } from './settings';

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

  // 2) Shared fallback PIN (app_settings) — anonymous. Stored as a PBKDF2 hash
  // for new writes; legacy plaintext values still verify (timing-safe) and are
  // re-hashed in place on first successful use (lazy upgrade, same pattern as
  // user PINs).
  const settings = await getAppSettings(env);
  const shared = settings.reception_override_pin;
  if (shared) {
    if (shared.startsWith('pbkdf2$')) {
      if (await verifyPin(pin, shared)) {
        return { ok: true, officerId: null, label: 'reception (shared PIN)' };
      }
    } else if (timingSafeEqualStrings(pin, shared)) {
      const upgraded = await hashPin(pin);
      await env.DB.prepare('UPDATE app_settings SET reception_override_pin = ? WHERE id = 1')
        .bind(upgraded).run();
      await invalidateSettingsCache(env);
      return { ok: true, officerId: null, label: 'reception (shared PIN)' };
    }
  }

  return NO_MATCH;
}
