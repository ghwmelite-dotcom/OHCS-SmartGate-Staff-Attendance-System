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
      const officer = await c.env.DB.prepare('SELECT directorate_id FROM officers WHERE id = ?')
        .bind(recId).first<{ directorate_id: string }>();
      if (!officer) return error(c, 'INVALID_OFFICER', 'Officer not found', 400);
      if (officer.directorate_id !== id) {
        return error(c, 'INVALID_OFFICER', 'Reception officer must belong to this directorate', 400);
      }
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
