/**
 * Telegram HTML-injection guard for public appointment flows (audit fix,
 * 2026-08-01). A public booker controls visitor_name; sendTelegramMessage
 * uses parse_mode HTML, so every interpolated value in the booking and
 * arrival notifications must be HTML-escaped at the Telegram boundary.
 * The in-app notification rows keep the raw text (React escapes there).
 *
 * Second suite (Commit F, 2026-08-01): /arrive joins the visits pipeline —
 * it creates a `visits` row via the same performCheckIn service the kiosk
 * walk-in path uses, so appointment visitors appear in /visits/active, the
 * visit log, reports, the SLA cron, the checkout sweep and the evacuation
 * roll, and can be checked out like any other visit. The host arrival alert
 * goes through the canonical notifyOnCheckIn fanout (with action buttons),
 * replacing the ad-hoc Telegram text the handler used to send.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { appointmentsPublicRoutes, findOrCreateAppointmentVisitor } from './appointments-public';
import { checkOutById } from '../services/check-out';
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
    CREATE TABLE directorates (id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT, floor TEXT, wing TEXT);
    CREATE TABLE officers (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, email TEXT, telegram_chat_id TEXT,
      directorate_id TEXT, is_available INTEGER DEFAULT 1, availability_status TEXT
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
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, telegram_chat_id TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE appointment_approvers (officer_id TEXT, user_id TEXT);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT,
      visit_id TEXT, created_at TEXT
    );
    CREATE TABLE visitors (
      id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      phone TEXT, email TEXT, organisation TEXT, photo_url TEXT, flag TEXT,
      total_visits INTEGER NOT NULL DEFAULT 0, last_visit_at TEXT,
      idempotency_key TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_visitors_idem_unique ON visitors(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE visits (
      id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, host_officer_id TEXT,
      host_name_manual TEXT, directorate_id TEXT, purpose_raw TEXT, purpose_category TEXT,
      badge_code TEXT, checkout_pin TEXT, status TEXT NOT NULL DEFAULT 'checked_in',
      check_in_source TEXT NOT NULL DEFAULT 'staff', notes TEXT, id_photo_check TEXT,
      created_by TEXT, idempotency_key TEXT, party_size INTEGER, party_names TEXT,
      check_in_at TEXT, check_out_at TEXT, duration_minutes INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_visits_idem_unique ON visits(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE directorate_receivers (directorate_id TEXT, officer_id TEXT);
    CREATE TABLE push_subscriptions (user_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT);
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (same pattern as telegram.test.ts), plus
// batch (performCheckIn inserts visit + bumps the visitor counter atomically).
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
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
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

// performCheckIn fires classify + host notification via ctx.waitUntil — a
// collecting fake lets tests await those background promises explicitly.
function makeExecCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, pending };
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

// Parse the JSON bodies posted to the Telegram Bot API.
function sentPayloads(fetchMock: ReturnType<typeof vi.fn>): Array<{ chat_id?: string | number; text?: string }> {
  return sentTexts(fetchMock).map((b) => JSON.parse(b) as { chat_id?: string | number; text?: string });
}

const INJECTION = '<a href="https://evil">x</a>';
const ESCAPED = '&lt;a href=&quot;https://evil&quot;&gt;x&lt;/a&gt;';

function seedOfficer(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, abbreviation, floor, wing) VALUES ('d1', 'RSIMD', 'RSIMD', '1', 'A')").run();
  db.prepare("INSERT INTO officers (id, name, title, telegram_chat_id, directorate_id, is_available) VALUES ('o1', 'Dr. Mensah', 'Director', '777', 'd1', 1)").run();
  db.prepare("INSERT INTO bookable_officers (id, officer_id, slot_start_time, slot_end_time, slot_duration_mins, advance_days_min, advance_days_max, is_active) VALUES ('bo1', 'o1', '09:00', '10:00', 30, 0, 30, 1)").run();
  db.prepare("INSERT INTO users (id, name, telegram_chat_id) VALUES ('u1', 'Ama Approver', '555')").run();
  db.prepare("INSERT INTO appointment_approvers (officer_id, user_id) VALUES ('o1', 'u1')").run();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function seedAppointment(
  db: SqliteDb,
  opts: { id?: string; ref?: string; name?: string; phone?: string; purpose?: string; status?: string; date?: string } = {},
) {
  db.prepare(
    `INSERT INTO appointments (id, officer_id, reference_code, appointment_date, time_slot,
       visitor_name, visitor_phone, visitor_email, organisation, purpose, status, created_at, updated_at)
     VALUES (?, 'o1', ?, ?, '09:00', ?, ?, NULL, NULL, ?, ?, '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')`
  ).run(
    opts.id ?? 'a1',
    opts.ref ?? 'ABC234',
    opts.date ?? todayStr(),
    opts.name ?? 'Ama Serwaa',
    opts.phone ?? '0244123456',
    opts.purpose ?? 'Meeting',
    opts.status ?? 'confirmed',
  );
}

interface ArriveResult {
  res: Response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  db: SqliteDb;
  env: Env;
  fetchMock: ReturnType<typeof vi.fn>;
  pending: Promise<unknown>[];
}

async function doArrive(
  seed: Parameters<typeof seedAppointment>[1] = {},
  opts: { ref?: string } = {},
): Promise<ArriveResult> {
  const { env, db } = makeEnv();
  seedOfficer(db);
  seedAppointment(db, seed);
  const fetchMock = stubTelegramFetch();
  const { ctx, pending } = makeExecCtx();

  const res = await makeApp().request('/appt/arrive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference_code: opts.ref ?? seed.ref ?? 'ABC234' }),
  }, env, ctx);
  const json = await res.json();
  return { res, json, db, env, fetchMock, pending };
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

/* ---------- POST /arrive — injection guard ---------- */

