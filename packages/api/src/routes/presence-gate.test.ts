/**
 * Presence display key gate (plan 2026-08-01-vms-audit-fixes.md, Commit E):
 * once presence_qr_mode > 0 the token feed drives a wall-mounted display in a
 * public lobby, so /api/presence/current stops being anonymous — it requires
 * the x-presence-display-key header matching the PRESENCE_DISPLAY_KEY secret.
 * Fail CLOSED: mode > 0 with the secret unset → 503 (display not provisioned).
 * Mode 0 (shipped dark) keeps the old open behaviour so nothing breaks today.
 *
 * Boots the REAL presence route over the node:sqlite D1 shim + Map KV
 * (pattern from kiosk-idempotency.test.ts), full schema.sql.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { presenceRoutes } from './presence';
import { invalidateSettingsCache } from '../services/settings';
import type { Env } from '../types';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  const schema = readFileSync(join(ROUTES_DIR, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

function d1(db: SqliteDb) {
  const stmt = (sql: string, params: unknown[]) => ({
    first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => { db.prepare(sql).run(...params); return { success: true }; },
  });
  return {
    prepare(sql: string) {
      return { ...stmt(sql, []), bind(...params: unknown[]) { return stmt(sql, params); } };
    },
  };
}

function makeEnv(displayKey?: string) {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    ENVIRONMENT: 'test',
    PRESENCE_DISPLAY_KEY: displayKey,
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
  return { env, store };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/presence', presenceRoutes);
  return app;
}

// getAppSettings memoizes per-isolate for 60s — clear the memo before each
// test, then seed the KV cache layer with the mode under test.
async function seedMode(env: Env, store: Map<string, string>, mode: number) {
  await invalidateSettingsCache(env);
  store.set('app-settings:v2', JSON.stringify({ presence_qr_mode: mode }));
}

function getCurrent(env: Env, headers: Record<string, string> = {}) {
  return makeApp().request('/presence/current', { headers }, env);
}

describe('GET /presence/current — display-key gate', () => {
  it('mode 0 stays open (no key configured, no header)', async () => {
    const { env, store } = makeEnv();
    await seedMode(env, store, 0);
    const res = await getCurrent(env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { token: string } };
    expect(body.data.token).toBeTruthy();
  });

  it('mode 1 with the secret UNSET fails closed (503)', async () => {
    const { env, store } = makeEnv(); // no PRESENCE_DISPLAY_KEY
    await seedMode(env, store, 1);
    const res = await getCurrent(env, { 'x-presence-display-key': 'anything' });
    expect(res.status).toBe(503);
  });

  it('mode 1 rejects a missing or wrong key (401)', async () => {
    const { env, store } = makeEnv('display-secret-1');
    await seedMode(env, store, 1);
    expect((await getCurrent(env)).status).toBe(401);
    expect((await getCurrent(env, { 'x-presence-display-key': 'wrong' })).status).toBe(401);
  });

  it('mode 1 serves the token with the correct key', async () => {
    const { env, store } = makeEnv('display-secret-1');
    await seedMode(env, store, 1);
    const res = await getCurrent(env, { 'x-presence-display-key': 'display-secret-1' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { token: string; code: string } };
    expect(body.data.token).toBeTruthy();
    expect(body.data.code).toMatch(/^\d{6}$/);
  });
});
