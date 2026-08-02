/**
 * Backup fail-closed (plan 2026-08-01-vms-audit-fixes.md, Commit E): with
 * BACKUP_ENCRYPTION_KEY unset the nightly backup used to write PLAINTEXT D1
 * dumps (full PII) to R2 with only a console warning. Now it fails closed:
 * no objects are written, every table is reported failed (so destructive
 * operations gated on a complete backup refuse to proceed), and
 * alertAdminError pages the admins.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportBackupToR2, BACKUP_TABLES } from './backup';
import type { Env } from '../types';

const SERVICES_DIR = dirname(fileURLToPath(import.meta.url));

afterEach(() => vi.unstubAllGlobals());

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
  const schema = readFileSync(join(SERVICES_DIR, '..', 'db', 'schema.sql'), 'utf8');
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

function makeEnv(opts: { key?: string; environment?: string } = {}) {
  const store = new Map<string, string>();
  const puts: string[] = [];
  const db = newDb();
  const env = {
    ENVIRONMENT: opts.environment ?? 'test',
    BACKUP_ENCRYPTION_KEY: opts.key,
    TELEGRAM_BOT_TOKEN: 't',
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    STORAGE: {
      put: async (k: string) => { puts.push(k); },
      list: async () => ({ objects: [], delimitedPrefixes: [], truncated: false }),
    },
    DB: d1(db),
  } as unknown as Env;
  return { env, store, puts };
}

// 32-byte AES key, base64 — same shape as prod's secret.
const KEY = Buffer.from('a'.repeat(32)).toString('base64');

describe('exportBackupToR2 — fail-closed without BACKUP_ENCRYPTION_KEY', () => {
  it('writes NOTHING to R2 and reports every table failed', async () => {
    const { env, puts } = makeEnv(); // no key
    const result = await exportBackupToR2(env);
    expect(puts).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.failed).toEqual([...BACKUP_TABLES]);
    expect(result.encrypted).toBe(false);
  });

  it('pages the admins (alertAdminError → Telegram) in production', async () => {
    const { env, store } = makeEnv({ environment: 'production' });
    store.set('telegram-admin-chat-id', '999');
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await exportBackupToR2(env);
    expect(fetchMock).toHaveBeenCalled();
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('BACKUP_ENCRYPTION_KEY');
  });

  it('with the key set, backups proceed as before', async () => {
    const { env, puts } = makeEnv({ key: KEY });
    const result = await exportBackupToR2(env);
    expect(result.failed).toEqual([]);
    expect(result.encrypted).toBe(true);
    expect(puts.length).toBe(BACKUP_TABLES.length);
  });
});
