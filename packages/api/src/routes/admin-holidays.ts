import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, created, error, notFound } from '../lib/response';
import { recordAudit, auditActorFromContext } from '../services/audit';

export const adminHolidayRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

// List all configured public holidays (superadmin).
adminHolidayRoutes.get('/', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const rows = await c.env.DB.prepare('SELECT id, date, name FROM holidays ORDER BY date').all();
  return success(c, rows.results ?? []);
});

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  name: z.string().min(1).max(120).trim(),
});

adminHolidayRoutes.post('/', zValidator('json', createSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const { date, name } = c.req.valid('json');
  const existing = await c.env.DB.prepare('SELECT id FROM holidays WHERE date = ?').bind(date).first();
  if (existing) return error(c, 'DUPLICATE', `A holiday already exists on ${date}`, 400);
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare('INSERT INTO holidays (id, date, name) VALUES (?, ?, ?)').bind(id, date, name).run();
  const row = await c.env.DB.prepare('SELECT id, date, name FROM holidays WHERE id = ?').bind(id).first();
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'holiday.create', entityType: 'holiday', entityId: id,
    summary: `Added public holiday ${date} — ${name}`,
  });
  return created(c, row);
});

adminHolidayRoutes.delete('/:id', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id, date, name FROM holidays WHERE id = ?')
    .bind(id).first<{ id: string; date: string; name: string }>();
  if (!existing) return notFound(c, 'Holiday');
  await c.env.DB.prepare('DELETE FROM holidays WHERE id = ?').bind(id).run();
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'holiday.delete', entityType: 'holiday', entityId: id,
    summary: `Removed public holiday ${existing.date} — ${existing.name}`,
  });
  return success(c, { removed: true });
});
