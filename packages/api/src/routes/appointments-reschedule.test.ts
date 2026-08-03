/**
 * Appointment reschedule proposals (spec 2026-08-03, §6):
 *
 * - /book response gains telegram_link_url when the bot username is configured
 *   (KV visit-link:<token> → appointmentId, 24h TTL).
 * - /start <token> visit-link branch binds telegram-visitor:<appointmentId> →
 *   chatId, consumes the one-time token, confirms naming the officer; unknown
 *   tokens fall through to the greeting.
 * - PATCH /appointments/admin/:id/propose — role gates, validation (future
 *   date, slot format), pending-only state guard; Telegram keyboard when the
 *   visitor is linked, email with public respond links when not; approver
 *   in-app notification.
 * - Telegram appt-respond callback — first-response-wins accept/decline with
 *   QR photo on accept; approver notified; unauthorized tappers refused.
 * - GET /appointments/public/respond/:code/:action — same transitions keyed by
 *   ref code, branded HTML outcome pages, friendly 404 for unknown codes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { appointmentsPublicRoutes } from './appointments-public';
import { appointmentsAdminRoutes } from './appointments-admin';
import { telegramWebhook } from './telegram';
import type { Env, SessionData } from '../types';

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
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT,
      visit_id TEXT, created_at TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (same pattern as appointments-public.test.ts);
// run() must report meta.changes — the guarded first-response-wins UPDATEs key on it.
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

function makeEnv(opts: { botUsername?: string | null; email?: boolean } = {}) {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_BOT_USERNAME: opts.botUsername === undefined ? 'ohcsbot' : opts.botUsername,
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

const adminSession: SessionData = { userId: 'u2', email: 'admin@ohcs.gov.gh', role: 'admin', name: 'Admin Ama' };
const approverSession: SessionData = { userId: 'u1', email: 'del@ohcs.gov.gh', role: 'staff', name: 'Del Gate' };
const outsiderSession: SessionData = { userId: 'u9', email: 'x@ohcs.gov.gh', role: 'staff', name: 'X Y' };

function makeAdminApp(session: SessionData = adminSession) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/admin/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/admin', appointmentsAdminRoutes);
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function yesterdayStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function seedOfficer(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, abbreviation, floor, wing) VALUES ('d1', 'RSIMD', 'RSIMD', '1', 'A')").run();
  db.prepare("INSERT INTO officers (id, name, title, telegram_chat_id, directorate_id, is_available) VALUES ('o1', 'Dr. Mensah', 'Director', '777', 'd1', 1)").run();
  db.prepare("INSERT INTO bookable_officers (id, officer_id, slot_start_time, slot_end_time, slot_duration_mins, advance_days_min, advance_days_max, is_active) VALUES ('bo1', 'o1', '09:00', '10:00', 30, 0, 30, 1)").run();
  db.prepare("INSERT INTO users (id, name, email, telegram_chat_id, role) VALUES ('u1', 'Ama Approver', 'del@ohcs.gov.gh', '555', 'staff')").run();
  db.prepare("INSERT INTO users (id, name, email, role) VALUES ('u2', 'Admin Ama', 'admin@ohcs.gov.gh', 'admin')").run();
  db.prepare("INSERT INTO appointment_approvers (id, officer_id, user_id) VALUES ('aa1', 'o1', 'u1')").run();
}

function seedAppointment(
  db: SqliteDb,
  opts: { id?: string; ref?: string; status?: string; email?: string | null; proposedDate?: string | null; proposedSlot?: string | null } = {},
) {
  db.prepare(
    `INSERT INTO appointments (id, officer_id, reference_code, appointment_date, time_slot,
       visitor_name, visitor_phone, visitor_email, organisation, purpose, status,
       proposed_date, proposed_time_slot, created_at, updated_at)
     VALUES (?, 'o1', ?, ?, '09:00', 'Ama Serwaa', '0244123456', ?, NULL, 'Meeting', ?, ?, ?, '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')`
  ).run(
    opts.id ?? 'a1',
    opts.ref ?? 'ABC234',
    tomorrowStr(),
    opts.email ?? null,
    opts.status ?? 'pending',
    opts.proposedDate ?? null,
    opts.proposedSlot ?? null,
  );
}

function proposeBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ proposed_date: tomorrowStr(), proposed_time_slot: '09:30', ...overrides });
}

async function doPropose(
  env: Env,
  opts: { id?: string; body?: string; session?: SessionData } = {},
) {
  const { ctx, pending } = makeExecCtx();
  const res = await makeAdminApp(opts.session ?? adminSession).request(`/admin/${opts.id ?? 'a1'}/propose`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ?? proposeBody(),
  }, env, ctx);
  return { res, pending };
}

/* ---------- /book — telegram_link_url ---------- */

