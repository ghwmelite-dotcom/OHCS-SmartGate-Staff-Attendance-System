/**
 * Regression test for the NSS / intern range-export window-clamp invariant.
 *
 * Audit fix locked in here: the export must clamp the clock-in NUMERATOR to each
 * user's posting window [nss_start_date, nss_end_date] (intersected with the
 * requested [from, to] range), exactly like the per-user working-days DENOMINATOR.
 * Without the clamp, a clock-in logged OUTSIDE the posting window (e.g. an early
 * test clock-in before nss_start_date, or one after nss_end_date) would inflate
 * `clock_ins` past `userWorkingDays`, producing clock_ins > working_days and
 * breaking the invariant `clock_ins + absent_days === userWorkingDays`.
 *
 * The SQL under test is the REAL query, imported from admin-nss.ts via
 * buildNssExportQuery() (single source of truth — no copy/paste drift). The
 * per-row JS (effectiveStart/effectiveEnd/workingDaysBetween/absent_days) below
 * mirrors the route's mapping and MUST be kept in sync with admin-nss.ts.
 *
 * Runs against a real in-memory SQLite DB via Node 24's built-in node:sqlite
 * (synchronous), so it exercises the actual SQLite date/strftime semantics the
 * production D1 query relies on — no app boot, no new dependency.
 */
import { describe, it, expect } from 'vitest';
import { buildNssExportQuery, personnelTypeWhere } from './admin-nss';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

