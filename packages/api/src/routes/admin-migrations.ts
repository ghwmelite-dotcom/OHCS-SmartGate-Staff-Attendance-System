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

    try {
      // exec() passes the raw SQL string to SQLite in one shot — all statements
      // run sequentially in a single implicit transaction and each statement sees
      // the committed state of its predecessors. This avoids the per-statement
      // FK ordering issues that can arise with batch(). The applied_migrations
      // bookkeeping INSERT stays OUTSIDE exec() and runs only after it succeeds.
      await c.env.DB.exec(m.sql);
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
