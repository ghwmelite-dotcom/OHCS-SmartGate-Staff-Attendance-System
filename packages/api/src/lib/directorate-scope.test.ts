/**
 * Directorate-scope resolver tests (plan: docs/superpowers/plans/2026-08-02-oversight-roles-cd-hos.md, Task 1).
 *
 * CD/HoS are display_role overlays on role='director' accounts (no new role
 * values — the Client Service precedent). The resolver must resolve them
 * org-wide (null) BEFORE the fail-closed sentinel path, including the
 * acting-CD case (display_role set while directorate_id is still linked).
 */
import { describe, it, expect } from 'vitest';
import { resolveDirectorateScope, DIRECTORATE_SCOPE_NONE } from './directorate-scope';

type Ctx = Parameters<typeof resolveDirectorateScope>[0];

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown };
}

function newDb(users: Array<{ id: string; directorate_id: string | null; display_role?: string | null }>): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db: SqliteDb = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, directorate_id TEXT, display_role TEXT)');
  const ins = db.prepare('INSERT INTO users (id, directorate_id, display_role) VALUES (?, ?, ?)');
  for (const u of users) ins.run(u.id, u.directorate_id, u.display_role ?? null);
  return db;
}

function d1(db: SqliteDb) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async <T = unknown>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
          };
        },
      };
    },
  };
}

function mockCtx(role: string, userId: string, db: SqliteDb): Ctx {
  return {
    get: (key: string) => (key === 'session' ? { userId, role } : undefined),
    env: { DB: d1(db) },
  } as unknown as Ctx;
}

const DIR = 'a'.repeat(32);

describe('resolveDirectorateScope — oversight display roles', () => {
  it("director with display_role='chief_director' (no directorate) resolves org-wide (null)", async () => {
    const db = newDb([{ id: 'cd1', directorate_id: null, display_role: 'chief_director' }]);
    expect(await resolveDirectorateScope(mockCtx('director', 'cd1', db))).toBeNull();
  });

  it("director with display_role='head_of_service' (no directorate) resolves org-wide (null)", async () => {
    const db = newDb([{ id: 'hos1', directorate_id: null, display_role: 'head_of_service' }]);
    expect(await resolveDirectorateScope(mockCtx('director', 'hos1', db))).toBeNull();
  });

  it('acting-CD: display_role set WITH a linked directorate still resolves org-wide', async () => {
    const db = newDb([{ id: 'cd2', directorate_id: DIR, display_role: 'chief_director' }]);
    expect(await resolveDirectorateScope(mockCtx('director', 'cd2', db))).toBeNull();
  });

  it('plain director WITHOUT an entity keeps the fail-closed sentinel', async () => {
    const db = newDb([{ id: 'd1', directorate_id: null }]);
    expect(await resolveDirectorateScope(mockCtx('director', 'd1', db))).toBe(DIRECTORATE_SCOPE_NONE);
  });

  it('plain director WITH an entity (no display_role) resolves to their directorate_id', async () => {
    const db = newDb([{ id: 'd2', directorate_id: DIR, display_role: null }]);
    expect(await resolveDirectorateScope(mockCtx('director', 'd2', db))).toBe(DIR);
  });

  it('non-director roles resolve unscoped without touching the DB', async () => {
    const db = newDb([]);
    expect(await resolveDirectorateScope(mockCtx('admin', 'nobody', db))).toBeNull();
    expect(await resolveDirectorateScope(mockCtx('staff', 'nobody', db))).toBeNull();
  });
});
