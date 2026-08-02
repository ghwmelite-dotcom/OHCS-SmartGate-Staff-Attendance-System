/**
 * Session revalidation on the self-service auth routes (plan:
 * docs/superpowers/plans/2026-08-01-vms-audit-fixes.md, Commit C finding 1).
 *
 * PATCH /auth/profile, POST /auth/change-pin and GET /auth/me live in the
 * public /api/auth zone (mounted BEFORE authMiddleware in index.ts), so they
 * must re-validate the session against the live user themselves: a deactivated
 * account or a bumped session_epoch (role change / PIN reset / logout-everywhere)
 * must 401 even when the KV session blob is still alive.
 *
 * Boots the REAL authRoutes with a minimal D1 shim over node:sqlite + a
 * Map-backed KV (same pattern as admin-settings.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from './auth';
import { hashPin, createSession, invalidateUserAuthState } from '../services/auth';
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
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, staff_id TEXT, nss_number TEXT,
      intern_code TEXT, phone TEXT, role TEXT, display_role TEXT, pin_hash TEXT,
      directorate_id TEXT,
      pin_acknowledged INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
      session_epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT, last_login_at TEXT
    );
    CREATE TABLE directorates (id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT);
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

const USER = {
  id: 'u_staff', name: 'Ama Serwaa', email: 'ama@ohcs.gov.gh',
  role: 'staff', pin: '1234',
};

async function makeEnv(opts: { isActive?: number; epoch?: number } = {}) {
  const store = new Map<string, string>();
  const db = newDb();
  const pinHash = await hashPin(USER.pin);
  db.prepare(
    `INSERT INTO users (id, name, email, staff_id, role, pin_hash, pin_acknowledged, is_active, session_epoch)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(USER.id, USER.name, USER.email, '896239', USER.role, pinHash, opts.isActive ?? 1, opts.epoch ?? 0);
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
  // getUserAuthState memoizes per-isolate (30s) across tests in this file — drop
  // any stale entry for the seeded user so each test sees its own fresh DB.
  invalidateUserAuthState(USER.id);
  return { env, db, store };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.route('/auth', authRoutes);
  return app;
}

const FAKE_EXEC_CTX = { waitUntil: () => {}, passThroughOnException: () => {} };

/** Mint a KV session for the seeded user at the given epoch. */
async function mintSession(env: Env, epoch = 0): Promise<string> {
  const { sessionId } = await createSession(USER.id, USER.email, USER.role, USER.name, env, false, epoch);
  return sessionId;
}

function authed(env: Env, sessionId: string, path: string, init: RequestInit = {}) {
  return makeApp().request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `session_id=${sessionId}`,
      ...(init.headers ?? {}),
    },
  }, env, FAKE_EXEC_CTX);
}

const getMe = (env: Env, sid: string) => authed(env, sid, '/auth/me');
const patchPhone = (env: Env, sid: string) =>
  authed(env, sid, '/auth/profile', { method: 'PATCH', body: JSON.stringify({ phone: '0241234567' }) });
const changePin = (env: Env, sid: string) =>
  authed(env, sid, '/auth/change-pin', {
    method: 'POST',
    body: JSON.stringify({ current_pin: USER.pin, new_pin: '5678' }),
  });

/* ---------- tests ---------- */

