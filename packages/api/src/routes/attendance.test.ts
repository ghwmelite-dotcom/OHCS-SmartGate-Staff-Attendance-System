/**
 * Attendance-register integrity tests (plan: docs/superpowers/plans/2026-08-01-attendance-integrity-gaps.md, Commit A).
 *
 * Boots the REAL attendanceRoutes with the D1-over-node:sqlite shim (pattern
 * from admin-settings.test.ts). Fake timers pin "today" to 2026-08-03.
 *
 * Covers:
 *   - /records?date=<past>: deactivated users WITH a clock record that day
 *     still appear; deactivated users with NO record stay excluded; today's
 *     register is unchanged (active only).
 *   - /today?date=<past>: population + counts match /records for the same date.
 *   - Date attribution: a replayed record (timestamp today, device_info
 *     .capturedDate yesterday) is attributed to yesterday in both endpoints;
 *     legacy NULL / non-JSON device_info rows fall back to the server
 *     timestamp without erroring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const NOW = '2026-08-03T12:00:00.000Z'; // fake "today" (Monday)
const PAST = '2026-07-31';               // a past workday (Friday)

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
      id TEXT PRIMARY KEY, name TEXT, staff_id TEXT, role TEXT DEFAULT 'staff',
      user_type TEXT DEFAULT 'staff', is_active INTEGER NOT NULL DEFAULT 1,
      directorate_id TEXT, display_role TEXT, current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE clock_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      timestamp TEXT NOT NULL, photo_url TEXT, device_info TEXT,
      reauth_method TEXT, liveness_decision TEXT, liveness_signature TEXT,
      presence_method TEXT, presence_token_window TEXT, risk_score INTEGER,
      risk_factors TEXT, risk_disposition TEXT
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
 *   u1 active, no records
 *   u2 active, clocked in+out on PAST
 *   u3 DEACTIVATED, clocked in on PAST        (must appear for PAST, not today)
 *   u4 DEACTIVATED, no records                (must never appear)
 *   u5 active, clocked in on PAST, device_info NULL (legacy)
 *   u6 active, clocked in on PAST, device_info 'not json' (legacy junk)
 *   u7 active, replayed record: server timestamp TODAY, capturedDate PAST
 *   u8 active, clocked in TODAY (plain)
 */
