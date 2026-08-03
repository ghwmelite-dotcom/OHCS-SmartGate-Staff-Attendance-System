/**
 * Booking acknowledgment + receiver fanout (spec 2026-08-03):
 *
 * Feature A — booking acknowledgment:
 * - /book emails the visitor "Request received — pending approval" with the
 *   ref code, requested date/slot and next-steps copy; best-effort (waitUntil),
 *   the booking never fails when the send throws.
 * - The /start visit-link confirmation message carries the pending state with
 *   officer/date/slot, all escaped.
 *
 * Feature B — receiver fanout on new bookings:
 * - /book also notifies the host directorate's directorate_receivers (in-app
 *   via the officer's linked user account + Telegram via officer.telegram_chat_id)
 *   with the same "New Appointment Request" content.
 * - Dedupe: a person who is both an approver (or the host) and a receiver gets
 *   exactly one notification per channel (user id for in-app, chat id for TG).
 * - No receivers configured → nothing breaks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { appointmentsPublicRoutes } from './appointments-public';
import { telegramWebhook } from './telegram';
import type { Env } from '../types';

afterEach(() => vi.unstubAllGlobals());

/* ---------- fakes (same pattern as appointments-reschedule.test.ts) ---------- */

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
    CREATE TABLE directorates (id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT, floor TEXT, wing TEXT);
    CREATE TABLE officers (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, email TEXT, telegram_chat_id TEXT,
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
      organisation TEXT, purpose TEXT, status TEXT, decline_reason TEXT,
      proposed_date TEXT, proposed_time_slot TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, telegram_chat_id TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE appointment_approvers (id TEXT, officer_id TEXT, user_id TEXT);
    CREATE TABLE directorate_receivers (directorate_id TEXT, officer_id TEXT, created_at TEXT);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT,
      visit_id TEXT, created_at TEXT
    );
  `);
  return db;
}

function d1(db: SqliteDb) {
  return {
    prepare(sql: string) {
      const bound = (...params: unknown[]) => ({
        first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
        all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
        run: async () => {
          const r = db.prepare(sql).run(...params) as { changes: number | bigint };
          return { success: true, meta: { changes: Number(r.changes) } };
        },
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

function makeEnv(opts: { email?: boolean } = {}) {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_BOT_USERNAME: 'ohcsbot',
    RESEND_API_KEY: opts.email ? 're_test' : undefined,
    EMAIL_FROM: opts.email ? 'OHCS <no-reply@ohcsghana.org>' : undefined,
    ADMIN_APP_URL: 'https://smartgate.test',
    ENVIRONMENT: 'test',
    KV: kv(store),
    DB: d1(db),
  } as unknown as Env;
  return { env, store, db };
}

function makePublicApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/appt', appointmentsPublicRoutes);
  app.post('/webhook', telegramWebhook);
  return app;
}

function makeExecCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, pending };
}

function stubFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callsTo(fetchMock: ReturnType<typeof vi.fn>, urlPart: string): any[][] {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(urlPart));
}

function telegramChats(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return callsTo(fetchMock, 'sendMessage').map((call) =>
    String((JSON.parse(String((call[1] as RequestInit).body)) as { chat_id: string | number }).chat_id));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Host o1 (Dr. Mensah, d1/RSIMD, tg 777); approver u1 (tg 555);
// receivers: o2 (d1, tg 888, user u3), o3 (d2, tg 999, user u4).
function seedAll(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, abbreviation, floor, wing) VALUES ('d1', 'RSIMD', 'RSIMD', '1', 'A')").run();
  db.prepare("INSERT INTO directorates (id, name, abbreviation, floor, wing) VALUES ('d2', 'OTHER', 'OTH', '2', 'B')").run();
  db.prepare("INSERT INTO officers (id, name, title, email, telegram_chat_id, directorate_id, is_available) VALUES ('o1', 'Dr. Mensah', 'Director', 'mensah@ohcs.gov.gh', '777', 'd1', 1)").run();
  db.prepare("INSERT INTO officers (id, name, title, email, telegram_chat_id, directorate_id, is_available) VALUES ('o2', 'Rec One', 'Receptionist', 'rec1@ohcs.gov.gh', '888', 'd1', 1)").run();
  db.prepare("INSERT INTO officers (id, name, title, email, telegram_chat_id, directorate_id, is_available) VALUES ('o3', 'Rec Two', 'Receptionist', 'rec2@ohcs.gov.gh', '999', 'd2', 1)").run();
  db.prepare("INSERT INTO bookable_officers (id, officer_id, slot_start_time, slot_end_time, slot_duration_mins, advance_days_min, advance_days_max, is_active) VALUES ('bo1', 'o1', '09:00', '10:00', 30, 0, 30, 1)").run();
  db.prepare("INSERT INTO users (id, name, email, telegram_chat_id, role) VALUES ('u1', 'Ama Approver', 'del@ohcs.gov.gh', '555', 'staff')").run();
  db.prepare("INSERT INTO users (id, name, email, role) VALUES ('u3', 'Rec One', 'rec1@ohcs.gov.gh', 'receptionist')").run();
  db.prepare("INSERT INTO users (id, name, email, role) VALUES ('u4', 'Rec Two', 'rec2@ohcs.gov.gh', 'receptionist')").run();
  db.prepare("INSERT INTO appointment_approvers (id, officer_id, user_id) VALUES ('aa1', 'o1', 'u1')").run();
  db.prepare("INSERT INTO directorate_receivers (directorate_id, officer_id) VALUES ('d1', 'o2')").run();
  db.prepare("INSERT INTO directorate_receivers (directorate_id, officer_id) VALUES ('d2', 'o3')").run();
}

function seedAppointment(db: SqliteDb, opts: { id?: string; ref?: string; status?: string } = {}) {
  db.prepare(
    `INSERT INTO appointments (id, officer_id, reference_code, appointment_date, time_slot,
       visitor_name, visitor_phone, visitor_email, organisation, purpose, status,
       created_at, updated_at)
     VALUES (?, 'o1', ?, ?, '09:00', 'Ama Serwaa', '0244123456', NULL, NULL, 'Meeting', ?,
             '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')`
  ).run(opts.id ?? 'a1', opts.ref ?? 'ABC234', tomorrowStr(), opts.status ?? 'pending');
}

async function doBook(env: Env, opts: { email?: string; visitorName?: string } = {}) {
  const { ctx, pending } = makeExecCtx();
  const res = await makePublicApp().request('/appt/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officer_id: 'o1',
      appointment_date: todayStr(),
      time_slot: '09:00',
      visitor_name: opts.visitorName ?? 'Ama Serwaa',
      visitor_phone: '0244123456',
      ...(opts.email ? { visitor_email: opts.email } : {}),
      purpose: 'Discuss the quarterly report',
    }),
  }, env, ctx);
  return { res, pending };
}

/* ---------- Feature A: acknowledgment email ---------- */

describe('POST /appointments/public/book — acknowledgment email', () => {
  it('emails the visitor a pending-approval acknowledgment with the ref code and slot', async () => {
    const { env, db } = makeEnv({ email: true });
    seedAll(db);
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env, { email: 'ama@example.com' });
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as any;

    const emails = callsTo(fetchMock, 'api.resend.com');
    expect(emails).toHaveLength(1);
    const payload = JSON.parse(String((emails[0]![1] as RequestInit).body)) as {
      to: string[]; subject: string; html: string; text: string;
    };
    expect(payload.to).toEqual(['ama@example.com']);
    expect(payload.html).toContain(json.data.reference_code);
    expect(payload.html).toContain('Dr. Mensah');
    expect(payload.html).toContain(todayStr());
    expect(payload.html).toContain('09:00');
    expect(payload.html.toLowerCase()).toContain('pending');
    expect(payload.html).toContain('confirmed or declined');
  });

  it('escapes visitor-controlled values in the acknowledgment email', async () => {
    const { env, db } = makeEnv({ email: true });
    seedAll(db);
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env, { email: 'ama@example.com', visitorName: '<script>alert(1)</script>' });
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);

    const emails = callsTo(fetchMock, 'api.resend.com');
    expect(emails).toHaveLength(1);
    const payload = JSON.parse(String((emails[0]![1] as RequestInit).body)) as { html: string };
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;script&gt;');
  });

  it('booking still succeeds when the email send throws', async () => {
    const { env, db } = makeEnv({ email: true });
    seedAll(db);
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('api.resend.com')) throw new Error('resend down');
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { res, pending } = await doBook(env, { email: 'ama@example.com' });
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as any;
    expect(json.data.reference_code).toBeTruthy();
    expect(callsTo(fetchMock, 'api.resend.com')).toHaveLength(1);
  });

  it('sends no email when the visitor gave none', async () => {
    const { env, db } = makeEnv({ email: true });
    seedAll(db);
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);
    expect(callsTo(fetchMock, 'api.resend.com')).toHaveLength(0);
  });
});

/* ---------- Feature A: visit-link confirmation carries the pending state ---------- */

describe('Telegram /start visit-link — pending-approval confirmation', () => {
  it('includes officer, date, slot and the pending-approval line, all escaped', async () => {
    const { env, store, db } = makeEnv();
    seedAll(db);
    seedAppointment(db);
    db.prepare("UPDATE officers SET name = 'Dr. <b>Mensah</b>' WHERE id = 'o1'").run();
    store.set('visit-link:tok123', 'a1');
    const fetchMock = stubFetch();

    const res = await makePublicApp().request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { chat: { id: 999 }, text: '/start tok123' } }),
    }, env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-visitor:a1')).toBe('999');

    const sends = callsTo(fetchMock, 'sendMessage');
    expect(sends).toHaveLength(1);
    const text = String((sends[0]![1] as RequestInit).body);
    expect(text).toContain('pending approval');
    expect(text).toContain(tomorrowStr());
    expect(text).toContain('09:00');
    expect(text).toContain('Dr. &lt;b&gt;Mensah&lt;/b&gt;');
    expect(text).not.toContain('<b>Mensah</b>');
  });
});

/* ---------- Feature B: receiver fanout ---------- */

describe('POST /appointments/public/book — directorate receiver fanout', () => {
  it("notifies the host directorate's receiver in-app + Telegram with the same request content", async () => {
    const { env, db } = makeEnv();
    seedAll(db);
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);

    const notif = db.prepare(
      "SELECT type, title, body FROM notifications WHERE user_id = 'u3'"
    ).get() as { type: string; title: string; body: string } | null;
    expect(notif).toBeTruthy();
    expect(notif!.type).toBe('appointment_request');
    expect(notif!.title).toBe('New appointment request');
    expect(notif!.body).toContain('Ama Serwaa');
    expect(notif!.body).toContain('Dr. Mensah');

    const chats = telegramChats(fetchMock);
    expect(chats).toContain('888');
    const toReceiver = callsTo(fetchMock, 'sendMessage').filter((call) =>
      String(JSON.parse(String((call[1] as RequestInit).body)).chat_id) === '888');
    expect(String((toReceiver[0]![1] as RequestInit).body)).toContain('New Appointment Request');
  });

  it('does not notify receivers of a different directorate', async () => {
    const { env, db } = makeEnv();
    seedAll(db);
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);

    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u4'").get()).toEqual({ n: 0 });
    expect(telegramChats(fetchMock)).not.toContain('999');
  });

  it('a person who is both approver and receiver gets exactly one of each channel', async () => {
    const { env, db } = makeEnv();
    seedAll(db);
    // o4 is a d1 receiver whose account IS the approver u1 (same email + chat).
    db.prepare("INSERT INTO officers (id, name, title, email, telegram_chat_id, directorate_id, is_available) VALUES ('o4', 'Ama Approver', 'Receptionist', 'del@ohcs.gov.gh', '555', 'd1', 1)").run();
    db.prepare("INSERT INTO directorate_receivers (directorate_id, officer_id) VALUES ('d1', 'o4')").run();
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);

    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u1'").get()).toEqual({ n: 1 });
    const chats = telegramChats(fetchMock);
    expect(chats.filter((c) => c === '555')).toHaveLength(1);
  });

  it('no receivers configured → booking + approver notification still work', async () => {
    const { env, db } = makeEnv();
    seedAll(db);
    db.prepare('DELETE FROM directorate_receivers').run();
    const fetchMock = stubFetch();

    const { res, pending } = await doBook(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(201);

    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u1'").get()).toEqual({ n: 1 });
    expect(telegramChats(fetchMock)).toEqual(['555']);
  });
});
