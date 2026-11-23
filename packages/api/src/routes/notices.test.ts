import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { noticeRoutes } from './notices';
import type { Env, SessionData } from '../types';
vi.mock('../services/audit', () => ({ recordAudit: vi.fn(), auditActorFromContext: vi.fn(() => ({})) }));
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

function d1(db: SqliteDb) {
  const stmt = (sql: string, params: unknown[]) => ({
    first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => {
      const r = db.prepare(sql).run(...params) as { changes: number | bigint };
      return { success: true, meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare(sql: string) {
      return { ...stmt(sql, []), bind(...params: unknown[]) { return stmt(sql, params); } };
    },
  };
}


let db: SqliteDb;
let env: Env;
const migration = readFileSync(join(__dirname, '../db/migration-notices-hub.sql'), 'utf8');
beforeEach(() => {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,display_role TEXT,directorate_id TEXT,staff_id TEXT,email TEXT,is_active INTEGER DEFAULT 1);
    CREATE TABLE directorates(id TEXT PRIMARY KEY,name TEXT,abbreviation TEXT,head_officer_id TEXT,is_active INTEGER DEFAULT 1);
    CREATE TABLE officers(id TEXT PRIMARY KEY,staff_id TEXT,email TEXT);
    CREATE TABLE absence_notices(id TEXT PRIMARY KEY,user_id TEXT,reason TEXT,note TEXT,notice_date TEXT,expected_return_date TEXT,created_at TEXT DEFAULT '2026-11-23T08:00:00Z');
    INSERT INTO directorates(id,name,abbreviation) VALUES ('a','Records','RSIMD'),('b','Finance','FIN');
    INSERT INTO users(id,name,role,directorate_id,staff_id,email) VALUES ('s','Staff One','staff','a','S1','one@example.org'),('t','Staff Two','staff','b','S2','two@example.org'),('d','Director','director','a','D1','director@example.org'),('x','No scope','director',NULL,NULL,NULL),('z','Super','superadmin',NULL,NULL,NULL),('i','IT admin','admin',NULL,NULL,NULL),('h','Head','staff','a','H1','head@example.org');
    INSERT INTO absence_notices(id,user_id,reason,note,notice_date,expected_return_date) VALUES ('legacy','s','sick','Legacy record','2026-11-22','2026-11-24');`);
  // Same splitter as production migration runner: triggers remain whole statements.
  for (const sql of migration.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) db.exec(sql);
  db.exec(`INSERT INTO absence_notices(id,user_id,reason,note,notice_date,expected_return_date) VALUES ('own','s','sick','Rest required','2026-11-23','2026-11-25'),('other','t','transport','Road closed','2026-11-23','2026-11-24'),('director','d','other','Personal matter','2026-11-23','2026-11-24');`);
  env = { DB: d1(db) } as unknown as Env;
});
function request(id: string, path = '', body?: unknown) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('*', async (c, next) => { c.set('session', { userId:id,role:'staff',email:'',name:'' }); await next(); });
  app.route('/notices', noticeRoutes);
  return app.request('/notices' + path, body ? { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) } : {}, env);
}
describe('notices hub access and lifecycle', () => {
  it('lists only own records and denies staff register, IDOR and acknowledgement', async () => {
    const response = await request('s');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect((await response.json()).data.notices.map((n: { id: string }) => n.id).sort()).toEqual(['legacy','own']);
    expect((await request('s','?view=register')).status).toBe(403);
    expect((await request('s','/other')).status).toBe(404);
    expect((await request('s','/other/acknowledge',{version:1})).status).toBe(403);
  });
  it('forces directorate boundaries on list, detail and writes', async () => {
    const result = await (await request('d','?view=register&directorate_id=b')).json();
    expect(result.data.notices.every((n: { directorate_id: string }) => n.directorate_id==='a')).toBe(true);
    expect((await request('d','/other')).status).toBe(404);
    expect((await request('d','/other/acknowledge',{version:1})).status).toBe(404);
    expect((await request('d','/director/acknowledge',{version:1})).status).toBe(403);
    expect((await request('x','?view=register')).status).toBe(403);
    expect((await request('i','?view=register')).status).toBe(403);
  });
  it('uses live role and assignment, supports uniquely linked head, fails closed after removal', async () => {
    db.exec(`INSERT INTO officers VALUES ('off','H1',NULL); UPDATE directorates SET head_officer_id='off' WHERE id='a';`);
    expect((await request('h','?view=register')).status).toBe(200);
    expect((await request('h','/own/acknowledge',{version:1})).status).toBe(200);
    db.exec(`UPDATE directorates SET head_officer_id=NULL; UPDATE users SET role='staff' WHERE id='d';`);
    expect((await request('h','?view=register')).status).toBe(403);
    expect((await request('d','?view=register')).status).toBe(403);
    db.exec(`UPDATE users SET is_active=0 WHERE id='s';`);
    expect((await request('s')).status).toBe(403);
  });
  it('never grants head access through self-editable email or ambiguous staff IDs', async () => {
    db.exec(`INSERT INTO officers VALUES ('off',NULL,'one@example.org'); UPDATE directorates SET head_officer_id='off' WHERE id='a';`);
    expect((await request('s','?view=register')).status).toBe(403);
    db.exec(`UPDATE officers SET staff_id='S1'; UPDATE users SET staff_id='S1' WHERE id='t';`);
    expect((await request('s','?view=register')).status).toBe(403);
  });
  it('paginates without exposing a different owner and filters acknowledgement status', async () => {
    for (let i=0; i<23; i++) db.prepare("INSERT INTO absence_notices(id,user_id,reason,notice_date) VALUES (?,'s','other','2026-11-01')").run('extra'+i);
    const first = (await (await request('s')).json()).data;
    const second = (await (await request('s','?page=2')).json()).data;
    expect(first.total).toBe(25);
    expect(first.notices).toHaveLength(20);
    expect(second.notices).toHaveLength(5);
    expect(new Set([...first.notices, ...second.notices].map((n: { id: string }) => n.id)).size).toBe(25);
    await request('d','/own/acknowledge',{version:1});
    const ack = (await (await request('s','?status=acknowledged')).json()).data;
    expect(ack.notices.map((n: { id: string }) => n.id)).toEqual(['own']);
  });
  it('allows explicit organisation-wide oversight', async () => {
    expect((await (await request('z','?view=register')).json()).data.total).toBe(4);
    db.exec(`UPDATE users SET display_role='chief_director' WHERE id='x';`);
    expect((await (await request('x','?view=register')).json()).data.total).toBe(4);
  });
  it('acknowledges once, resets on revision and rejects stale/withdrawn versions', async () => {
    expect((await request('d','/own/acknowledge',{version:1})).status).toBe(200);
    expect((await request('d','/own/acknowledge',{version:1})).status).toBe(409);
    db.exec(`UPDATE absence_notices SET note='Changed explanation' WHERE id='own';`);
    expect((await request('d','/own/acknowledge',{version:1})).status).toBe(409);
    const changed = (await (await request('s','/own')).json()).data;
    expect(changed.status).toBe('submitted');
    expect(changed.version).toBe(2);
    expect(changed.revisions.some((r: { event: string }) => r.event==='acknowledged')).toBe(true);
    db.exec(`DELETE FROM absence_notices WHERE id='own';`);
    const withdrawn = (await (await request('s','/own')).json()).data;
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.revisions).toHaveLength(4);
    expect((await request('d','/own/acknowledge',{version:3})).status).toBe(409);
  });
  it('preserves submission scope on transfer and backfills surviving records', async () => {
    db.exec(`UPDATE users SET directorate_id='b' WHERE id='s';`);
    expect((await (await request('d','/legacy')).json()).data.directorate_id).toBe('a');
    expect((await (await request('s','/legacy')).json()).data.revisions[0].event).toBe('imported');
  });
  it('filters and bounds queries without accepting SQL patterns', async () => {
    expect((await (await request('d','?view=register&q=Staff%20One&from=2026-11-23')).json()).data.total).toBe(1);
    expect((await (await request('z',"?view=register&q=%27%20OR%201%3D1--")).json()).data.total).toBe(0);
    expect((await request('s','?page=0')).status).toBe(400);
    expect((await request('s','?from=2026-11-30&to=2026-11-01')).status).toBe(400);
  });
});
