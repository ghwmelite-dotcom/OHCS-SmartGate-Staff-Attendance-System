import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
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
