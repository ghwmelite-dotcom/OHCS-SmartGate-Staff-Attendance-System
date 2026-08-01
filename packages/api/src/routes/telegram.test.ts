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
    CREATE TABLE directorates (id TEXT PRIMARY KEY, abbreviation TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, directorate_id TEXT);
    CREATE TABLE officers (id TEXT PRIMARY KEY, name TEXT, email TEXT, telegram_chat_id TEXT);
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (same pattern as admin-nss-export.test.ts).
function d1(db: SqliteDb) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
            all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
            run: async () => { db.prepare(sql).run(...params); return { success: true }; },
          };
        },
      };
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

function makeEnv(opts: { username?: string | null } = {}) {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_BOT_USERNAME: opts.username === undefined ? 'ohcsbot' : opts.username,
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
