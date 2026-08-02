/**
 * Reports hardening (plan 2026-08-01-vms-audit-fixes.md, Commit E):
 *
 *   #5 GET /reports/visits silently truncated at the limit — the response now
 *      carries `truncated: true` when more rows exist, so the UI/export can
 *      warn instead of presenting a partial report as complete.
 *   #6 GET /reports/evacuation stored party_names JSON but only rendered
 *      "×N" — the roll now includes the parsed names per visit so the printed
 *      evacuation roll lists every person by name.
 *
 * Boots the REAL report routes over the node:sqlite D1 shim + Map KV (pattern
 * from kiosk-idempotency.test.ts), full schema.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { reportRoutes } from './reports';
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

const superadmin: SessionData = { userId: 'u_super', email: 'super@ohcs.gov.gh', role: 'superadmin', name: 'Super Admin' };

function makeApp(session: SessionData = superadmin) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/r/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/r', reportRoutes);
  return app;
}

function addVisitorWithVisit(
  db: SqliteDb,
  visitorId: string,
  visitId: string,
  opts: { status?: string; checkInAt?: string; partySize?: number | null; partyNames?: string | null } = {},
): void {
  db.prepare('INSERT INTO visitors (id, first_name, last_name) VALUES (?, ?, ?)')
    .run(visitorId, 'Ama', 'Mensah');
  db.prepare(
    'INSERT INTO visits (id, visitor_id, status, check_in_at, party_size, party_names) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    visitId, visitorId, opts.status ?? 'checked_out',
    opts.checkInAt ?? '2026-07-30T09:00:00Z',
    opts.partySize ?? null, opts.partyNames ?? null,
  );
}

describe('GET /reports/visits — truncated flag', () => {
  it('flags truncated when the rows hit the limit and more exist', async () => {
    const { env, db } = makeEnv();
    for (let i = 0; i < 3; i++) addVisitorWithVisit(db, `v${i}`, `s${i}`);

    const res = await makeApp().request('/r/visits?from=2026-07-01&to=2026-07-31&limit=2', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { visits: unknown[]; truncated: boolean; summary: { total_visits: number } } };
    expect(body.data.visits.length).toBe(2);
    expect(body.data.truncated).toBe(true);
    expect(body.data.summary.total_visits).toBe(3);
  });

  it('reports truncated = false when everything fits', async () => {
    const { env, db } = makeEnv();
    for (let i = 0; i < 3; i++) addVisitorWithVisit(db, `v${i}`, `s${i}`);

    const res = await makeApp().request('/r/visits?from=2026-07-01&to=2026-07-31&limit=500', {}, env);
    const body = await res.json() as { data: { visits: unknown[]; truncated: boolean } };
    expect(body.data.visits.length).toBe(3);
    expect(body.data.truncated).toBe(false);
  });
});

describe('GET /reports/evacuation — party names', () => {
  it('includes parsed party_names per in-building visit', async () => {
    const { env, db } = makeEnv();
    addVisitorWithVisit(db, 'v1', 's1', {
      status: 'checked_in',
      partySize: 3,
      partyNames: '["Kwame A","Efua B"]',
    });

    const res = await makeApp().request('/r/evacuation', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { visitors: { party_size: number; party_names: string[] }[] } };
    expect(body.data.visitors.length).toBe(1);
    expect(body.data.visitors[0]!.party_size).toBe(3);
    expect(body.data.visitors[0]!.party_names).toEqual(['Kwame A', 'Efua B']);
  });

  it('tolerates missing or malformed party_names JSON', async () => {
    const { env, db } = makeEnv();
    addVisitorWithVisit(db, 'v1', 's1', { status: 'checked_in' });
    addVisitorWithVisit(db, 'v2', 's2', { status: 'checked_in', partySize: 2, partyNames: 'not json' });

    const res = await makeApp().request('/r/evacuation', {}, env);
    const body = await res.json() as { data: { visitors: { party_names: string[] }[] } };
    expect(body.data.visitors.length).toBe(2);
    for (const v of body.data.visitors) expect(Array.isArray(v.party_names)).toBe(true);
  });
});
