/**
 * Visitor management hardening (plan 2026-08-01-vms-audit-fixes.md, Commit E):
 *
 *   #1 DELETE /visitors/:id must also delete visitor_surveys rows for the
 *      visitor's visits (FK visitor_surveys.visit_id → visits.id) or the batch
 *      fails with a 500, and both DELETE and the PII-editing PUT must write
 *      audit_log entries.
 *   #9 GET /visitors/:id history is capped at 100 (was a silent LIMIT 20) and
 *      the response carries the total visit count so the portal can say
 *      "showing N of M".
 *
 * Boots the REAL visitor routes over the node:sqlite D1 shim + Map KV (pattern
 * from kiosk-idempotency.test.ts), full schema.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { visitorRoutes } from './visitors';
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

// Minimal D1 shim over node:sqlite, with batch() mapped to a transaction.
function d1(db: SqliteDb) {
  const stmt = (sql: string, params: unknown[]) => ({
    first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => { db.prepare(sql).run(...params); return { success: true, meta: { changes: 1 } }; },
  });
  return {
    prepare(sql: string) {
      return { ...stmt(sql, []), bind(...params: unknown[]) { return stmt(sql, params); } };
    },
    async batch(stmts: { run(): Promise<unknown> }[]) {
      for (const s of stmts) await s.run();
      return [];
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

const superadmin: SessionData = { userId: 'u_super', email: 'super@ohcs.gov.gh', role: 'superadmin', name: 'Super Admin' };

function makeApp(session: SessionData = superadmin) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/v/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/v', visitorRoutes);
  return app;
}

function addVisitor(db: SqliteDb, id: string, first = 'Ama', last = 'Mensah'): void {
  db.prepare('INSERT INTO visitors (id, first_name, last_name, phone, organisation) VALUES (?, ?, ?, ?, ?)')
    .run(id, first, last, '0241234567', 'Ghana Cocoa Board');
}

function addVisit(db: SqliteDb, id: string, visitorId: string, status = 'checked_out'): void {
  db.prepare('INSERT INTO visits (id, visitor_id, status) VALUES (?, ?, ?)').run(id, visitorId, status);
}

function auditActions(db: SqliteDb): string[] {
  return (db.prepare('SELECT action FROM audit_log ORDER BY seq').all() as { action: string }[]).map((r) => r.action);
}

describe('DELETE /visitors/:id — cascade + audit', () => {
  it('deletes surveys, notifications, visits and the visitor in one go', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    addVisit(db, 's1', 'v1');
    db.prepare("INSERT INTO visitor_surveys (visit_id, rating) VALUES ('s1', 5)").run();
    db.prepare("INSERT INTO users (id, name, email) VALUES ('u1', 'Reception', 'r@ohcs.gov.gh')").run();
    db.prepare("INSERT INTO notifications (id, user_id, type, title, body, visit_id) VALUES ('n1', 'u1', 'x', 't', 'b', 's1')").run();

    const res = await makeApp().request('/v/v1', { method: 'DELETE' }, env);
    expect(res.status).toBe(200);

    const counts = [
      ['visitors', 0], ['visits', 0], ['visitor_surveys', 0], ['notifications', 0],
    ] as const;
    for (const [table, expected] of counts) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n, table).toBe(expected);
    }
  });

  it('writes a visitor.delete audit entry', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    const res = await makeApp().request('/v/v1', { method: 'DELETE' }, env);
    expect(res.status).toBe(200);
    expect(auditActions(db)).toContain('visitor.delete');
  });
});

describe('PUT /visitors/:id — PII edit is audited', () => {
  it('writes a visitor.update audit entry with the field diff', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    const res = await makeApp().request('/v/v1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Yaa' }),
    }, env);
    expect(res.status).toBe(200);

    expect(auditActions(db)).toContain('visitor.update');
    const row = db.prepare("SELECT changes, entity_id FROM audit_log WHERE action = 'visitor.update'").get() as { changes: string; entity_id: string };
    expect(row.entity_id).toBe('v1');
    const changes = JSON.parse(row.changes) as Record<string, { from: unknown; to: unknown }>;
    expect(changes.first_name).toEqual({ from: 'Ama', to: 'Yaa' });
  });
});

describe('GET /visitors/:id — history cap + total count', () => {
  it('caps the embedded history at 100 and reports the full visit count', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    for (let i = 0; i < 105; i++) addVisit(db, `s${i}`, 'v1');

    const res = await makeApp().request('/v/v1', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { visits: unknown[]; visit_count: number } };
    expect(body.data.visits.length).toBe(100);
    expect(body.data.visit_count).toBe(105);
  });

  it('small histories come back whole with an exact count', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1');
    addVisit(db, 's1', 'v1');
    addVisit(db, 's2', 'v1');

    const res = await makeApp().request('/v/v1', {}, env);
    const body = await res.json() as { data: { visits: unknown[]; visit_count: number } };
    expect(body.data.visits.length).toBe(2);
    expect(body.data.visit_count).toBe(2);
  });
});
