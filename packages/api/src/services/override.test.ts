/**
 * Hashed shared reception override PIN (plan:
 * docs/superpowers/plans/2026-08-01-vms-audit-fixes.md, Commit C finding 4).
 *
 * The shared reception override PIN lived in app_settings.reception_override_pin
 * as PLAINTEXT while per-officer PINs are PBKDF2-hashed. Now:
 *   - new writes (admin settings PUT) store a PBKDF2 hash;
 *   - a legacy plaintext value still verifies (timing-safe compare) and is
 *     re-hashed in place on first successful use (lazy upgrade, same pattern as
 *     user PINs);
 *   - wrong PINs never match, hashed or not.
 *
 * Boots the REAL resolveOverride + adminSettingsRoutes over the node:sqlite D1
 * shim + Map KV (pattern from admin-settings.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { resolveOverride } from './override';
import { adminSettingsRoutes } from '../routes/admin-settings';
import { invalidateSettingsCache } from './settings';
import { hashPin } from './auth';
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
    CREATE TABLE officers (
      id TEXT PRIMARY KEY, name TEXT, override_pin_hash TEXT
    );
    CREATE TABLE audit_log (
      id TEXT, seq INTEGER, at TEXT, actor_user_id TEXT, actor_role TEXT, actor_label TEXT,
      action TEXT, entity_type TEXT, entity_id TEXT, summary TEXT, changes TEXT, ip TEXT,
      prev_hash TEXT, hash TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (copied pattern from admin-settings.test.ts).
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
  return { env, db, store };
}

const superadmin: SessionData = { userId: 'u_super', email: 'super@ohcs.gov.gh', role: 'superadmin', name: 'Super Admin' };

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/s/*', async (c, next) => { c.set('session', superadmin); await next(); });
  app.route('/s', adminSettingsRoutes);
  return app;
}

const WORK_HOURS = { work_start_time: '08:00', late_threshold_time: '08:30', work_end_time: '17:00' };

function putSettings(env: Env, body: Record<string, unknown>) {
  return makeApp().request('/s', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...WORK_HOURS, ...body }),
  }, env);
}

function storedPin(db: SqliteDb): string | null {
  const row = db.prepare('SELECT reception_override_pin FROM app_settings WHERE id = 1').get() as { reception_override_pin: string | null };
  return row.reception_override_pin;
}

/* ---------- tests ---------- */

describe('shared reception override PIN — hashed storage with lazy upgrade', () => {
  it('legacy plaintext value verifies and is re-hashed in storage on first use', async () => {
    const { env, db } = makeEnv();
    await invalidateSettingsCache(env);
    db.prepare('UPDATE app_settings SET reception_override_pin = ? WHERE id = 1').run('2468');

    const res = await resolveOverride(env, '2468');
    expect(res).toEqual({ ok: true, officerId: null, label: 'reception (shared PIN)' });

    // Lazy upgrade: the stored value is now a PBKDF2 hash, not the plaintext.
    const stored = storedPin(db);
    expect(stored).toMatch(/^pbkdf2\$/);
    expect(stored).not.toBe('2468');

    // And the hashed value still verifies on the next lookup.
    await invalidateSettingsCache(env);
    const again = await resolveOverride(env, '2468');
    expect(again.ok).toBe(true);
  });

  it('wrong PIN is rejected against both legacy plaintext and hashed storage', async () => {
    const { env, db } = makeEnv();
    await invalidateSettingsCache(env);
    db.prepare('UPDATE app_settings SET reception_override_pin = ? WHERE id = 1').run('2468');

    expect((await resolveOverride(env, '9999')).ok).toBe(false);
    // A failed attempt must NOT trigger the lazy upgrade.
    expect(storedPin(db)).toBe('2468');

    // Upgrade, then confirm wrong PIN still rejected against the hash.
    await resolveOverride(env, '2468');
    await invalidateSettingsCache(env);
    expect((await resolveOverride(env, '9999')).ok).toBe(false);
    expect((await resolveOverride(env, '24680')).ok).toBe(false);
  });

  it('admin settings PUT stores a hash, never the plaintext PIN', async () => {
    const { env, db } = makeEnv();
    await invalidateSettingsCache(env);

    const res = await putSettings(env, { reception_override_pin: '2468' });
    expect(res.status).toBe(200);

    const stored = storedPin(db);
    expect(stored).toMatch(/^pbkdf2\$/);
    expect(stored).not.toBe('2468');

    await invalidateSettingsCache(env);
    expect((await resolveOverride(env, '2468')).ok).toBe(true);
    expect((await resolveOverride(env, '0000')).ok).toBe(false);
  });

  it("PUT '' clears the override (NULL — overrides disabled)", async () => {
    const { env, db } = makeEnv();
    await invalidateSettingsCache(env);
    await putSettings(env, { reception_override_pin: '2468' });
    await invalidateSettingsCache(env);

    const res = await putSettings(env, { reception_override_pin: '' });
    expect(res.status).toBe(200);
    expect(storedPin(db)).toBeNull();

    await invalidateSettingsCache(env);
    expect((await resolveOverride(env, '2468')).ok).toBe(false);
  });

  it('per-officer hashed PINs still resolve (regression guard)', async () => {
    const { env, db } = makeEnv();
    await invalidateSettingsCache(env);
    db.prepare('INSERT INTO officers (id, name, override_pin_hash) VALUES (?, ?, ?)')
      .run('off1', 'Ama Director', await hashPin('1357'));

    const res = await resolveOverride(env, '1357');
    expect(res).toEqual({ ok: true, officerId: 'off1', label: 'Ama Director' });
    expect((await resolveOverride(env, '2468')).ok).toBe(false);
  });
});
