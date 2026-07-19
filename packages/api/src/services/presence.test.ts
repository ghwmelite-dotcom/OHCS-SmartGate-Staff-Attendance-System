import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../types';
import {
  getCurrentPresenceToken, validatePresenceToken,
  PRESENCE_ROTATE_MS, PRESENCE_KV_TTL_SECONDS,
} from './presence';

// Same Map-backed mockKv helper as liveness/review-counter.test.ts.
function mockKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

function mockEnv(kv: KVNamespace): Env {
  return { KV: kv } as unknown as Env;
}

// Fixed "now" — the service takes an injectable timestamp, so no fake timers.
const T0 = 1_800_000_000_000;

describe('getCurrentPresenceToken', () => {
  it('creates a fresh window on empty KV and returns the full 45s', async () => {
    const kv = mockKv();
    const env = mockEnv(kv);
    const { token, expiresIn } = await getCurrentPresenceToken(env, T0);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresIn).toBe(45);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(
      'presence:current',
      expect.any(String),
      { expirationTtl: PRESENCE_KV_TTL_SECONDS },
    );
  });

  it('returns the same token 30s later with expiresIn = 15 and no write', async () => {
    const kv = mockKv();
    const env = mockEnv(kv);
    const first = await getCurrentPresenceToken(env, T0);
    vi.mocked(kv.put).mockClear();
    const second = await getCurrentPresenceToken(env, T0 + 30_000);
    expect(second.token).toBe(first.token);
    expect(second.expiresIn).toBe(15);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rotates at +46s and moves the old window to presence:previous', async () => {
    const kv = mockKv();
    const env = mockEnv(kv);
    const first = await getCurrentPresenceToken(env, T0);
    const second = await getCurrentPresenceToken(env, T0 + PRESENCE_ROTATE_MS + 1_000);
    expect(second.token).not.toBe(first.token);
    expect(second.expiresIn).toBe(45);
    expect(kv.put).toHaveBeenCalledWith(
      'presence:previous',
      JSON.stringify({ token: first.token, window_start: T0 }),
      { expirationTtl: PRESENCE_KV_TTL_SECONDS },
    );
    // The displaced token still validates via the grace window.
    expect(await validatePresenceToken(env, first.token)).toBe('previous');
  });

  it('treats corrupt JSON under presence:current as missing and rotates fresh', async () => {
    const kv = mockKv({ 'presence:current': '{not json' });
    const env = mockEnv(kv);
    const { token, expiresIn } = await getCurrentPresenceToken(env, T0);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresIn).toBe(45);
    expect(kv.put).toHaveBeenCalledWith(
      'presence:current',
      expect.any(String),
      { expirationTtl: PRESENCE_KV_TTL_SECONDS },
    );
  });
});

describe('validatePresenceToken', () => {
  it("returns 'current' for the live-window token", async () => {
    const kv = mockKv({
      'presence:current': JSON.stringify({ token: 'tok-cur', window_start: T0 }),
    });
    expect(await validatePresenceToken(mockEnv(kv), 'tok-cur')).toBe('current');
  });

  it("returns 'previous' for the grace-window token", async () => {
    const kv = mockKv({
      'presence:current': JSON.stringify({ token: 'tok-cur', window_start: T0 }),
      'presence:previous': JSON.stringify({ token: 'tok-prev', window_start: T0 - PRESENCE_ROTATE_MS }),
    });
    expect(await validatePresenceToken(mockEnv(kv), 'tok-prev')).toBe('previous');
  });

  it("returns 'invalid' for an unknown token and for empty input", async () => {
    const kv = mockKv({
      'presence:current': JSON.stringify({ token: 'tok-cur', window_start: T0 }),
      'presence:previous': JSON.stringify({ token: 'tok-prev', window_start: T0 - PRESENCE_ROTATE_MS }),
    });
    const env = mockEnv(kv);
    expect(await validatePresenceToken(env, crypto.randomUUID())).toBe('invalid');
    expect(await validatePresenceToken(env, '')).toBe('invalid');
  });
});
