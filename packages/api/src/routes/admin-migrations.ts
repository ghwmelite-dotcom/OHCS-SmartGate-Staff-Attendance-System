import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { MIGRATIONS, sha256Hex } from '../db/migrations-index';

export const adminMigrationsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

adminMigrationsRoutes.post('/run', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const applied: string[] = [];
  const skipped: string[] = [];
  const failures: Array<{ filename: string; errorMessage: string }> = [];

  for (const m of MIGRATIONS) {
    const existing = await c.env.DB.prepare(
      'SELECT filename FROM applied_migrations WHERE filename = ?'
    ).bind(m.filename).first<{ filename: string }>();

    if (existing) {
      skipped.push(m.filename);
      continue;
    }

    // Strip whole-line `--` comments BEFORE splitting on `;\n`. The previous
    // approach split first and then filtered chunks starting with `--`, which
    // silently dropped any statement that shared a chunk with leading
    // comments (i.e. nearly every migration in this repo).
    const cleaned = m.sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleaned
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      for (const stmt of statements) {
        await c.env.DB.prepare(stmt).run();
      }
      const hash = await sha256Hex(m.sql);
      await c.env.DB.prepare(
        'INSERT INTO applied_migrations (filename, hash) VALUES (?, ?)'
      ).bind(m.filename, hash).run();
      applied.push(m.filename);
    } catch (err) {
      failures.push({ filename: m.filename, errorMessage: err instanceof Error ? err.message : String(err) });
      break;
    }
  }

  return success(c, { applied, skipped, failures });
});

// One-time, idempotent fix: drop the legacy users.role CHECK constraint via a
// single DB.batch() transaction (the only place PRAGMA defer_foreign_keys is
// honored). Not handled by /run because prod's applied_migrations is out of sync.
adminMigrationsRoutes.post('/drop-users-role-check', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const ddl = await c.env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ sql: string }>();
  if (!ddl) return error(c, 'NO_USERS_TABLE', 'users table not found', 500);

  // Idempotent: if the role CHECK is already gone, do nothing.
  if (!/CHECK\s*\(\s*role\s+IN/i.test(ddl.sql)) {
    return success(c, { status: 'already-dropped' });
  }

  const migration = MIGRATIONS.find((m) => m.filename === 'migration-users-role-check-drop.sql');
  if (!migration) return error(c, 'MIGRATION_MISSING', 'migration not registered', 500);

  // Same strip-comments / split-on-`;\n` logic as the /run handler.
  const cleaned = migration.sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = cleaned
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  try {
    // Single transaction → PRAGMA defer_foreign_keys=TRUE (first statement) holds,
    // so DROP TABLE users is allowed and FK integrity re-checks at commit.
    await c.env.DB.batch(statements.map((s) => c.env.DB.prepare(s)));
    return success(c, { status: 'applied', statements: statements.length });
  } catch (err) {
    return error(c, 'MIGRATION_FAILED', err instanceof Error ? err.message : String(err), 500);
  }
});
