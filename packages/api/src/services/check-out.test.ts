import { describe, it, expect, vi } from 'vitest';
import { checkOutByBadgeCode } from './check-out';
import type { Env } from '../types';

// Minimal D1 mock: queue up `first()` return values in call order, record run() calls.
function mockEnv(firstResults: unknown[]) {
  const runCalls: { sql: string; binds: unknown[] }[] = [];
  let firstIdx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt = {
      _binds: [] as unknown[],
      bind(...b: unknown[]) { this._binds = b; return this; },
      first: vi.fn(async () => firstResults[firstIdx++] ?? null),
      run: vi.fn(async () => { runCalls.push({ sql, binds: stmt._binds }); return { success: true }; }),
    };
    return stmt;
  });
  const env = { DB: { prepare } } as unknown as Env;
  return { env, runCalls };
}

describe('checkOutByBadgeCode', () => {
  it('returns NOT_FOUND when the badge code matches no visit', async () => {
    const { env } = mockEnv([null]); // SELECT id by badge_code -> null
    const result = await checkOutByBadgeCode(env, 'SG-NOPE');
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('returns ALREADY_CHECKED_OUT when the visit is not checked_in', async () => {
    const { env } = mockEnv([
      { id: 'v1' },                                   // SELECT id by badge_code
      { id: 'v1', check_in_at: '2026-06-17T08:00:00Z', status: 'checked_out' }, // SELECT visit
    ]);
    const result = await checkOutByBadgeCode(env, 'SG-OLD');
    expect(result).toEqual({ ok: false, code: 'ALREADY_CHECKED_OUT' });
  });

  it('checks out an active visit and returns the updated row', async () => {
    const { env, runCalls } = mockEnv([
      { id: 'v1' },                                   // SELECT id by badge_code
      { id: 'v1', check_in_at: '2026-06-17T08:00:00Z', status: 'checked_in' }, // SELECT visit
      { id: 'v1', status: 'checked_out', first_name: 'Ama' }, // SELECT updated row
    ]);
    const result = await checkOutByBadgeCode(env, 'SG-LIVE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visit).toMatchObject({ status: 'checked_out' });
    expect(runCalls.length).toBe(1); // exactly one UPDATE ran
  });
});
