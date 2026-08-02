/**
 * Server-side forced PIN reset (plan:
 * docs/superpowers/plans/2026-08-01-vms-audit-fixes.md, Commit C finding 3).
 *
 * pin_acknowledged = 0 marks a PIN-type staff account (role 'staff' — career
 * staff, NSS, interns) still on its admin-issued initial PIN. Until now only
 * the staff PWA's client-side prompt enforced the reset. authMiddleware now
 * refuses every protected route for such accounts with 403 PIN_RESET_REQUIRED;
 * the only reachable routes are the /api/auth self-service ones (change-pin /
 * me / logout), which are mounted before the middleware.
 *
 * Gate scoping evidence: pin_acknowledged defaults to 0 for ALL users —
 * including admin-tier accounts (superadmin/admin/receptionist/it/director)
 * created via POST /api/users, which carry an admin-set PIN they never use
 * (they sign into the VMS portal via email OTP / WebAuthn). Gating on the flag
 * alone would trap them, so the gate applies to role 'staff' only.
 *
 * Boots a mini-app mirroring index.ts composition (authRoutes before
 * authMiddleware) over the node:sqlite D1 shim + Map KV.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../routes/auth';
import { authMiddleware } from './auth';
import { requireRole } from '../lib/require-role';
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
      session_epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT
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

const USERS = {
  unack: { id: 'u_unack', role: 'staff', pin_acknowledged: 0 },
  ack: { id: 'u_ack', role: 'staff', pin_acknowledged: 1 },
  admin: { id: 'u_admin', role: 'admin', pin_acknowledged: 0 },
  // RCU reception-parity fixtures (directorate_abbr flow tests below).
  rcuStaff: { id: 'u_rcu', role: 'staff', pin_acknowledged: 1 },
  otherStaff: { id: 'u_other', role: 'staff', pin_acknowledged: 1 },
} as const;

async function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  const pinHash = await hashPin('1234');
  for (const u of Object.values(USERS)) {
    db.prepare(
      `INSERT INTO users (id, name, email, staff_id, role, pin_hash, pin_acknowledged, is_active, session_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`
    ).run(u.id, `User ${u.id}`, `${u.id}@ohcs.gov.gh`, `SID-${u.id}`, u.role, pinHash, u.pin_acknowledged);
  }
  // RCU reception-parity fixtures: two directorates, one staffer in each.
  db.prepare("INSERT INTO directorates (id, name, abbreviation) VALUES ('d_rcu', 'Reception Coordinating Unit', 'RCU')").run();
  db.prepare("INSERT INTO directorates (id, name, abbreviation) VALUES ('d_rsimd', 'RSIMD', 'RSIMD')").run();
  db.prepare("UPDATE users SET directorate_id = 'd_rcu' WHERE id = ?").run(USERS.rcuStaff.id);
  db.prepare("UPDATE users SET directorate_id = 'd_rsimd' WHERE id = ?").run(USERS.otherStaff.id);
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
  // Per-isolate auth-state memo persists across tests in this file.
  for (const u of Object.values(USERS)) invalidateUserAuthState(u.id);
  return { env, db, store };
}

// Mirrors index.ts: the /api/auth zone is mounted BEFORE authMiddleware, so it
// never passes through the gate; everything else under /api/* does.
function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.route('/api/auth', authRoutes);
  app.use('/api/*', authMiddleware);
  app.get('/api/clock', (c) => c.json({ data: 'clock-ok', error: null }));
  app.get('/api/visits', (c) => c.json({ data: 'visits-ok', error: null }));
  // Reception-tier gate for the directorate_abbr flow tests: passes only when
  // the middleware-carried session satisfies requireRole(..., 'receptionist').
  app.get('/api/reception-gated', (c) => {
    const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist');
    if (blocked) return blocked;
    return c.json({ data: 'reception-ok', error: null });
  });
  return app;
}

const FAKE_EXEC_CTX = { waitUntil: () => {}, passThroughOnException: () => {} };

async function sessionFor(env: Env, userId: string, role: string): Promise<string> {
  const { sessionId } = await createSession(userId, `${userId}@ohcs.gov.gh`, role, `User ${userId}`, env, false, 0);
  return sessionId;
}

function hit(env: Env, sid: string, path: string, init: RequestInit = {}) {
  return makeApp().request(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}`, ...(init.headers ?? {}) },
  }, env, FAKE_EXEC_CTX);
}

/* ---------- tests ---------- */

describe('authMiddleware — forced PIN reset gate (pin_acknowledged = 0)', () => {
  it('unacknowledged staff user gets 403 PIN_RESET_REQUIRED on protected routes', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.unack.id, 'staff');

    for (const path of ['/api/clock', '/api/visits']) {
      const res = await hit(env, sid, path);
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('PIN_RESET_REQUIRED');
    }
  });

  it('unacknowledged staff user can still reach change-pin, me and logout', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.unack.id, 'staff');

    const me = await hit(env, sid, '/api/auth/me');
    expect(me.status).toBe(200);

    const change = await hit(env, sid, '/api/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ current_pin: '1234', new_pin: '5678' }),
    });
    expect(change.status).toBe(200);

    const logout = await hit(env, sid, '/api/auth/logout', { method: 'POST', body: '{}' });
    expect(logout.status).toBe(200);
  });

  it('after changing the PIN the gate lifts for the re-issued session', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.unack.id, 'staff');

    const change = await hit(env, sid, '/api/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ current_pin: '1234', new_pin: '5678' }),
    });
    expect(change.status).toBe(200);
    const newSid = /session_id=([^;]+)/.exec(change.headers.get('set-cookie') ?? '')?.[1];
    expect(newSid).toBeTruthy();

    const res = await hit(env, newSid!, '/api/clock');
    expect(res.status).toBe(200);
  });

  it('acknowledged staff user is unaffected', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.ack.id, 'staff');
    expect((await hit(env, sid, '/api/clock')).status).toBe(200);
    expect((await hit(env, sid, '/api/visits')).status).toBe(200);
  });

  it('admin-tier account with pin_acknowledged = 0 is NOT trapped (OTP/WebAuthn portal user)', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.admin.id, 'admin');
    expect((await hit(env, sid, '/api/clock')).status).toBe(200);
    expect((await hit(env, sid, '/api/visits')).status).toBe(200);
  });
});

describe('authMiddleware — directorate_abbr flows into the session (RCU reception parity)', () => {
  // Plan: docs/superpowers/plans/2026-08-03-role-display-appointments-rcu.md.
  // getUserAuthState joins directorates and the middleware overlays
  // directorate_abbr onto the per-request session, so requireRole's effective
  // reception tier (role 'staff' + abbr 'RCU') works behind the real middleware.

  it('RCU staff passes a receptionist-gated route through the real middleware', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.rcuStaff.id, 'staff');
    const res = await hit(env, sid, '/api/reception-gated');
    expect(res.status).toBe(200);
  });

  it('non-RCU staff is 403 on the same gate', async () => {
    const { env } = await makeEnv();
    const sid = await sessionFor(env, USERS.otherStaff.id, 'staff');
    const res = await hit(env, sid, '/api/reception-gated');
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });
});
