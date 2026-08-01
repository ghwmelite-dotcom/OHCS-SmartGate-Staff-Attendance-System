/**
 * User-level Telegram link tests (spec §6.2 — deep-link connect flow).
 *
 * - POST /notifications/telegram/link-token mints a one-time KV token.
 * - GET /notifications/telegram/status reflects telegram-user:<id> and the
 *   caller's org-entity abbreviation.
 * - /start <token> in the webhook writes telegram-user:<userId>, consumes the
 *   token, mirrors the chat onto a matching officer, and confirms; unknown
 *   tokens fall through to the greeting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { notificationsTelegramRoutes } from './notifications-telegram';
import { telegramWebhook, telegramAttendanceWebhook } from './telegram';
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
    CREATE TABLE directorates (id TEXT PRIMARY KEY, abbreviation TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, directorate_id TEXT, staff_id TEXT, role TEXT);
    CREATE TABLE officers (id TEXT PRIMARY KEY, name TEXT, email TEXT, telegram_chat_id TEXT);
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, seq INTEGER UNIQUE, at TEXT,
      actor_user_id TEXT, actor_role TEXT, actor_label TEXT,
      action TEXT, entity_type TEXT, entity_id TEXT,
      summary TEXT, changes TEXT, ip TEXT, prev_hash TEXT, hash TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (same pattern as admin-nss-export.test.ts).
function d1(db: SqliteDb) {
  return {
    prepare(sql: string) {
      const bound = (...params: unknown[]) => ({
        first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
        all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
        run: async () => { db.prepare(sql).run(...params); return { success: true }; },
      });
      // Real D1 also allows first/all/run directly on the unbound statement.
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

function makeEnv(opts: {
  username?: string | null;
  attendanceUsername?: string | null;
  attendanceToken?: string;
  attendanceSecret?: string;
} = {}) {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_BOT_USERNAME: opts.username === undefined ? 'ohcsbot' : opts.username,
    TELEGRAM_ATTENDANCE_BOT_TOKEN: opts.attendanceToken,
    TELEGRAM_ATTENDANCE_BOT_USERNAME: opts.attendanceUsername ?? undefined,
    TELEGRAM_ATTENDANCE_WEBHOOK_SECRET: opts.attendanceSecret,
    ENVIRONMENT: 'test',
    KV: kv(store),
    DB: d1(db),
  } as unknown as Env;
  return { env, store, db };
}

const baseSession: SessionData = { userId: 'u1', email: 'ama@ohcs.gov.gh', role: 'staff', name: 'Ama Serwaa' };

function makeApp(session: SessionData = baseSession) {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/t/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/t', notificationsTelegramRoutes);
  app.post('/webhook', telegramWebhook);
  app.post('/att-webhook', telegramAttendanceWebhook);
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

function sentText(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
  return String((fetchMock.mock.calls[call]![1] as RequestInit).body);
}

/* ---------- link-token ---------- */

describe('POST /notifications/telegram/link-token', () => {
  it('mints a one-time KV token and returns the t.me deep link', async () => {
    const { env, store } = makeEnv();
    const res = await makeApp().request('/t/link-token', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { url: string }; error: null };
    expect(body.error).toBeNull();
    expect(body.data.url).toMatch(/^https:\/\/t\.me\/ohcsbot\?start=[0-9a-f]{32}$/);
    const token = body.data.url.split('start=')[1]!;
    expect(store.get(`telegram-user-link:${token}`)).toBe('u1');
  });

  it('503s when the bot username is missing or still the placeholder', async () => {
    for (const username of [null, 'REPLACE_WITH_BOT_USERNAME']) {
      const { env } = makeEnv({ username });
      const res = await makeApp().request('/t/link-token', { method: 'POST' }, env);
      expect(res.status).toBe(503);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('BOT_NOT_CONFIGURED');
    }
  });
});

/* ---------- status ---------- */

describe('GET /notifications/telegram/status', () => {
  it('reports linked=false with the caller\u2019s directorate abbreviation', async () => {
    const { env, db } = makeEnv();
    db.prepare("INSERT INTO directorates (id, abbreviation) VALUES ('d1', 'RSIMD')").run();
    db.prepare("INSERT INTO users (id, name, email, directorate_id) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh', 'd1')").run();
    const res = await makeApp().request('/t/status', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { linked: boolean; entityAbbr: string | null } };
    expect(body.data).toEqual({ linked: false, entityAbbr: 'RSIMD' });
  });

  it('reports linked=true once telegram-user:<id> exists; entityAbbr null without a directorate', async () => {
    const { env, store, db } = makeEnv();
    db.prepare("INSERT INTO users (id, name, email, directorate_id) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh', NULL)").run();
    store.set('telegram-user:u1', '555');
    const res = await makeApp().request('/t/status', {}, env);
    const body = await res.json() as { data: { linked: boolean; entityAbbr: string | null } };
    expect(body.data).toEqual({ linked: true, entityAbbr: null });
  });
});

