/**
 * Clock-route integrity tests (plan: docs/superpowers/plans/2026-08-01-attendance-integrity-gaps.md, Commit A).
 *
 * Boots the REAL clockRoutes with a minimal D1 shim over node:sqlite + a
 * Map-backed KV (same pattern as admin-settings.test.ts). Fake timers pin
 * "today" to 2026-08-03 (a Monday, 07:00 UTC — before the 08:30 late
 * threshold so the late-alert waitUntil branch never fires).
 *
 * Covers:
 *   - Post-insert steps (prompt KV delete, streak UPDATEs, R2 photo put) are
 *     best-effort: a failure there must not 5xx a request whose clock row is
 *     already persisted.
 *   - captured_at validation: within [now-48h, now+5min] → persisted as
 *     device_info.capturedDate; too old / future / garbage → ignored (NULL).
 *   - ALREADY_CLOCKED / NOT_CLOCKED_IN key on the EFFECTIVE date (validated
 *     capture date ?? server today), matched via COALESCE(capturedDate,
 *     timestamp) so a next-day replay of yesterday's clock is checked against
 *     yesterday, not today.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { clockRoutes } from './clock';
import type { Env, SessionData } from '../types';
import { hashPin } from '../services/auth';
import * as audit from '../services/audit';
import * as notifier from '../services/notifier';
import migration from '../db/migration-clock-self-reported.sql';

/* ---------- fakes ---------- */

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

const NOW = '2026-08-03T07:00:00.000Z';          // fake "today" (Monday)
const TODAY = '2026-08-03';
const YESTERDAY = '2026-08-02';
const YESTERDAY_CLOCK = '2026-08-02T08:05:00.000Z'; // ~23h before fake now

