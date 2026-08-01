/**
 * Telegram HTML-injection guard for public appointment flows (audit fix,
 * 2026-08-01). A public booker controls visitor_name; sendTelegramMessage
 * uses parse_mode HTML, so every interpolated value in the booking and
 * arrival notifications must be HTML-escaped at the Telegram boundary.
 * The in-app notification rows keep the raw text (React escapes there).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { appointmentsPublicRoutes } from './appointments-public';
import type { Env } from '../types';

afterEach(() => vi.unstubAllGlobals());

/* ---------- fakes ---------- */

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
  db.exec(`
    CREATE TABLE directorates (id TEXT PRIMARY KEY, name TEXT, floor TEXT, wing TEXT);
    CREATE TABLE officers (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, telegram_chat_id TEXT,
      directorate_id TEXT, is_available INTEGER DEFAULT 1
    );
    CREATE TABLE bookable_officers (
      id TEXT PRIMARY KEY, officer_id TEXT, slot_start_time TEXT, slot_end_time TEXT,
      slot_duration_mins INTEGER, advance_days_min INTEGER, advance_days_max INTEGER,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY, officer_id TEXT, reference_code TEXT, appointment_date TEXT,
      time_slot TEXT, visitor_name TEXT, visitor_phone TEXT, visitor_email TEXT,
      organisation TEXT, purpose TEXT, status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, telegram_chat_id TEXT);
    CREATE TABLE appointment_approvers (officer_id TEXT, user_id TEXT);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT,
      visit_id TEXT, created_at TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (same pattern as telegram.test.ts).
function d1(db: SqliteDb) {
  return {
    prepare(sql: string) {
      const bound = (...params: unknown[]) => ({
        first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
        all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
        run: async () => { db.prepare(sql).run(...params); return { success: true }; },
      });
      return { bind: bound, ...bound() };
    },
  };
}

function kv(store: Map<string, string>) {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
}

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    TELEGRAM_BOT_TOKEN: 't',
    ENVIRONMENT: 'test',
    KV: kv(store),
    DB: d1(db),
  } as unknown as Env;
  return { env, store, db };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/appt', appointmentsPublicRoutes);
  return app;
}

function stubTelegramFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentTexts(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body));
}

const INJECTION = '<a href="https://evil">x</a>';
const ESCAPED = '&lt;a href=&quot;https://evil&quot;&gt;x&lt;/a&gt;';

function seedOfficer(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, floor, wing) VALUES ('d1', 'RSIMD', '1', 'A')").run();
  db.prepare("INSERT INTO officers (id, name, title, telegram_chat_id, directorate_id, is_available) VALUES ('o1', 'Dr. Mensah', 'Director', '777', 'd1', 1)").run();
  db.prepare("INSERT INTO bookable_officers (id, officer_id, slot_start_time, slot_end_time, slot_duration_mins, advance_days_min, advance_days_max, is_active) VALUES ('bo1', 'o1', '09:00', '10:00', 30, 0, 30, 1)").run();
  db.prepare("INSERT INTO users (id, telegram_chat_id) VALUES ('u1', '555')").run();
  db.prepare("INSERT INTO appointment_approvers (officer_id, user_id) VALUES ('o1', 'u1')").run();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- POST /book ---------- */

describe('POST /appointments-public/book — Telegram notification escapes visitor_name', () => {
  it('sends the escaped name to approvers and stores the raw name in-app', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/appt/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        officer_id: 'o1',
        appointment_date: todayStr(),
        time_slot: '09:00',
        visitor_name: INJECTION,
        visitor_phone: '0244123456',
        purpose: 'Discuss the quarterly report',
      }),
    }, env);
    expect(res.status).toBe(201);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const text = sentTexts(fetchMock)[0]!;
    expect(text).toContain(ESCAPED);
    expect(text).not.toContain('<a href="https://evil">');

    // In-app notification keeps the raw text (React is the escape boundary).
    const notif = db.prepare("SELECT body FROM notifications WHERE type = 'appointment_request'").get() as { body: string };
    expect(notif.body).toContain(INJECTION);
  });
});

/* ---------- POST /arrive ---------- */

describe('POST /appointments-public/arrive — Telegram arrival sends escape visitor_name', () => {
  async function arrive() {
    const { env, db } = makeEnv();
    seedOfficer(db);
    db.prepare(
      "INSERT INTO appointments (id, officer_id, reference_code, appointment_date, time_slot, visitor_name, visitor_phone, visitor_email, organisation, purpose, status, created_at, updated_at) VALUES ('a1', 'o1', 'ABC234', ?, '09:00', ?, '0244123456', NULL, NULL, 'Meeting', 'confirmed', '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')"
    ).run(todayStr(), INJECTION);
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/appt/arrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_code: 'ABC234' }),
    }, env);
    return { res, fetchMock };
  }

  it('escapes the name in both the officer and approver sends', async () => {
    const { res, fetchMock } = await arrive();
    expect(res.status).toBe(200);

    // One send to the officer directly (777) + one to the approver (555).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const text of sentTexts(fetchMock)) {
      expect(text).toContain(ESCAPED);
      expect(text).not.toContain('<a href="https://evil">');
    }
  });
});
