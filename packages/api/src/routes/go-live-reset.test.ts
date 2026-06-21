/**
 * Integration test for the go-live reset wipe.
 *
 * Runs the REAL ordered statement list (GO_LIVE_RESET_STATEMENTS, imported from
 * admin-maintenance.ts — single source of truth, no copy/paste drift) against a
 * real in-memory SQLite DB with FK enforcement ON, seeded with the full schema.
 * This proves two things the route depends on:
 *
 *   1. FK-safety: with `PRAGMA foreign_keys = ON`, the ordered statements never
 *      hit a constraint violation (children deleted / circular refs nulled before
 *      parents). A wrong order would throw here, exactly as D1 would in prod.
 *   2. The keep-set survives: directorates, visit_categories, holidays and
 *      app_settings are fully retained; the acting superadmin + the kiosk user
 *      remain; every demo officer, user and all test activity is gone.
 *
 * Uses Node's built-in node:sqlite (synchronous) — same approach as
 * admin-nss-export.test.ts, no app boot, no new dependency.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GO_LIVE_RESET_STATEMENTS, GO_LIVE_RESET_PREVIEW_SQL } from './admin-maintenance';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const SUPERADMIN_ID = 'user_superadmin';
const KIOSK_ID = 'user_kiosk';

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;'); // mirror D1, which forces FKs on
  const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

function count(db: SqliteDb, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

// Seed a realistic mix: real org config + the acting superadmin + kiosk, plus
// demo officers/users and a full spread of test activity referencing them.
function seed(db: SqliteDb): void {
  // Real org config (must survive).
  db.prepare('INSERT INTO directorates (id, name, abbreviation) VALUES (?, ?, ?)').run('dir1', 'Records', 'RSIMD');
  db.prepare('INSERT INTO directorates (id, name, abbreviation) VALUES (?, ?, ?)').run('dir2', 'Finance', 'F&A');
  db.prepare('INSERT INTO visit_categories (id, name, slug) VALUES (?, ?, ?)').run('vc1', 'Official', 'official');
  db.prepare('INSERT INTO holidays (id, date, name) VALUES (?, ?, ?)').run('h1', '2026-07-01', 'Republic Day');

  // Users: keep the superadmin + kiosk; everyone else is demo.
  const insUser = db.prepare(
    'INSERT INTO users (id, staff_id, name, email, role, pin_hash, directorate_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insUser.run(SUPERADMIN_ID, '1334685', 'Super Admin', 'super@ohcs', 'superadmin', 'hash', null);
  insUser.run(KIOSK_ID, null, 'Kiosk', 'kiosk@ohcs', 'staff', 'hash', null);
  insUser.run('u_director', 'OHCS-9', 'Demo Director', 'dir@ohcs', 'director', 'hash', 'dir1');
  insUser.run('u_staff', 'OHCS-10', 'Demo Staff', 'staff@ohcs', 'staff', 'hash', 'dir2');
  // An intern who reports to the demo director (exercises the self-reference null).
  db.prepare(
    'INSERT INTO users (id, name, email, role, user_type, intern_code, supervisor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('u_intern', 'Demo Intern', 'intern@ohcs', 'staff', 'staff', 'INT-1', 'u_director');

  // Officers (all demo) + directorates pointing at them (circular FK + head ref).
  const insOff = db.prepare('INSERT INTO officers (id, name, directorate_id) VALUES (?, ?, ?)');
  insOff.run('off1', 'Mr Mensah', 'dir1');
  insOff.run('off2', 'Ms Addo', 'dir2');
  db.prepare('UPDATE directorates SET reception_officer_id = ?, head_officer_id = ? WHERE id = ?').run('off1', 'off1', 'dir1');
  db.prepare('UPDATE directorates SET reception_officer_id = ?, head_officer_id = ? WHERE id = ?').run('off2', 'off2', 'dir2');
  db.prepare('INSERT INTO directorate_receivers (directorate_id, officer_id) VALUES (?, ?)').run('dir1', 'off1');
  db.prepare('INSERT INTO directorate_receivers (directorate_id, officer_id) VALUES (?, ?)').run('dir2', 'off2');

  // Test activity referencing the above.
  db.prepare('INSERT INTO visitors (id, first_name, last_name) VALUES (?, ?, ?)').run('vis1', 'Jane', 'Doe');
  db.prepare(
    'INSERT INTO visits (id, visitor_id, host_officer_id, directorate_id, created_by) VALUES (?, ?, ?, ?, ?)',
  ).run('v1', 'vis1', 'off1', 'dir1', KIOSK_ID);
  db.prepare('INSERT INTO clock_records (id, user_id, type) VALUES (?, ?, ?)').run('cr1', 'u_staff', 'clock_in');
  db.prepare('INSERT INTO notifications (id, user_id, title, visit_id) VALUES (?, ?, ?, ?)').run('n1', 'u_director', 'Visitor', 'v1');
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)').run('p1', 'u_staff', 'https://x', 'k', 'a');
  db.prepare('INSERT INTO leave_requests (id, user_id, type, start_date, end_date, approved_by) VALUES (?, ?, ?, ?, ?, ?)').run('lr1', 'u_staff', 'annual', '2026-07-01', '2026-07-02', 'u_director');
  db.prepare('INSERT INTO absence_notices (id, user_id, reason, notice_date) VALUES (?, ?, ?, ?)').run('an1', 'u_staff', 'sick', '2026-07-01');
  db.prepare('INSERT INTO webauthn_credentials (id, user_id, public_key) VALUES (?, ?, ?)').run('wa_staff', 'u_staff', 'pk');
  db.prepare('INSERT INTO webauthn_credentials (id, user_id, public_key) VALUES (?, ?, ?)').run('wa_super', SUPERADMIN_ID, 'pk');
  db.prepare('INSERT INTO audit_log (id, seq, at, action, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)').run('a1', 1, '2026-06-21T00:00:00Z', 'user.create', '', 'h');
}

function runWipe(db: SqliteDb): void {
  for (const s of GO_LIVE_RESET_STATEMENTS) {
    if (s.bindsKeep) db.prepare(s.sql).run(SUPERADMIN_ID, KIOSK_ID);
    else db.prepare(s.sql).run();
  }
}

describe('GO_LIVE_RESET_STATEMENTS — FK-safe wipe', () => {
  it('runs without FK violations and clears all demo content + test activity', () => {
    const db = newDb();
    seed(db);

    // Sanity: everything is populated before the wipe.
    expect(count(db, 'officers')).toBe(2);
    expect(count(db, 'visits')).toBe(1);
    expect(count(db, 'users')).toBe(5);

    // Must not throw — proves the ordering is FK-safe with foreign_keys = ON.
    expect(() => runWipe(db)).not.toThrow();

    // Test activity + demo directory fully cleared.
    for (const t of [
      'officers', 'directorate_receivers', 'visits', 'visitors', 'clock_records',
      'notifications', 'push_subscriptions', 'leave_requests', 'absence_notices', 'audit_log',
    ]) {
      expect(count(db, t), `${t} should be empty`).toBe(0);
    }
  });

  it('preview reports the exact delete/keep counts WITHOUT changing anything', () => {
    const db = newDb();
    seed(db);

    // Bind order mirrors the route: keep,keep (users_deleted), keep,keep
    // (webauthn_deleted), keep,keep (users_kept).
    const p = db.prepare(GO_LIVE_RESET_PREVIEW_SQL)
      .get(SUPERADMIN_ID, KIOSK_ID, SUPERADMIN_ID, KIOSK_ID, SUPERADMIN_ID, KIOSK_ID) as Record<string, number>;

    expect(p.officers).toBe(2);
    expect(p.reception_links).toBe(2);
    expect(p.visits).toBe(1);
    expect(p.visitors).toBe(1);
    expect(p.users_deleted).toBe(3);   // director, staff, intern
    expect(p.users_kept).toBe(2);      // superadmin + kiosk
    expect(p.webauthn_deleted).toBe(1); // staff's; superadmin's is kept
    expect(p.directorates_kept).toBe(2);
    expect(p.categories_kept).toBe(1);
    expect(p.holidays_kept).toBe(1);

    // Preview must be read-only — nothing was deleted.
    expect(count(db, 'officers')).toBe(2);
    expect(count(db, 'users')).toBe(5);
  });

  it('preserves the real org config, the acting superadmin and the kiosk user', () => {
    const db = newDb();
    seed(db);
    runWipe(db);

    // Org config retained in full.
    expect(count(db, 'directorates')).toBe(2);
    expect(count(db, 'visit_categories')).toBe(1);
    expect(count(db, 'holidays')).toBe(1);
    expect(count(db, 'app_settings')).toBe(1); // schema seeds the singleton row

    // Only the two protected users remain.
    const ids = (db.prepare('SELECT id FROM users ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual([KIOSK_ID, SUPERADMIN_ID]);

    // The superadmin keeps their webauthn credential; the removed users' are gone.
    expect(count(db, 'webauthn_credentials')).toBe(1);
    const wa = db.prepare('SELECT user_id FROM webauthn_credentials').get() as { user_id: string };
    expect(wa.user_id).toBe(SUPERADMIN_ID);

    // The circular officer references on the kept directorates were nulled.
    const dir = db.prepare('SELECT reception_officer_id, head_officer_id FROM directorates WHERE id = ?').get('dir1') as { reception_officer_id: string | null; head_officer_id: string | null };
    expect(dir.reception_officer_id).toBeNull();
    expect(dir.head_officer_id).toBeNull();
  });
});