describe('self-service auth routes — live session revalidation', () => {
  it('valid session works on all three routes', async () => {
    const { env } = await makeEnv();
    const sid = await mintSession(env);

    const me = await getMe(env, sid);
    expect(me.status).toBe(200);
    expect((await me.json() as { data: { user: { id: string } } }).data.user.id).toBe(USER.id);

    expect((await patchPhone(env, sid)).status).toBe(200);
    expect((await changePin(env, sid)).status).toBe(200);
  });

  it('deactivated account → 401 on all three routes', async () => {
    const { env, db } = await makeEnv();
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(USER.id);
    invalidateUserAuthState(USER.id); // direct DB write bypasses bumpSessionEpoch

    // One session per route: the first 401 also deletes the KV session blob.
    for (const hit of [getMe, patchPhone, changePin]) {
      const sid = await mintSession(env);
      const res = await hit(env, sid);
      expect(res.status).toBe(401);
      expect((await res.json() as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    }
  });

  it('epoch-bumped session → 401 SESSION_REVOKED on all three routes', async () => {
    const { env, db } = await makeEnv();
    db.prepare('UPDATE users SET session_epoch = 1 WHERE id = ?').run(USER.id);
    invalidateUserAuthState(USER.id);

    for (const hit of [getMe, patchPhone, changePin]) {
      const sid = await mintSession(env, 0); // stale epoch 0, DB is at 1
      const res = await hit(env, sid);
      expect(res.status).toBe(401);
      expect((await res.json() as { error: { code: string } }).error.code).toBe('SESSION_REVOKED');
    }
  });

  it('change-pin validates against pre-change state, then mints a working new session', async () => {
    const { env } = await makeEnv();
    const sid = await mintSession(env);

    const res = await changePin(env, sid);
    expect(res.status).toBe(200);

    // The old session is revoked…
    expect((await getMe(env, sid)).status).toBe(401);

    // …and the re-issued cookie session works (epoch was bumped after validation).
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = /session_id=([^;]+)/.exec(setCookie);
    expect(match).toBeTruthy();
    const me = await getMe(env, match![1]!);
    expect(me.status).toBe(200);
  });

  it('change-pin with an already-revoked (stale-epoch) session never re-mints', async () => {
    const { env, db } = await makeEnv();
    const sid = await mintSession(env, 0);
    db.prepare('UPDATE users SET session_epoch = 1 WHERE id = ?').run(USER.id);
    invalidateUserAuthState(USER.id);

    const res = await changePin(env, sid);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('GET /auth/me — directorate_abbr (plan 2026-08-03-role-display-appointments-rcu)', () => {
  it('returns the linked directorate abbreviation, null when unlinked', async () => {
    const { env, db } = await makeEnv();
    db.prepare("INSERT INTO directorates (id, name, abbreviation) VALUES ('d_rcu', 'Reception Coordinating Unit', 'RCU')").run();
    db.prepare("UPDATE users SET directorate_id = 'd_rcu' WHERE id = ?").run(USER.id);
    invalidateUserAuthState(USER.id);

    const sid = await mintSession(env);
    const linked = await getMe(env, sid);
    expect(linked.status).toBe(200);
    const linkedBody = await linked.json() as { data: { user: { directorate_abbr: string | null } } };
    expect(linkedBody.data.user.directorate_abbr).toBe('RCU');

    db.prepare('UPDATE users SET directorate_id = NULL WHERE id = ?').run(USER.id);
    invalidateUserAuthState(USER.id);
    const unlinked = await getMe(env, sid);
    expect(unlinked.status).toBe(200);
    const unlinkedBody = await unlinked.json() as { data: { user: { directorate_abbr: string | null } } };
    expect(unlinkedBody.data.user.directorate_abbr).toBeNull();
  });
});

describe('POST /auth/pin-login — user object completeness', () => {
  it('returns display_role and directorate_abbr (portal badges + RCU parity depend on them)', async () => {
    const { env, db } = await makeEnv();
    db.prepare("INSERT INTO directorates (id, name, abbreviation) VALUES ('d_rcu', 'Reception Coordinating Unit', 'RCU')").run();
    db.prepare("UPDATE users SET display_role = 'chief_director', directorate_id = 'd_rcu' WHERE id = ?").run(USER.id);
    invalidateUserAuthState(USER.id);

    const res = await makeApp().request('/auth/pin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: '896239', pin: USER.pin }),
    }, env, FAKE_EXEC_CTX);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { user: Record<string, unknown> } };
    expect(body.data.user.display_role).toBe('chief_director');
    expect(body.data.user.directorate_abbr).toBe('RCU');
  });
});
