/**
 * Kiosk photo-overwrite token binding (plan 2026-08-01-vms-audit-fixes.md,
 * Commit E): GET /kiosk/visitor-by-phone discloses the visitor id, and the
 * three photo-upload routes were open to anyone — so any lobby user could
 * overwrite a stored face/ID photo. Now visitor-by-phone mints a short-lived
 * KV token (`photo-upload:<token>` → visitorId, 10-min TTL) returned as
 * upload_token, and replacing an EXISTING photo requires it. First upload for
 * a visitor with no stored photo stays open (new-visitor kiosk flow).
 *
 * Boots the REAL kiosk routes over the node:sqlite D1 shim + Map KV + fake R2
 * (pattern from kiosk-idempotency.test.ts), full schema.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { kioskRoutes } from './kiosk';
import type { Env } from '../types';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

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
  db.exec('PRAGMA foreign_keys = ON;'); // mirror D1, which forces FKs on
  const schema = readFileSync(join(ROUTES_DIR, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
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
      get: async (k: string, type?: string) => {
        const v = store.get(k);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    STORAGE: { put: async () => ({}) },
    DB: d1(db),
  } as unknown as Env;
  return { env, db };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/kiosk', kioskRoutes);
  return app;
}

// Minimal JPEG (magic bytes FF D8 FF) so the isJpeg guard passes.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).buffer;

function addVisitor(db: SqliteDb, id: string, phone: string, photoUrl: string | null): void {
  db.prepare('INSERT INTO visitors (id, first_name, last_name, phone, organisation, photo_url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'Ama', 'Mensah', phone, 'Ghana Cocoa Board', photoUrl);
}

function addCompletedVisit(db: SqliteDb, id: string, visitorId: string): void {
  db.prepare("INSERT INTO visits (id, visitor_id, status) VALUES (?, ?, 'checked_out')").run(id, visitorId);
}

async function lookupByPhone(env: Env, phone: string): Promise<{ id: string; upload_token?: string }> {
  const res = await makeApp().request(`/kiosk/visitor-by-phone?phone=${encodeURIComponent(phone)}`, {}, env);
  expect(res.status).toBe(200);
  return (await res.json() as { data: { id: string; upload_token?: string } }).data;
}

function uploadPhoto(env: Env, visitorId: string, kind: string, token?: string) {
  return makeApp().request(`/kiosk/visitors/${visitorId}/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      ...(token ? { 'x-upload-token': token } : {}),
    },
    body: JPEG,
  }, env);
}

describe('GET /kiosk/visitor-by-phone — mints an upload token', () => {
  it('returns upload_token bound to the matched visitor', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1', '0241234567', '/api/photos/visitors/v1');
    addCompletedVisit(db, 's1', 'v1');
    const data = await lookupByPhone(env, '0241234567');
    expect(data.id).toBe('v1');
    expect(data.upload_token).toBeTruthy();
  });
});

describe('POST /kiosk/visitors/:id/photo — overwrite token binding', () => {
  it('first upload (no stored photo) stays open without a token', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1', '0241234567', null);
    const res = await uploadPhoto(env, 'v1', 'photo');
    expect(res.status).toBe(200);
  });

  it('replacing a stored photo WITHOUT a token is rejected (403)', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1', '0241234567', '/api/photos/visitors/v1');
    const res = await uploadPhoto(env, 'v1', 'photo');
    expect(res.status).toBe(403);
  });

  it('replacing a stored photo with a WRONG-visitor token is rejected', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1', '0241234567', '/api/photos/visitors/v1');
    addVisitor(db, 'v2', '0201234567', '/api/photos/visitors/v2');
    addCompletedVisit(db, 's2', 'v2');
    const { upload_token } = await lookupByPhone(env, '0201234567'); // token for v2
    const res = await uploadPhoto(env, 'v1', 'photo', upload_token);
    expect(res.status).toBe(403);
  });

  it('replacing a stored photo with the matching token succeeds', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1', '0241234567', '/api/photos/visitors/v1');
    addCompletedVisit(db, 's1', 'v1');
    const { upload_token } = await lookupByPhone(env, '0241234567');
    const res = await uploadPhoto(env, 'v1', 'photo', upload_token);
    expect(res.status).toBe(200);
  });

  it('the same binding applies to id-photo-back', async () => {
    const { env, db } = makeEnv();
    addVisitor(db, 'v1', '0241234567', null);
    db.prepare("UPDATE visitors SET id_photo_back_url = '/api/photos/visitors/v1/id-back' WHERE id = 'v1'").run();
    addCompletedVisit(db, 's1', 'v1');

    expect((await uploadPhoto(env, 'v1', 'id-photo-back')).status).toBe(403);
    const { upload_token } = await lookupByPhone(env, '0241234567');
    expect((await uploadPhoto(env, 'v1', 'id-photo-back', upload_token)).status).toBe(200);
  });
});
