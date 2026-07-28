/**
 * Clock nudge ladder tests (spec: docs/superpowers/specs/2026-07-27-clock-nudge-ladder-design.md).
 *
 * - Slot gating: morning 08:00–11:00 (30-min slots), evening 17:00/17:30 only.
 * - Message ladder: tone escalation, streak hook, final-slot copy.
 * - Audience SQL (REAL queries via node:sqlite, pattern from
 *   admin-nss-export.test.ts): activated-only targeting, compliance stops the
 *   ladder, absence-notice suppression, evening requires in-but-not-out.
 */
import { describe, it, expect } from 'vitest';
import {
  morningSlot,
  eveningSlot,
  buildClockInMessage,
  buildClockOutMessage,
  buildClockInNudgeQuery,
  buildClockOutNudgeQuery,
} from './reminders';

const THRESHOLD_MIN = 8 * 60 + 30; // 08:30

/* ---------- Slot gating ---------- */

describe('morningSlot', () => {
  it('is null before 08:00 and once the 11:00 slot window closes', () => {
    expect(morningSlot(7 * 60 + 59)).toBeNull();
    expect(morningSlot(11 * 60 + 15)).toBe(660); // 11:15 tick still lands in the 11:00 slot
    expect(morningSlot(11 * 60 + 30)).toBeNull();
  });

  it('maps ticks into 30-min slots across 08:00–11:00', () => {
    expect(morningSlot(8 * 60)).toBe(480);
    expect(morningSlot(8 * 60 + 14)).toBe(480);
    expect(morningSlot(8 * 60 + 30)).toBe(510);
    expect(morningSlot(10 * 60 + 45)).toBe(630);
    expect(morningSlot(11 * 60)).toBe(660); // final slot inclusive
  });
});

describe('eveningSlot', () => {
  it('is only the 17:00 and 17:30 slots', () => {
    expect(eveningSlot(16 * 60 + 59)).toBeNull();
    expect(eveningSlot(17 * 60)).toBe(1020);
    expect(eveningSlot(17 * 60 + 14)).toBe(1020);
    expect(eveningSlot(17 * 60 + 30)).toBe(1050);
    expect(eveningSlot(17 * 60 + 45)).toBe(1050);
    expect(eveningSlot(18 * 60)).toBeNull();
  });
});

/* ---------- Message ladder ---------- */

describe('buildClockInMessage', () => {
  it('is gentle before the late threshold', () => {
    const m = buildClockInMessage(480, THRESHOLD_MIN, '08:30', 'Ama', 4);
    expect(m.title).toContain('Good morning');
    expect(m.title).toContain('Ama');
  });

  it('uses the streak hook after the threshold when streak > 1', () => {
    const m = buildClockInMessage(540, THRESHOLD_MIN, '08:30', 'Ama', 4);
    expect(m.body).toContain('4-day streak');
  });

  it('falls back to the threshold callout when streak <= 1', () => {
    const m = buildClockInMessage(540, THRESHOLD_MIN, '08:30', 'Ama', 0);
    expect(m.body).toContain('08:30');
    expect(m.body).not.toContain('streak');
  });

  it('is clearly final in the 11:00 slot', () => {
    const m = buildClockInMessage(660, THRESHOLD_MIN, '08:30', 'Ama', 9);
    expect(m.title).toContain('Last nudge');
  });
});

describe('buildClockOutMessage', () => {
  it('soft first nudge at 17:00, firmer at 17:30', () => {
    expect(buildClockOutMessage(1020, 'Kofi').title).toContain('Wrapping up');
    expect(buildClockOutMessage(1050, 'Kofi').title).toContain('Still showing');
  });
});

/* ---------- Audience SQL (node:sqlite) ---------- */

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown };
}

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, is_active INTEGER, pin_acknowledged INTEGER,
      staff_id TEXT, nss_number TEXT, intern_code TEXT, current_streak INTEGER
    );
    CREATE TABLE clock_records (user_id TEXT, type TEXT, timestamp TEXT);
    CREATE TABLE absence_notices (user_id TEXT, notice_date TEXT, expected_return_date TEXT);
  `);
  return db;
}

const DAY = '2026-07-27';

function seedUsers(db: SqliteDb) {
  const ins = db.prepare(
    'INSERT INTO users (id, name, is_active, pin_acknowledged, staff_id, nss_number, intern_code, current_streak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  // u1 eligible — active, activated, identifier, no clock-in
  ins.run('u1', 'Ama Eligible', 1, 1, '896239', null, null, 3);
  // u2 clocked in today (evening candidate)
  ins.run('u2', 'Kofi ClockedIn', 1, 1, '896240', null, null, 1);
  // u3 never activated — excluded
  ins.run('u3', 'Esi Dormant', 1, 0, '896241', null, null, 0);
  // u4 inactive — excluded
  ins.run('u4', 'Yaw Inactive', 0, 1, '896242', null, null, 0);
  // u5 no identifier — excluded
  ins.run('u5', 'Akos NoId', 1, 1, null, null, null, 0);
  // u6 absence notice covering today — excluded
  ins.run('u6', 'Kweku Away', 1, 1, '896243', null, null, 0);
  // u7 clocked in AND out — excluded from evening
  ins.run('u7', 'Abena Done', 1, 1, '896244', null, null, 5);

  const clock = db.prepare('INSERT INTO clock_records (user_id, type, timestamp) VALUES (?, ?, ?)');
  clock.run('u2', 'clock_in', `${DAY}T08:05:00.000Z`);
  clock.run('u7', 'clock_in', `${DAY}T08:01:00.000Z`);
  clock.run('u7', 'clock_out', `${DAY}T17:10:00.000Z`);

  db.prepare('INSERT INTO absence_notices (user_id, notice_date, expected_return_date) VALUES (?, ?, ?)')
    .run('u6', DAY, DAY);
}

describe('buildClockInNudgeQuery', () => {
  it('targets only activated, active, identified users with no clock-in and no absence notice', () => {
    const db = newDb();
    seedUsers(db);
    const rows = db.prepare(buildClockInNudgeQuery()).all(DAY, DAY) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['u1']);
  });

  it('excludes a user as soon as they clock in (compliance stops the ladder)', () => {
    const db = newDb();
    seedUsers(db);
    db.prepare('INSERT INTO clock_records (user_id, type, timestamp) VALUES (?, ?, ?)')
      .run('u1', 'clock_in', `${DAY}T09:12:00.000Z`);
    const rows = db.prepare(buildClockInNudgeQuery()).all(DAY, DAY);
    expect(rows).toHaveLength(0);
  });
});

describe('buildClockOutNudgeQuery', () => {
  it('targets users clocked in but not out', () => {
    const db = newDb();
    seedUsers(db);
    const rows = db.prepare(buildClockOutNudgeQuery()).all(DAY, DAY, DAY) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['u2']);
  });

  it('excludes a user as soon as they clock out', () => {
    const db = newDb();
    seedUsers(db);
    db.prepare('INSERT INTO clock_records (user_id, type, timestamp) VALUES (?, ?, ?)')
      .run('u2', 'clock_out', `${DAY}T17:05:00.000Z`);
    const rows = db.prepare(buildClockOutNudgeQuery()).all(DAY, DAY, DAY);
    expect(rows).toHaveLength(0);
  });
});