/* ---------- /start deep-link handler ---------- */

describe('telegramWebhook /start with a user link token', () => {
  const startUpdate = (text: string) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: 555 }, text } }),
  });

  it('links the user, consumes the token, mirrors the officer, and confirms', async () => {
    const { env, store, db } = makeEnv();
    store.set('telegram-user-link:tok123', 'u1');
    db.prepare("INSERT INTO users (id, name, email) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    db.prepare("INSERT INTO officers (id, name, email) VALUES ('o1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', startUpdate('/start tok123'), env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-user:u1')).toBe('555');
    expect(store.has('telegram-user-link:tok123')).toBe(false);
    const officer = db.prepare("SELECT telegram_chat_id AS cid FROM officers WHERE id = 'o1'").get() as { cid: string };
    expect(officer.cid).toBe('555');
    expect(fetchMock).toHaveBeenCalled();
    const text = sentText(fetchMock);
    expect(text).toContain('Connected!');
    expect(text).toContain('clock-in and clock-out reminders');
  });

  it('falls through to the greeting for an unknown or expired token', async () => {
    const { env, store } = makeEnv();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', startUpdate('/start bogus-token'), env);
    expect(res.status).toBe(200);
    expect(sentText(fetchMock)).toContain('OHCS SmartGate Bot');
    expect([...store.keys()].filter((k) => k.startsWith('telegram-user:'))).toHaveLength(0);
  });
});

/* ---------- link-token attendance username ---------- */

describe('POST /notifications/telegram/link-token — attendance bot username', () => {
  it('builds the deep link with the attendance bot username when configured', async () => {
    const { env, store } = makeEnv({ attendanceUsername: 'RSIMDAttendanceAlertsBot' });
    const res = await makeApp().request('/t/link-token', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { url: string } };
    expect(body.data.url).toMatch(/^https:\/\/t\.me\/RSIMDAttendanceAlertsBot\?start=[0-9a-f]{32}$/);
    const token = body.data.url.split('start=')[1]!;
    expect(store.get(`telegram-user-link:${token}`)).toBe('u1');
  });

  it('falls back to the main bot username when the attendance username is unset', async () => {
    const { env } = makeEnv();
    const res = await makeApp().request('/t/link-token', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { url: string } };
    expect(body.data.url).toMatch(/^https:\/\/t\.me\/ohcsbot\?start=[0-9a-f]{32}$/);
  });

  it('resolves the 503 guard on the attendance username even when the main one is missing', async () => {
    const { env } = makeEnv({ username: null, attendanceUsername: 'RSIMDAttendanceAlertsBot' });
    const res = await makeApp().request('/t/link-token', { method: 'POST' }, env);
    expect(res.status).toBe(200);
  });

  it('503s when neither username is configured', async () => {
    const { env } = makeEnv({ username: null });
    const res = await makeApp().request('/t/link-token', { method: 'POST' }, env);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BOT_NOT_CONFIGURED');
  });
});

/* ---------- dedicated attendance-bot webhook ---------- */