function newDb(): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      work_start_time TEXT NOT NULL,
      late_threshold_time TEXT NOT NULL,
      work_end_time TEXT NOT NULL,
      reception_override_pin TEXT,
      clockin_reauth_enforce INTEGER NOT NULL DEFAULT 0,
      clockin_pin_attempt_cap INTEGER NOT NULL DEFAULT 5,
      clockin_prompt_ttl_seconds INTEGER NOT NULL DEFAULT 90,
      clockin_passive_liveness_enforce INTEGER NOT NULL DEFAULT 0,
      clockin_liveness_review_cap_per_week INTEGER NOT NULL DEFAULT 2,
      clockin_liveness_model_version TEXT NOT NULL DEFAULT 'buffalo_s_v1',
      visitor_photo_retention_days INTEGER NOT NULL DEFAULT 30,
      presence_qr_mode INTEGER NOT NULL DEFAULT 0,
      risk_fusion_mode INTEGER NOT NULL DEFAULT 0,
      risk_fusion_block_enabled INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    INSERT INTO app_settings (id, work_start_time, late_threshold_time, work_end_time)
      VALUES (1, '08:00', '08:30', '17:00');
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, user_type TEXT DEFAULT 'staff',
      staff_id TEXT, pin_hash TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      current_streak INTEGER NOT NULL DEFAULT 0, longest_streak INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users (id, name, email, role, staff_id) VALUES ('u1', 'Ama Serwaa', 'ama@ohcs.gov.gh', 'staff', '896239');
    CREATE TABLE clock_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      -- The route INSERT omits timestamp, so this default is what rows get.
      -- Pinned to the fake "now" (NOW below): strftime('now') would use real
      -- wall-clock, which drifts from vi.setSystemTime and silently breaks
      -- the effective-date duplicate check on any day except 2026-08-03.
      timestamp TEXT NOT NULL DEFAULT '2026-08-03T07:00:00.000Z',
      latitude REAL, longitude REAL, within_geofence INTEGER NOT NULL DEFAULT 0,
      photo_url TEXT, device_info TEXT, idempotency_key TEXT,
      reauth_method TEXT, liveness_challenge TEXT, liveness_decision TEXT, liveness_signature TEXT,
      presence_method TEXT, presence_token_window TEXT, risk_score INTEGER, risk_factors TEXT,
      risk_disposition TEXT, reported_departure_at TEXT
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, visit_id TEXT, read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT, p256dh TEXT, auth TEXT
    );
  `);
  return db;
}

// Minimal D1 shim over node:sqlite (copied pattern from admin-settings.test.ts).
function d1(db: SqliteDb) {
  const stmt = (sql: string, params: unknown[]) => ({
    first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    all: async <T = unknown>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => { db.prepare(sql).run(...params); return { success: true }; },
  });
  return {
    prepare(sql: string) {
      return { ...stmt(sql, []), bind(...params: unknown[]) { return stmt(sql, params); } };
    },
  };
}

function makeEnv(opts: { kvDeleteThrows?: boolean } = {}) {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    ENVIRONMENT: 'test',
    KV: {
      get: async (k: string, type?: string) => {
        const v = store.get(k);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: opts.kvDeleteThrows
        ? async () => { throw new Error('KV delete boom'); }
        : async (k: string) => { store.delete(k); },
    },
    DB: d1(db),
    STORAGE: { put: async () => {} },
  } as unknown as Env;
  return { env, db, store };
}

const session: SessionData = { userId: 'u1', email: 'ama@ohcs.gov.gh', role: 'staff', name: 'Ama Serwaa' };

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
  app.use('/c/*', async (c, next) => { c.set('session', session); await next(); });
  app.route('/c', clockRoutes);
  return app;
}

const FAKE_EXEC_CTX = { waitUntil: () => {}, passThroughOnException: () => {} };

/** Collecting execution context — lets tests await waitUntil fanout. */
function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => { pending.push(p.catch(() => {})); },
      passThroughOnException: () => {},
    },
    drain: () => Promise.all(pending),
  };
}

function clockInWithCtx(env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void; passThroughOnException: () => void }, type: 'clock_in' | 'clock_out' = 'clock_in') {
  return makeApp().request('/c', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...INSIDE }),
  }, env, ctx as never);
}

function notifRows(db: SqliteDb): Array<Record<string, unknown>> {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at, type').all('u1') as Array<Record<string, unknown>>;
}

// A point well inside the OHCS polygon.
const INSIDE = { latitude: 5.55257, longitude: -0.19742, accuracy: 10 };

function clockIn(env: Env, extra: Record<string, unknown> = {}) {
  return makeApp().request('/c', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clock_in', ...INSIDE, ...extra }),
  }, env, FAKE_EXEC_CTX);
}

function seedPrompt(store: Map<string, string>, promptId: string) {
  store.set(`clock-prompt:${promptId}`, JSON.stringify({
    userId: 'u1', expiresAt: Date.now() + 60_000, challengeAction: 'blink',
  }));
}

function clockRow(db: SqliteDb): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM clock_records WHERE user_id = ? ORDER BY timestamp').get('u1') as Record<string, unknown> | undefined;
}

function clockRows(db: SqliteDb): Array<Record<string, unknown>> {
  return db.prepare('SELECT * FROM clock_records WHERE user_id = ? ORDER BY timestamp').all('u1') as Array<Record<string, unknown>>;
}

/* ---------- tests ---------- */

describe('self-reported clock-out', () => {
  const now = '2026-08-03T16:00:00.000Z';
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    vi.spyOn(audit, 'recordAudit').mockResolvedValue();
    vi.spyOn(notifier, 'sendTypedNotification').mockResolvedValue();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  async function fixture() {
    const f = makeEnv();
    const ctx = makeCtx();
    f.db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin('123456'), 'u1');
    f.db.exec("CREATE UNIQUE INDEX idem ON clock_records(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL");
    f.db.prepare('INSERT INTO clock_records(id,user_id,type,timestamp) VALUES (?,?,?,?)').run('in', 'u1', 'clock_in', `${TODAY}T08:00:00.000Z`);
    const prompt = crypto.randomUUID(); seedPrompt(f.store, prompt);
    const body = { prompt_id: prompt, idempotency_key: crypto.randomUUID(), pin: '123456', departure_at: `${TODAY}T14:15:00.000Z` };
    const submit = (extra: Record<string, unknown> = {}) => makeApp().request('/c/self-report-out', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }),
    }, f.env, ctx.ctx as never);
    return { ...f, body, submit, drain: ctx.drain };
  }
  it.each(['1234', '12345', '123456'])('accepts the existing %s login PIN', async pin => {
    const f = await fixture();
    f.db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin(pin), 'u1');
    expect((await f.submit({ pin })).status).toBe(200);
  });
  it('writes one standard confirmation with the departure time and a calendar-neutral sign-off', async () => {
    vi.mocked(notifier.sendTypedNotification).mockRestore();
    const f = await fixture();
    expect((await f.submit()).status).toBe(200);
    await f.drain();
    expect((await f.submit()).status).toBe(200);
    await f.drain();
    const confirmations = notifRows(f.db).filter(row => row.type === 'clock_out_confirmation');
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.body).toContain('14:15');
    expect(confirmations[0]?.body).toContain('self-reported');
    expect(confirmations[0]?.body).toContain('Enjoy your time off.');
    expect(confirmations[0]?.body).not.toContain('tomorrow');
  });
  it('keeps a successful clock-out when notification delivery fails', async () => {
    vi.mocked(notifier.sendTypedNotification).mockRejectedValue(new Error('Push unavailable'));
    const f = await fixture();
    expect((await f.submit()).status).toBe(200);
    await f.drain();
    expect(clockRows(f.db).filter(row => row.type === 'clock_out')).toHaveLength(1);
    expect((await f.submit()).status).toBe(200);
    expect(notifier.sendTypedNotification).toHaveBeenCalledOnce();
  });
  it('retains both times, records no location/liveness, returns honest staff status and audit', async () => {
    const f = await fixture();
    expect((await f.submit()).status).toBe(200);
    const row = clockRows(f.db).find(r => r.type === 'clock_out');
    expect(row).toMatchObject({ timestamp: now, reported_departure_at: f.body.departure_at, within_geofence: 0, latitude: null, longitude: null, liveness_decision: null, reauth_method: 'pin' });
    const status = await makeApp().request('/c/my-status', {}, f.env);
    expect(await status.json()).toMatchObject({ data: { clocked_out: true, clock_out_time: f.body.departure_at, clock_out_submitted_at: now, clock_out_self_reported: true } });
    expect(audit.recordAudit).toHaveBeenCalledOnce();
  });
  it('uses server time for Just left', async () => {
    const f = await fixture();
    const res = await f.submit({ departure_at: undefined });
    expect(await res.json()).toMatchObject({ data: { timestamp: now, reported_departure_at: now } });
  });
  it.each([
    ['missing PIN', { pin: undefined }, 403],
    ['wrong PIN', { pin: '000000' }, 403],
    ['before clock-in', { departure_at: `${TODAY}T07:59:00.000Z` }, 400],
    ['future', { departure_at: `${TODAY}T16:01:00.000Z` }, 400],
    ['previous day', { departure_at: `${YESTERDAY}T14:15:00.000Z` }, 400],
    ['invalid date', { departure_at: 'not a date' }, 400],
    ['different user field', { user_id: 'someone-else' }, 400],
    ['fake geofence evidence', { within_geofence: true }, 400],
    ['malformed passkey', { webauthn_assertion: { id: 'fake' } }, 400],
  ])('rejects %s without inserting', async (_label, extra, code) => {
    const f = await fixture();
    expect((await f.submit(extra)).status).toBe(code);
    expect(clockRows(f.db)).toHaveLength(1);
  });
  it('requires today clock-in', async () => {
    const f = await fixture(); f.db.exec("DELETE FROM clock_records");
    expect((await f.submit()).status).toBe(400);
  });
  it.each(['expired', 'another user'])('rejects %s prompt', async (kind) => {
    const f = await fixture();
    f.store.set(`clock-prompt:${f.body.prompt_id}`, JSON.stringify({ userId: kind === 'expired' ? 'u1' : 'u2', expiresAt: kind === 'expired' ? 0 : Date.now() + 60000 }));
    expect((await f.submit()).status).toBe(400);
  });
  it('returns the original result after a lost response, despite consumed prompt', async () => {
    const f = await fixture(); expect((await f.submit()).status).toBe(200);
    const retry = await f.submit();
    expect(await retry.json()).toMatchObject({ data: { timestamp: now, reported_departure_at: f.body.departure_at, deduplicated: true } });
    expect(clockRows(f.db)).toHaveLength(2);
  });
  it('never relabels a self-report as geofence verified on normal-route replay', async () => {
    const f = await fixture(); expect((await f.submit()).status).toBe(200);
    const replay = await clockIn(f.env, { type: 'clock_out', idempotency_key: f.body.idempotency_key });
    expect(await replay.json()).toMatchObject({ data: { within_geofence: false, reported_departure_at: f.body.departure_at } });
  });
  it('excludes duplicate keys and normal clock-out races', async () => {
    const f = await fixture();
    const results = await Promise.all([f.submit(), f.submit({ idempotency_key: crypto.randomUUID() })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await clockIn(f.env, { type: 'clock_out' })).status).toBe(400);
    expect(clockRows(f.db)).toHaveLength(2);
  });
  it('honours the PIN attempt cap even with normal enforcement disabled', async () => {
    const f = await fixture(); f.store.set(`clock-pin-attempts:u1:${TODAY}`, '5');
    expect((await f.submit()).status).toBe(429);
  });
  it('permits only one departure when normal and self-report requests compete', async () => {
    const f = await fixture();
    const results = await Promise.all([f.submit(), clockIn(f.env, { type: 'clock_out' })]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(clockRows(f.db).filter(r => r.type === 'clock_out')).toHaveLength(1);
  });
  it('does not turn prompt cleanup failure into lost attendance', async () => {
    const f = await fixture();
    const original = f.env.KV.delete.bind(f.env.KV);
    vi.spyOn(f.env.KV, 'delete').mockImplementation(async key => { if (key.startsWith('clock-prompt:')) throw new Error('unavailable'); await original(key); });
    expect((await f.submit()).status).toBe(200);
    expect(clockRows(f.db)).toHaveLength(2);
  });
  it('migration preserves existing data with a null declaration', () => {
    const { DatabaseSync } = require('node:sqlite');
    const db: SqliteDb = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE clock_records(id TEXT, timestamp TEXT); INSERT INTO clock_records VALUES ('legacy','2026-08-03T17:00:00Z')");
    db.exec(migration);
    expect(db.prepare('SELECT * FROM clock_records').get()).toEqual({ id: 'legacy', timestamp: '2026-08-03T17:00:00Z', reported_departure_at: null });
  });
});

describe('POST /clock — delivery confirmations (one-shot, real state changes only)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('clock-in fires exactly one in-app confirmation notification', async () => {
    const { env, db } = makeEnv();
    const ctx = makeCtx();
    const res = await clockInWithCtx(env, ctx.ctx as never);
    expect(res.status).toBe(200);
    await ctx.drain();

    const rows = notifRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('clock_in_confirmation');
    expect(String(rows[0]!.title)).toContain('Clocked in');
    expect(String(rows[0]!.body)).toContain('07:00');
  });

  it('clock-out confirmation carries the day duration', async () => {
    const { env, db } = makeEnv();
    db.prepare("INSERT INTO clock_records (id, user_id, type, timestamp) VALUES ('ci-seed', 'u1', 'clock_in', '2026-08-03T07:00:00.000Z')").run();
    vi.setSystemTime(new Date('2026-08-03T16:00:00.000Z'));

    const ctx = makeCtx();
    const res = await clockInWithCtx(env, ctx.ctx as never, 'clock_out');
    expect(res.status).toBe(200);
    await ctx.drain();

    const rows = notifRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('clock_out_confirmation');
    expect(String(rows[0]!.body)).toContain('9h 0m today');
    expect(String(rows[0]!.body)).toContain('Enjoy your time off.');
    expect(String(rows[0]!.body)).not.toContain('tomorrow');
  });

  it('a deduped resubmit stays silent — no second confirmation', async () => {
    const { env, db } = makeEnv();
    const first = makeCtx();
    expect((await clockInWithCtx(env, first.ctx as never)).status).toBe(200);
    await first.drain();

    const second = makeCtx();
    const res = await clockInWithCtx(env, second.ctx as never);
    expect(res.status).toBe(400); // ALREADY_CLOCKED
    await second.drain();

    const rows = notifRows(db).filter((r) => r.type === 'clock_in_confirmation');
    expect(rows).toHaveLength(1);
  });
});

describe('POST /clock — post-insert best-effort', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('baseline: online clock-in succeeds and persists a row', async () => {
    const { env, db } = makeEnv();
    const res = await clockIn(env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; streak: number } };
    expect(body.data.id).toBeTruthy();
    expect(body.data.streak).toBe(1);
    expect(clockRow(db)).toBeTruthy();
  });

  it('prompt KV delete failure post-insert still returns success and keeps the row', async () => {
    const { env, db, store } = makeEnv({ kvDeleteThrows: true });
    const promptId = crypto.randomUUID();
    seedPrompt(store, promptId);

    const res = await clockIn(env, { prompt_id: promptId });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } | null; error: { code: string } | null };
    expect(body.error).toBeNull();
    expect(body.data?.id).toBeTruthy();
    // The row is durable even though the prompt cleanup blew up.
    expect(clockRow(db)).toBeTruthy();
  });
});

describe('POST /clock — captured_at validation and effective-date duplicate check', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('valid captured_at (yesterday) is persisted as device_info.capturedDate', async () => {
    const { env, db } = makeEnv();
    const res = await clockIn(env, { captured_at: YESTERDAY_CLOCK });
    expect(res.status).toBe(200);
    const row = clockRow(db);
    expect(row).toBeTruthy();
    expect(JSON.parse(String(row!.device_info))).toEqual({ capturedDate: YESTERDAY });
  });

  it('a second submit for the same capture date is ALREADY_CLOCKED, but a fresh clock today is not', async () => {
    const { env } = makeEnv();
    expect((await clockIn(env, { captured_at: YESTERDAY_CLOCK })).status).toBe(200);

    // Replay of the same offline capture → duplicate for YESTERDAY.
    const replay = await clockIn(env, { captured_at: YESTERDAY_CLOCK });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CLOCKED');

    // A genuinely new clock-in today must NOT be blocked by yesterday's replay.
    const fresh = await clockIn(env);
    expect(fresh.status).toBe(200);
  });

  it('captured_at older than 48h is ignored (device_info stays NULL)', async () => {
    const { env, db } = makeEnv();
    const tooOld = new Date(Date.now() - 72 * 3600_000).toISOString();
    const res = await clockIn(env, { captured_at: tooOld });
    expect(res.status).toBe(200);
    expect(clockRow(db)!.device_info).toBeNull();
  });

  it('captured_at beyond 5min in the future is ignored', async () => {
    const { env, db } = makeEnv();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const res = await clockIn(env, { captured_at: future });
    expect(res.status).toBe(200);
    expect(clockRow(db)!.device_info).toBeNull();
  });

  it('garbage captured_at is ignored', async () => {
    const { env, db } = makeEnv();
    const res = await clockIn(env, { captured_at: 'not-a-date' });
    expect(res.status).toBe(200);
    expect(clockRow(db)!.device_info).toBeNull();
  });

  it('offline clock-out replay finds yesterday\'s clock-in via the effective date', async () => {
    const { env, db } = makeEnv();
    // Clock-in happened online yesterday (server timestamp yesterday, no capturedDate).
    db.prepare("INSERT INTO clock_records (id, user_id, type, timestamp) VALUES (?, ?, 'clock_in', ?)")
      .run('seed-ci', 'u1', YESTERDAY_CLOCK);

    const res = await makeApp().request('/c', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clock_out', ...INSIDE, captured_at: '2026-08-02T17:10:00.000Z' }),
    }, env, FAKE_EXEC_CTX);
    expect(res.status).toBe(200);
    const rows = clockRows(db);
    expect(rows).toHaveLength(2);
    const out = rows.find((r) => r.type === 'clock_out')!;
    expect(JSON.parse(String(out.device_info))).toEqual({ capturedDate: YESTERDAY });
  });
});
