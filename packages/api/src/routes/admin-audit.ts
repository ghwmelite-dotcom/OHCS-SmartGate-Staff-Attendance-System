import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { listAudit, verifyChain } from '../services/audit';

export const adminAuditRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

// Paginated, filtered audit-log listing (newest first).
adminAuditRoutes.get('/', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const q = c.req.query();
  const beforeSeq = q.cursor ? Number(q.cursor) : undefined;
  const limit = q.limit ? Number(q.limit) : undefined;
  const { rows, nextCursor } = await listAudit(c.env, {
    entityType: q.entity_type || undefined,
    action: q.action || undefined,
    actorUserId: q.actor || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    q: q.q || undefined,
    beforeSeq: Number.isFinite(beforeSeq) ? beforeSeq : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  // Parse the changes JSON for the client so it doesn't have to.
  const entries = rows.map((r) => ({
    ...r,
    changes: r.changes ? safeParse(r.changes) : null,
  }));
  return success(c, { entries, nextCursor });
});

// Re-walk and verify the hash chain.
adminAuditRoutes.get('/verify', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const result = await verifyChain(c.env);
  return success(c, result);
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
