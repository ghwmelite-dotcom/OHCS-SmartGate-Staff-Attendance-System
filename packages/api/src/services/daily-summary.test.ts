/**
 * daily-summary weekend guard.
 * Cloudflare cron weekday numbering is Quartz-style (1=SUN … 7=SAT), so a
 * "1-5" cron fires Sunday–Thursday — the daily report MUST self-suppress on
 * weekends/holidays in code, the same way the reminder ladders do.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendDailySummary } from './daily-summary';
import type { Env } from '../types';

vi.mock('./telegram', () => ({
  sendTelegramMessage: vi.fn(async () => true),
}));
import { sendTelegramMessage } from './telegram';
const sendMock = vi.mocked(sendTelegramMessage);

function makeEnv() {
  const kv = new Map<string, string>([
    ['app-settings:v2', JSON.stringify({
      work_start_time: '08:00', late_threshold_time: '08:30', work_end_time: '17:00',
      updated_by: null, updated_at: 'x', clockin_reauth_enforce: 0, clockin_pin_attempt_cap: 5,
      clockin_prompt_ttl_seconds: 90, clockin_passive_liveness_enforce: 0,
      clockin_liveness_review_cap_per_week: 2, clockin_liveness_model_version: 'buffalo_s_v1',
      reception_override_pin: null, visitor_photo_retention_days: 30, presence_qr_mode: 0,
      risk_fusion_mode: 0, risk_fusion_block_enabled: 0, reminder_directorate_ids: 'dir_rsimd',
    })],
    ['telegram-admin-chat-id', '555'],
  ]);
  return {
    TELEGRAM_BOT_TOKEN: 't',
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
      delete: async (k: string) => { kv.delete(k); },
    },
    DB: {
      prepare: (sql: string) => ({
        first: async () => (sql.includes('COUNT') ? { c: 0 } : null),
        all: async () => ({ results: [] }),
        run: async () => ({}),
        bind: () => ({
          first: async () => (sql.includes('COUNT') ? { c: 0 } : null),
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      }),
    },
  } as unknown as Env;
}

afterEach(() => {
  sendMock.mockClear();
  vi.useRealTimers();
});

describe('sendDailySummary weekend guard', () => {
  it('does NOT send the daily report on a Sunday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T09:00:00Z')); // Sunday
    await sendDailySummary(makeEnv());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does NOT send the daily report on a Saturday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T09:00:00Z')); // Saturday
    await sendDailySummary(makeEnv());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends the daily report on a weekday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T09:00:00Z')); // Monday
    await sendDailySummary(makeEnv());
    expect(sendMock).toHaveBeenCalled();
  });
});

/* ---------- noticed-absent span is [notice_date, expected_return_date) ---------- */

// Real-SQL semantics (node:sqlite D1 shim): expected_return_date is the day
// the officer is BACK — the span must be exclusive of it.
function makeSqliteEnv() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT DEFAULT 'staff', is_active INTEGER NOT NULL DEFAULT 1, directorate_id TEXT);
    CREATE TABLE clock_records (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, timestamp TEXT);
    CREATE TABLE absence_notices (id TEXT PRIMARY KEY, user_id TEXT, reason TEXT, note TEXT, notice_date TEXT, expected_return_date TEXT);
    CREATE TABLE directorates (id TEXT PRIMARY KEY, abbreviation TEXT, is_active INTEGER NOT NULL DEFAULT 1);
  `);
  const kv = new Map<string, string>([
    ['app-settings:v2', JSON.stringify({
      work_start_time: '08:00', late_threshold_time: '08:30', work_end_time: '17:00',
      updated_by: null, updated_at: 'x', clockin_reauth_enforce: 0, clockin_pin_attempt_cap: 5,
      clockin_prompt_ttl_seconds: 90, clockin_passive_liveness_enforce: 0,
      clockin_liveness_review_cap_per_week: 2, clockin_liveness_model_version: 'buffalo_s_v1',
      reception_override_pin: null, visitor_photo_retention_days: 30, presence_qr_mode: 0,
      risk_fusion_mode: 0, risk_fusion_block_enabled: 0, reminder_directorate_ids: 'dir_rsimd',
    })],
    ['telegram-admin-chat-id', '555'],
  ]);
  const env = {
    TELEGRAM_BOT_TOKEN: 't',
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
      delete: async (k: string) => { kv.delete(k); },
    },
    DB: {
      prepare(sql: string) {
        const bound = (...params: unknown[]) => ({
          first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
          all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
          run: async () => { db.prepare(sql).run(...params); return { success: true }; },
        });
        return { bind: bound, ...bound() };
      },
    },
  } as unknown as Env;
  return { env, db };
}

describe('sendDailySummary — noticed-absent span', () => {
  it('does NOT count someone whose expected_return_date IS today (back at work)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T09:00:00Z')); // Monday
    const { env, db } = makeSqliteEnv();
    db.prepare("INSERT INTO users (id, name) VALUES ('u1', 'Kofi Away')").run();
    // Absent 2026-08-01 … 2026-08-02, back TODAY (2026-08-03).
    db.prepare("INSERT INTO absence_notices (id, user_id, reason, notice_date, expected_return_date) VALUES ('n1', 'u1', 'sick', '2026-08-01', '2026-08-03')").run();

    await sendDailySummary(env);
    expect(sendMock).toHaveBeenCalled();
    const text = String(sendMock.mock.calls[0]![0].text);
    expect(text).not.toContain('Notified absent');
  });

  it('counts someone whose span still covers today (return date tomorrow)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T09:00:00Z')); // Monday
    const { env, db } = makeSqliteEnv();
    db.prepare("INSERT INTO users (id, name) VALUES ('u1', 'Kofi Away')").run();
    db.prepare("INSERT INTO absence_notices (id, user_id, reason, notice_date, expected_return_date) VALUES ('n1', 'u1', 'sick', '2026-08-01', '2026-08-04')").run();

    await sendDailySummary(env);
    const text = String(sendMock.mock.calls[0]![0].text);
    expect(text).toContain('Notified absent: <b>1</b>');
  });
});