describe('POST /appointments/public/book — telegram_link_url', () => {
  async function doBook(env: Env) {
    const res = await makePublicApp().request('/appt/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        officer_id: 'o1',
        appointment_date: todayStr(),
        time_slot: '09:00',
        visitor_name: 'Ama Serwaa',
        visitor_phone: '0244123456',
        purpose: 'Discuss the quarterly report',
      }),
    }, env);
    return res;
  }

  it('includes a t.me deep link and stores the one-time visit-link token', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    stubFetch();

    const res = await doBook(env);
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as any;
    expect(json.data.telegram_link_url).toMatch(/^https:\/\/t\.me\/ohcsbot\?start=[0-9a-f]{32}$/);

    const token = String(json.data.telegram_link_url).split('start=')[1]!;
    const appointmentId = store.get(`visit-link:${token}`);
    expect(appointmentId).toBeTruthy();
    expect(db.prepare('SELECT id FROM appointments WHERE id = ?').get(appointmentId)).toBeTruthy();
  });

  it('omits the link when the bot username is unset or still the placeholder', async () => {
    for (const botUsername of [null, 'REPLACE_WITH_BOT_USERNAME']) {
      const { env, db } = makeEnv({ botUsername });
      seedOfficer(db);
      stubFetch();
      const res = await doBook(env);
      expect(res.status).toBe(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = await res.json() as any;
      expect(json.data.telegram_link_url ?? null).toBeNull();
    }
  });
});

/* ---------- /start visit-link branch ---------- */

describe('Telegram /start — visit-link branch', () => {
  it('binds telegram-visitor:<appointmentId> to the chat, consumes the token, confirms naming the officer', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    store.set('visit-link:tok123', 'a1');
    const fetchMock = stubFetch();

    const res = await makePublicApp().request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { chat: { id: 999 }, text: '/start tok123' } }),
    }, env);
    expect(res.status).toBe(200);

    expect(store.get('telegram-visitor:a1')).toBe('999');
    expect(store.get('visit-link:tok123')).toBeUndefined();

    const sends = callsTo(fetchMock, 'sendMessage');
    expect(sends).toHaveLength(1);
    const text = String((sends[0]![1] as RequestInit).body);
    expect(text).toContain('Dr. Mensah');
    expect(text).toContain('appointment');
  });

  it('unknown/expired token falls through to the greeting and binds nothing', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    const fetchMock = stubFetch();

    const res = await makePublicApp().request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { chat: { id: 999 }, text: '/start nope' } }),
    }, env);
    expect(res.status).toBe(200);

    expect(store.get('telegram-visitor:a1')).toBeUndefined();
    const sends = callsTo(fetchMock, 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(String((sends[0]![1] as RequestInit).body)).toContain('OHCS SmartGate Bot');
  });
});

/* ---------- PATCH /admin/:id/propose ---------- */

