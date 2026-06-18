import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CheckInSchema } from '../lib/validation';
import { success, created, notFound, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { checkOutById } from '../services/check-out';
import { performCheckIn } from '../services/check-in';
import { z } from 'zod';

export const visitRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

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
  const { date, from, to, status, directorate_id, badge_code, q, limit, cursor } = c.req.valid('query');
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
  const rows = results.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1] as { check_in_at: string }).check_in_at : undefined;

  return success(c, items, { cursor: nextCursor, hasMore });
});

visitRoutes.get('/active', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const results = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.status = 'checked_in'
     ORDER BY v.check_in_at DESC`
  ).all();

  return success(c, results.results ?? []);
});

visitRoutes.post('/check-in', zValidator('json', CheckInSchema), async (c) => {
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

visitRoutes.post('/:id/check-out', async (c) => {
  const result = await checkOutById(c.env, c.req.param('id'));
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return notFound(c, 'Visit');
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
