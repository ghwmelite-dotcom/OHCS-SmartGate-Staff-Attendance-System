/**
 * GET /appointments/public/ref/:code hardening (plan 2026-08-01-vms-audit-fixes.md,
 * Commit E): the kiosk appointment lookup was an unauthenticated full-row dump
 * (a.* — visitor phone + email included) with no rate limit, so a guessed
 * 6-char reference code leaked PII. Now: per-IP rate limit (mirrors
 * /arrive's 20/60s) and an explicit display-column projection that drops
 * visitor_phone / visitor_email while keeping every field the kiosk
 * appointment-confirm screen renders.
 *
 * Same node:sqlite D1-shim harness as appointments-public.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { appointmentsPublicRoutes } from './appointments-public';
import type { Env } from '../types';

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
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY, officer_id TEXT, reference_code TEXT, appointment_date TEXT,
      time_slot TEXT, visitor_name TEXT, visitor_phone TEXT, visitor_email TEXT,
      organisation TEXT, purpose TEXT, status TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  db.prepare("INSERT INTO directorates (id, name, floor, wing) VALUES ('d1', 'RSIMD', '1', 'A')").run();
  db.prepare("INSERT INTO officers (id, name, title, directorate_id, is_available) VALUES ('o1', 'Dr. Mensah', 'Director', 'd1', 1)").run();
  db.prepare(
    `INSERT INTO appointments (id, officer_id, reference_code, appointment_date, time_slot,
       visitor_name, visitor_phone, visitor_email, organisation, purpose, status, created_at, updated_at)
     VALUES ('a1', 'o1', 'ABC234', '2026-08-03', '09:00', 'Ama Mensah', '0244123456',
             'ama@example.com', 'Cocoa Board', 'Quarterly review', 'confirmed',
             '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z')`
  ).run();
  return db;
}

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

function makeEnv() {
  const store = new Map<string, string>();
  const db = newDb();
  const env = {
    ENVIRONMENT: 'test',
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    DB: d1(db),
  } as unknown as Env;
  return { env };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/appt', appointmentsPublicRoutes);
  return app;
}

describe('GET /appointments-public/ref/:code', () => {
  it('returns the display fields the kiosk renders, WITHOUT visitor phone/email', async () => {
    const { env } = makeEnv();
    const res = await makeApp().request('/appt/ref/ABC234', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { appointment: Record<string, unknown> } };
    const appt = body.data.appointment;

    // PII dropped
    expect('visitor_phone' in appt).toBe(false);
    expect('visitor_email' in appt).toBe(false);

    // Everything the kiosk appointment-confirm screen renders is kept
    for (const key of [
      'id', 'reference_code', 'appointment_date', 'time_slot', 'visitor_name',
      'status', 'officer_name', 'officer_title', 'directorate_name',
      'directorate_floor', 'directorate_wing',
    ]) {
      expect(key in appt, key).toBe(true);
    }
    expect(appt.visitor_name).toBe('Ama Mensah');
    expect(appt.officer_name).toBe('Dr. Mensah');
    expect(appt.directorate_name).toBe('RSIMD');
  });

  it('rate-limits per IP after 20 lookups in a minute', async () => {
    const { env } = makeEnv();
    const app = makeApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.request('/appt/ref/ABC234', {}, env);
      expect(res.status, `request ${i + 1}`).toBe(200);
    }
    const blocked = await app.request('/appt/ref/ABC234', {}, env);
    expect(blocked.status).toBe(429);
  });
});
