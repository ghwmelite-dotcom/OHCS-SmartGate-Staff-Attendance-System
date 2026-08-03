/**
 * Attendance range export tests (plan: docs/superpowers/plans/2026-08-03-attendance-range-export.md, API item 2).
 *
 * Boots the REAL attendanceRoutes with the D1-over-node:sqlite shim (pattern
 * from attendance.test.ts).
 *
 * Covers GET /attendance/export:
 *   - one row per user × day across the span, incl. days with no clock row;
 *   - population: active users on every day; deactivated users only on days
 *     they have a clock-in or a covering absence notice (matches /records
 *     past-date semantics);
 *   - late/early flags vs settings thresholds; has_photo 0/1; presence_method;
 *   - absence notice fields populated, latest notice wins on overlap;
 *   - validation: from/to required + format, from ≤ to, span cap 366 days;
 *   - effective-date attribution (capturedDate row lands on the capture day);
 *   - user_type filter (export default = 'all');
 *   - oversight scoping: director force-scoped (beats client param + 403
 *     sentinel), CD/HoS org-wide, staff 403.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { attendanceRoutes } from './attendance';
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

// 3-day export span used across the tests (Fri–Sun).
const FROM = '2026-07-31';
const D1 = '2026-07-31';
const D2 = '2026-08-01';
const D3 = '2026-08-02';
const TO = '2026-08-02';

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      work_start_time TEXT NOT NULL,
      late_threshold_time TEXT NOT NULL,
      work_end_time TEXT NOT NULL,
      reception_override_pin TEXT,
      clockin_reauth_enforce INTEGER NOT NULL DEFAULT 0,
      clockin_pin_attempt_cap INTEGER NOT NULL DEFAULT 5,
      clockin_prompt_ttl_seconds INTEGER NOT NULL DEFAULT 90,
      clockin_passive_liveness_enforce INTEGER NOT NULL DEFAULT 0,
      clockin_liveness_review_cap_per_week INTEGER NOT NULL DEFAULT 2,
      clockin_liveness_model_version TEXT NOT NULL DEFAULT 'buffalo_s_v1',
      visitor_photo_retention_days INTEGER NOT NULL DEFAULT 30,
      presence_qr_mode INTEGER NOT NULL DEFAULT 0,
      risk_fusion_mode INTEGER NOT NULL DEFAULT 0,
      risk_fusion_block_enabled INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    INSERT INTO app_settings (id, work_start_time, late_threshold_time, work_end_time)
      VALUES (1, '08:00', '08:30', '17:00');
    CREATE TABLE directorates (
      id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO directorates (id, name, abbreviation) VALUES ('dir1', 'Records', 'RSIMD');
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, staff_id TEXT, nss_number TEXT, intern_code TEXT,
      role TEXT DEFAULT 'staff', user_type TEXT DEFAULT 'staff',
      is_active INTEGER NOT NULL DEFAULT 1, directorate_id TEXT, display_role TEXT
    );
    CREATE TABLE clock_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      timestamp TEXT NOT NULL, photo_url TEXT, device_info TEXT,
      presence_method TEXT
    );
    CREATE TABLE absence_notices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL,
      note TEXT, notice_date TEXT NOT NULL, expected_return_date TEXT,
      created_at TEXT
    );
  `);
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

/**
 * Fixture:
 *   u1 active staff, no clock rows; two overlapping notices covering D2
 *     (an-old 'sick' created earlier, an-new 'transport' created later)
 *   u2 active staff, on-time in + normal out on D1 WITH photo + presence 'qr'
 *   u3 active staff, LATE in (08:40 > 08:30) + EARLY out (16:00 < 17:00) on D1, no photo
 *   u4 DEACTIVATED staff, clocked in on D1           → only the D1 row
 *   u5 DEACTIVATED staff, notice covering D1–D2      → only D1/D2 rows
 *   u6 active NSS (user_type nss, intern_code NULL)
 *   u7 active intern (user_type nss, intern_code set)
 *   u8 active staff, replayed record: timestamp 2026-08-03, capturedDate D1
 *
 * Expected span row counts (segment all): 6 active × 3 days = 18, + u4 (D1) 1,
 * + u5 (D1, D2) 2 → 21 rows.
 */
