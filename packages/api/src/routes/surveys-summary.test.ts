/**
 * Survey response-rate denominator (plan 2026-08-01-vms-audit-fixes.md,
 * Commit E): survey tokens are minted ONLY at kiosk checkout, but the summary
 * divided by ALL checked-out visits — reception-dashboard and swept checkouts
 * (which were never offered a survey) dragged the rate down. visits has no
 * checkout-channel column (and this commit carries no migration), so the
 * denominator is restricted to the queryable kiosk cohort:
 * status='checked_out' AND check_in_source='kiosk'. The response field is
 * renamed `kiosk_checkouts` so consumers can't mistake it for all checkouts.
 *
 * Boots the REAL survey routes over the node:sqlite D1 shim + Map KV (pattern
 * from kiosk-idempotency.test.ts), full schema.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { surveyRoutes } from './surveys';
import type { Env, SessionData } from '../types';

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
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    DB: d1(db),
  } as unknown as Env;
  return { env, db };
}

const receptionist: SessionData = { userId: 'u_rec', email: 'r@ohcs.gov.gh', role: 'receptionist', name: 'Reception' };

function makeApp(session: SessionData = receptionist) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/s/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/s', surveyRoutes);
  return app;
}

function addCheckedOutVisit(db: SqliteDb, id: string, source: 'kiosk' | 'staff', checkOutAt: string): void {
  db.prepare('INSERT INTO visitors (id, first_name, last_name) VALUES (?, ?, ?)').run(`vis_${id}`, 'Ama', 'Mensah');
  db.prepare(
    "INSERT INTO visits (id, visitor_id, status, check_in_source, check_out_at) VALUES (?, ?, 'checked_out', ?, ?)"
  ).run(id, `vis_${id}`, source, checkOutAt);
}

describe('GET /surveys/summary — response-rate denominator', () => {
  it('counts only the kiosk cohort as the denominator', async () => {
    const { env, db } = makeEnv();
    addCheckedOutVisit(db, 'k1', 'kiosk', '2026-07-30T10:00:00Z');
    addCheckedOutVisit(db, 'k2', 'kiosk', '2026-07-30T11:00:00Z');
    addCheckedOutVisit(db, 'r1', 'staff', '2026-07-30T12:00:00Z'); // reception checkout — no survey offered
    // One submitted survey against a kiosk checkout
    db.prepare("INSERT INTO visitor_surveys (visit_id, rating, created_at) VALUES ('k1', 5, '2026-07-30T10:05:00Z')").run();

    const res = await makeApp().request('/s/summary?from=2026-07-01&to=2026-07-31', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { total: number; kiosk_checkouts: number; response_rate: number | null };
    };
    expect(body.data.total).toBe(1);
    expect(body.data.kiosk_checkouts).toBe(2);   // r1 excluded
    expect(body.data.response_rate).toBe(0.5);
  });

  it('no kiosk checkouts → null response rate (no divide-by-zero)', async () => {
    const { env, db } = makeEnv();
    addCheckedOutVisit(db, 'r1', 'staff', '2026-07-30T12:00:00Z');

    const res = await makeApp().request('/s/summary?from=2026-07-01&to=2026-07-31', {}, env);
    const body = await res.json() as { data: { kiosk_checkouts: number; response_rate: number | null } };
    expect(body.data.kiosk_checkouts).toBe(0);
    expect(body.data.response_rate).toBeNull();
  });
});