describe('PATCH /appointments/admin/:id/propose', () => {
  it('403s for a staff user who is not an approver for the officer', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    stubFetch();

    const { res } = await doPropose(env, { session: outsiderSession });
    expect(res.status).toBe(403);
  });

  it('allows an approver delegate (non-admin in appointment_approvers)', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    stubFetch();

    const { res } = await doPropose(env, { session: approverSession });
    expect(res.status).toBe(200);
  });

  it('422s on a past proposed_date and 400s on a malformed slot', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    stubFetch();

    const past = await doPropose(env, { body: proposeBody({ proposed_date: yesterdayStr() }) });
    expect(past.res.status).toBe(422);

    const badSlot = await doPropose(env, { body: proposeBody({ proposed_time_slot: '9am' }) });
    expect(badSlot.res.status).toBe(400);
  });

  it('422s unless the appointment is pending', async () => {
    for (const status of ['confirmed', 'declined', 'cancelled', 'completed', 'reschedule_proposed']) {
      const { env, db } = makeEnv();
      seedOfficer(db);
      seedAppointment(db, { status });
      stubFetch();

      const { res } = await doPropose(env);
      expect(res.status).toBe(422);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(((await res.json()) as any).error.code).toBe('INVALID_STATE');
    }
  });

  it('sets reschedule_proposed + proposed columns and notifies approvers in-app', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    stubFetch();

    const { res, pending } = await doPropose(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT status, proposed_date, proposed_time_slot FROM appointments WHERE id = ?').get('a1') as Record<string, unknown>;
    expect(row.status).toBe('reschedule_proposed');
    expect(row.proposed_date).toBe(tomorrowStr());
    expect(row.proposed_time_slot).toBe('09:30');

    const notif = db.prepare("SELECT type, body FROM notifications WHERE user_id = 'u1'").get() as { type: string; body: string };
    expect(notif).toBeTruthy();
    expect(notif.body).toContain('09:30');
  });

  it('sends the Telegram inline keyboard when the visitor is linked', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    store.set('telegram-visitor:a1', '999');
    const fetchMock = stubFetch();

    const { res } = await doPropose(env);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((await res.json()) as any).data.delivered_via).toBe('telegram');

    const sends = callsTo(fetchMock, 'sendMessage');
    expect(sends).toHaveLength(1);
    const payload = JSON.parse(String((sends[0]![1] as RequestInit).body)) as {
      chat_id: string;
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(String(payload.chat_id)).toBe('999');
    const buttons = payload.reply_markup.inline_keyboard[0]!;
    expect(buttons.map((b) => b.callback_data)).toEqual(['appt-respond:a1:accept', 'appt-respond:a1:decline']);
  });

  it('emails the two public respond links when the visitor is not linked', async () => {
    const { env, db } = makeEnv({ email: true });
    seedOfficer(db);
    seedAppointment(db, { email: 'ama@example.com' });
    const fetchMock = stubFetch();

    const { res, pending } = await doPropose(env);
    await Promise.allSettled(pending);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((await res.json()) as any).data.delivered_via).toBe('email');

    const emails = callsTo(fetchMock, 'api.resend.com');
    expect(emails).toHaveLength(1);
    const body = JSON.parse(String((emails[0]![1] as RequestInit).body)) as { to: string[]; html: string };
    expect(body.to).toEqual(['ama@example.com']);
    expect(body.html).toContain('/api/appointments/public/respond/ABC234/accept');
    expect(body.html).toContain('/api/appointments/public/respond/ABC234/decline');
  });
});

/* ---------- Telegram appt-respond callback ---------- */

function callbackUpdate(data: string, fromId = 999) {
  return JSON.stringify({
    callback_query: {
      id: 'cb1',
      from: { id: fromId },
      data,
      message: { message_id: 5, chat: { id: 999 }, text: 'proposal' },
    },
  });
}

async function doCallback(env: Env, data: string, fromId = 999) {
  return makePublicApp().request('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: callbackUpdate(data, fromId),
  }, env);
}

describe('Telegram appt-respond callback — accept', () => {
  it('confirms on the proposed slot, messages the visitor, attempts the QR photo, notifies the approver', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    store.set('telegram-visitor:a1', '999');
    const fetchMock = stubFetch();

    const res = await doCallback(env, 'appt-respond:a1:accept');
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT status, appointment_date, time_slot, proposed_date, proposed_time_slot FROM appointments WHERE id = ?').get('a1') as Record<string, unknown>;
    expect(row.status).toBe('confirmed');
    expect(row.appointment_date).toBe(tomorrowStr());
    expect(row.time_slot).toBe('09:30');
    expect(row.proposed_date).toBeNull();
    expect(row.proposed_time_slot).toBeNull();

    // Every callback is answered.
    expect(callsTo(fetchMock, 'answerCallbackQuery')).toHaveLength(1);

    // Visitor confirmation carries the ref code; a QR photo send was attempted.
    const sends = callsTo(fetchMock, 'sendMessage');
    const toVisitor = sends.filter((call) => {
      const p = JSON.parse(String((call[1] as RequestInit).body)) as { chat_id: string; text: string };
      return String(p.chat_id) === '999';
    });
    expect(toVisitor.length).toBeGreaterThanOrEqual(1);
    expect(String((toVisitor[0]![1] as RequestInit).body)).toContain('ABC234');
    expect(callsTo(fetchMock, 'sendPhoto')).toHaveLength(1);

    // Approver notified in-app + telegram.
    const notif = db.prepare("SELECT type FROM notifications WHERE user_id = 'u1'").get() as { type: string } | null;
    expect(notif).toBeTruthy();
    const toApprover = sends.filter((call) => String(JSON.parse(String((call[1] as RequestInit).body)).chat_id) === '555');
    expect(toApprover).toHaveLength(1);
  });

  it('first response wins — a replay answers "already handled" and changes nothing', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    store.set('telegram-visitor:a1', '999');
    const fetchMock = stubFetch();

    await doCallback(env, 'appt-respond:a1:accept');
    const res2 = await doCallback(env, 'appt-respond:a1:decline');
    expect(res2.status).toBe(200);

    const row = db.prepare('SELECT status FROM appointments WHERE id = ?').get('a1') as { status: string };
    expect(row.status).toBe('confirmed');

    const answers = callsTo(fetchMock, 'answerCallbackQuery');
    expect(answers).toHaveLength(2);
    expect(String((answers[1]![1] as RequestInit).body)).toContain('lready');
  });

  it('accept from a non-proposed status answers "already handled"', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'pending' });
    store.set('telegram-visitor:a1', '999');
    const fetchMock = stubFetch();

    const res = await doCallback(env, 'appt-respond:a1:accept');
    expect(res.status).toBe(200);
    const answers = callsTo(fetchMock, 'answerCallbackQuery');
    expect(answers).toHaveLength(1);
    expect(String((answers[0]![1] as RequestInit).body)).toContain('lready');
    expect((db.prepare('SELECT status FROM appointments WHERE id = ?').get('a1') as { status: string }).status).toBe('pending');
  });

  it('refuses a tap from a chat that is not the linked visitor', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    store.set('telegram-visitor:a1', '999');
    stubFetch();

    const res = await doCallback(env, 'appt-respond:a1:accept', 555);
    expect(res.status).toBe(200);
    expect((db.prepare('SELECT status FROM appointments WHERE id = ?').get('a1') as { status: string }).status).toBe('reschedule_proposed');
  });
});

