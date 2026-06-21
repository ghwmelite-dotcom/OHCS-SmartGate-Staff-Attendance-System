/**
 * Integration test for the restore plan.
 *
 * Runs the REAL buildRestorePlan() output against in-memory SQLite with
 * `PRAGMA foreign_keys = ON` (mirrors D1), seeding a "current" state, then
 * restoring a *different* snapshot. Proves:
 *   1. FK-safety — the wipe+reinsert order never trips a constraint (a wrong
 *      order would throw here exactly as D1 would).
 *   2. Correctness — afterwards the DB matches the snapshot (row counts), the
 *      previous "current" data is gone, and the deferred circular (directorate
 *      ↔ officer) + self (user supervisor) references are reconnected.
 *   3. Schema-drift tolerance — a snapshot column the live schema lacks is
 *      dropped rather than failing the insert.
 *
 * Uses node:sqlite, same as go-live-reset.test.ts. The live column map is read
 * via PRAGMA table_info, exactly like the route.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRestorePlan, type RestoreSnapshot, type ColumnMap } from './restore';

interface SqliteStatement { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): SqliteStatement; }

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  return db;
}

function count(db: SqliteDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

// Read live columns the same way the route does.
function columnMap(db: SqliteDb, tables: string[]): ColumnMap {
  const map: ColumnMap = {};
  for (const t of tables) {
    map[t] = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name);
  }
  return map;
}

// Seed a "current" state that the restore must fully replace.
function seedCurrent(db: SqliteDb): void {
  db.prepare('INSERT INTO directorates (id, name, abbreviation) VALUES (?, ?, ?)').run('old_dir', 'Old', 'OLD');
  db.prepare('INSERT INTO officers (id, name, directorate_id) VALUES (?, ?, ?)').run('old_off', 'Old Officer', 'old_dir');
  db.prepare('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)').run('old_user', 'Old User', 'old@x', 'staff');
  db.prepare('INSERT INTO visitors (id, first_name, last_name) VALUES (?, ?, ?)').run('old_vis', 'Old', 'Visitor');
  db.prepare('INSERT INTO notifications (id, user_id, title) VALUES (?, ?, ?)').run('old_n', 'old_user', 'stale');
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)').run('old_p', 'old_user', 'https://old', 'k', 'a');
}

// A snapshot from "another time" — circular directorate↔officer refs and a user
// self-reference, plus a deliberately unknown column to exercise drift handling.
const SNAPSHOT: RestoreSnapshot = {
  directorates: [
    { id: 'd1', name: 'Records', abbreviation: 'RSIMD', reception_officer_id: 'o1', head_officer_id: 'o1', legacy_gone_column: 'x' },
    { id: 'd2', name: 'Finance', abbreviation: 'F&A', reception_officer_id: null, head_officer_id: null },
  ],
  visit_categories: [{ id: 'vc1', name: 'Official', slug: 'official', directorate_hint_id: 'd1' }],
  officers: [
    { id: 'o1', name: 'Mr Mensah', directorate_id: 'd1' },
    { id: 'o2', name: 'Ms Addo', directorate_id: 'd2' },
  ],
  users: [
    { id: 'u_super', name: 'Super', email: 's@x', role: 'superadmin' },
    { id: 'u_dir', name: 'Director', email: 'd@x', role: 'director', directorate_id: 'd1' },
    { id: 'u_intern', name: 'Intern', email: 'i@x', role: 'staff', supervisor_user_id: 'u_dir' },
  ],
  visitors: [{ id: 'v1', first_name: 'Jane', last_name: 'Doe' }],
  visits: [{ id: 'vs1', visitor_id: 'v1', host_officer_id: 'o1', directorate_id: 'd1', created_by: 'u_super' }],
  clock_records: [{ id: 'c1', user_id: 'u_dir', type: 'clock_in' }],
  leave_requests: [{ id: 'l1', user_id: 'u_dir', type: 'annual', start_date: '2026-07-01', end_date: '2026-07-02', approved_by: 'u_super' }],
  absence_notices: [{ id: 'a1', user_id: 'u_dir', reason: 'sick', notice_date: '2026-07-01' }],
  directorate_receivers: [{ directorate_id: 'd1', officer_id: 'o1' }],
  webauthn_credentials: [{ id: 'w1', user_id: 'u_super', public_key: 'pk' }],
  app_settings: [{ id: 1, work_start_time: '08:00', late_threshold_time: '08:30', work_end_time: '17:00' }],
  holidays: [{ id: 'h1', date: '2026-07-01', name: 'Republic Day' }],
  audit_log: [{ id: 'au1', seq: 1, at: '2026-06-21T00:00:00Z', action: 'seed', prev_hash: '', hash: 'h' }],
};

const TABLES = Object.keys(SNAPSHOT);

function runPlan(db: SqliteDb, plan: { sql: string; binds: unknown[] }[]): void {
  for (const s of plan) db.prepare(s.sql).run(...s.binds);
}

describe('buildRestorePlan — FK-safe restore', () => {
  it('runs without FK violations and the DB matches the snapshot', () => {
    const db = newDb();
    seedCurrent(db);
    const plan = buildRestorePlan(SNAPSHOT, columnMap(db, TABLES));

    expect(() => runPlan(db, plan)).not.toThrow();

    // Every restored table matches the snapshot row count.
    for (const t of TABLES) {
      expect(count(db, t), `${t}`).toBe(SNAPSHOT[t]!.length);
    }
    // The previous "current" rows are gone.
    expect((db.prepare('SELECT id FROM directorates ORDER BY id').all() as { id: string }[]).map((r) => r.id))
      .toEqual(['d1', 'd2']);
    // Transient tables (not in backup) were cleared.
    expect(count(db, 'notifications')).toBe(0);
    expect(count(db, 'push_subscriptions')).toBe(0);
  });

  it('reconnects the deferred circular + self references', () => {
    const db = newDb();
    seedCurrent(db);
    runPlan(db, buildRestorePlan(SNAPSHOT, columnMap(db, TABLES)));

    const d1 = db.prepare('SELECT reception_officer_id, head_officer_id FROM directorates WHERE id = ?').get('d1') as { reception_officer_id: string | null; head_officer_id: string | null };
    expect(d1.reception_officer_id).toBe('o1');
    expect(d1.head_officer_id).toBe('o1');

    const intern = db.prepare('SELECT supervisor_user_id FROM users WHERE id = ?').get('u_intern') as { supervisor_user_id: string | null };
    expect(intern.supervisor_user_id).toBe('u_dir');
  });

  it('drops a snapshot column the live schema does not have (drift tolerance)', () => {
    const db = newDb();
    seedCurrent(db);
    // SNAPSHOT.directorates[0] carries legacy_gone_column — must not break insert.
    expect(() => runPlan(db, buildRestorePlan(SNAPSHOT, columnMap(db, TABLES)))).not.toThrow();
    expect(count(db, 'directorates')).toBe(2);
  });
});