function seed(db: SqliteDb) {
  const insUser = db.prepare(
    'INSERT INTO users (id, name, staff_id, is_active, directorate_id) VALUES (?, ?, ?, ?, ?)',
  );
  insUser.run('u1', 'Active NoClock', 'S1', 1, 'dir1');
  insUser.run('u2', 'Active Clocked', 'S2', 1, 'dir1');
  insUser.run('u3', 'Deactivated Clocked', 'S3', 0, 'dir1');
  insUser.run('u4', 'Deactivated NoRecord', 'S4', 0, 'dir1');
  insUser.run('u5', 'Legacy NullInfo', 'S5', 1, 'dir1');
  insUser.run('u6', 'Legacy JunkInfo', 'S6', 1, 'dir1');
  insUser.run('u7', 'Replayed Capture', 'S7', 1, 'dir1');
  insUser.run('u8', 'Active Today', 'S8', 1, 'dir1');

  const insClock = db.prepare(
    'INSERT INTO clock_records (id, user_id, type, timestamp, device_info) VALUES (?, ?, ?, ?, ?)',
  );
  insClock.run('ci-u2', 'u2', 'clock_in', `${PAST}T08:05:00.000Z`, null);
  insClock.run('co-u2', 'u2', 'clock_out', `${PAST}T17:10:00.000Z`, null);
  insClock.run('ci-u3', 'u3', 'clock_in', `${PAST}T08:20:00.000Z`, null);
  insClock.run('ci-u5', 'u5', 'clock_in', `${PAST}T08:30:00.000Z`, null);
  insClock.run('ci-u6', 'u6', 'clock_in', `${PAST}T08:40:00.000Z`, 'not json');
  insClock.run('ci-u7', 'u7', 'clock_in', '2026-08-03T07:55:00.000Z', JSON.stringify({ capturedDate: PAST }));
  insClock.run('ci-u8', 'u8', 'clock_in', '2026-08-03T08:00:00.000Z', null);

  // u1 has an absence notice covering fake-today (2026-08-03), back tomorrow.
  db.prepare(
    'INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('an1', 'u1', 'sick', 'Clinic visit', '2026-08-03', '2026-08-04');
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

interface RecordRow {
  user_id: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
}

async function getRecords(env: Env, query = ''): Promise<RecordRow[]> {
  const res = await makeApp().request(`/a/records${query}`, {}, env);
  expect(res.status).toBe(200);
  const body = await res.json() as { data: RecordRow[] };
  return body.data;
}

interface TodayStats {
  total_staff: number;
  clocked_in: number;
  clocked_out: number;
  not_clocked_in: number;
}

async function getToday(env: Env, query = ''): Promise<TodayStats> {
  const res = await makeApp().request(`/a/today${query}`, {}, env);
  expect(res.status).toBe(200);
  const body = await res.json() as { data: TodayStats };
  return body.data;
}

/* ---------- tests ---------- */

describe('GET /attendance/records — past-date population', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('includes a deactivated user who clocked that day, excludes one with no record', async () => {
    const { env } = makeEnv();
    const rows = await getRecords(env, `?date=${PAST}`);
    const ids = rows.map((r) => r.user_id);
    expect(ids).toContain('u3'); // deactivated but clocked on PAST
    expect(ids).not.toContain('u4'); // deactivated, no record
    // All active users still appear (register semantics).
    for (const id of ['u1', 'u2', 'u5', 'u6', 'u7', 'u8']) expect(ids).toContain(id);
  });

  it('attributes a replayed record (timestamp today, capturedDate past) to the past date', async () => {
    const { env } = makeEnv();
    const rows = await getRecords(env, `?date=${PAST}`);
    const clockedIds = rows.filter((r) => r.clock_in_time !== null).map((r) => r.user_id).sort();
    expect(clockedIds).toEqual(['u2', 'u3', 'u5', 'u6', 'u7']);
  });

  it("today's register is unchanged: active users only, replayed record not attributed to today", async () => {
    const { env } = makeEnv();
    const rows = await getRecords(env); // no ?date → today
    const ids = rows.map((r) => r.user_id);
    expect(ids).not.toContain('u3');
    expect(ids).not.toContain('u4');
    const clockedIds = rows.filter((r) => r.clock_in_time !== null).map((r) => r.user_id);
    expect(clockedIds).toEqual(['u8']); // u7's replayed record belongs to PAST
  });

  it('rows carry absence_reason/absence_note for users with an active notice that day', async () => {
    const { env } = makeEnv();
    const rows = await getRecords(env, '?date=2026-08-03') as Array<RecordRow & { absence_reason: string | null; absence_note: string | null }>;
    const u1 = rows.find((r) => r.user_id === 'u1');
    expect(u1?.absence_reason).toBe('sick');
    expect(u1?.absence_note).toBe('Clinic visit');
    // users without a notice read null, and a notice does not leak onto other dates
    const u2 = rows.find((r) => r.user_id === 'u2');
    expect(u2?.absence_reason).toBeNull();
    const pastRows = await getRecords(env, `?date=${PAST}`) as Array<RecordRow & { absence_reason: string | null }>;
    expect(pastRows.find((r) => r.user_id === 'u1')?.absence_reason).toBeNull();
  });
});

describe('GET /attendance/today — optional ?date aligned with /records', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('?date=<past> counts match /records for the same fixture', async () => {
    const { env } = makeEnv();
    const stats = await getToday(env, `?date=${PAST}`);
    const rows = await getRecords(env, `?date=${PAST}`);

    expect(stats.total_staff).toBe(rows.length); // 6 active + u3 = 7
    expect(stats.total_staff).toBe(7);
    expect(stats.clocked_in).toBe(rows.filter((r) => r.clock_in_time !== null).length); // 5
    expect(stats.clocked_in).toBe(5);
    expect(stats.clocked_out).toBe(rows.filter((r) => r.clock_out_time !== null).length); // 1
    expect(stats.not_clocked_in).toBe(stats.total_staff - stats.clocked_in);
  });

  it('no ?date keeps today semantics: active-only population', async () => {
    const { env } = makeEnv();
    const stats = await getToday(env);
    expect(stats.total_staff).toBe(6);
    expect(stats.clocked_in).toBe(1); // u8 only; u7's replay belongs to PAST
  });

  it('rejects a malformed ?date', async () => {
    const { env } = makeEnv();
    const res = await makeApp().request('/a/today?date=oops', {}, env);
    expect(res.status).toBe(400);
    const res2 = await makeApp().request('/a/today?date=2026-8-3', {}, env);
    expect(res2.status).toBe(400);
  });
});

