import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom does not implement IndexedDB, so every call here exercises the
// localStorage fallback path (and the in-memory memo). The IDB happy path is
// verified manually per the plan's smoke checklist (clear IDB → device_novelty
// factor returns).
//
// The module memoises at module scope, so each test re-imports a fresh module.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function freshModule() {
  return import('./deviceId');
}

describe('getDeviceId', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('generates a UUID and persists it to localStorage when IDB is unavailable', async () => {
    const { getDeviceId } = await freshModule();
    const id = await getDeviceId();
    expect(id).toMatch(UUID_V4);
    expect(localStorage.getItem('device_id')).toBe(id);
  });

  it('memoises: repeat calls return the same id without touching storage', async () => {
    const { getDeviceId } = await freshModule();
    const id = await getDeviceId();
    localStorage.clear();
    expect(await getDeviceId()).toBe(id);
  });

  it('reuses an existing localStorage id instead of generating a new one', async () => {
    const existing = '11111111-2222-4333-8444-555555555555';
    localStorage.setItem('device_id', existing);
    const { getDeviceId } = await freshModule();
    expect(await getDeviceId()).toBe(existing);
    expect(localStorage.getItem('device_id')).toBe(existing);
  });

  it('gives distinct installs distinct ids', async () => {
    const first = await (await freshModule()).getDeviceId();
    vi.resetModules();
    localStorage.clear();
    const second = await (await freshModule()).getDeviceId();
    expect(first).not.toBe(second);
  });
});
