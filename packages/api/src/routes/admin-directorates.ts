import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, created, notFound } from '../lib/response';

export const adminDirectorateRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

const createSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  abbreviation: z.string().min(1).max(20).trim(),
  type: z.enum(['directorate', 'secretariat', 'unit']),
  rooms: z.string().max(200).optional().or(z.literal('')),
});

adminDirectorateRoutes.post('/', zValidator('json', createSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    'INSERT INTO directorates (id, name, abbreviation, type, rooms) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, body.name, body.abbreviation.toUpperCase(), body.type, body.rooms || null).run();

  const row = await c.env.DB.prepare('SELECT * FROM directorates WHERE id = ?').bind(id).first();
  return created(c, row);
});

const updateSchema = createSchema.partial().extend({
  is_active: z.number().min(0).max(1).optional(),
  reception_officer_id: z.string().nullable().optional(),
});

adminDirectorateRoutes.put('/:id', zValidator('json', updateSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?').bind(id).first();
  if (!existing) return notFound(c, 'Directorate');

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.abbreviation !== undefined) { fields.push('abbreviation = ?'); values.push(body.abbreviation.toUpperCase()); }
  if (body.type !== undefined) { fields.push('type = ?'); values.push(body.type); }
  if (body.rooms !== undefined) { fields.push('rooms = ?'); values.push(body.rooms || null); }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active); }

  if (body.reception_officer_id !== undefined) {
    const recId = body.reception_officer_id || null;
    if (recId !== null) {
      const member = await c.env.DB.prepare(
        'SELECT 1 FROM directorate_receivers WHERE directorate_id = ? AND officer_id = ?'
      ).bind(id, recId).first();
      if (!member) return error(c, 'NOT_A_RECEIVER', 'Add the officer to the team before making them primary', 400);
    }
    fields.push('reception_officer_id = ?');
    values.push(recId);
  }

  if (fields.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE directorates SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const row = await c.env.DB.prepare('SELECT * FROM directorates WHERE id = ?').bind(id).first();
  return success(c, row);
});

// List a directorate's receiver team with link + primary state (superadmin).
adminDirectorateRoutes.get('/:id/receivers', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const dir = await c.env.DB.prepare('SELECT reception_officer_id FROM directorates WHERE id = ?')
    .bind(id).first<{ reception_officer_id: string | null }>();
  if (!dir) return notFound(c, 'Directorate');
  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.name, (o.telegram_chat_id IS NOT NULL) AS linked
     FROM directorate_receivers dr JOIN officers o ON dr.officer_id = o.id
     WHERE dr.directorate_id = ? ORDER BY o.name`
  ).bind(id).all<{ id: string; name: string; linked: number }>();
  const receivers = (rows.results ?? []).map((r) => ({
    id: r.id, name: r.name, linked: !!r.linked, primary: r.id === dir.reception_officer_id,
  }));
  return success(c, receivers);
});

const addReceiverSchema = z.object({ officer_id: z.string().min(1) });
adminDirectorateRoutes.post('/:id/receivers', zValidator('json', addReceiverSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const { officer_id } = c.req.valid('json');
  const officer = await c.env.DB.prepare('SELECT directorate_id FROM officers WHERE id = ?')
    .bind(officer_id).first<{ directorate_id: string }>();
  if (!officer) return error(c, 'INVALID_OFFICER', 'Officer not found', 400);
  if (officer.directorate_id !== id) return error(c, 'INVALID_OFFICER', 'Officer must belong to this directorate', 400);
  await c.env.DB.prepare('INSERT OR IGNORE INTO directorate_receivers (directorate_id, officer_id) VALUES (?, ?)')
    .bind(id, officer_id).run();
  return created(c, { officer_id });
});

adminDirectorateRoutes.delete('/:id/receivers/:officerId', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const officerId = c.req.param('officerId');
  await c.env.DB.prepare('DELETE FROM directorate_receivers WHERE directorate_id = ? AND officer_id = ?')
    .bind(id, officerId).run();
  await c.env.DB.prepare('UPDATE directorates SET reception_officer_id = NULL WHERE id = ? AND reception_officer_id = ?')
    .bind(id, officerId).run();
  return success(c, { removed: true });
});

// Admin: create/update officers
const officerCreateSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  title: z.string().max(100).optional().or(z.literal('')),
  directorate_id: z.string().min(1),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  office_number: z.string().max(20).optional().or(z.literal('')),
});

adminDirectorateRoutes.post('/officers', zValidator('json', officerCreateSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    'INSERT INTO officers (id, name, title, directorate_id, email, phone, office_number) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name, body.title || null, body.directorate_id, body.email || null, body.phone || null, body.office_number || null).run();

  const row = await c.env.DB.prepare(
    `SELECT o.*, d.abbreviation as directorate_abbr FROM officers o JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
  ).bind(id).first();
  return created(c, row);
});

const officerUpdateSchema = officerCreateSchema.partial().extend({
  is_available: z.number().min(0).max(1).optional(),
});

adminDirectorateRoutes.put('/officers/:id', zValidator('json', officerUpdateSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM officers WHERE id = ?').bind(id).first();
  if (!existing) return notFound(c, 'Officer');

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title || null); }
  if (body.directorate_id !== undefined) { fields.push('directorate_id = ?'); values.push(body.directorate_id); }
  if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email || null); }
  if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone || null); }
  if (body.office_number !== undefined) { fields.push('office_number = ?'); values.push(body.office_number || null); }
  if (body.is_available !== undefined) { fields.push('is_available = ?'); values.push(body.is_available); }

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  if (fields.length > 1) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE officers SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const row = await c.env.DB.prepare(
    `SELECT o.*, d.abbreviation as directorate_abbr FROM officers o JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
  ).bind(id).first();
  return success(c, row);
});

// Generate a one-time Telegram deep-link for an officer (superadmin).
adminDirectorateRoutes.post('/officers/:id/link-token', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE id = ?').bind(id).first();
  if (!officer) return notFound(c, 'Officer');
  const token = crypto.randomUUID().replace(/-/g, '');
  await c.env.KV.put(`officer-link:${token}`, id, { expirationTtl: 7 * 86400 });
  const url = `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
  return success(c, { url, token });
});

// Revoke an officer's Telegram link (superadmin).
adminDirectorateRoutes.delete('/officers/:id/telegram', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = NULL WHERE id = ?').bind(id).run();
  return success(c, { unlinked: true });
});
