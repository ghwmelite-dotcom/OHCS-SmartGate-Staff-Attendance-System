/**
 * Kiosk createVisitor idempotency (plan 2026-08-01-vms-audit-fixes.md, Commit
 * D): the kiosk mints one idempotency key per visitor flow and reuses it on
 * retries, so a retry after a lost response must NOT create a second visitor
 * row — the keyed pre-check (plus a UNIQUE-violation recovery, mirroring
 * performCheckIn) returns the original row.
 *
 * Boots the REAL kiosk route over the node:sqlite D1 shim + Map KV (pattern
 * from override.test.ts), full schema.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { kioskRoutes } from './kiosk';
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
  db.exec('PRAGMA foreign_keys = ON;'); // mirror D1, which forces FKs on
  const schema = readFileSync(join(ROUTES_DIR, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

// Minimal D1 shim over node:sqlite (copied pattern from override.test.ts).
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
  return { env, db };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/kiosk', kioskRoutes);
  return app;
}

const VISITOR_BODY = {
  first_name: 'Ama',
  last_name: 'Mensah',
  phone: '0241234567',
  organisation: 'Ghana Cocoa Board',
};

function postVisitor(env: Env, body: Record<string, unknown>) {
  return makeApp().request('/kiosk/visitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

describe('POST /kiosk/visitors — idempotency_key dedupe', () => {
  it('a repeated keyed POST returns the SAME visitor and creates no duplicate row', async () => {
    const { env, db } = makeEnv();
    const body = { ...VISITOR_BODY, idempotency_key: 'kiosk-visitor-key-1' };

    const first = await postVisitor(env, body);
    expect(first.status).toBe(201);
    const firstData = (await first.json() as { data: { id: string } }).data;

    // Retry with the same key — the kiosk's error-screen retry path.
    const second = await postVisitor(env, body);
    expect(second.status).toBe(201);
    const secondData = (await second.json() as { data: { id: string } }).data;

    expect(secondData.id).toBe(firstData.id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM visitors').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('different keys still create distinct visitors', async () => {
    const { env, db } = makeEnv();
    await postVisitor(env, { ...VISITOR_BODY, idempotency_key: 'key-a' });
    await postVisitor(env, { ...VISITOR_BODY, idempotency_key: 'key-b' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM visitors').get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('keyless POSTs keep the old behaviour (always insert)', async () => {
    const { env, db } = makeEnv();
    await postVisitor(env, VISITOR_BODY);
    await postVisitor(env, VISITOR_BODY);
    const count = db.prepare('SELECT COUNT(*) AS n FROM visitors').get() as { n: number };
    expect(count.n).toBe(2);
  });
});
