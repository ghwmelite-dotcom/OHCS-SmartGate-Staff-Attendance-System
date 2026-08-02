/**
 * Absence notice premium tests (spec: docs/superpowers/specs/2026-08-02-absence-notice-premium-design.md;
 * plan: docs/superpowers/plans/2026-08-02-absence-notice-premium.md, Tasks 1 & 3).
 *
 * Route-level (real attendanceRoutes + adminDirectorateRoutes over the node:sqlite
 * D1 shim, pattern from attendance.test.ts / admin-settings.test.ts):
 *   - POST /absence-notice validation matrix: note required (trimmed, min 2),
 *     expected_return_date required, strictly after today, <= today + 30 days.
 *   - Upsert: re-submitting the same day updates the row instead of duplicating.
 *   - DELETE /absence-notice/today: 200 {deleted:true} then 404; GET today empties.
 *   - Audit rows: absence.submit / absence.update / absence.retract.
 *   - PUT /admin-directorates/:id head_officer_id: officer must belong to the
 *     entity; GET / exposes head_officer_id + head_name (LEFT JOIN officers).
 *
 * Unit-level (sendAbsenceNoticePush with stubbed fetch for Telegram):
 *   - Resolution chain head → director-role users → superadmins; submitter
 *     excluded at every step; an unreachable head falls through.
 *   - Message carries reason label ('other' → "Other"), note, return date;
 *     Telegram variant is HTML-escaped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { attendanceRoutes } from './attendance';
import { adminDirectorateRoutes } from './admin-directorates';
import { sendAbsenceNoticePush, type AbsenceNoticeInput } from '../services/reminders';
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
const TODAY = '2026-08-03';
const TOMORROW = '2026-08-04';
const BACK = '2026-08-05';              // Wednesday
const MAX_RETURN = '2026-09-02';        // today + 30 days
const PAST_MAX_RETURN = '2026-09-03';   // today + 31 days

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE directorates (
      id TEXT PRIMARY KEY, name TEXT, abbreviation TEXT, type TEXT, org_type TEXT,
      rooms TEXT, floor TEXT, wing TEXT,
      head_officer_id TEXT, reception_officer_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE officers (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, directorate_id TEXT,
      email TEXT, phone TEXT, staff_id TEXT, telegram_chat_id TEXT,
      is_available INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, staff_id TEXT,
      role TEXT DEFAULT 'staff', is_active INTEGER NOT NULL DEFAULT 1,
      directorate_id TEXT
    );
    CREATE TABLE absence_notices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL, note TEXT,
      notice_date TEXT NOT NULL, expected_return_date TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT, visit_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT, p256dh TEXT, auth TEXT
    );
    CREATE TABLE audit_log (
      id TEXT, seq INTEGER, at TEXT, actor_user_id TEXT, actor_role TEXT, actor_label TEXT,
      action TEXT, entity_type TEXT, entity_id TEXT, summary TEXT, changes TEXT, ip TEXT,
      prev_hash TEXT, hash TEXT
    );
  `);
  return db;
}

function d1(db: SqliteDb) {
  const stmt = (sql: string, params: unknown[]) => ({
    first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => {
      const r = db.prepare(sql).run(...params) as { changes: number | bigint };
      return { success: true, meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare(sql: string) {
      return { ...stmt(sql, []), bind(...params: unknown[]) { return stmt(sql, params); } };
    },
  };
}

/**
 * Fixture:
 *   dir1 — head officer o_head (staff-linked to u_headuser, telegram chat123);
 *          u_sub staff submitter, u_dir director, o_unreachable ghost head,
 *          o_selfhead linked to the SUBMITTER's own account.
 *   dir2 — o_other (officer of another entity, for PUT validation).
 *   dir3 — u_sub3 with no head/director coverage.
 *   u_super — the superadmin fallback.
 */