describe('telegramAttendanceWebhook — dedicated attendance bot', () => {
  const attUpdate = (text: string, secret?: string) => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: JSON.stringify({ message: { chat: { id: 777 }, text } }),
  });

  function sentUrl(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
    return String(fetchMock.mock.calls[call]![0]);
  }

  it('links a telegram-user-link token, consumes it, and confirms via the ATTENDANCE token', async () => {
    const { env, store, db } = makeEnv({ attendanceToken: 'att-tok', attendanceSecret: 'sec' });
    store.set('telegram-user-link:tok9', 'u1');
    db.prepare("INSERT INTO users (id, name, email) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/att-webhook', attUpdate('/start tok9', 'sec'), env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-user:u1')).toBe('777');
    expect(store.has('telegram-user-link:tok9')).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    expect(sentUrl(fetchMock)).toBe('https://api.telegram.org/botatt-tok/sendMessage');
    expect(sentText(fetchMock)).toContain('Connected!');
  });

  it('sends via the main token until the attendance token secret is set', async () => {
    const { env, store, db } = makeEnv({ attendanceSecret: 'sec' });
    store.set('telegram-user-link:tok9', 'u1');
    db.prepare("INSERT INTO users (id, name, email) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/att-webhook', attUpdate('/start tok9', 'sec'), env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-user:u1')).toBe('777');
    expect(sentUrl(fetchMock)).toBe('https://api.telegram.org/bott/sendMessage');
  });

  it('401s when the webhook secret header is missing or wrong', async () => {
    const { env, store } = makeEnv({ attendanceToken: 'att-tok', attendanceSecret: 'sec' });
    store.set('telegram-user-link:tok9', 'u1');
    const fetchMock = stubTelegramFetch();

    for (const secret of [undefined, 'wrong']) {
      const res = await makeApp().request('/att-webhook', attUpdate('/start tok9', secret), env);
      expect(res.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.has('telegram-user-link:tok9')).toBe(true);
    expect([...store.keys()].filter((k) => k.startsWith('telegram-user:'))).toHaveLength(0);
  });

  it('greets via the attendance token on a bogus token, with no KV writes', async () => {
    const { env, store } = makeEnv({ attendanceToken: 'att-tok', attendanceSecret: 'sec' });
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/att-webhook', attUpdate('/start bogus', 'sec'), env);
    expect(res.status).toBe(200);
    expect(sentUrl(fetchMock)).toBe('https://api.telegram.org/botatt-tok/sendMessage');
    expect(sentText(fetchMock)).toContain('Attendance Alerts');
    expect([...store.keys()].filter((k) => k.startsWith('telegram-user:'))).toHaveLength(0);
  });

  it('does NOT handle officer-link tokens, /link, or other commands', async () => {
    const { env, store, db } = makeEnv({ attendanceToken: 'att-tok', attendanceSecret: 'sec' });
    store.set('officer-link:off1', 'o1');
    db.prepare("INSERT INTO officers (id, name, email) VALUES ('o1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    const fetchMock = stubTelegramFetch();

    // officer-link deep-link token: NOT consumed by the attendance webhook.
    const r1 = await makeApp().request('/att-webhook', attUpdate('/start off1', 'sec'), env);
    expect(r1.status).toBe(200);
    expect(store.get('officer-link:off1')).toBe('o1'); // untouched — main bot consumes it
    const officer = db.prepare("SELECT telegram_chat_id AS cid FROM officers WHERE id = 'o1'").get() as { cid: string | null };
    expect(officer.cid).toBeNull();

    // Other commands are ignored entirely (no fetch beyond the greeting above).
    const callsBefore = fetchMock.mock.calls.length;
    const r2 = await makeApp().request('/att-webhook', attUpdate('/link 1334685', 'sec'), env);
    expect(r2.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect([...store.keys()].filter((k) => k.startsWith('telegram-user:'))).toHaveLength(0);
  });
});

/* ---------- bare /link is no longer a link path (audit fix, 2026-08-01) ---------- */

describe('telegramWebhook /link — unauthenticated write removed', () => {
  const cmd = (text: string, chatId = 555) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: chatId }, text } }),
  });

  it('replies with linking instructions and writes NOTHING for a known staff ID', async () => {
    const { env, store, db } = makeEnv();
    db.prepare("INSERT INTO users (id, name, email, staff_id, role) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh', '1334685', 'staff')").run();
    db.prepare("INSERT INTO officers (id, name, email) VALUES ('o1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/link 1334685'), env);
    expect(res.status).toBe(200);
    const text = sentText(fetchMock);
    expect(text).toContain('one-time link');
    // No link writes of any kind.
    expect([...store.keys()].filter((k) => k.startsWith('telegram-user:'))).toHaveLength(0);
    expect([...store.keys()].filter((k) => k.startsWith('telegram-chat:'))).toHaveLength(0);
    const officer = db.prepare("SELECT telegram_chat_id AS cid FROM officers WHERE id = 'o1'").get() as { cid: string | null };
    expect(officer.cid).toBeNull();
  });

  it('keeps the staff-ID-not-found wording for unknown IDs', async () => {
    const { env } = makeEnv();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/link 9999999'), env);
    expect(res.status).toBe(200);
    expect(sentText(fetchMock)).toContain('not found');
  });
});

/* ---------- link writes: reverse key + audit trail ---------- */

