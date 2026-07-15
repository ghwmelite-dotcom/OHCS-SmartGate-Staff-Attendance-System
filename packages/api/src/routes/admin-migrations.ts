import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { MIGRATIONS, sha256Hex } from '../db/migrations-index';
import { recordAudit, auditActorFromContext } from '../services/audit';

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

    // Strip whole-line comments and split into individual statements.
    const cleaned = m.sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = cleaned
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      // Run each statement individually so it commits before the next begins.
      // This guarantees FK checks in later statements (DELETE FROM officers)
      // see committed results from earlier ones (UPDATE visits SET host_officer_id = NULL).
      // batch() has FK ordering issues; exec() rejects large multi-statement files.
      for (const s of statements) {
        await c.env.DB.prepare(s).run();
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

  if (applied.length > 0 || failures.length > 0) {
    await recordAudit(c.env, auditActorFromContext(c), {
      action: 'migrations.run', entityType: 'migration', entityId: null,
      summary: `Ran migrations — applied ${applied.length} (${applied.join(', ') || 'none'}), ${failures.length} failed, ${skipped.length} skipped`,
    });
  }
  return success(c, { applied, skipped, failures });
});