// --- Per-row JS mirrored from admin-nss.ts (KEEP IN SYNC). ------------------
// Monday..Friday count between two ISO dates inclusive; 0 if window empty.
function workingDaysBetween(startIso: string, endIso: string): number {
  const startMs = new Date(`${startIso}T00:00:00Z`).getTime();
  const endMs = new Date(`${endIso}T00:00:00Z`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return 0;
  let n = 0;
  for (let t = startMs; t <= endMs; t += 86400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

interface RawRow {
  user_id: string;
  name: string;
  nss_number: string | null;
  directorate_abbr: string | null;
  nss_start_date: string | null;
  nss_end_date: string | null;
  current_streak: number;
  clock_ins: number;
  late_count: number;
}

// Mirror of the route's per-row mapping for absent_days / userWorkingDays.
function deriveUserMetrics(r: RawRow, from: string, to: string) {
  const effectiveStart = r.nss_start_date && r.nss_start_date > from ? r.nss_start_date : from;
  const effectiveEnd = r.nss_end_date && r.nss_end_date < to ? r.nss_end_date : to;
  const userWorkingDays = workingDaysBetween(effectiveStart, effectiveEnd);
  const clock_ins = r.clock_ins ?? 0;
  return {
    userWorkingDays,
    clock_ins,
    absent_days: Math.max(0, userWorkingDays - clock_ins),
  };
}

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  // Minimal schema — only the columns the export query + mapping touch.
  db.exec(`
    CREATE TABLE directorates (id TEXT PRIMARY KEY, abbreviation TEXT);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT,
      user_type TEXT,
      nss_number TEXT,
      intern_code TEXT,
      nss_start_date TEXT,
      nss_end_date TEXT,
      directorate_id TEXT,
      current_streak INTEGER DEFAULT 0
    );
    CREATE TABLE clock_records (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      type TEXT,
      timestamp TEXT
    );
  `);
  return db;
}

// Run the REAL export query the way the route does, returning raw rows.
function runExport(db: SqliteDb, from: string, to: string, lateAfter: string): RawRow[] {
  const typeClause = personnelTypeWhere(undefined); // -> u.user_type = 'nss'
  const whereClause = typeClause; // no directorate filter in this test
  const sql = buildNssExportQuery(typeClause, whereClause);
  // Bind order MUST match admin-nss.ts:
  //   from, to, from, from, to, to, lateAfter, ...whereParams (none here)
  return db.prepare(sql).all(from, to, from, from, to, to, lateAfter) as RawRow[];
}

describe('buildNssExportQuery — window-clamp invariant', () => {
  const FROM = '2026-03-02'; // Monday
  const TO = '2026-03-27';   // Friday (4 full Mon..Fri weeks = 20 working days)
  const LATE_AFTER = '08:30:00';

  it('clamps clock-ins to the posting window; invariant clock_ins + absent_days === userWorkingDays holds', () => {
    const db = newDb();
    db.prepare('INSERT INTO directorates (id, abbreviation) VALUES (?, ?)').run('dir1', 'RSIMD');

    // NSS user starts in the MIDDLE of the range and ends after the range.
    // posting window = [2026-03-16, 2026-04-30] ∩ [from, to] = [2026-03-16, 2026-03-27]
    db.prepare(
      `INSERT INTO users (id, name, user_type, nss_number, nss_start_date, nss_end_date, directorate_id, current_streak)
       VALUES (?, ?, 'nss', ?, ?, ?, ?, ?)`
    ).run('u1', 'Ama Mensah', 'NSSGUE8364724', '2026-03-16', '2026-04-30', 'dir1', 3);

    // Clock-ins. Insert some INSIDE the window on weekdays, and at least one
    // BEFORE nss_start_date (the pre-fix bug source) plus one after nss_end_date.
    const ins = db.prepare(`INSERT INTO clock_records (id, user_id, type, timestamp) VALUES (?, 'u1', 'clock_in', ?)`);
    // Inside window (Mon 03-16, Tue 03-17, Wed 03-18) -> 3 valid working-day clock-ins.
    ins.run('c1', '2026-03-16T08:05:00Z');
    ins.run('c2', '2026-03-17T08:05:00Z');
    ins.run('c3', '2026-03-18T08:40:00Z'); // late one
    // OUTSIDE window — BEFORE nss_start_date (would have inflated clock_ins pre-fix).
    ins.run('c4', '2026-03-09T08:05:00Z'); // Monday, inside [from,to] but before posting start
    // OUTSIDE [from,to] entirely / after nss_end_date region (defensive).
    ins.run('c5', '2026-05-04T08:05:00Z');

    const rows = runExport(db, FROM, TO, LATE_AFTER);
    expect(rows).toHaveLength(1);
    const raw = rows[0]!;

    // The out-of-window clock-ins (c4 before start, c5 outside range) are NOT counted.
    // Only c1, c2, c3 remain.
    expect(raw.clock_ins).toBe(3);

    const { userWorkingDays, clock_ins, absent_days } = deriveUserMetrics(raw, FROM, TO);

    // userWorkingDays = Mon..Fri in [2026-03-16, 2026-03-27] = 10.
    expect(userWorkingDays).toBe(10);

    // Core invariants from the audit fix:
    expect(clock_ins).toBeLessThanOrEqual(userWorkingDays);
    expect(clock_ins + absent_days).toBe(userWorkingDays);
    expect(absent_days).toBe(7); // 10 working days - 3 clock-ins
  });

  it('proves the pre-fix bug is gone: an extra clock-in BEFORE nss_start_date does not push clock_ins past userWorkingDays', () => {
    const db = newDb();
    db.prepare('INSERT INTO directorates (id, abbreviation) VALUES (?, ?)').run('dir1', 'RSIMD');

    // Tight window: user starts on the LAST working day of the range, so
    // userWorkingDays === 1. Pre-fix, out-of-window clock-ins would make
    // clock_ins (e.g. 3) exceed userWorkingDays (1), breaking the invariant.
    db.prepare(
      `INSERT INTO users (id, name, user_type, nss_number, nss_start_date, nss_end_date, directorate_id, current_streak)
       VALUES (?, ?, 'nss', ?, ?, ?, ?, ?)`
    ).run('u1', 'Kofi Asante', 'NSSGUE0000001', '2026-03-27', '2026-12-31', 'dir1', 0);

    const ins = db.prepare(`INSERT INTO clock_records (id, user_id, type, timestamp) VALUES (?, 'u1', 'clock_in', ?)`);
    // The ONE legitimate in-window clock-in (Fri 03-27).
    ins.run('c1', '2026-03-27T08:00:00Z');
    // Three pre-window clock-ins that the BUG would have counted.
    ins.run('c2', '2026-03-09T08:00:00Z');
    ins.run('c3', '2026-03-10T08:00:00Z');
    ins.run('c4', '2026-03-11T08:00:00Z');

    const rows = runExport(db, FROM, TO, LATE_AFTER);
    const raw = rows[0]!;

    // Only the in-window clock-in survives the clamp.
    expect(raw.clock_ins).toBe(1);

    const { userWorkingDays, clock_ins, absent_days } = deriveUserMetrics(raw, FROM, TO);
    expect(userWorkingDays).toBe(1);
    expect(clock_ins).toBeLessThanOrEqual(userWorkingDays); // would FAIL pre-fix (3 > 1)
    expect(clock_ins + absent_days).toBe(userWorkingDays);
    expect(absent_days).toBe(0);
  });

  it('weekend clock-ins inside the window are not counted (numerator stays a Mon..Fri subset)', () => {
    const db = newDb();
    db.prepare('INSERT INTO directorates (id, abbreviation) VALUES (?, ?)').run('dir1', 'RSIMD');
    db.prepare(
      `INSERT INTO users (id, name, user_type, nss_number, nss_start_date, nss_end_date, directorate_id, current_streak)
       VALUES (?, ?, 'nss', ?, ?, ?, ?, ?)`
    ).run('u1', 'Yaa Owusu', 'NSSGUE0000002', '2026-03-02', '2026-12-31', 'dir1', 0);

    const ins = db.prepare(`INSERT INTO clock_records (id, user_id, type, timestamp) VALUES (?, 'u1', 'clock_in', ?)`);
    ins.run('c1', '2026-03-02T08:00:00Z'); // Monday - counts
    ins.run('c2', '2026-03-07T08:00:00Z'); // Saturday - excluded
    ins.run('c3', '2026-03-08T08:00:00Z'); // Sunday - excluded

    const rows = runExport(db, FROM, TO, LATE_AFTER);
    expect(rows[0]!.clock_ins).toBe(1);
  });
});