describe('link writes carry a reverse telegram-chat: key and an audit row', () => {
  const startUpdate = (text: string) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: 555 }, text } }),
  });

  it('/start <token> writes telegram-chat:<chatId> and a telegram.link audit row', async () => {
    const { env, store, db } = makeEnv();
    store.set('telegram-user-link:tok123', 'u1');
    db.prepare("INSERT INTO users (id, name, email) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    stubTelegramFetch();

    const res = await makeApp().request('/webhook', startUpdate('/start tok123'), env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-user:u1')).toBe('555');
    expect(store.get('telegram-chat:555')).toBe('u1');
    const audit = db.prepare("SELECT action, entity_type, entity_id FROM audit_log").all() as Array<{ action: string; entity_type: string; entity_id: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({ action: 'telegram.link', entity_type: 'user', entity_id: 'u1' });
  });

  it('/unlink removes both telegram-user:<id> and telegram-chat:<chatId>', async () => {
    const { env, store, db } = makeEnv();
    store.set('telegram-user-link:tok123', 'u1');
    db.prepare("INSERT INTO users (id, name, email) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    db.prepare("INSERT INTO officers (id, name, email) VALUES ('o1', 'Ama Serwaa', 'ama@ohcs.gov.gh')").run();
    stubTelegramFetch();

    await makeApp().request('/webhook', startUpdate('/start tok123'), env);
    expect(store.get('telegram-user:u1')).toBe('555');
    expect(store.get('telegram-chat:555')).toBe('u1');

    const res = await makeApp().request('/webhook', startUpdate('/unlink'), env);
    expect(res.status).toBe(200);
    expect(store.has('telegram-user:u1')).toBe(false);
    expect(store.has('telegram-chat:555')).toBe(false);
    const officer = db.prepare("SELECT telegram_chat_id AS cid FROM officers WHERE id = 'o1'").get() as { cid: string | null };
    expect(officer.cid).toBeNull();
  });
});

/* ---------- /admin + /stop gating (audit fix, 2026-08-01) ---------- */

describe('telegramWebhook /admin and /stop — admin-chat registration is gated', () => {
  const cmd = (text: string, chatId: number) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: chatId }, text } }),
  });

  function seedUser(db: SqliteDb, id: string, role: string) {
    db.prepare('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)').run(id, `User ${id}`, `${id}@ohcs.gov.gh`, role);
  }

  it('refuses an unlinked chat and leaves KV untouched', async () => {
    const { env, store } = makeEnv();
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/admin', 900), env);
    expect(res.status).toBe(200);
    expect(sentText(fetchMock)).toContain('administrator');
    expect(store.has('telegram-admin-chat-id')).toBe(false);
  });

  it('refuses a chat linked to a staff-role user', async () => {
    const { env, store, db } = makeEnv();
    seedUser(db, 'u-staff', 'staff');
    store.set('telegram-chat:900', 'u-staff');
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/admin', 900), env);
    expect(res.status).toBe(200);
    expect(sentText(fetchMock)).toContain('administrator');
    expect(store.has('telegram-admin-chat-id')).toBe(false);
  });

  it('registers a chat linked to an admin-role user', async () => {
    const { env, store, db } = makeEnv();
    seedUser(db, 'u-admin', 'admin');
    store.set('telegram-chat:900', 'u-admin');
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/admin', 900), env);
    expect(res.status).toBe(200);
    expect(sentText(fetchMock)).toContain('Daily summaries enabled');
    expect(store.get('telegram-admin-chat-id')).toBe('900');
  });

  it('registers a chat linked to a superadmin-role user', async () => {
    const { env, store, db } = makeEnv();
    seedUser(db, 'u-super', 'superadmin');
    store.set('telegram-chat:900', 'u-super');
    stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/admin', 900), env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-admin-chat-id')).toBe('900');
  });

  it('/stop from a stranger leaves the registered admin chat intact', async () => {
    const { env, store } = makeEnv();
    store.set('telegram-admin-chat-id', '555');
    const fetchMock = stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/stop', 999), env);
    expect(res.status).toBe(200);
    expect(store.get('telegram-admin-chat-id')).toBe('555');
  });

  it('/stop from the registered admin chat clears it', async () => {
    const { env, store } = makeEnv();
    store.set('telegram-admin-chat-id', '555');
    stubTelegramFetch();

    const res = await makeApp().request('/webhook', cmd('/stop', 555), env);
    expect(res.status).toBe(200);
    expect(store.has('telegram-admin-chat-id')).toBe(false);
  });
});