function seed(db: SqliteDb) {
  const insDir = db.prepare(
    "INSERT INTO directorates (id, name, abbreviation, type, head_officer_id) VALUES (?, ?, ?, 'directorate', ?)",
  );
  insDir.run('dir1', 'Records', 'RSIMD', 'o_head');
  insDir.run('dir2', 'Finance', 'FIN', null);
  insDir.run('dir3', 'Lonely Unit', 'LNU', null);

  const insOfficer = db.prepare(
    'INSERT INTO officers (id, name, directorate_id, email, staff_id, telegram_chat_id) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insOfficer.run('o_head', 'Head Officer', 'dir1', null, 'S200', 'chat123');
  insOfficer.run('o_unreachable', 'Ghost Head', 'dir1', null, null, null);
  insOfficer.run('o_selfhead', 'Self Head', 'dir1', null, 'S100', null);
  insOfficer.run('o_other', 'Other Officer', 'dir2', null, null, null);

  const insUser = db.prepare(
    'INSERT INTO users (id, name, email, staff_id, role, directorate_id) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insUser.run('u_sub', 'Kofi Away', 'kofi@ohcs.gov.gh', 'S100', 'staff', 'dir1');
  insUser.run('u_headuser', 'Ama Head', 'ama@ohcs.gov.gh', 'S200', 'staff', 'dir1');
  insUser.run('u_dir', 'Director Danso', 'dir@ohcs.gov.gh', 'S300', 'director', 'dir1');
  insUser.run('u_sub3', 'No Coverage', 'solo@ohcs.gov.gh', 'S400', 'staff', 'dir3');
  insUser.run('u_super', 'Super Admin', 'super@ohcs.gov.gh', null, 'superadmin', null);
}

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  seed(db);
  const env = {
    ENVIRONMENT: 'test',
    TELEGRAM_BOT_TOKEN: 'test-token',
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
  return { env, db, store };
}

const staff: SessionData = { userId: 'u_sub', email: 'kofi@ohcs.gov.gh', role: 'staff', name: 'Kofi Away' };
const superadmin: SessionData = { userId: 'u_super', email: 'super@ohcs.gov.gh', role: 'superadmin', name: 'Super Admin' };

// Swallow waitUntil rejections (the fire-and-forget absence push) — side effects
// under test are exercised directly via sendAbsenceNoticePush below.
const FAKE_EXEC_CTX = { waitUntil: (p: Promise<unknown>) => { p?.catch?.(() => {}); }, passThroughOnException: () => {} };

function attendanceApp(session: SessionData = staff) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/a/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/a', attendanceRoutes);
  return app;
}

function adminApp(session: SessionData = superadmin) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/s/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/s', adminDirectorateRoutes);
  return app;
}

function postNotice(env: Env, body: Record<string, unknown>) {
  return attendanceApp().request('/a/absence-notice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env, FAKE_EXEC_CTX);
}

const VALID = { reason: 'sick', note: 'Clinic visit', expected_return_date: BACK };

/* ---------- POST validation matrix ---------- */

describe('POST /absence-notice — required fields (premium)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects a missing note', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { reason: 'sick', expected_return_date: BACK });
    expect(res.status).toBe(400);
  });

  it('rejects a one-character note (min 2 after trim)', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { ...VALID, note: ' x ' });
    expect(res.status).toBe(400);
  });

  it("rejects reason='other' with a blank note (specify is required)", async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { reason: 'other', note: '   ', expected_return_date: BACK });
    expect(res.status).toBe(400);
  });

  it('rejects a missing expected_return_date', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { reason: 'sick', note: 'Clinic visit' });
    expect(res.status).toBe(400);
  });

  it('rejects a return date of today (must be strictly after)', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { ...VALID, expected_return_date: TODAY });
    expect(res.status).toBe(400);
  });

  it('rejects a return date beyond today + 30 days', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { ...VALID, expected_return_date: PAST_MAX_RETURN });
    expect(res.status).toBe(400);
  });

  it('accepts the today + 30 days boundary', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, { ...VALID, expected_return_date: MAX_RETURN });
    expect(res.status).toBe(200);
  });

  it('accepts a fully valid notice and returns it', async () => {
    const { env } = makeEnv();
    const res = await postNotice(env, VALID);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reason: string; note: string; expected_return_date: string; notice_date: string } };
    expect(body.data.reason).toBe('sick');
    expect(body.data.note).toBe('Clinic visit');
    expect(body.data.expected_return_date).toBe(BACK);
    expect(body.data.notice_date).toBe(TODAY);
  });
});

/* ---------- Upsert ---------- */