describe('POST /appointments-public/arrive — Telegram arrival sends escape visitor_name', () => {
  it('escapes the name in both the host and approver sends', async () => {
    const { res, fetchMock, pending } = await doArrive({ name: INJECTION });
    expect(res.status).toBe(200);
    // The host alert now rides the canonical fanout in waitUntil.
    await Promise.allSettled(pending);

    // One send to the host directly (777) + one to the approver (555).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const text of sentTexts(fetchMock)) {
      expect(text).toContain(ESCAPED);
      expect(text).not.toContain('<a href="https://evil">');
    }
  });
});

/* ---------- POST /arrive — visits pipeline (Commit F) ---------- */

describe('POST /appointments-public/arrive — joins the visits pipeline', () => {
  it('creates a visits row for the arriving visitor (visible to /visits/active semantics)', async () => {
    const { res, json, db, pending } = await doArrive();
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    // The created visit rides the response so the kiosk can show badge + PIN.
    expect(json.data.visit).toBeTruthy();
    expect(String(json.data.visit.badge_code)).toMatch(/^OHCS-/);
    expect(String(json.data.visit.checkout_pin)).toMatch(/^\d{6}$/);

    const visit = db.prepare('SELECT * FROM visits').get() as Record<string, unknown>;
    expect(visit).toBeTruthy();
    expect(visit.host_officer_id).toBe('o1');
    expect(visit.directorate_id).toBe('d1');
    expect(visit.purpose_raw).toBe('Meeting');
    expect(visit.purpose_category).toBe('scheduled_appointment');
    expect(visit.check_in_source).toBe('kiosk');
    expect(visit.status).toBe('checked_in');
    expect(visit.idempotency_key).toBe('appt-arrive:a1');
    expect(visit.check_in_at).toBeTruthy();

    // A visitor row was created from the appointment's free-text fields.
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(visit.visitor_id) as Record<string, unknown>;
    expect(visitor.first_name).toBe('Ama');
    expect(visitor.last_name).toBe('Serwaa');
    expect(visitor.phone).toBe('0244123456');

    // Same WHERE + join semantics as GET /visits/active and the visit log:
    // the appointment visitor is now visible there.
    const active = db.prepare(
      `SELECT v.id, vis.first_name, vis.last_name
       FROM visits v JOIN visitors vis ON v.visitor_id = vis.id
       WHERE v.status = 'checked_in'`
    ).all() as Array<{ id: string; first_name: string }>;
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(visit.id);
  });

  it('links the visit to an existing visitor found by phone (either stored form)', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    db.prepare("INSERT INTO visitors (id, first_name, last_name, phone) VALUES ('v1', 'Ama', 'Serwaa', '+233244123456')").run();
    seedAppointment(db, { phone: '024 412 3456' }); // local form + spaces → same number
    stubTelegramFetch();
    const { ctx, pending } = makeExecCtx();

    const res = await makeApp().request('/appt/arrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_code: 'ABC234' }),
    }, env, ctx);
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    const visit = db.prepare('SELECT visitor_id FROM visits').get() as { visitor_id: string };
    expect(visit.visitor_id).toBe('v1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitors').get() as { n: number }).toEqual({ n: 1 });
  });

  it('a second /arrive for the same appointment does NOT create a second visit', async () => {
    const first = await doArrive();
    expect(first.res.status).toBe(200);
    await Promise.allSettled(first.pending);

    // Retry against the same env/db — the appointment is already completed.
    const fetchMock2 = stubTelegramFetch();
    const { ctx, pending } = makeExecCtx();
    const res2 = await makeApp().request('/appt/arrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_code: 'ABC234' }),
    }, first.env, ctx);
    await Promise.allSettled(pending);

    expect(res2.status).toBe(422);
    const body2 = await res2.json() as { error?: { code?: string } };
    expect(body2.error?.code).toBe('APPT_ALREADY_COMPLETED');
    expect(first.db.prepare('SELECT COUNT(*) AS n FROM visits').get() as { n: number }).toEqual({ n: 1 });
    expect(fetchMock2).not.toHaveBeenCalled();
  });

  it('two CONCURRENT /arrive calls fan out to approvers exactly once (first writer wins)', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    const fetchMock = stubTelegramFetch();
    const { ctx: ctx1, pending: p1 } = makeExecCtx();
    const { ctx: ctx2, pending: p2 } = makeExecCtx();

    // Both requests pass the status check before either flips the appointment —
    // the guarded UPDATE is what decides who notifies.
    const app = makeApp();
    const body = JSON.stringify({ reference_code: 'ABC234' });
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
    const [res1, res2] = await Promise.all([
      app.request('/appt/arrive', init, env, ctx1),
      app.request('/appt/arrive', init, env, ctx2),
    ]);
    await Promise.allSettled([...p1, ...p2]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 422]);
    // The loser gets the already-completed shape — no 500, no partial fan-out.
    const loser = res1.status === 422 ? res1 : res2;
    expect(((await loser.json()) as { error?: { code?: string } }).error?.code).toBe('APPT_ALREADY_COMPLETED');

    const notifs = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'appointment_arrived'").get() as { n: number };
    expect(notifs.n).toBe(1);
    const toApprover = sentPayloads(fetchMock).filter((p) => String(p.chat_id) === '555');
    expect(toApprover).toHaveLength(1);
  });

  it('the evacuation roll semantics (status = checked_in, joined to visitors) include the row', async () => {
    const { res, db, pending } = await doArrive();
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    // Same query shape as buildEvacuationRoll's visitor section (reports.ts).
    const rows = db.prepare(
      `SELECT (vis.first_name || ' ' || vis.last_name) AS name, v.badge_code
       FROM visits v
       JOIN visitors vis ON v.visitor_id = vis.id
       WHERE v.status = 'checked_in'`
    ).all() as Array<{ name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Ama Serwaa');

    const count = db.prepare(
      `SELECT COALESCE(SUM(COALESCE(v.party_size, 1)), 0) AS n FROM visits v WHERE v.status = 'checked_in'`
    ).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('notifies the host through the canonical arrival fanout — single alert, with action keyboard', async () => {
    const { res, fetchMock, pending } = await doArrive();
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    const payloads = sentPayloads(fetchMock);
    const toHost = payloads.filter((p) => String(p.chat_id) === '777');
    // Exactly ONE host alert — the old ad-hoc "is here for your" text is gone.
    expect(toHost).toHaveLength(1);
    expect(toHost[0]!.text).toContain('You have a visitor');
    expect(toHost[0]!.text).not.toContain('is here for your');
    // Canonical host alert carries the arrival-action inline keyboard.
    expect(sentTexts(fetchMock).find((b) => b.includes('"chat_id":"777"') || b.includes('"chat_id":777'))).toContain('reply_markup');

    // The appointment approver still gets their own lifecycle notification.
    const toApprover = payloads.filter((p) => String(p.chat_id) === '555');
    expect(toApprover).toHaveLength(1);
  });

  it('the created visit checks out via checkOutById semantics', async () => {
    const { res, json, db, env, pending } = await doArrive();
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    const visitId = String(json.data.visit.id);
    const out = await checkOutById(env, visitId);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.visit.status).toBe('checked_out');

    const row = db.prepare('SELECT status, check_out_at FROM visits WHERE id = ?').get(visitId) as { status: string; check_out_at: string | null };
    expect(row.status).toBe('checked_out');
    expect(row.check_out_at).toBeTruthy();

    // No longer on the evacuation roll / active list.
    const stillActive = db.prepare("SELECT COUNT(*) AS n FROM visits WHERE status = 'checked_in'").get() as { n: number };
    expect(stillActive.n).toBe(0);
  });
});

/* ---------- findOrCreateAppointmentVisitor — duplicate-insert race ---------- */

describe('findOrCreateAppointmentVisitor — raced concurrent creates dedupe on the appointment key', () => {
  it('two concurrent calls for the same appointment create ONE visitor row and both return it', async () => {
    const { env, db } = makeEnv();
    const appt = {
      visitor_name: 'Ama Serwaa',
      visitor_phone: '0244123456',
      visitor_email: null,
      organisation: null,
    };

    // Both phone lookups resolve (no match) before either INSERT lands — the
    // deterministic idempotency key is what stops the second row.
    const [id1, id2] = await Promise.all([
      findOrCreateAppointmentVisitor(env, appt, 'a1'),
      findOrCreateAppointmentVisitor(env, appt, 'a1'),
    ]);

    expect(id1).toBe(id2);
    const rows = db.prepare('SELECT id, idempotency_key FROM visitors').all() as Array<{ id: string; idempotency_key: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id1);
    expect(rows[0]!.idempotency_key).toBe('appt-visitor:a1');
  });
});
