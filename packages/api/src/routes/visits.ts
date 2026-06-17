import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CheckInSchema } from '../lib/validation';
import { success, created, notFound, error } from '../lib/response';
import { classifyAndUpdate } from '../services/classifier';
import { notifyOnCheckIn } from '../services/notifier';
import { requireRole } from '../lib/require-role';
import { checkOutById } from '../services/check-out';
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
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director');
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
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director');
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

  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(body.visitor_id).first();
  if (!visitor) return notFound(c, 'Visitor');

  if (body.idempotency_key) {
    const existing = await c.env.DB.prepare(
      "SELECT id, badge_code FROM visits WHERE idempotency_key = ? LIMIT 1"
    ).bind(body.idempotency_key).first<{ id: string; badge_code: string }>();
    if (existing) {
      const dup = await c.env.DB.prepare(
        `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
                COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
         FROM visits v
         JOIN visitors vis ON v.visitor_id = vis.id
         LEFT JOIN officers o ON v.host_officer_id = o.id
         LEFT JOIN directorates d ON v.directorate_id = d.id
         WHERE v.id = ?`
      ).bind(existing.id).first();
      return created(c, dup);
    }
  }

  const visitId = crypto.randomUUID().replace(/-/g, '');
  const randomSuffix = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map(b => b.toString(36)).join('').slice(0, 4).toUpperCase();
  const badgeCode = `SG-${Date.now().toString(36).toUpperCase()}${randomSuffix}`;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, host_name_manual, directorate_id, purpose_raw, purpose_category, badge_code, status, created_by, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?)`
    ).bind(visitId, body.visitor_id, body.host_officer_id || null, body.host_name_manual || null,
           body.directorate_id || null, body.purpose_raw || null, body.purpose_category || null, badgeCode, session.userId, body.idempotency_key ?? null),

    c.env.DB.prepare(
      `UPDATE visitors SET total_visits = total_visits + 1, last_visit_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).bind(body.visitor_id),
  ]);

  const visit = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.id = ?`
  ).bind(visitId).first();

  // Fire classification in background (non-blocking)
  if (body.purpose_raw) {
    c.executionCtx.waitUntil(
      classifyAndUpdate(visitId, body.purpose_raw, body.directorate_id || null, c.env)
    );
  }

  // Notify host + directorate leadership (Telegram + in-app)
  if (body.host_officer_id && visit) {
    const v = visit as Record<string, unknown>;
    c.executionCtx.waitUntil(
      notifyOnCheckIn({
        visit_id: visitId,
        host_officer_id: body.host_officer_id,
        first_name: String(v.first_name ?? ''),
        last_name: String(v.last_name ?? ''),
        organisation: (v.organisation as string | null) ?? null,
        purpose_raw: body.purpose_raw || null,
        purpose_category: body.purpose_category || null,
        badge_code: badgeCode,
        check_in_at: String(v.check_in_at ?? ''),
        directorate_id: body.directorate_id || null,
        directorate_abbr: (v.directorate_abbr as string | null) ?? null,
      }, c.env)
    );
  }

  return created(c, visit);
});

visitRoutes.post('/:id/check-out', async (c) => {
  const result = await checkOutById(c.env, c.req.param('id'));
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return notFound(c, 'Visit');
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