describe('POST /absence-notice — same-day upsert', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('re-submitting the same day updates the row instead of duplicating it', async () => {
    const { env, db } = makeEnv();
    expect((await postNotice(env, VALID)).status).toBe(200);
    expect((await postNotice(env, { reason: 'transport', note: 'Trotro strike', expected_return_date: TOMORROW })).status).toBe(200);

    const rows = db.prepare('SELECT reason, note, expected_return_date FROM absence_notices WHERE user_id = ?').all('u_sub') as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('transport');
    expect(rows[0]!.note).toBe('Trotro strike');
    expect(rows[0]!.expected_return_date).toBe(TOMORROW);
  });

  it('audits the first submit and the update distinctly', async () => {
    const { env, db } = makeEnv();
    await postNotice(env, VALID);
    await postNotice(env, { reason: 'transport', note: 'Trotro strike', expected_return_date: TOMORROW });

    const actions = db.prepare(
      "SELECT action FROM audit_log WHERE entity_type = 'absence_notice' ORDER BY seq",
    ).all() as Array<{ action: string }>;
    expect(actions.map((a) => a.action)).toEqual(['absence.submit', 'absence.update']);
  });

  it('a raced concurrent submit can never leave two rows (atomic upsert)', async () => {
    const { env, db } = makeEnv();
    // Simulate the lost race: the moment the route's first absence_notices
    // statement completes, a "concurrent winner" row lands — the old
    // read-then-insert flow then inserted a SECOND row on top of it.
    let injected = false;
    const realPrepare = env.DB.prepare.bind(env.DB);
    env.DB = {
      prepare(sql: string) {
        const stmt = realPrepare(sql);
        const hook = <T>(p: Promise<T>): Promise<T> => p.then((r) => {
          if (!injected && sql.includes('absence_notices')) {
            injected = true;
            db.prepare(
              "INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date) VALUES ('winner', 'u_sub', 'sick', 'Concurrent winner', ?, ?)",
            ).run(TODAY, BACK);
          }
          return r;
        });
        const wrap = (s: Record<string, (...a: unknown[]) => unknown>): Record<string, unknown> => ({
          bind: (...p: unknown[]) => wrap(s.bind!(...p) as Record<string, (...a: unknown[]) => unknown>),
          first: () => hook(Promise.resolve(s.first!())),
          all: () => hook(Promise.resolve(s.all!())),
          run: () => hook(Promise.resolve(s.run!())),
        });
        return wrap(stmt as unknown as Record<string, (...a: unknown[]) => unknown>);
      },
    } as unknown as Env['DB'];

    const res = await postNotice(env, { reason: 'transport', note: 'Trotro strike', expected_return_date: TOMORROW });
    expect(res.status).toBe(200);

    const rows = db.prepare('SELECT id, reason, note, expected_return_date FROM absence_notices WHERE user_id = ?').all('u_sub') as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    // The surviving row carries one coherent submission — the route's update wins last.
    expect(rows[0]!.reason).toBe('transport');
    expect(rows[0]!.expected_return_date).toBe(TOMORROW);
  });
});

/* ---------- DELETE (retract) ---------- */

describe('DELETE /absence-notice/today', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  function del(env: Env) {
    return attendanceApp().request('/a/absence-notice/today', { method: 'DELETE' }, env, FAKE_EXEC_CTX);
  }

  it('deletes today\'s notice (200), empties GET today, then 404s on a second retract', async () => {
    const { env } = makeEnv();
    expect((await postNotice(env, VALID)).status).toBe(200);

    const res = await del(env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);

    const getRes = await attendanceApp().request('/a/absence-notice/today', {}, env, FAKE_EXEC_CTX);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { data: unknown };
    expect(getBody.data).toBeNull();

    expect((await del(env)).status).toBe(404);
  });

  it('404s when there is no notice for today', async () => {
    const { env } = makeEnv();
    expect((await del(env)).status).toBe(404);
  });

  it('audits the retract', async () => {
    const { env, db } = makeEnv();
    await postNotice(env, VALID);
    await del(env);
    const actions = db.prepare(
      "SELECT action FROM audit_log WHERE entity_type = 'absence_notice' ORDER BY seq",
    ).all() as Array<{ action: string }>;
    expect(actions.map((a) => a.action)).toEqual(['absence.submit', 'absence.retract']);
  });
});

/* ---------- Head-of-entity routing chain ---------- */

