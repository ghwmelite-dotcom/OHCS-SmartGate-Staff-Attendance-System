/**
 * Offline-replay captured_at handling in the visits pipeline (plan
 * 2026-08-01-vms-audit-fixes.md, Commit D):
 *
 *   - performCheckIn records a validated client captured_at as check_in_at, so
 *     a 09:00 reception check-in that only drained at 11:00 is recorded ~09:00.
 *     Out-of-window / missing captured_at falls back to server now.
 *   - checkOutById does the same for check_out_at (queued check-outs replay
 *     through the same visit-queue) and never produces a negative duration.
 *   - checkOutByPin matches visits checked in within the last 24 HOURS — the
 *     old date('now') rule meant yesterday's stragglers could never be
 *     PIN-checked-out the next morning.
 *
 * Runs the REAL services against the node:sqlite D1 shim over the full
 * schema.sql (pattern from override.test.ts / kiosk.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performCheckIn } from './check-in';
import { checkOutById, checkOutByPin } from './check-out';
import type { Env } from '../types';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
}

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;'); // mirror D1, which forces FKs on
  const schema = readFileSync(join(ROUTES_DIR, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

// Minimal D1 shim over node:sqlite (extended from override.test.ts with batch
// + run-meta changes, which performCheckIn / checkOutById rely on).
function d1(db: SqliteDb) {
  const stmt = (sql: string, params: unknown[]) => ({
    sql,
    params,
    first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: r.changes } };
    },
  });
  return {
    prepare(sql: string) {
      return { ...stmt(sql, []), bind(...params: unknown[]) { return stmt(sql, params); } };
    },
    async batch(stmts: Array<{ sql: string; params: unknown[] }>) {
      return stmts.map((s) => {
        db.prepare(s.sql).run(...s.params);
        return { success: true };
      });
    },
  };
}

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    ENVIRONMENT: 'test',
    KV: {
      get: async (k: string, type?: string) => {
        const v = store.get(k);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    DB: d1(db),
  } as unknown as Env;
  return { env, db };
}

// performCheckIn fans notifications/classification out through waitUntil —
// swallow them; those paths are covered elsewhere.
const fakeCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function addVisitor(db: SqliteDb, id: string): void {
  db.prepare('INSERT INTO visitors (id, first_name, last_name) VALUES (?, ?, ?)').run(id, 'Ama', 'Mensah');
}

function addVisit(db: SqliteDb, id: string, visitorId: string, checkInAt: string, pin: string): void {
  db.prepare(
    `INSERT INTO visits (id, visitor_id, status, check_in_at, checkout_pin) VALUES (?, ?, 'checked_in', ?, ?)`
  ).run(id, visitorId, checkInAt, pin);
}

const isoHoursAgo = (h: number) =>
  new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('performCheckIn — captured_at (offline queue replay)', () => {
  it('records a validated captured_at as check_in_at', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    const captured = isoHoursAgo(2);

    const res = await performCheckIn(env, fakeCtx, {
      visitor_id: 'v1', created_by: null, check_in_source: 'staff', captured_at: captured,
    });
    expect(res.ok).toBe(true);

    const row = db.prepare('SELECT check_in_at FROM visits WHERE visitor_id = ?').get('v1') as { check_in_at: string };
    expect(row.check_in_at).toBe(captured);
  });

  it('ignores an out-of-window captured_at and stamps server now', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    const fiveDaysAgo = isoHoursAgo(120);

    const res = await performCheckIn(env, fakeCtx, {
      visitor_id: 'v1', created_by: null, check_in_source: 'staff', captured_at: fiveDaysAgo,
    });
    expect(res.ok).toBe(true);

    const row = db.prepare('SELECT check_in_at FROM visits WHERE visitor_id = ?').get('v1') as { check_in_at: string };
    expect(row.check_in_at).not.toBe(fiveDaysAgo);
    expect(Date.now() - Date.parse(row.check_in_at)).toBeLessThan(60_000);
  });

  it('stamps server now when captured_at is absent (unchanged online path)', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');

    await performCheckIn(env, fakeCtx, {
      visitor_id: 'v1', created_by: null, check_in_source: 'staff',
    });

    const row = db.prepare('SELECT check_in_at FROM visits WHERE visitor_id = ?').get('v1') as { check_in_at: string };
    expect(Date.now() - Date.parse(row.check_in_at)).toBeLessThan(60_000);
  });

  it('still dedupes by idempotency_key when the replay repeats', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    const params = {
      visitor_id: 'v1', created_by: null, check_in_source: 'staff' as const,
      idempotency_key: 'key-1', captured_at: isoHoursAgo(1),
    };
    const first = await performCheckIn(env, fakeCtx, params);
    const second = await performCheckIn(env, fakeCtx, params);
    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.deduped).toBe(true);
    const count = db.prepare('SELECT COUNT(*) AS n FROM visits WHERE visitor_id = ?').get('v1') as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('checkOutById — captured_at (offline queue replay)', () => {
  it('records a validated captured_at as check_out_at and computes duration from it', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    addVisit(db, 's1', 'v1', isoHoursAgo(3), '111111');
    const captured = isoHoursAgo(1);

    const res = await checkOutById(env, 's1', captured);
    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT check_out_at, duration_minutes FROM visits WHERE id = ?').get('s1') as { check_out_at: string; duration_minutes: number };
    expect(row.check_out_at).toBe(captured);
    expect(row.duration_minutes).toBe(120);
  });

  it('ignores an out-of-window captured_at and stamps server now', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    addVisit(db, 's1', 'v1', isoHoursAgo(3), '111111');

    const res = await checkOutById(env, 's1', isoHoursAgo(120));
    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT check_out_at FROM visits WHERE id = ?').get('s1') as { check_out_at: string };
    expect(Date.now() - Date.parse(row.check_out_at)).toBeLessThan(60_000);
  });
});

describe('checkOutByPin — 24-hour window', () => {
  it('checks out a visit from 23 hours ago (yesterday’s straggler)', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    addVisit(db, 's1', 'v1', isoHoursAgo(23), '222222');

    const res = await checkOutByPin(env, '222222');
    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT status FROM visits WHERE id = ?').get('s1') as { status: string };
    expect(row.status).toBe('checked_out');
  });

  it('rejects a visit from 25 hours ago', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    addVisit(db, 's1', 'v1', isoHoursAgo(25), '333333');

    const res = await checkOutByPin(env, '333333');
    expect(res).toEqual({ ok: false, code: 'NOT_FOUND' });
    const row = db.prepare('SELECT status FROM visits WHERE id = ?').get('s1') as { status: string };
    expect(row.status).toBe('checked_in');
  });
});