function seed(db: SqliteDb) {
  const insUser = db.prepare(
    `INSERT INTO users (id, name, staff_id, nss_number, intern_code, user_type, is_active, directorate_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insUser.run('u1', 'Active NoClock', 'S1', null, null, 'staff', 1, 'dir1');
  insUser.run('u2', 'On Time', 'S2', null, null, 'staff', 1, 'dir1');
  insUser.run('u3', 'Late Early', 'S3', null, null, 'staff', 1, 'dir1');
  insUser.run('u4', 'Deactivated Clocked', 'S4', null, null, 'staff', 0, 'dir1');
  insUser.run('u5', 'Deactivated Notice', 'S5', null, null, 'staff', 0, 'dir1');
  insUser.run('u6', 'Nss Person', null, 'NSS0001', null, 'nss', 1, 'dir1');
  insUser.run('u7', 'Intern Person', null, null, 'INT9', 'nss', 1, 'dir1');
  insUser.run('u8', 'Replayed', 'S8', null, null, 'staff', 1, 'dir1');

  const insClock = db.prepare(
    'INSERT INTO clock_records (id, user_id, type, timestamp, photo_url, device_info, presence_method) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insClock.run('ci-u2', 'u2', 'clock_in', `${D1}T08:05:00.000Z`, 'photos/u2-in.jpg', null, 'qr');
  insClock.run('co-u2', 'u2', 'clock_out', `${D1}T17:10:00.000Z`, null, null, null);
  insClock.run('ci-u3', 'u3', 'clock_in', `${D1}T08:40:00.000Z`, null, null, null);
  insClock.run('co-u3', 'u3', 'clock_out', `${D1}T16:00:00.000Z`, null, null, null);
  insClock.run('ci-u4', 'u4', 'clock_in', `${D1}T08:10:00.000Z`, null, null, null);
  insClock.run('ci-u8', 'u8', 'clock_in', '2026-08-03T07:55:00.000Z', null, JSON.stringify({ capturedDate: D1 }), null);

  const insNotice = db.prepare(
    'INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  // u1: two overlapping notices covering D2 only — the later-created must win.
  insNotice.run('an-old', 'u1', 'sick', 'Old note', D2, D3, '2026-07-30T09:00:00Z');
  insNotice.run('an-new', 'u1', 'transport', 'Trotro strike', D2, D3, '2026-07-31T09:00:00Z');
  // u5 (deactivated): notice covering D1 and D2.
  insNotice.run('an-u5', 'u5', 'leave', 'Approved leave', D1, D3, '2026-07-30T08:00:00Z');
}

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  seed(db);
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

const admin: SessionData = { userId: 'admin1', email: 'admin@ohcs.gov.gh', role: 'admin', name: 'Admin' };

function makeApp(session: SessionData = admin) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/a/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/a', attendanceRoutes);
  return app;
}

interface ExportRow {
  date: string;
  user_id: string;
  name: string;
  identifier: string | null;
  directorate_abbr: string | null;
  clock_in_time: string | null;
  clock_out_time: string | null;
  is_late: number;
  is_early_departure: number;
  presence_method: string | null;
  absence_reason: string | null;
  absence_note: string | null;
  has_photo: number;
}

async function getExport(env: Env, query = '', session: SessionData = admin): Promise<ExportRow[]> {
  const res = await makeApp(session).request(`/a/export${query}`, {}, env);
  expect(res.status).toBe(200);
  const body = await res.json() as { data: ExportRow[] };
  return body.data;
}

const SPAN = `?from=${FROM}&to=${TO}`;

/** Find the single row for a user on a date (fails the test if not exactly one). */
function rowFor(rows: ExportRow[], userId: string, date: string): ExportRow {
  const matches = rows.filter((r) => r.user_id === userId && r.date === date);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

/* ---------- tests ---------- */

describe('GET /attendance/export — rows per user × day', () => {
  it('returns one row per active user per day, including days with no clock row', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);
    expect(rows).toHaveLength(21);

    // u1 (active, never clocks) appears on all three days with null clock fields.
    for (const date of [D1, D2, D3]) {
      const r = rowFor(rows, 'u1', date);
      expect(r.clock_in_time).toBeNull();
      expect(r.clock_out_time).toBeNull();
      expect(r.has_photo).toBe(0);
    }

    // Rows carry the contract identity columns.
    const r = rowFor(rows, 'u1', D1);
    expect(r.name).toBe('Active NoClock');
    expect(r.identifier).toBe('S1');
    expect(r.directorate_abbr).toBe('RSIMD');
  });

  it('orders rows by date then name', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);
    const keys = rows.map((r) => `${r.date}|${r.name}`);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('deactivated users appear only on days they clocked or had a covering notice', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);

    // u4 clocked on D1 only.
    const u4Rows = rows.filter((r) => r.user_id === 'u4');
    expect(u4Rows.map((r) => r.date)).toEqual([D1]);
    expect(u4Rows[0]!.clock_in_time).toBe(`${D1}T08:10:00.000Z`);

    // u5's notice covers D1–D2, not D3.
    const u5Rows = rows.filter((r) => r.user_id === 'u5');
    expect(u5Rows.map((r) => r.date).sort()).toEqual([D1, D2]);
    for (const r of u5Rows) {
      expect(r.absence_reason).toBe('leave');
      expect(r.absence_note).toBe('Approved leave');
    }
  });

  it('computes is_late / is_early_departure against the settings thresholds', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);

    const onTime = rowFor(rows, 'u2', D1);
    expect(onTime.is_late).toBe(0);
    expect(onTime.is_early_departure).toBe(0);

    const lateEarly = rowFor(rows, 'u3', D1);
    expect(lateEarly.is_late).toBe(1);        // 08:40 > 08:30 threshold
    expect(lateEarly.is_early_departure).toBe(1); // 16:00 < 17:00 work end

    // No clock rows → no flags.
    const absent = rowFor(rows, 'u1', D1);
    expect(absent.is_late).toBe(0);
    expect(absent.is_early_departure).toBe(0);
  });

  it('has_photo is 1 only when the clock-in carries a photo; presence_method passes through', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);

    expect(rowFor(rows, 'u2', D1).has_photo).toBe(1);
    expect(rowFor(rows, 'u2', D1).presence_method).toBe('qr');
    expect(rowFor(rows, 'u3', D1).has_photo).toBe(0);
    expect(rowFor(rows, 'u1', D1).presence_method).toBeNull();
  });

  it('populates absence fields, and the latest overlapping notice wins', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);

    // u1 has two notices covering D2; an-new was created later.
    const covered = rowFor(rows, 'u1', D2);
    expect(covered.absence_reason).toBe('transport');
    expect(covered.absence_note).toBe('Trotro strike');

    // The notice does not leak onto days outside its span.
    expect(rowFor(rows, 'u1', D1).absence_reason).toBeNull();
    expect(rowFor(rows, 'u1', D3).absence_reason).toBeNull();
  });

  it('attributes a replayed record (timestamp outside the span, capturedDate inside) to the capture day', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);

    expect(rowFor(rows, 'u8', D1).clock_in_time).toBe('2026-08-03T07:55:00.000Z');
    expect(rowFor(rows, 'u8', D2).clock_in_time).toBeNull();
    expect(rowFor(rows, 'u8', D3).clock_in_time).toBeNull();
  });

  it('resolves identifier as staff_id | nss_number | intern_code', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);
    expect(rowFor(rows, 'u1', D1).identifier).toBe('S1');
    expect(rowFor(rows, 'u6', D1).identifier).toBe('NSS0001');
    expect(rowFor(rows, 'u7', D1).identifier).toBe('INT9');
  });
});

describe('GET /attendance/export — user_type filter (default all)', () => {
  it('defaults to all segments (NSS + intern rows included)', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, SPAN);
    expect(rows.filter((r) => r.user_id === 'u6')).toHaveLength(3);
    expect(rows.filter((r) => r.user_id === 'u7')).toHaveLength(3);
  });

  it('?user_type=staff excludes NSS and intern rows', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, `${SPAN}&user_type=staff`);
    expect(rows.some((r) => r.user_id === 'u6' || r.user_id === 'u7')).toBe(false);
    // 4 active staff × 3 days + u4 (1) + u5 (2) = 15
    expect(rows).toHaveLength(15);
  });

  it('?user_type=nss returns real NSS only; ?user_type=intern interns only', async () => {
    const { env } = makeEnv();
    const nssRows = await getExport(env, `${SPAN}&user_type=nss`);
    expect(nssRows).toHaveLength(3);
    expect(nssRows.every((r) => r.user_id === 'u6')).toBe(true);

    const internRows = await getExport(env, `${SPAN}&user_type=intern`);
    expect(internRows).toHaveLength(3);
    expect(internRows.every((r) => r.user_id === 'u7')).toBe(true);
  });
});

describe('GET /attendance/export — validation', () => {
  it('requires from and to', async () => {
    const { env } = makeEnv();
    for (const path of ['/a/export', `/a/export?from=${FROM}`, `/a/export?to=${TO}`]) {
      const res = await makeApp().request(path, {}, env);
      expect(res.status).toBe(400);
    }
  });

  it('rejects malformed dates', async () => {
    const { env } = makeEnv();
    for (const path of [`/a/export?from=oops&to=${TO}`, `/a/export?from=${FROM}&to=2026-8-2`]) {
      const res = await makeApp().request(path, {}, env);
      expect(res.status).toBe(400);
    }
  });

  it('rejects from > to', async () => {
    const { env } = makeEnv();
    const res = await makeApp().request(`/a/export?from=${TO}&to=${FROM}`, {}, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BAD_RANGE');
  });

  it('caps the span at 366 days (400 BAD_RANGE beyond)', async () => {
    const { env } = makeEnv();
    // 2026-01-01 → 2027-01-01 inclusive is exactly 366 days (2026 is not a
    // leap year) — allowed; one day more is 367 and must 400.
    const ok = await makeApp().request('/a/export?from=2026-01-01&to=2027-01-01', {}, env);
    expect(ok.status).toBe(200);
    const tooBig = await makeApp().request('/a/export?from=2026-01-01&to=2027-01-02', {}, env);
    expect(tooBig.status).toBe(400);
    const body = await tooBig.json() as { error: { code: string } };
    expect(body.error.code).toBe('BAD_RANGE');
  });

  it('accepts a single-day range (from = to)', async () => {
    const { env } = makeEnv();
    const rows = await getExport(env, `?from=${D1}&to=${D1}`);
    // 6 active × 1 day + u4 + u5 = 8
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.date === D1)).toBe(true);
  });
});

/* ---------- oversight scoping ---------- */

/**
 * Oversight fixture (on top of seed()):
 *   dir2 'F&A' second directorate
 *   director1    role=director, dir1                        → scoped to dir1
 *   directorNoEnt role=director, no entity                  → fail-closed 403
 *   actingCd     role=director, dir1, chief_director        → org-wide
 *   staffDir2    staff in dir2, clocked in on D1
 */
function seedOversight(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, abbreviation) VALUES ('dir2', 'Finance', 'F&A')").run();
  const insUser = db.prepare(
    'INSERT INTO users (id, name, staff_id, role, is_active, directorate_id, display_role) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insUser.run('director1', 'Director One', null, 'director', 1, 'dir1', null);
  insUser.run('directorNoEnt', 'Director NoEntity', null, 'director', 1, null, null);
  insUser.run('actingCd', 'Acting CD', null, 'director', 1, 'dir1', 'chief_director');
  insUser.run('staffDir2', 'Staff Dir Two', 'S9', 'staff', 1, 'dir2', null);
  db.prepare(
    'INSERT INTO clock_records (id, user_id, type, timestamp, device_info) VALUES (?, ?, ?, ?, ?)',
  ).run('ci-staffDir2', 'staffDir2', 'clock_in', `${D1}T08:10:00.000Z`, null);
}

const director: SessionData = { userId: 'director1', email: 'd1@ohcs.gov.gh', role: 'director', name: 'Director One' };
const directorNoEntity: SessionData = { userId: 'directorNoEnt', email: 'dn@ohcs.gov.gh', role: 'director', name: 'Director NoEntity' };
const actingCd: SessionData = { userId: 'actingCd', email: 'cd@ohcs.gov.gh', role: 'director', name: 'Acting CD' };
const staffSession: SessionData = { userId: 'u1', email: 's1@ohcs.gov.gh', role: 'staff', name: 'Active NoClock' };

function makeOversightEnv() {
  const { env, db } = makeEnv();
  seedOversight(db);
  return env;
}

describe('GET /attendance/export — oversight scoping', () => {
  it('director is force-scoped to their entity — and the resolver beats a client-passed directorate_id', async () => {
    const env = makeOversightEnv();
    const rows = await getExport(env, `${SPAN}&directorate_id=dir2`, director);
    expect(rows.length).toBeGreaterThan(0);
    // No dir2 rows despite the param; staffDir2's clock-in is invisible.
    expect(rows.some((r) => r.user_id === 'staffDir2')).toBe(false);
    expect(rows.every((r) => r.directorate_abbr === 'RSIMD')).toBe(true);
  });

  it('director without a linked entity gets 403 (fail-closed, not zeros)', async () => {
    const env = makeOversightEnv();
    const res = await makeApp(directorNoEntity).request(`/a/export${SPAN}`, {}, env);
    expect(res.status).toBe(403);
  });

  it('CD/HoS (display_role) get org-wide rows across directorates', async () => {
    const env = makeOversightEnv();
    const rows = await getExport(env, SPAN, actingCd);
    const dir2Rows = rows.filter((r) => r.user_id === 'staffDir2');
    expect(dir2Rows).toHaveLength(3);
    expect(dir2Rows.every((r) => r.directorate_abbr === 'F&A')).toBe(true);
    expect(rowFor(rows, 'staffDir2', D1).clock_in_time).toBe(`${D1}T08:10:00.000Z`);
  });

  it('an unscoped caller can filter by directorate_id', async () => {
    const env = makeOversightEnv();
    const rows = await getExport(env, `${SPAN}&directorate_id=dir2`, actingCd);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.user_id === 'staffDir2')).toBe(true);
  });

  it('staff role gets 403', async () => {
    const env = makeOversightEnv();
    const res = await makeApp(staffSession).request(`/a/export${SPAN}`, {}, env);
    expect(res.status).toBe(403);
  });
});
