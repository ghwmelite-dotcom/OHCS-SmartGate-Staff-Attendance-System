/**
 * Random staff initial/reset PINs (plan:
 * docs/superpowers/plans/2026-08-01-vms-audit-fixes.md, Commit C finding 2).
 *
 * Staff accounts used to get a PIN derived from the last 4 digits of the staff
 * ID — predictable to anyone who knows a colleague's staff ID. All four
 * provisioning paths must now issue a random 6-digit PIN (generateInitialPin,
 * same as NSS/intern) and SURFACE it to the admin (response payload / welcome
 * email), because it is no longer derivable.
 *
 * Boots the REAL userRoutes / adminDirectorateRoutes / bulkImportRoutes with a
 * minimal D1 shim over node:sqlite + Map-backed KV (pattern from
 * admin-settings.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { userRoutes } from './users';
import { adminDirectorateRoutes } from './admin-directorates';
import { bulkImportRoutes } from './bulk-import';
import { verifyPin } from '../services/auth';
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
    CREATE TABLE directorates (id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT);
    INSERT INTO directorates (id, name, abbreviation) VALUES ('dir_fa', 'Finance & Administration', 'F&A');
    CREATE TABLE officers (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, directorate_id TEXT, email TEXT,
      phone TEXT, office_number TEXT, override_pin_hash TEXT, is_available INTEGER NOT NULL DEFAULT 1,
      staff_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, staff_id TEXT, pin_hash TEXT,
      role TEXT, display_role TEXT, grade TEXT, directorate_id TEXT, phone TEXT,
      pin_acknowledged INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
      session_epoch INTEGER NOT NULL DEFAULT 0, user_type TEXT NOT NULL DEFAULT 'staff',
      nss_number TEXT, intern_code TEXT, last_login_at TEXT, created_at TEXT, updated_at TEXT
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
  app.use('/*', async (c, next) => { c.set('session', superadmin); await next(); });
  app.route('/users', userRoutes);
  app.route('/dir', adminDirectorateRoutes);
  app.route('/import', bulkImportRoutes);
  return app;
}

const FAKE_EXEC_CTX = { waitUntil: () => {}, passThroughOnException: () => {} };

const post = (env: Env, path: string, body: unknown) =>
  makeApp().request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env, FAKE_EXEC_CTX);

// Staff IDs chosen so the last-4-digits derivation would be obvious if used.
const STAFF_ID_A = 'OHCS-1234';
const STAFF_ID_B = 'OHCS-5678';

function expectRandomSixDigit(pin: unknown, staffId: string) {
  expect(typeof pin).toBe('string');
  expect(pin as string).toMatch(/^\d{6}$/);
  // Not the predictable last-4-of-staff-ID derivation.
  const digits = staffId.replace(/\D/g, '');
  const legacy = digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
  expect(pin).not.toBe(legacy);
}

function storedHash(db: SqliteDb, staffId: string): string {
  const row = db.prepare('SELECT pin_hash FROM users WHERE staff_id = ?').get(staffId) as { pin_hash: string } | undefined;
  expect(row).toBeTruthy();
  return row!.pin_hash;
}

/* ---------- tests ---------- */

describe('staff initial/reset PINs — random, not staff-ID-derived', () => {
  it('provision-from-officers issues random 6-digit PINs and surfaces them', async () => {
    const { env, db } = makeEnv();
    db.prepare(`INSERT INTO officers (id, name, directorate_id, staff_id) VALUES ('o1', 'Kofi Mensah', 'dir_fa', ?)`).run(STAFF_ID_A);
    db.prepare(`INSERT INTO officers (id, name, directorate_id, staff_id) VALUES ('o2', 'Efua Owusu', 'dir_fa', ?)`).run(STAFF_ID_B);

    const res = await post(env, '/users/provision-from-officers', {});
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { provisioned: number; pins: Array<{ identifier: string; initial_pin: string }> };
    };
    expect(body.data.provisioned).toBe(2);
    expect(body.data.pins).toHaveLength(2);

    const pinA = body.data.pins.find((p) => p.identifier === STAFF_ID_A)?.initial_pin;
    const pinB = body.data.pins.find((p) => p.identifier === STAFF_ID_B)?.initial_pin;
    expectRandomSixDigit(pinA, STAFF_ID_A);
    expectRandomSixDigit(pinB, STAFF_ID_B);
    expect(pinA).not.toBe(pinB); // independently random

    // The stored hashes verify against the surfaced PINs.
    expect(await verifyPin(pinA!, storedHash(db, STAFF_ID_A))).toBe(true);
    expect(await verifyPin(pinB!, storedHash(db, STAFF_ID_B))).toBe(true);
  });

  it('reset-pin issues a random 6-digit PIN, returns it, and forces re-acknowledgement', async () => {
    const { env, db } = makeEnv();
    db.prepare(
      `INSERT INTO users (id, name, email, staff_id, pin_hash, role, pin_acknowledged)
       VALUES ('u1', 'Kofi Mensah', 'kofi@ohcs.gov.gh', ?, 'stale-hash', 'staff', 1)`
    ).run(STAFF_ID_A);

    const res = await post(env, '/users/u1/reset-pin', {});
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { pin?: string } };
    expectRandomSixDigit(body.data.pin, STAFF_ID_A);
    expect(await verifyPin(body.data.pin!, storedHash(db, STAFF_ID_A))).toBe(true);

    const row = db.prepare('SELECT pin_acknowledged FROM users WHERE id = ?').get('u1') as { pin_acknowledged: number };
    expect(row.pin_acknowledged).toBe(0);

    // A second reset produces a fresh, different PIN.
    const res2 = await post(env, '/users/u1/reset-pin', {});
    const body2 = await res2.json() as { data: { pin?: string } };
    expectRandomSixDigit(body2.data.pin, STAFF_ID_A);
    expect(body2.data.pin).not.toBe(body.data.pin);
    expect(await verifyPin(body2.data.pin!, storedHash(db, STAFF_ID_A))).toBe(true);
  });

  it('officer create with staff_id auto-provisions with a random PIN and surfaces it', async () => {
    const { env, db } = makeEnv();
    const res = await post(env, '/dir/officers', {
      name: 'Kofi Mensah', directorate_id: 'dir_fa', staff_id: STAFF_ID_A,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { initial_pin?: string | null } };
    expectRandomSixDigit(body.data.initial_pin, STAFF_ID_A);
    expect(await verifyPin(body.data.initial_pin!, storedHash(db, STAFF_ID_A))).toBe(true);
  });

  it('bulk officer import issues random 6-digit PINs and surfaces them per row', async () => {
    const { env, db } = makeEnv();
    const res = await post(env, '/import/officers', {
      rows: [
        { name: 'Kofi Mensah', directorate_code: 'F&A', staff_id: STAFF_ID_A },
        { name: 'Efua Owusu', directorate_code: 'F&A', staff_id: STAFF_ID_B },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { imported: number; pins: Array<{ row: number; identifier: string; initial_pin: string }> };
    };
    expect(body.data.imported).toBe(2);
    expect(body.data.pins).toHaveLength(2);
    for (const p of body.data.pins) {
      expectRandomSixDigit(p.initial_pin, p.identifier);
      expect(await verifyPin(p.initial_pin, storedHash(db, p.identifier))).toBe(true);
    }
    expect(body.data.pins[0]!.initial_pin).not.toBe(body.data.pins[1]!.initial_pin);
  });
});
