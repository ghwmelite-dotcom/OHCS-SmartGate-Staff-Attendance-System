import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const reportSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  directorate_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

reportRoutes.get('/visits', zValidator('query', reportSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'director', 'receptionist');
  if (blocked) return blocked;
  const { from, to, directorate_id, limit } = c.req.valid('query');

  let sql = `SELECT v.check_in_at, v.check_out_at, v.duration_minutes, v.status, v.badge_code,
                    v.purpose_raw, v.purpose_category,
                    vis.first_name, vis.last_name, vis.organisation, vis.phone,
                    o.name as host_name,
                    d.abbreviation as directorate_abbr, d.name as directorate_name
             FROM visits v
             JOIN visitors vis ON v.visitor_id = vis.id
             LEFT JOIN officers o ON v.host_officer_id = o.id
             LEFT JOIN directorates d ON v.directorate_id = d.id
             WHERE DATE(v.check_in_at) >= ? AND DATE(v.check_in_at) <= ?`;
  const params: unknown[] = [from, to];

  if (directorate_id) {
    sql += ' AND v.directorate_id = ?';
    params.push(directorate_id);
  }

  sql += ' ORDER BY v.check_in_at DESC LIMIT ?';
  params.push(limit);

  const results = await c.env.DB.prepare(sql).bind(...params).all();

  // Summary stats
  const summary = await c.env.DB.prepare(
    `SELECT COUNT(*) as total_visits,
            COUNT(DISTINCT v.visitor_id) as unique_visitors,
            ROUND(AVG(v.duration_minutes)) as avg_duration,
            (SELECT d2.abbreviation FROM visits v2 JOIN directorates d2 ON v2.directorate_id = d2.id
             WHERE DATE(v2.check_in_at) >= ? AND DATE(v2.check_in_at) <= ?
             GROUP BY d2.id ORDER BY COUNT(*) DESC LIMIT 1) as busiest_directorate
     FROM visits v
     WHERE DATE(v.check_in_at) >= ? AND DATE(v.check_in_at) <= ?`
  ).bind(from, to, from, to).first<{
    total_visits: number;
    unique_visitors: number;
    avg_duration: number | null;
    busiest_directorate: string | null;
  }>();

  return success(c, {
    summary: {
      total_visits: summary?.total_visits ?? 0,
      unique_visitors: summary?.unique_visitors ?? 0,
      avg_duration: summary?.avg_duration ?? 0,
      busiest_directorate: summary?.busiest_directorate ?? 'N/A',
      from,
      to,
    },
    visits: results.results ?? [],
  });
});
