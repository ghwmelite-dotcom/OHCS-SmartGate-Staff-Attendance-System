import type { Env } from '../types';

// Rotating proof-of-presence token (spec: docs/superpowers/specs/2026-07-19-presence-qr-design.md).
// The token is EVIDENCE, not a credential — session auth, geofence, liveness and
// re-auth are unchanged, so the issue endpoint can stay public (rate-limited).
// Rotation is on-demand in KV (no cron): whoever asks for the current token
// rotates it when the window is stale. Concurrent isolates may double-rotate —
// last write wins, and a displaced token still validates as `previous` for up
// to 90s; acceptable because the token is evidence, not a credential.

export interface PresenceWindow { token: string; window_start: number } // unix ms
export const PRESENCE_ROTATE_MS = 45_000;
export const PRESENCE_KV_TTL_SECONDS = 90;
const CURRENT_KEY = 'presence:current';
const PREVIOUS_KEY = 'presence:previous';

export type PresenceTokenWindow = 'current' | 'previous' | 'invalid';

async function readWindow(env: Env, key: string): Promise<PresenceWindow | null> {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as PresenceWindow; } catch { return null; }
}

/** Current display token, rotating on-demand when the window is >= 45s old. */
export async function getCurrentPresenceToken(
  env: Env, now: number = Date.now(),
): Promise<{ token: string; expiresIn: number }> {
  const current = await readWindow(env, CURRENT_KEY);
  if (current && now - current.window_start < PRESENCE_ROTATE_MS) {
    const expiresIn = Math.max(0, Math.ceil((PRESENCE_ROTATE_MS - (now - current.window_start)) / 1000));
    return { token: current.token, expiresIn };
  }
  if (current) {
    await env.KV.put(PREVIOUS_KEY, JSON.stringify(current), { expirationTtl: PRESENCE_KV_TTL_SECONDS });
  }
  const next: PresenceWindow = { token: crypto.randomUUID(), window_start: now };
  await env.KV.put(CURRENT_KEY, JSON.stringify(next), { expirationTtl: PRESENCE_KV_TTL_SECONDS });
  return { token: next.token, expiresIn: PRESENCE_ROTATE_MS / 1000 };
}

/** Validate a scanned token against the live + grace windows. */
export async function validatePresenceToken(env: Env, token: string): Promise<PresenceTokenWindow> {
  if (!token) return 'invalid';
  const current = await readWindow(env, CURRENT_KEY);
  if (current?.token === token) return 'current';
  const previous = await readWindow(env, PREVIOUS_KEY);
  if (previous?.token === token) return 'previous';
  return 'invalid';
}