function noticeFor(userId: string, overrides: Partial<AbsenceNoticeInput> = {}): AbsenceNoticeInput {
  return {
    id: 'n1',
    user_id: userId,
    reason: 'sick',
    note: 'Clinic visit',
    notice_date: TODAY,
    expected_return_date: BACK,
    ...overrides,
  };
}

interface NotifRow { user_id: string; type: string; title: string; body: string }

function notifs(db: SqliteDb): NotifRow[] {
  return db.prepare('SELECT user_id, type, title, body FROM notifications ORDER BY created_at, user_id').all() as NotifRow[];
}

describe('sendAbsenceNoticePush — routing chain', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reachable head: linked user gets the in-app notification AND the officer gets Telegram', async () => {
    const { env, db } = makeEnv();
    await sendAbsenceNoticePush(env, noticeFor('u_sub', {
      reason: 'other', note: 'Car broke & towed <garage>',
    }));

    const rows = notifs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe('u_headuser');
    expect(rows[0]!.type).toBe('absence_notice');
    expect(rows[0]!.title).toBe('Kofi Away out until 5 Aug');
    expect(rows[0]!.body).toContain('Other'); // 'other' label is "Other", not "Absent"
    expect(rows[0]!.body).not.toContain('Absent');
    expect(rows[0]!.body).toContain('Car broke & towed <garage>');
    expect(rows[0]!.body).toContain('Expected back 5 Aug');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('https://api.telegram.org/bottest-token/sendMessage');
    const payload = JSON.parse(init.body) as { chat_id: string; text: string };
    expect(payload.chat_id).toBe('chat123');
    expect(payload.text).toContain('Kofi Away');
    expect(payload.text).toContain('&lt;garage&gt;'); // HTML-escaped user content
    expect(payload.text).toContain('Expected back 5 Aug');
  });

  it('unreachable head (no user account, no Telegram) falls through to the director', async () => {
    const { env, db } = makeEnv();
    db.prepare('UPDATE directorates SET head_officer_id = ? WHERE id = ?').run('o_unreachable', 'dir1');
    await sendAbsenceNoticePush(env, noticeFor('u_sub'));

    const rows = notifs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe('u_dir');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('head resolving to the SUBMITTER\'s own account is excluded — falls through to the director', async () => {
    const { env, db } = makeEnv();
    db.prepare('UPDATE directorates SET head_officer_id = ? WHERE id = ?').run('o_selfhead', 'dir1');
    await sendAbsenceNoticePush(env, noticeFor('u_sub'));

    const rows = notifs(db);
    expect(rows.map((r) => r.user_id)).toEqual(['u_dir']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('head-is-submitter WITH a Telegram chat does NOT self-send — falls through to the director', async () => {
    const { env, db } = makeEnv();
    // o_selfhead is staff-linked to the submitter (S100) AND has a Telegram chat.
    db.prepare("UPDATE officers SET telegram_chat_id = 'chat999' WHERE id = 'o_selfhead'").run();
    db.prepare('UPDATE directorates SET head_officer_id = ? WHERE id = ?').run('o_selfhead', 'dir1');
    await sendAbsenceNoticePush(env, noticeFor('u_sub'));

    const rows = notifs(db);
    expect(rows.map((r) => r.user_id)).toEqual(['u_dir']);
    // No Telegram self-send to the head's own chat, and the submitter is
    // never a recipient on any channel.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows.some((r) => r.user_id === 'u_sub')).toBe(false);
  });

  it('telegram-only head (no linked user, NOT the submitter) gets the notice on Telegram', async () => {
    const { env, db } = makeEnv();
    db.prepare("INSERT INTO officers (id, name, directorate_id, email, staff_id, telegram_chat_id) VALUES ('o_tgonly', 'TG Only Head', 'dir1', null, null, 'chat777')").run();
    db.prepare('UPDATE directorates SET head_officer_id = ? WHERE id = ?').run('o_tgonly', 'dir1');
    await sendAbsenceNoticePush(env, noticeFor('u_sub'));

    // Telegram delivered to the head's officer chat, and the chain is
    // claimed — no fall-through to the director.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body) as { chat_id: string; text: string };
    expect(payload.chat_id).toBe('chat777');
    expect(payload.text).toContain('Kofi Away');
    expect(notifs(db).some((r) => r.user_id === 'u_dir')).toBe(false);
  });

  it('a head name matching TWO active users notifies neither — falls through to the director', async () => {
    const { env, db } = makeEnv();
    // Head with no staff_id/email: only the exact-name leg can resolve them,
    // but two active users share the name (rename attack / innocent collision).
    db.prepare("INSERT INTO officers (id, name, directorate_id, email, staff_id, telegram_chat_id) VALUES ('o_dup', 'Duplicate Name', 'dir1', null, null, null)").run();
    db.prepare("INSERT INTO users (id, name, email, staff_id, role, directorate_id) VALUES ('u_dup1', 'Duplicate Name', 'd1@ohcs.gov.gh', 'S500', 'staff', 'dir1')").run();
    db.prepare("INSERT INTO users (id, name, email, staff_id, role, directorate_id) VALUES ('u_dup2', 'Duplicate Name', 'd2@ohcs.gov.gh', 'S501', 'staff', 'dir1')").run();
    db.prepare('UPDATE directorates SET head_officer_id = ? WHERE id = ?').run('o_dup', 'dir1');
    await sendAbsenceNoticePush(env, noticeFor('u_sub'));

    const rows = notifs(db);
    expect(rows.map((r) => r.user_id)).toEqual(['u_dir']);
    expect(rows.some((r) => r.user_id === 'u_dup1' || r.user_id === 'u_dup2')).toBe(false);
  });

  it('no head and no director in the entity notifies superadmins only', async () => {
    const { env, db } = makeEnv();
    await sendAbsenceNoticePush(env, noticeFor('u_sub3'));

    const rows = notifs(db);
    expect(rows.map((r) => r.user_id)).toEqual(['u_super']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the submitter is never a recipient', async () => {
    const { env, db } = makeEnv();
    // No head on dir3; make the submitter a director there — they must not
    // receive their own absence notice; it falls to superadmins.
    db.prepare("UPDATE users SET role = 'director' WHERE id = 'u_sub3'").run();
    await sendAbsenceNoticePush(env, noticeFor('u_sub3'));

    const rows = notifs(db);
    expect(rows.map((r) => r.user_id)).toEqual(['u_super']);
    expect(rows.some((r) => r.user_id === 'u_sub3')).toBe(false);
  });

  it("same-day notice titles 'won't be in today' when there is no return date", async () => {
    const { env, db } = makeEnv();
    await sendAbsenceNoticePush(env, noticeFor('u_sub3', { expected_return_date: null }));
    const rows = notifs(db);
    expect(rows[0]!.title).toBe("No Coverage won't be in today");
  });
});

/* ---------- Admin: head_officer_id wiring ---------- */

describe('PUT /admin-directorates/:id — head_officer_id', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  function put(env: Env, id: string, body: Record<string, unknown>) {
    return adminApp().request(`/s/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, env, FAKE_EXEC_CTX);
  }

  it('sets the head and GET / exposes head_officer_id + head_name', async () => {
    const { env } = makeEnv();
    const res = await put(env, 'dir1', { head_officer_id: 'o_unreachable' });
    expect(res.status).toBe(200);

    const getRes = await adminApp().request('/s', {}, env, FAKE_EXEC_CTX);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { data: Array<{ id: string; head_officer_id: string | null; head_name: string | null }> };
    const dir1 = body.data.find((d) => d.id === 'dir1');
    expect(dir1?.head_officer_id).toBe('o_unreachable');
    expect(dir1?.head_name).toBe('Ghost Head');
    const dir2 = body.data.find((d) => d.id === 'dir2');
    expect(dir2?.head_officer_id).toBeNull();
    expect(dir2?.head_name).toBeNull();
  });

  it('rejects an officer who belongs to another entity', async () => {
    const { env } = makeEnv();
    const res = await put(env, 'dir1', { head_officer_id: 'o_other' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown officer', async () => {
    const { env } = makeEnv();
    const res = await put(env, 'dir1', { head_officer_id: 'nope' });
    expect(res.status).toBe(400);
  });

  it('null clears the head', async () => {
    const { env } = makeEnv();
    expect((await put(env, 'dir1', { head_officer_id: null })).status).toBe(200);
    const row = await env.DB.prepare('SELECT head_officer_id FROM directorates WHERE id = ?').bind('dir1').first<{ head_officer_id: string | null }>();
    expect(row?.head_officer_id).toBeNull();
  });
});
