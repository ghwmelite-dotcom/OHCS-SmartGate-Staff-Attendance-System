import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, created, notFound } from '../lib/response';
import { recordAudit, auditActorFromContext, diffRecords } from '../services/audit';

export const adminDirectorateRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

const createSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  abbreviation: z.string().min(1).max(20).trim(),
  type: z.enum(['directorate', 'secretariat', 'unit']),
  rooms: z.string().max(200).optional().or(z.literal('')),
  floor: z.string().max(100).optional().or(z.literal('')),
  wing: z.string().max(100).optional().or(z.literal('')),
});

// List ALL directorates incl. inactive (superadmin) — the public GET /directorates
// filters to is_active = 1, which would hide a deactivated entity and make it
// impossible to reactivate from the dashboard.
adminDirectorateRoutes.get('/', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM directorates ORDER BY is_active DESC, abbreviation'
  ).all();
  return success(c, rows.results ?? []);
});

adminDirectorateRoutes.post('/', zValidator('json', createSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    'INSERT INTO directorates (id, name, abbreviation, type, rooms, floor, wing) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name, body.abbreviation.toUpperCase(), body.type, body.rooms || null, body.floor || null, body.wing || null).run();

  const row = await c.env.DB.prepare('SELECT * FROM directorates WHERE id = ?').bind(id).first();
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'directorate.create', entityType: 'directorate', entityId: id,
    summary: `Created ${body.type} ${body.abbreviation.toUpperCase()} — ${body.name}`,
  });
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

  const existing = await c.env.DB.prepare('SELECT * FROM directorates WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!existing) return notFound(c, 'Directorate');

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.abbreviation !== undefined) { fields.push('abbreviation = ?'); values.push(body.abbreviation.toUpperCase()); }
  if (body.type !== undefined) { fields.push('type = ?'); values.push(body.type); }
  if (body.rooms !== undefined) { fields.push('rooms = ?'); values.push(body.rooms || null); }
  if (body.floor !== undefined) { fields.push('floor = ?'); values.push(body.floor || null); }
  if (body.wing !== undefined) { fields.push('wing = ?'); values.push(body.wing || null); }
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

  const row = await c.env.DB.prepare('SELECT * FROM directorates WHERE id = ?').bind(id).first<Record<string, unknown>>();
  const changes = diffRecords(existing, row, ['name', 'abbreviation', 'type', 'rooms', 'floor', 'wing', 'is_active', 'reception_officer_id']);
  if (Object.keys(changes).length > 0) {
    const onlyPrimary = Object.keys(changes).length === 1 && !!changes.reception_officer_id;
    await recordAudit(c.env, auditActorFromContext(c), {
      action: onlyPrimary ? 'reception_team.set_primary' : 'directorate.update',
      entityType: 'directorate', entityId: id,
      summary: onlyPrimary
        ? `Set primary receiver for ${existing.abbreviation}`
        : `Updated directorate ${existing.abbreviation}`,
      changes,
    });
  }
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
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'reception_team.add', entityType: 'directorate', entityId: id,
    summary: `Added officer ${officer_id} to the reception team`,
  });
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
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'reception_team.remove', entityType: 'directorate', entityId: id,
    summary: `Removed officer ${officerId} from the reception team`,
  });
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
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'officer.create', entityType: 'officer', entityId: id,
    summary: `Created officer ${body.name}${body.title ? ` (${body.title})` : ''}`,
  });
  return created(c, row);
});

const officerUpdateSchema = officerCreateSchema.partial().extend({
  is_available: z.number().min(0).max(1).optional(),
});

adminDirectorateRoutes.put('/officers/:id', zValidator('json', officerUpdateSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT id, name, title, directorate_id, email, phone, office_number, is_available FROM officers WHERE id = ?'
  ).bind(id).first<Record<string, unknown> & { name?: string }>();
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
  const after = await c.env.DB.prepare(
    'SELECT name, title, directorate_id, email, phone, office_number, is_available FROM officers WHERE id = ?'
  ).bind(id).first<Record<string, unknown>>();
  const changes = diffRecords(existing, after, ['name', 'title', 'directorate_id', 'email', 'phone', 'office_number', 'is_available']);
  if (Object.keys(changes).length > 0) {
    await recordAudit(c.env, auditActorFromContext(c), {
      action: 'officer.update', entityType: 'officer', entityId: id,
      summary: `Updated officer ${existing.name ?? id}`,
      changes,
    });
  }
  return success(c, row);
});

// Generate a one-time Telegram deep-link for an officer (superadmin).
adminDirectorateRoutes.post('/officers/:id/link-token', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  // Guard: until the real bot @username is configured, a deep link would be malformed.
  if (!c.env.TELEGRAM_BOT_USERNAME || c.env.TELEGRAM_BOT_USERNAME === 'REPLACE_WITH_BOT_USERNAME') {
    return error(c, 'BOT_NOT_CONFIGURED', 'Telegram bot username is not configured yet. Set TELEGRAM_BOT_USERNAME before generating deep links.', 503);
  }
  const id = c.req.param('id');
  const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE id = ?').bind(id).first();
  if (!officer) return notFound(c, 'Officer');
  const token = crypto.randomUUID().replace(/-/g, '');
  await c.env.KV.put(`officer-link:${token}`, id, { expirationTtl: 7 * 86400 });
  const url = `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'officer.telegram_link_issued', entityType: 'officer', entityId: id,
    summary: `Issued a Telegram link token for officer ${id}`,
  });
  return success(c, { url, token });
});

// Revoke an officer's Telegram link (superadmin).
adminDirectorateRoutes.delete('/officers/:id/telegram', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = NULL WHERE id = ?').bind(id).run();
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'officer.telegram_revoked', entityType: 'officer', entityId: id,
    summary: `Revoked the Telegram link for officer ${id}`,
  });
  return success(c, { unlinked: true });
});
