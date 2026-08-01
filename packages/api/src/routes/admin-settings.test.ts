/**
 * Admin settings round-trip tests for the reminder_directorate_ids allowlist.
 *
 * The allowlist has NO app_settings column (the spec forbids a migration for
 * it) — the superadmin-set value lives as a KV override
 * (`app-settings:reminder-directorate-ids`) that getAppSettings layers over
 * DEFAULTS. These tests boot the real adminSettingsRoutes with a minimal D1
 * shim over node:sqlite + a Map-backed KV (same pattern as telegram.test.ts)
 * and assert:
 *
 *   - GET exposes the effective value (DEFAULTS seed when no override is set).
 *   - PUT stores the normalized CSV in KV (never in the DB row).
 *   - PUT that omits the key keeps the current override.
 *   - PUT '' stores '' (meaning "no filter"), it does NOT delete the KV key.
 *   - PUT with a malformed value is rejected by the zod schema (400).
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { adminSettingsRoutes } from './admin-settings';
import { REMINDER_DIRECTORATE_IDS_KV_KEY } from '../services/settings';
import type { Env, SessionData } from '../types';

/* ---------- fakes ---------- */

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
  db.exec(`
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      work_start_time TEXT NOT NULL,
      late_threshold_time TEXT NOT NULL,
      work_end_time TEXT NOT NULL,
      reception_override_pin TEXT,
      clockin_reauth_enforce INTEGER NOT NULL DEFAULT 0,
      clockin_pin_attempt_cap INTEGER NOT NULL DEFAULT 5,
      clockin_prompt_ttl_seconds INTEGER NOT NULL DEFAULT 90,
      clockin_passive_liveness_enforce INTEGER NOT NULL DEFAULT 0,
      clockin_liveness_review_cap_per_week INTEGER NOT NULL DEFAULT 2,
      clockin_liveness_model_version TEXT NOT NULL DEFAULT 'buffalo_s_v1',
      visitor_photo_retention_days INTEGER NOT NULL DEFAULT 30,
      presence_qr_mode INTEGER NOT NULL DEFAULT 0,
      risk_fusion_mode INTEGER NOT NULL DEFAULT 0,
      risk_fusion_block_enabled INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    INSERT INTO app_settings (id, work_start_time, late_threshold_time, work_end_time)
      VALUES (1, '08:00', '08:30', '17:00');
    CREATE TABLE audit_log (
      id TEXT, seq INTEGER, at TEXT, actor_user_id TEXT, actor_role TEXT, actor_label TEXT,
      action TEXT, entity_type TEXT, entity_id TEXT, summary TEXT, changes TEXT, ip TEXT,
      prev_hash TEXT, hash TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite — supports both .prepare(sql).first() and
// .prepare(sql).bind(...).first()/all()/run().
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

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    KV: {
      // Mirror real KV: the 'json' type parses the stored string.
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
  return { env, db, store };
}

const superadmin: SessionData = { userId: 'u_super', email: 'super@ohcs.gov.gh', role: 'superadmin', name: 'Super Admin' };

function makeApp(session: SessionData = superadmin) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/s/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/s', adminSettingsRoutes);
  return app;
}

const WORK_HOURS = { work_start_time: '08:00', late_threshold_time: '08:30', work_end_time: '17:00' };

function put(env: Env, body: Record<string, unknown>) {
  return makeApp().request('/s', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...WORK_HOURS, ...body }),
  }, env);
}

async function getIds(env: Env): Promise<string> {
  const res = await makeApp().request('/s', {}, env);
  expect(res.status).toBe(200);
  const body = await res.json() as { data: { reminder_directorate_ids: string } };
  return body.data.reminder_directorate_ids;
}

/* ---------- tests ---------- */

describe('admin settings — reminder_directorate_ids (KV-backed, no DB column)', () => {
  it('GET exposes the DEFAULTS seed when no override is set', async () => {
    const { env } = makeEnv();
    expect(await getIds(env)).toBe('dir_rsimd');
  });

  it('PUT stores the normalized CSV in KV (trimmed, empties dropped), not in the DB row', async () => {
    const { env, store } = makeEnv();
    const res = await put(env, { reminder_directorate_ids: ' dir_rsimd , ,dir_finance ' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reminder_directorate_ids: string } };
    expect(body.data.reminder_directorate_ids).toBe('dir_rsimd,dir_finance');
    expect(store.get(REMINDER_DIRECTORATE_IDS_KV_KEY)).toBe('dir_rsimd,dir_finance');
    // And the GET path reflects the override.
    expect(await getIds(env)).toBe('dir_rsimd,dir_finance');
  });

  it('PUT that omits the key keeps the current override', async () => {
    const { env, store } = makeEnv();
    await put(env, { reminder_directorate_ids: 'dir_rsimd' });
    const res = await put(env, {});
    expect(res.status).toBe(200);
    expect(store.get(REMINDER_DIRECTORATE_IDS_KV_KEY)).toBe('dir_rsimd');
    expect(await getIds(env)).toBe('dir_rsimd');
  });

  it("PUT '' stores '' (no filter) — the KV key is not deleted", async () => {
    const { env, store } = makeEnv();
    await put(env, { reminder_directorate_ids: 'dir_rsimd' });
    const res = await put(env, { reminder_directorate_ids: '' });
    expect(res.status).toBe(200);
    expect(store.has(REMINDER_DIRECTORATE_IDS_KV_KEY)).toBe(true);
    expect(store.get(REMINDER_DIRECTORATE_IDS_KV_KEY)).toBe('');
    expect(await getIds(env)).toBe('');
  });

  it('PUT rejects malformed values', async () => {
    const { env, store } = makeEnv();
    const res = await put(env, { reminder_directorate_ids: 'dir_a; DROP TABLE users' });
    expect(res.status).toBe(400);
    expect(store.has(REMINDER_DIRECTORATE_IDS_KV_KEY)).toBe(false);
  });
});
