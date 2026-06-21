import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { listAudit, verifyChain } from '../services/audit';

export const adminAuditRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

// Bounded query — cap `q` (it drives a LIKE scan), clamp the cursor/limit, and
// require ISO-ish dates, so this can't be abused to DoS the audit table.
const listQuerySchema = z.object({
  entity_type: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  actor: z.string().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'from must be ISO date').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'to must be ISO date').optional(),
  q: z.string().max(100).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Paginated, filtered audit-log listing (newest first).
adminAuditRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const q = c.req.valid('query');
  const { rows, nextCursor } = await listAudit(c.env, {
    entityType: q.entity_type || undefined,
    action: q.action || undefined,
    actorUserId: q.actor || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    q: q.q || undefined,
    beforeSeq: q.cursor,
    limit: q.limit,
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
