import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { recordAudit, auditActorFromContext } from '../services/audit';

type App = { Bindings: Env; Variables: { session: SessionData } };
type Access = { global: boolean; directorates: string[] };
export const noticeRoutes = new Hono<App>();

// Re-read active account and assignments: cached sessions cannot widen scope.
async function access(c: Context<App>): Promise<Access | null> {
  const user = await c.env.DB.prepare('SELECT role, display_role, directorate_id, staff_id, email FROM users WHERE id = ? AND is_active = 1')
    .bind(c.get('session').userId).first<{ role: string; display_role: string | null; directorate_id: string | null; staff_id: string | null; email: string | null }>();
  if (!user) return null;
  if (user.role === 'superadmin' || (user.role === 'director' && ['chief_director', 'head_of_service'].includes(user.display_role ?? ''))) return { global: true, directorates: [] };
  const heads = await c.env.DB.prepare(`SELECT d.id FROM directorates d JOIN officers o ON o.id = d.head_officer_id
    WHERE d.is_active = 1 AND o.staff_id IS NOT NULL AND o.staff_id = ?
      AND (SELECT COUNT(*) FROM users WHERE staff_id = o.staff_id AND is_active = 1) = 1`)
    .bind(user.staff_id).all<{ id: string }>();
  const ids = new Set((heads.results ?? []).map(r => r.id));
  if (user.role === 'director' && user.directorate_id) ids.add(user.directorate_id);
  return { global: false, directorates: [...ids] };
}

function scope(a: Access, mine: boolean, userId: string): { sql: string; binds: string[] } {
  if (mine) return { sql: 'n.user_id = ?', binds: [userId] };
  if (a.global) return { sql: '1=1', binds: [] };
  if (!a.directorates.length) return { sql: '0=1', binds: [] };
  return { sql: `n.directorate_id IN (${a.directorates.map(() => '?').join(',')})`, binds: a.directorates };
}
const projection = `n.*, u.name AS staff_name, d.name AS directorate_name, d.abbreviation AS directorate_abbr,
  ack.name AS acknowledged_by_name,
  CASE WHEN n.withdrawn_at IS NOT NULL THEN 'withdrawn' WHEN n.acknowledged_at IS NOT NULL THEN 'acknowledged' ELSE 'submitted' END AS status`;
const joins = 'FROM notice_register n JOIN users u ON u.id=n.user_id LEFT JOIN directorates d ON d.id=n.directorate_id LEFT JOIN users ack ON ack.id=n.acknowledged_by';

noticeRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });

const querySchema = z.object({
  view: z.enum(['mine', 'register']).default('mine'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'submitted', 'acknowledged', 'withdrawn']).default('all'),
  from: z.string().date().optional(), to: z.string().date().optional(),
});

noticeRoutes.get('/', zValidator('query', querySchema), async c => {
  const a = await access(c);
  if (!a) return error(c, 'FORBIDDEN', 'Active account required', 403);
  const q = c.req.valid('query');
  const canReview = a.global || a.directorates.length > 0;
  if (q.view === 'register' && !canReview) return error(c, 'FORBIDDEN', 'Directorate oversight access required', 403);
  if (q.from && q.to && q.from > q.to) return error(c, 'BAD_DATE', 'Start date must not follow end date', 400);
  const filter = scope(a, q.view === 'mine', c.get('session').userId);
  const clauses = [filter.sql];
  const binds: (string | number)[] = [...filter.binds];
  if (q.q) { clauses.push('(instr(lower(u.name), lower(?)) > 0 OR instr(lower(n.id), lower(?)) > 0)'); binds.push(q.q, q.q); }
  if (q.from) { clauses.push('n.notice_date >= ?'); binds.push(q.from); }
  if (q.to) { clauses.push('n.notice_date <= ?'); binds.push(q.to); }
  if (q.status === 'withdrawn') clauses.push('n.withdrawn_at IS NOT NULL');
  if (q.status === 'submitted') clauses.push('n.withdrawn_at IS NULL AND n.acknowledged_at IS NULL');
  if (q.status === 'acknowledged') clauses.push('n.withdrawn_at IS NULL AND n.acknowledged_at IS NOT NULL');
  const where = clauses.join(' AND ');
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total ${joins} WHERE ${where}`).bind(...binds).first<{ total: number }>();
  const rows = await c.env.DB.prepare(`SELECT ${projection} ${joins} WHERE ${where} ORDER BY n.notice_date DESC, n.created_at DESC, n.id DESC LIMIT 20 OFFSET ?`)
    .bind(...binds, (q.page - 1) * 20).all();
  await recordAudit(c.env, auditActorFromContext(c), { action: 'notice.list', entityType: 'absence_notice', summary: `Read ${q.view} notices page ${q.page}` });
  return success(c, { notices: rows.results ?? [], total: count?.total ?? 0, page: q.page, page_size: 20, can_review: canReview });
});

noticeRoutes.get('/:id', async c => {
  const a = await access(c);
  if (!a) return error(c, 'FORBIDDEN', 'Active account required', 403);
  const filter = scope(a, false, c.get('session').userId);
  const row = await c.env.DB.prepare(`SELECT ${projection} ${joins} WHERE n.id=? AND (n.user_id=? OR (${filter.sql}))`)
    .bind(c.req.param('id'), c.get('session').userId, ...filter.binds).first<{ id: string; user_id: string; status: string }>();
  if (!row) return error(c, 'NOT_FOUND', 'Notice not found', 404);
  const revisions = await c.env.DB.prepare('SELECT r.version, r.event, r.reason, r.note, r.expected_return_date, r.at, u.name AS actor_name FROM notice_revisions r LEFT JOIN users u ON u.id=r.actor_id WHERE r.notice_id=? ORDER BY r.id DESC').bind(row.id).all();
  await recordAudit(c.env, auditActorFromContext(c), { action: 'notice.read', entityType: 'absence_notice', entityId: row.id, summary: 'Viewed notice and revision history' });
  return success(c, { ...row, revisions: revisions.results ?? [], can_acknowledge: row.user_id !== c.get('session').userId && row.status === 'submitted' && (a.global || a.directorates.length > 0) });
});

noticeRoutes.post('/:id/acknowledge', zValidator('json', z.object({ version: z.number().int().positive() })), async c => {
  const a = await access(c);
  if (!a || (!a.global && !a.directorates.length)) return error(c, 'FORBIDDEN', 'Directorate oversight access required', 403);
  const filter = scope(a, false, c.get('session').userId);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT n.id,n.user_id FROM notice_register n WHERE n.id=? AND ${filter.sql}`).bind(id, ...filter.binds).first<{ id: string; user_id: string }>();
  if (!row) return error(c, 'NOT_FOUND', 'Notice not found', 404);
  if (row.user_id === c.get('session').userId) return error(c, 'FORBIDDEN', 'You cannot acknowledge your own notice', 403);
  const result = await c.env.DB.prepare(`UPDATE notice_register AS n SET acknowledged_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), acknowledged_by=?
    WHERE id=? AND version=? AND withdrawn_at IS NULL AND acknowledged_at IS NULL AND ${filter.sql}`)
    .bind(c.get('session').userId, id, c.req.valid('json').version, ...filter.binds).run();
  if (!result.meta.changes) return error(c, 'CONFLICT', 'This notice changed or was already acknowledged. Refresh and review it again.', 409);
  await recordAudit(c.env, auditActorFromContext(c), { action: 'notice.acknowledge', entityType: 'absence_notice', entityId: id, summary: `Acknowledged version ${c.req.valid('json').version}; not leave approval` });
  return success(c, { acknowledged: true });
});
