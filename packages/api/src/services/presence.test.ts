import { describe, it, expect } from 'vitest';
import { presenceCodeFromToken, validatePresenceCode, getCurrentPresenceToken, PRESENCE_ROTATE_MS } from './presence';
import type { Env } from '../types';

function kvEnv() {
  const store = new Map<string, string>();
  return {
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
  } as unknown as Env;
}

describe('presenceCodeFromToken', () => {
  it('is deterministic and always 6 digits (zero-padded)', async () => {
    const token = crypto.randomUUID();
    const a = await presenceCodeFromToken(token);
    const b = await presenceCodeFromToken(token);
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{6}$/);
  });

  it('different tokens almost surely give different codes', async () => {
    const codes = new Set(await Promise.all(
      Array.from({ length: 20 }, () => presenceCodeFromToken(crypto.randomUUID())),
    ));
    expect(codes.size).toBeGreaterThan(15);
  });

  it('is domain-separated from a raw token hash', async () => {
    // A code must not equal the decimal rendering of the token's own SHA-256
    // prefix — the presence-code: prefix makes the namespaces distinct.
    const token = crypto.randomUUID();
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const rawCode = String(new DataView(raw).getUint32(0) % 1_000_000).padStart(6, '0');
    expect(await presenceCodeFromToken(token)).not.toBe(rawCode);
  });
});

describe('validatePresenceCode', () => {
  it('accepts the current code, then the previous after rotation, then rejects', async () => {
    const env = kvEnv();
    const t0 = 1_800_000_000_000;
    const { token } = await getCurrentPresenceToken(env, t0);
    const code = await presenceCodeFromToken(token);

    // Current window
    expect(await validatePresenceCode(env, code)).toBe('current');

    // Rotate — the old token moves to previous, its code still validates there
    const t1 = t0 + PRESENCE_ROTATE_MS + 1;
    const { token: next } = await getCurrentPresenceToken(env, t1);
    expect(next).not.toBe(token);
    expect(await validatePresenceCode(env, code)).toBe('previous');
    expect(await validatePresenceCode(env, await presenceCodeFromToken(next))).toBe('current');

    // Fully displaced — the code is dead
    const t2 = t1 + PRESENCE_ROTATE_MS + 1;
    await getCurrentPresenceToken(env, t2);
    expect(await validatePresenceCode(env, code)).toBe('invalid');
  });

  it('rejects malformed codes without touching KV', async () => {
    expect(await validatePresenceCode(kvEnv(), '12345')).toBe('invalid');
    expect(await validatePresenceCode(kvEnv(), '1234567')).toBe('invalid');
    expect(await validatePresenceCode(kvEnv(), 'abcdef')).toBe('invalid');
  });
});