describe('Telegram appt-respond callback — decline', () => {
  it('closes terminally with a rebook link for the visitor and notifies the approver', async () => {
    const { env, store, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    store.set('telegram-visitor:a1', '999');
    const fetchMock = stubFetch();

    const res = await doCallback(env, 'appt-respond:a1:decline');
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT status, decline_reason FROM appointments WHERE id = ?').get('a1') as Record<string, unknown>;
    expect(row.status).toBe('declined');
    expect(row.decline_reason).toBe('visitor declined proposed time');

    const sends = callsTo(fetchMock, 'sendMessage');
    const toVisitor = sends.filter((call) => String(JSON.parse(String((call[1] as RequestInit).body)).chat_id) === '999');
    expect(toVisitor).toHaveLength(1);
    expect(String((toVisitor[0]![1] as RequestInit).body)).toContain('/book');

    const toApprover = sends.filter((call) => String(JSON.parse(String((call[1] as RequestInit).body)).chat_id) === '555');
    expect(toApprover).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u1'").get() as { n: number }).toEqual({ n: 1 });
  });
});

/* ---------- GET /public/respond/:code/:action ---------- */

describe('GET /appointments/public/respond/:code/:action', () => {
  it('accept confirms on the proposed slot and returns a branded HTML page', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    stubFetch();

    const res = await makePublicApp().request('/appt/respond/ABC234/accept', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('ABC234');
    expect(html).toContain('09:30');

    const row = db.prepare('SELECT status, appointment_date, time_slot FROM appointments WHERE id = ?').get('a1') as Record<string, unknown>;
    expect(row.status).toBe('confirmed');
    expect(row.appointment_date).toBe(tomorrowStr());
    expect(row.time_slot).toBe('09:30');
  });

  it('decline closes the appointment and returns a rebook page', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    stubFetch();

    const res = await makePublicApp().request('/appt/respond/ABC234/decline', {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/book');

    const row = db.prepare('SELECT status, decline_reason FROM appointments WHERE id = ?').get('a1') as Record<string, unknown>;
    expect(row.status).toBe('declined');
    expect(row.decline_reason).toBe('visitor declined proposed time');
  });

  it('a replay returns the already-handled page instead of re-transitioning', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    stubFetch();

    await makePublicApp().request('/appt/respond/ABC234/accept', {}, env);
    const res2 = await makePublicApp().request('/appt/respond/ABC234/decline', {}, env);
    expect(res2.status).toBe(200);
    expect(await res2.text()).toContain('already');
    expect((db.prepare('SELECT status FROM appointments WHERE id = ?').get('a1') as { status: string }).status).toBe('confirmed');
  });

  it('unknown code returns a friendly 404 page', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    stubFetch();

    const res = await makePublicApp().request('/appt/respond/ZZZ999/accept', {}, env);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).not.toContain('ZZZ999'); // no reflection of the guessed code
  });

  it('escapes visitor-controlled values in the outcome page', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'reschedule_proposed', proposedDate: tomorrowStr(), proposedSlot: '09:30' });
    db.prepare("UPDATE appointments SET visitor_name = '<script>alert(1)</script>' WHERE id = 'a1'").run();
    stubFetch();

    const res = await makePublicApp().request('/appt/respond/ABC234/accept', {}, env);
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
