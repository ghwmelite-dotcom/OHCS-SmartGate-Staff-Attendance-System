import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';

// Visitor satisfaction survey — read side for the Client Service tier
// (reception parity). Spec: 2026-07-20-visitor-satisfaction-survey-design.
export const surveyRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const SURVEY_ROLES = ['superadmin', 'admin', 'receptionist'] as const;

const listQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  directorate_id: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(50),
});

const summaryQuerySchema = listQuerySchema.omit({ rating: true, page: true, page_size: true });

// Translate filters into a WHERE clause over the visitor_surveys alias `s`.
function buildWhere(q: { from?: string; to?: string; rating?: number; directorate_id?: string }) {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (q.from) { clauses.push('s.created_at >= ?'); binds.push(`${q.from}T00:00:00Z`); }
  if (q.to) { clauses.push('s.created_at <= ?'); binds.push(`${q.to}T23:59:59Z`); }
  if (q.rating) { clauses.push('s.rating = ?'); binds.push(q.rating); }
  if (q.directorate_id) { clauses.push('s.directorate_id = ?'); binds.push(q.directorate_id); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', binds };
}

// Paginated list with visitor/host context for follow-up. page_size up to 500
// so the Feedback page can pull a full export set and build CSV client-side.
surveyRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const blocked = requireRole(c, ...SURVEY_ROLES);
  if (blocked) return blocked;
  const q = c.req.valid('query');
  const { where, binds } = buildWhere(q);

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM visitor_surveys s ${where}`
  ).bind(...binds).first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.rating, s.comment, s.created_at, s.wait_minutes, s.badge_code, s.source,
            v.first_name, v.last_name, d.abbreviation AS directorate_abbr,
            COALESCE(o.name, vis.host_name_manual) AS host_name
     FROM visitor_surveys s
     JOIN visits vis ON vis.id = s.visit_id
     JOIN visitors v ON v.id = vis.visitor_id
     LEFT JOIN directorates d ON d.id = s.directorate_id
     LEFT JOIN officers o ON o.id = s.host_officer_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, q.page_size, (q.page - 1) * q.page_size).all();

  return success(c, { rows: rows.results ?? [], total: total?.n ?? 0, page: q.page, page_size: q.page_size });
});

// Aggregate stats + response rate (surveys / completed checkouts in period).
surveyRoutes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const blocked = requireRole(c, ...SURVEY_ROLES);
  if (blocked) return blocked;
  const q = c.req.valid('query');
  const { where, binds } = buildWhere(q);

  const agg = await c.env.DB.prepare(
    `SELECT AVG(s.rating) AS average, COUNT(*) AS total,
            SUM(CASE WHEN s.rating <= 2 THEN 1 ELSE 0 END) AS low
     FROM visitor_surveys s ${where}`
  ).bind(...binds).first<{ average: number | null; total: number; low: number | null }>();

  const dist = await c.env.DB.prepare(
    `SELECT s.rating, COUNT(*) AS n FROM visitor_surveys s ${where} GROUP BY s.rating`
  ).bind(...binds).all<{ rating: number; n: number }>();

  // Denominator for the response rate: visits checked out in the same window.
  // Keyed on check_out_at (the moment the survey was offered), not check_in_at.
  const visitClauses: string[] = ["status = 'checked_out'"];
  const visitBinds: unknown[] = [];
  if (q.from) { visitClauses.push('check_out_at >= ?'); visitBinds.push(`${q.from}T00:00:00Z`); }
  if (q.to) { visitClauses.push('check_out_at <= ?'); visitBinds.push(`${q.to}T23:59:59Z`); }
  if (q.directorate_id) { visitClauses.push('directorate_id = ?'); visitBinds.push(q.directorate_id); }
  const checkouts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM visits WHERE ${visitClauses.join(' AND ')}`
  ).bind(...visitBinds).first<{ n: number }>();

  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const d of dist.results ?? []) distribution[String(d.rating)] = d.n;

  const total = agg?.total ?? 0;
  const checkoutCount = checkouts?.n ?? 0;
  return success(c, {
    average: agg?.average ?? null,
    total,
    low: agg?.low ?? 0,
    distribution,
    checkouts: checkoutCount,
    response_rate: checkoutCount > 0 ? total / checkoutCount : null,
  });
});