// Commit B: /by-directorate and /user/:userId/monthly must attribute clock rows
// by the same effective date (device_info.capturedDate ?? timestamp date) as
// /records and /today, so offline replays don't fragment across endpoints.
describe('GET /attendance/by-directorate — effective-date attribution', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('counts a replayed record (capturedDate past) toward the capture date', async () => {
    const { env } = makeEnv();
    const res = await makeApp().request(`/a/by-directorate?date=${PAST}`, {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ abbreviation: string; present: number }> };
    const dir1 = body.data.find((d) => d.abbreviation === 'RSIMD');
    // u2, u5, u6 + replayed u7 (deactivated u3 doesn't join: is_active = 1 filter).
    expect(dir1?.present).toBe(4);
  });
});

describe('GET /attendance/user/:userId/monthly — effective-date attribution', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('places a replayed record under its capturedDate month and day', async () => {
    const { env } = makeEnv();
    interface MonthlyBody { data: { total_days_present: number; daily_records: Record<string, { clock_in?: string }> } }

    const res = await makeApp().request('/a/user/u7/monthly?month=2026-07', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as MonthlyBody;
    expect(body.data.daily_records[PAST]).toBeDefined();
    expect(body.data.total_days_present).toBe(1);

    // …and NOT under the replay month (server timestamp is 2026-08-03).
    const res2 = await makeApp().request('/a/user/u7/monthly?month=2026-08', {}, env);
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as MonthlyBody;
    expect(Object.keys(body2.data.daily_records)).toEqual([]);
  });
});

/* ---------- oversight scoping (plan 2026-08-02-oversight-roles-cd-hos, Task 2) ---------- */

/**
 * Oversight fixture (applied on top of seed() only in these tests):
 *   dir2 'F&A' second directorate
 *   director1   role=director, dir1                        → scoped to dir1
 *   directorNoEnt role=director, no entity                 → fail-closed 403
 *   actingCd    role=director, dir1, chief_director        → org-wide
 *   hosUser     role=director, no entity, head_of_service  → org-wide
 *   staffDir2   staff in dir2, clocked in TODAY
 * Totals with this fixture (today, active): org-wide 11 users / 2 clocked in;
 * dir1: 8 users / 1 clocked in (u8).
 */
