import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import { userRoutes } from './users';
import type { Env, SessionData } from '../types';

describe('GET /users/unprovisioned-count response shape', () => {
  it('count is a non-negative integer', () => {
    const schema = z.object({ count: z.number().int().min(0) });
    expect(schema.safeParse({ count: 0 }).success).toBe(true);
    expect(schema.safeParse({ count: 42 }).success).toBe(true);
    expect(schema.safeParse({ count: -1 }).success).toBe(false);
    expect(schema.safeParse({ count: 'bad' }).success).toBe(false);
  });
});

/* ---------- GET /users — telegram_linked adoption flag ---------- */

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
    CREATE TABLE directorates (id TEXT PRIMARY KEY, abbreviation TEXT);
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, staff_id TEXT, phone TEXT,
      role TEXT, display_role TEXT, grade TEXT, is_active INTEGER DEFAULT 1,
      last_login_at TEXT, created_at TEXT, user_type TEXT,
      nss_number TEXT, nss_start_date TEXT, nss_end_date TEXT, directorate_id TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (same pattern as telegram.test.ts).
function d1(db: SqliteDb) {
  return {
    prepare(sql: string) {
      const bound = (...params: unknown[]) => ({
        first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
        all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
        run: async () => { db.prepare(sql).run(...params); return { success: true }; },
      });
      return { bind: bound, ...bound() };
    },
  };
}

function kv(store: Map<string, string>) {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
}

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  const env = { KV: kv(store), DB: d1(db), ENVIRONMENT: 'test' } as unknown as Env;
  return { env, store, db };
}

const superSession: SessionData = { userId: 'sa', email: 'root@ohcs.gov.gh', role: 'superadmin', name: 'Root' };

function makeApp(session: SessionData = superSession) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/users', userRoutes);
  return app;
}

function seedUser(db: SqliteDb, id: string, name: string) {
  db.prepare('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, `${id}@ohcs.gov.gh`, 'staff', '2026-01-01T00:00:00Z');
}

describe('GET /users — telegram_linked flag', () => {
  it('is true for users with a telegram-user:<id> KV entry, false otherwise', async () => {
    const { env, store, db } = makeEnv();
    seedUser(db, 'u-linked', 'Linked User');
    seedUser(db, 'u-plain', 'Plain User');
    store.set('telegram-user:u-linked', '555');

    const res = await makeApp().request('/users', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; telegram_linked: boolean }>; error: null };
    expect(body.error).toBeNull();
    const byId = Object.fromEntries(body.data.map((u) => [u.id, u.telegram_linked]));
    expect(byId).toEqual({ 'u-linked': true, 'u-plain': false });
  });

  it('still 403s for non-superadmins', async () => {
    const { env } = makeEnv();
    const res = await makeApp({ ...superSession, role: 'admin' }).request('/users', {}, env);
    expect(res.status).toBe(403);
  });
});
