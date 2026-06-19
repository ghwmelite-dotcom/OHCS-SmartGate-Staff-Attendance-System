import {
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { Context } from 'hono';
import type { Env } from '../types';
import { resolveRp } from '../lib/webauthn-rp';
import { verifyPin, needsRehash, hashPin } from './auth';

export type ReauthOutcome =
  | { ok: true; method: 'webauthn' | 'pin' }
  | { ok: false; reason: 'no_credential' | 'verification_failed' | 'rate_limited' | 'no_pin_set' };

/**
 * Verify a WebAuthn assertion produced for a clock-in.
 *
 * The assertion's clientDataJSON.challenge MUST equal the prompt_id (UUID
 * string) that was issued by POST /api/clock/prompt. We use the same UUID
 * for both the cryptographic challenge and the visible prompt to bind the
 * assertion to the same prompt the staff member is showing in the photo.
 */
export async function verifyClockWebAuthnAssertion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<{ Bindings: Env; Variables: any }>,
  userId: string,
  promptId: string,
  assertion: AuthenticationResponseJSON,
): Promise<ReauthOutcome> {
  const rp = resolveRp(c);
  if (!rp) return { ok: false, reason: 'verification_failed' };

  const credentialId = assertion.id;
  const cred = await c.env.DB.prepare(
    `SELECT id, user_id, public_key, counter, transports
     FROM webauthn_credentials WHERE id = ? AND user_id = ?`
  ).bind(credentialId, userId).first<{
    id: string; user_id: string; public_key: string; counter: number; transports: string | null;
  }>();
  if (!cred) return { ok: false, reason: 'no_credential' };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: isoBase64URL.fromUTF8String(promptId),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, reason: 'verification_failed' };
  }

  if (!verification.verified) return { ok: false, reason: 'verification_failed' };

  // Bump counter + last_used so a replayed assertion is rejected next time.
  await c.env.DB.prepare(
    `UPDATE webauthn_credentials SET counter = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(verification.authenticationInfo.newCounter, cred.id).run();

  return { ok: true, method: 'webauthn' };
}

/**
 * Verify a PIN re-auth attempt for the given user, with KV-backed daily
 * rate-limiting. Returns 'rate_limited' when the user has exceeded
 * `attemptCap` failed attempts on the current ISO date.
 *
 * On a wrong PIN, the attempt counter is incremented (best-effort; KV is not
 * atomic but the cap is intentionally soft — a race costs at most one extra
 * attempt before lockout).
 */
export async function verifyClockPin(
  env: Env,
  userId: string,
  pin: string,
  attemptCap: number,
): Promise<ReauthOutcome> {
  const isoDate = new Date().toISOString().slice(0, 10);
  const key = `clock-pin-attempts:${userId}:${isoDate}`;

  const currentRaw = await env.KV.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (current >= attemptCap) return { ok: false, reason: 'rate_limited' };

  const row = await env.DB.prepare(
    'SELECT pin_hash FROM users WHERE id = ?'
  ).bind(userId).first<{ pin_hash: string | null }>();
  if (!row || !row.pin_hash) return { ok: false, reason: 'no_pin_set' };

  const ok = await verifyPin(pin, row.pin_hash);
  if (!ok) {
    // Best-effort increment, 24h TTL.
    await env.KV.put(key, String(current + 1), { expirationTtl: 86400 });
    return { ok: false, reason: 'verification_failed' };
  }

  // Successful auth — clear the counter so a fat-finger run doesn't carry over.
  await env.KV.delete(key);

  // Lazy upgrade: re-hash a legacy SHA-256 PIN to PBKDF2 on successful verify.
  // No execution context is available here (signature takes Env, not Context),
  // so we await it. The cost is paid only once per legacy account.
  if (needsRehash(row.pin_hash)) {
    const upgraded = await hashPin(pin);
    await env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').bind(upgraded, userId).run();
  }

  return { ok: true, method: 'pin' };
}