function seedOversight(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, abbreviation) VALUES ('dir2', 'Finance', 'F&A')").run();
  const insUser = db.prepare(
    'INSERT INTO users (id, name, staff_id, role, is_active, directorate_id, display_role) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insUser.run('director1', 'Director One', null, 'director', 1, 'dir1', null);
  insUser.run('directorNoEnt', 'Director NoEntity', null, 'director', 1, null, null);
  insUser.run('actingCd', 'Acting CD', null, 'director', 1, 'dir1', 'chief_director');
  insUser.run('hosUser', 'Head Of Service', null, 'director', 1, null, 'head_of_service');
  insUser.run('staffDir2', 'Staff Dir Two', 'S9', 'staff', 1, 'dir2', null);
  const insClock = db.prepare(
    'INSERT INTO clock_records (id, user_id, type, timestamp, device_info) VALUES (?, ?, ?, ?, ?)',
  );
  insClock.run('ci-staffDir2', 'staffDir2', 'clock_in', '2026-08-03T08:10:00.000Z', null);
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

describe('oversight scoping — /records, /today, /by-directorate', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('director /records returns only their entity — and beats a client-passed directorate_id', async () => {
    const env = makeOversightEnv();
    const res = await makeApp(director).request('/a/records?directorate_id=dir2', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: RecordRow[] };
    const ids = body.data.map((r) => r.user_id).sort();
    // dir1 active: base 6 + director1 + actingCd — no dir2 rows despite the param.
    expect(ids).toEqual(['actingCd', 'director1', 'u1', 'u2', 'u5', 'u6', 'u7', 'u8']);
  });

  it('director without an entity gets 403 on all three endpoints (fail-closed, not zeros)', async () => {
    const env = makeOversightEnv();
    for (const path of ['/a/records', '/a/today', '/a/by-directorate']) {
      const res = await makeApp(directorNoEntity).request(path, {}, env);
      expect(res.status).toBe(403);
    }
  });

  it('CD/HoS (display_role) get full org-wide data', async () => {
    const env = makeOversightEnv();

    const recRes = await makeApp(actingCd).request('/a/records', {}, env);
    expect(recRes.status).toBe(200);
    const recBody = await recRes.json() as { data: RecordRow[] };
    expect(recBody.data.map((r) => r.user_id)).toContain('staffDir2'); // dir2 row visible
    expect(recBody.data.length).toBe(11);

    const todayRes = await makeApp(actingCd).request('/a/today', {}, env);
    expect(todayRes.status).toBe(200);
    const todayBody = await todayRes.json() as { data: TodayStats };
    expect(todayBody.data.total_staff).toBe(11);
    expect(todayBody.data.clocked_in).toBe(2); // u8 (dir1) + staffDir2 (dir2)
  });

  it('staff role keeps 403 on all three endpoints', async () => {
    const env = makeOversightEnv();
    for (const path of ['/a/records', '/a/today', '/a/by-directorate']) {
      const res = await makeApp(staffSession).request(path, {}, env);
      expect(res.status).toBe(403);
    }
  });

  it('director /today counts are forced to their entity', async () => {
    const env = makeOversightEnv();
    const res = await makeApp(director).request('/a/today', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: TodayStats };
    expect(body.data.total_staff).toBe(8); // dir1 actives only
    expect(body.data.clocked_in).toBe(1);  // u8 only — staffDir2's clock-in excluded
  });

  it('director /by-directorate collapses to their own entity card; CD sees both', async () => {
    const env = makeOversightEnv();

    const dirRes = await makeApp(director).request('/a/by-directorate', {}, env);
    expect(dirRes.status).toBe(200);
    const dirBody = await dirRes.json() as { data: Array<{ abbreviation: string; total_staff: number; present: number }> };
    expect(dirBody.data.length).toBe(1);
    expect(dirBody.data[0]!.abbreviation).toBe('RSIMD');
    expect(dirBody.data[0]!.total_staff).toBe(8);
    expect(dirBody.data[0]!.present).toBe(1);

    const cdRes = await makeApp(actingCd).request('/a/by-directorate', {}, env);
    expect(cdRes.status).toBe(200);
    const cdBody = await cdRes.json() as { data: Array<{ abbreviation: string; present: number }> };
    expect(cdBody.data.length).toBe(2);
    expect(cdBody.data.find((d) => d.abbreviation === 'F&A')?.present).toBe(1);
  });
});
