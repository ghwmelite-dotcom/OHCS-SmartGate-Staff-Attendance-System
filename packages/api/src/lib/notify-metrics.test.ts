import { describe, it, expect, vi } from 'vitest';
import { recordNotifyOutcome, isDeadPushStatus } from './notify-metrics';

function kvStub() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

describe('recordNotifyOutcome', () => {
  it('increments an ok counter keyed by date+channel', async () => {
    const kv = kvStub();
    await recordNotifyOutcome({ KV: kv } as never, 'telegram', true);
    const key = [...kv.store.keys()][0]!;
    expect(key).toMatch(/^notify-stat:\d{4}-\d{2}-\d{2}:telegram:ok$/);
    expect(kv.store.get(key)).toBe('1');
    await recordNotifyOutcome({ KV: kv } as never, 'telegram', true);
    expect(kv.store.get(key)).toBe('2');
  });
  it('uses a fail counter when not ok', async () => {
    const kv = kvStub();
    await recordNotifyOutcome({ KV: kv } as never, 'push', false, '410');
    expect([...kv.store.keys()][0]).toMatch(/:push:fail$/);
  });
  it('never throws when KV fails', async () => {
    const kv = { get: vi.fn(async () => { throw new Error('kv down'); }), put: vi.fn() };
    await expect(recordNotifyOutcome({ KV: kv } as never, 'push', true)).resolves.toBeUndefined();
  });
});

describe('isDeadPushStatus', () => {
  it('is true for 404 and 410', () => {
    expect(isDeadPushStatus(410)).toBe(true);
    expect(isDeadPushStatus(404)).toBe(true);
  });
  it('is false for success/other statuses', () => {
    expect(isDeadPushStatus(201)).toBe(false);
    expect(isDeadPushStatus(429)).toBe(false);
    expect(isDeadPushStatus(0)).toBe(false);
  });
});
