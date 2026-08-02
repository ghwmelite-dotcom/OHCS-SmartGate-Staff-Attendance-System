/**
 * PATCH /appointments/admin/:id/complete — desk completion joins the visits
 * pipeline (2026-08-02). Previously the route only flipped the appointment
 * status, so a visitor who never went through the kiosk arrival flow left no
 * visits row: invisible to /visits/active, reports, the SLA cron, the
 * checkout sweep and the evacuation roll. Complete now mirrors what
 * /appointments/public/arrive does — find-or-create the visitor and run the
 * canonical performCheckIn with purpose_category='scheduled_appointment' and
 * a deterministic idempotency key — EXCEPT the source is 'staff' (a desk
 * action by reception/admin; check_in_source's union is 'staff'|'kiosk' and
 * 'kiosk' would misattribute it). If the kiosk arrival already created the
 * visit (idempotency key appt-arrive:<id>), complete links the appointment
 * without creating a duplicate.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { appointmentsAdminRoutes } from './appointments-admin';
import { appointmentsPublicRoutes } from './appointments-public';
import type { Env, SessionData } from '../types';

afterEach(() => vi.unstubAllGlobals());

/* ---------- fakes (same node:sqlite D1-shim pattern as appointments-public.test.ts) ---------- */

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
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY, officer_id TEXT, reference_code TEXT, appointment_date TEXT,
      time_slot TEXT, visitor_name TEXT, visitor_phone TEXT, visitor_email TEXT,
      organisation TEXT, purpose TEXT, status TEXT, visit_id TEXT,
      approved_by TEXT, approved_at TEXT, approver_notes TEXT, decline_reason TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, telegram_chat_id TEXT, role TEXT, is_active INTEGER DEFAULT 1,
      directorate_id TEXT, display_role TEXT);
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

const admin: SessionData = { userId: 'admin1', email: 'admin@ohcs.gov.gh', role: 'admin', name: 'Admin' };

function makeApp(session: SessionData = admin) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/admin/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/admin', appointmentsAdminRoutes);
  app.route('/public', appointmentsPublicRoutes);
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

function stubTelegramFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function seedOfficer(db: SqliteDb) {
  db.prepare("INSERT INTO directorates (id, name, abbreviation, floor, wing) VALUES ('d1', 'RSIMD', 'RSIMD', '1', 'A')").run();
  db.prepare("INSERT INTO officers (id, name, title, telegram_chat_id, directorate_id, is_available) VALUES ('o1', 'Dr. Mensah', 'Director', '777', 'd1', 1)").run();
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

/* ---------- PATCH /:id/complete — visits pipeline ---------- */

describe('PATCH /appointments-admin/:id/complete — joins the visits pipeline', () => {
  it('creates a visits row for the appointment visitor and links it', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    stubTelegramFetch();
    const { ctx, pending } = makeExecCtx();

    const res = await makeApp().request('/admin/a1/complete', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, env, ctx);
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    const visit = db.prepare('SELECT * FROM visits').get() as Record<string, unknown>;
    expect(visit).toBeTruthy();
    expect(visit.host_officer_id).toBe('o1');
    expect(visit.directorate_id).toBe('d1');
    expect(visit.purpose_raw).toBe('Meeting');
    expect(visit.purpose_category).toBe('scheduled_appointment');
    expect(visit.idempotency_key).toBe('appt-complete:a1');
    expect(visit.status).toBe('checked_in');
    // Desk action by an admin — 'staff', not 'kiosk'; created_by is the actor.
    expect(visit.check_in_source).toBe('staff');
    expect(visit.created_by).toBe('admin1');
    expect(String(visit.badge_code)).toMatch(/^OHCS-/);

    // A visitor row was created from the appointment's free-text fields.
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(visit.visitor_id) as Record<string, unknown>;
    expect(visitor.first_name).toBe('Ama');
    expect(visitor.last_name).toBe('Serwaa');

    // Appointment is completed and linked to the visit.
    const appt = db.prepare('SELECT status, visit_id FROM appointments WHERE id = ?').get('a1') as { status: string; visit_id: string | null };
    expect(appt.status).toBe('completed');
    expect(appt.visit_id).toBe(visit.id);

    // Visible to /visits/active semantics.
    const active = db.prepare("SELECT COUNT(*) AS n FROM visits WHERE status = 'checked_in'").get() as { n: number };
    expect(active.n).toBe(1);
  });

  it('complete after the kiosk arrival ran creates NO second visit', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db);
    stubTelegramFetch();

    // Simulate the arrive path having already created the visit (the
    // appointment is still 'confirmed' here — the race window between
    // performCheckIn and the status flip in /arrive).
    db.prepare(
      `INSERT INTO visitors (id, first_name, last_name, phone) VALUES ('v1', 'Ama', 'Serwaa', '0244123456')`
    ).run();
    db.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, directorate_id, purpose_raw, purpose_category,
         badge_code, checkout_pin, status, check_in_source, idempotency_key, check_in_at)
       VALUES ('visit-arrive', 'v1', 'o1', 'd1', 'Meeting', 'scheduled_appointment',
         'OHCS-TEST', '123456', 'checked_in', 'kiosk', 'appt-arrive:a1', '2026-08-02T09:00:00Z')`
    ).run();

    const { ctx, pending } = makeExecCtx();
    const res = await makeApp().request('/admin/a1/complete', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, env, ctx);
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);

    expect(db.prepare('SELECT COUNT(*) AS n FROM visits').get() as { n: number }).toEqual({ n: 1 });
    const appt = db.prepare('SELECT status, visit_id FROM appointments WHERE id = ?').get('a1') as { status: string; visit_id: string | null };
    expect(appt.status).toBe('completed');
    expect(appt.visit_id).toBe('visit-arrive');
  });

  it('rejects a non-confirmed appointment without creating a visit', async () => {
    const { env, db } = makeEnv();
    seedOfficer(db);
    seedAppointment(db, { status: 'pending' });
    stubTelegramFetch();
    const { ctx, pending } = makeExecCtx();

    const res = await makeApp().request('/admin/a1/complete', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, env, ctx);
    await Promise.allSettled(pending);

    expect(res.status).toBe(422);
    expect(db.prepare('SELECT COUNT(*) AS n FROM visits').get() as { n: number }).toEqual({ n: 0 });
  });
});

/* ---------- GET / — director/oversight read scope, fail-closed staff (plan 2026-08-03) ---------- */

describe('GET /appointments-admin — read scope for director + oversight roles', () => {
  interface ListBody { data: { appointments: Array<{ id: string; officer_id: string }>; total: number } }

  function seedScopeFixtures(db: SqliteDb) {
    // Entity one: d1/o1/a1 (existing helpers); entity two: d2/o2/a2.
    seedOfficer(db);
    db.prepare("INSERT INTO directorates (id, name, abbreviation, floor, wing) VALUES ('d2', 'PMD', 'PMD', '2', 'B')").run();
    db.prepare("INSERT INTO officers (id, name, title, telegram_chat_id, directorate_id, is_available) VALUES ('o2', 'Ms. Owusu', 'Director', NULL, 'd2', 1)").run();
    seedAppointment(db, { id: 'a1', ref: 'AAA111' });
    db.prepare(
      `INSERT INTO appointments (id, officer_id, reference_code, appointment_date, time_slot,
         visitor_name, visitor_phone, visitor_email, organisation, purpose, status, created_at, updated_at)
       VALUES ('a2', 'o2', 'BBB222', ?, '10:00', 'Kofi Boateng', '0244999888', NULL, NULL, 'Review', 'confirmed',
               '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')`
    ).run(todayStr());
    // Users the scope resolver / gates read.
    db.prepare("INSERT INTO users (id, name, email, role, directorate_id, display_role) VALUES ('dir1', 'Director One', 'dir1@ohcs.gov.gh', 'director', 'd1', NULL)").run();
    db.prepare("INSERT INTO users (id, name, email, role, directorate_id, display_role) VALUES ('dir_no', 'Director None', 'dirn@ohcs.gov.gh', 'director', NULL, NULL)").run();
    db.prepare("INSERT INTO users (id, name, email, role, directorate_id, display_role) VALUES ('cd1', 'Chief Director', 'cd@ohcs.gov.gh', 'director', 'd1', 'chief_director')").run();
    db.prepare("INSERT INTO users (id, name, email, role, directorate_id, display_role) VALUES ('hos1', 'Head of Service', 'hos@ohcs.gov.gh', 'director', NULL, 'head_of_service')").run();
    db.prepare("INSERT INTO users (id, name, email, role, directorate_id, display_role) VALUES ('staff_plain', 'Plain Staff', 'sp@ohcs.gov.gh', 'staff', NULL, NULL)").run();
    db.prepare("INSERT INTO users (id, name, email, role, directorate_id, display_role) VALUES ('staff_appr', 'Approver Staff', 'sa@ohcs.gov.gh', 'staff', NULL, NULL)").run();
    db.prepare("INSERT INTO appointment_approvers (officer_id, user_id) VALUES ('o1', 'staff_appr')").run();
  }

  const sess = (userId: string, role: string, directorate_abbr: string | null = null): SessionData =>
    ({ userId, email: `${userId}@ohcs.gov.gh`, role, name: `User ${userId}`, directorate_abbr } as SessionData);

  const list = (env: Env, session: SessionData, qs = '') =>
    makeApp(session).request(`/admin${qs}`, { method: 'GET' }, env);

  it('director sees only their own entity — a client-passed officer_id filter is beaten', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);
    const session = sess('dir1', 'director');

    const all = await list(env, session);
    expect(all.status).toBe(200);
    const allBody = await all.json() as ListBody;
    expect(allBody.data.appointments.map((a) => a.id)).toEqual(['a1']);
    expect(allBody.data.total).toBe(1);

    // Asking for the OTHER entity's officer yields nothing (scope is forced,
    // not a default the client can override).
    const beaten = await list(env, session, '?officer_id=o2');
    expect(beaten.status).toBe(200);
    const beatenBody = await beaten.json() as ListBody;
    expect(beatenBody.data.appointments).toEqual([]);
    expect(beatenBody.data.total).toBe(0);
  });

  it('director with no linked entity 403s (fail-closed sentinel)', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);
    const res = await list(env, sess('dir_no', 'director'));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('oversight display roles (chief director / head of service) see all entities', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);

    for (const userId of ['cd1', 'hos1']) {
      const res = await list(env, sess(userId, 'director'));
      expect(res.status).toBe(200);
      const body = await res.json() as ListBody;
      expect(body.data.appointments.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
      expect(body.data.total).toBe(2);
    }
  });

  it('plain staff (not an approver) 403s', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);
    const res = await list(env, sess('staff_plain', 'staff'));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('staff who IS an appointment approver keeps approver-scoped visibility', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);
    const res = await list(env, sess('staff_appr', 'staff'));
    expect(res.status).toBe(200);
    const body = await res.json() as ListBody;
    expect(body.data.appointments.map((a) => a.id)).toEqual(['a1']);
  });

  it('RCU staff reads all appointments (effective reception tier)', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);
    const res = await list(env, sess('staff_plain', 'staff', 'RCU'));
    expect(res.status).toBe(200);
    const body = await res.json() as ListBody;
    expect(body.data.appointments.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('receptionist and admin remain unscoped', async () => {
    const { env, db } = makeEnv();
    seedScopeFixtures(db);
    for (const role of ['receptionist', 'admin', 'superadmin']) {
      const res = await list(env, sess('admin1', role));
      expect(res.status).toBe(200);
      const body = await res.json() as ListBody;
      expect(body.data.total).toBe(2);
    }
  });
});
