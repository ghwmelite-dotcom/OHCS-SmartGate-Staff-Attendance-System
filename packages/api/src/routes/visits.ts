import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CheckInSchema } from '../lib/validation';
import { success, created, notFound, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { resolveDirectorateScope } from '../lib/directorate-scope';
import { checkOutById } from '../services/check-out';
import { performCheckIn } from '../services/check-in';
import { recordAudit, auditActorFromContext } from '../services/audit';
import { z } from 'zod';

export const visitRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// host_response_by (the responding Telegram chat id) is internal audit data —
// strip it before serializing; host_response / host_response_at stay visible.
function publicVisit(row: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...row };
  delete rest.host_response_by;
  return rest;
}

const listSchema = z.object({
  date: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(['checked_in', 'checked_out', 'cancelled']).optional(),
  directorate_id: z.string().optional(),
  badge_code: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

visitRoutes.get('/', zValidator('query', listSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const { date, from, to, status, badge_code, q, limit, cursor } = c.req.valid('query');
  // Directors are isolated to their own directorate — override any incoming filter.
  const directorScope = await resolveDirectorateScope(c);
  const directorate_id = directorScope ?? c.req.valid('query').directorate_id;
  let sql = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation, vis.phone,
             COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
             FROM visits v
             JOIN visitors vis ON v.visitor_id = vis.id
             LEFT JOIN officers o ON v.host_officer_id = o.id
             LEFT JOIN directorates d ON v.directorate_id = d.id`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (date) {
    conditions.push('DATE(v.check_in_at) = ?');
    params.push(date);
  }
  if (status) {
    conditions.push('v.status = ?');
    params.push(status);
  }
  if (from) {
    conditions.push('DATE(v.check_in_at) >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('DATE(v.check_in_at) <= ?');
    params.push(to);
  }
  if (directorate_id) {
    conditions.push('v.directorate_id = ?');
    params.push(directorate_id);
  }
  if (badge_code) {
    conditions.push('v.badge_code = ?');
    params.push(badge_code);
  }
  if (q && q.length >= 2) {
    const pattern = `%${q}%`;
    conditions.push('(vis.first_name LIKE ? OR vis.last_name LIKE ? OR vis.organisation LIKE ? OR v.badge_code LIKE ?)');
    params.push(pattern, pattern, pattern, pattern);
  }
  if (cursor) {
    conditions.push('v.check_in_at < ?');
    params.push(cursor);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY v.check_in_at DESC LIMIT ?';
  params.push(limit + 1);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = (results.results ?? []).map(publicVisit);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1] as { check_in_at: string }).check_in_at : undefined;

  return success(c, items, { cursor: nextCursor, hasMore });
});

visitRoutes.get('/active', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  // Directors only see active visits for their own directorate.
  const directorScope = await resolveDirectorateScope(c);
  let sql = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.status = 'checked_in'`;
  const params: unknown[] = [];
  if (directorScope) {
    sql += ' AND v.directorate_id = ?';
    params.push(directorScope);
  }
  sql += ' ORDER BY v.check_in_at DESC';
  const results = await c.env.DB.prepare(sql).bind(...params).all();

  return success(c, (results.results ?? []).map(publicVisit));
});

visitRoutes.post('/check-in', zValidator('json', CheckInSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const body = c.req.valid('json');
  const session = c.get('session');

  const result = await performCheckIn(c.env, c.executionCtx, {
    visitor_id: body.visitor_id,
    host_officer_id: body.host_officer_id,
    host_name_manual: body.host_name_manual,
    directorate_id: body.directorate_id,
    purpose_raw: body.purpose_raw,
    purpose_category: body.purpose_category,
    idempotency_key: body.idempotency_key,
    created_by: session.userId,
    check_in_source: 'staff',
  });

  if (!result.ok) return notFound(c, 'Visitor');
  return created(c, result.visit);
});

const bulkCheckoutSchema = z.object({
  ids: z.array(z.string()).optional(),
});

// End-of-day cleanup (spec §2): close all open visits, or only the given ids,
// in one guarded UPDATE. Deliberately does NOT fan out per-visit host
// notifications (end-of-day cleanup should not spam hosts) and never touches
// checkout_pin records.
visitRoutes.post('/bulk-checkout', zValidator('json', bulkCheckoutSchema), async (c) => {
  const blocked = requireRole(c, 'receptionist', 'admin', 'superadmin');
  if (blocked) return blocked;
  const { ids } = c.req.valid('json');
  const session = c.get('session');
  const now = new Date().toISOString();

  // Maintains the same field triplet checkOutById sets: status + check_out_at
  // + duration_minutes, guarded so already-closed/cancelled rows never match.
  let sql = `UPDATE visits
             SET status = 'checked_out', check_out_at = ?,
                 duration_minutes = CAST(ROUND((julianday(?) - julianday(check_in_at)) * 1440) AS INTEGER)
             WHERE status = 'checked_in' AND check_out_at IS NULL`;
  const params: unknown[] = [now, now];
  if (ids && ids.length > 0) {
    sql += ` AND id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const res = await c.env.DB.prepare(sql).bind(...params).run();
  const checkedOut = res.meta?.changes ?? 0;

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'visit.bulk_checkout',
    entityType: 'visit',
    summary: `Bulk checkout — ${checkedOut} visit(s) closed by ${session.name}${ids?.length ? ` (${ids.length} id(s) specified)` : ' (all open)'}`,
  });
  return success(c, { checked_out: checkedOut });
});

visitRoutes.post('/:id/check-out', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const visitId = c.req.param('id');
  // Directorate isolation: a director may only check out visits in their directorate.
  const directorScope = await resolveDirectorateScope(c);
  if (directorScope !== null) {
    const v = await c.env.DB.prepare('SELECT directorate_id FROM visits WHERE id = ?')
      .bind(visitId).first<{ directorate_id: string | null }>();
    if (!v || v.directorate_id !== directorScope) return notFound(c, 'Visit');
  }
  const result = await checkOutById(c.env, visitId);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return notFound(c, 'Visit');
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
