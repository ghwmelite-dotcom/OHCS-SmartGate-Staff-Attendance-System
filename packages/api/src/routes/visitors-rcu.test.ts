import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { visitorRoutes } from '../routes/visitors';
import type { Env, SessionData } from '../types';

function d1(db: any) {
  const stmt = (sql: string, params: unknown[]) => ({
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { db.prepare(sql).run(...params); return { success: true }; },
  });
  return { prepare: (sql: string) => ({ ...stmt(sql, []), bind: (...p: unknown[]) => stmt(sql, p) }) };
}

function makeEnv(role: string, abbr: string | null, opts: { directorEntity?: string } = {}) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE visitors (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, phone TEXT, email TEXT, organisation TEXT, id_type TEXT, id_number TEXT, photo_url TEXT, id_photo_url TEXT, total_visits INTEGER, last_visit_at TEXT, created_at TEXT, updated_at TEXT, flag TEXT, flag_note TEXT, flag_updated_at TEXT, flag_updated_by TEXT);
    CREATE TABLE visits (id TEXT PRIMARY KEY, visitor_id TEXT, directorate_id TEXT, host_officer_id TEXT, check_in_at TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, directorate_id TEXT, display_role TEXT);
    CREATE TABLE directorates (id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT, is_active INTEGER);
    CREATE TABLE officers (id TEXT PRIMARY KEY, name TEXT, directorate_id TEXT);
  `);
  db.prepare("INSERT INTO visitors (id, first_name, last_name, phone, created_at) VALUES ('v1','Kwame','Addo','054','2026-07-20')").run();
  if (opts.directorEntity) {
    // Director's own entity is dirX; the visitor's only visit went elsewhere.
    db.prepare("INSERT INTO users (id, directorate_id, display_role) VALUES ('u1', ?, NULL)").run(opts.directorEntity);
    db.prepare("INSERT INTO directorates (id, name, abbreviation, is_active) VALUES ('dirOther', 'Other', 'OTH', 1)").run();
    db.prepare("INSERT INTO visits (id, visitor_id, directorate_id, check_in_at) VALUES ('vis1', 'v1', 'dirOther', '2026-07-20T10:00:00Z')").run();
  }
  const session: SessionData = { userId: 'u1', email: 's@b.c', role, name: 'S', directorate_abbr: abbr } as SessionData;
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/v/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/v', visitorRoutes);
  const env = { DB: d1(db), KV: { get: async () => null, put: async () => {}, delete: async () => {} } } as unknown as Env;
  return { app, env };
}

describe('GET /visitors — RCU parity', () => {
  it('RCU staff (role=staff, abbr=RCU) gets the visitor list', async () => {
    const { app, env } = makeEnv('staff', 'RCU');
    const res = await app.request('/v', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
  it('non-RCU staff is still 403', async () => {
    const { app, env } = makeEnv('staff', 'RSIMD');
    const res = await app.request('/v', {}, env);
    expect(res.status).toBe(403);
  });
});

describe('GET /visitors — director sees ALL visitor identities (product decision 2026-08-03)', () => {
  it('director list is unscoped even when the visitor never visited their entity', async () => {
    const { app, env } = makeEnv('director', null, { directorEntity: 'dirX' });
    const res = await app.request('/v', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((v) => v.id)).toEqual(['v1']);
  });

  it('director detail 200s for an out-of-entity visitor; visit history stays scoped', async () => {
    const { app, env } = makeEnv('director', null, { directorEntity: 'dirX' });
    const res = await app.request('/v/v1', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; visits: unknown[]; visit_count: number } };
    expect(body.data.id).toBe('v1');
    // History mirrors the Visit Log's director scoping: only their entity's visits.
    expect(body.data.visits).toHaveLength(0);
    expect(body.data.visit_count).toBe(0);
  });
});
