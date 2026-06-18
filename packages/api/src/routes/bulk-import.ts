import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { hashPin } from '../services/auth';

export const bulkImportRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

// Bulk import users
const userRowSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  staff_id: z.string().min(1),
  pin: z.string().length(4).regex(/^\d{4}$/),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().optional().or(z.literal('')),
  directorate_code: z.string().optional().or(z.literal('')),
});

bulkImportRoutes.post('/users', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const body = await c.req.json() as { rows: unknown[] };
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return error(c, 'EMPTY', 'No rows to import', 400);
  }
  if (body.rows.length > 200) {
    return error(c, 'TOO_MANY', 'Maximum 200 rows per import', 400);
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < body.rows.length; i++) {
    const parsed = userRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, email, staff_id, pin, role, grade, directorate_code } = parsed.data;

    // Check duplicates
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? OR staff_id = ?'
    ).bind(email.toLowerCase(), staff_id.toUpperCase()).first();

    if (existing) {
      errors.push({ row: i + 1, message: `Duplicate email or staff ID: ${email} / ${staff_id}` });
      skipped++;
      continue;
    }

    // Resolve directorate
    let directorateId: string | null = null;
    if (directorate_code) {
      const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE abbreviation = ?')
        .bind(directorate_code.toUpperCase()).first<{ id: string }>();
      if (dir) directorateId = dir.id;
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    const pinHash = await hashPin(pin);

    await c.env.DB.prepare(
      'INSERT INTO users (id, name, email, staff_id, pin_hash, role, grade, directorate_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, email.toLowerCase(), staff_id.toUpperCase(), pinHash, role, grade || null, directorateId).run();

    imported++;
  }

  return success(c, { imported, skipped, errors });
});

// Bulk import directorates
const dirRowSchema = z.object({
  name: z.string().min(1),
  abbreviation: z.string().min(1),
  type: z.enum(['directorate', 'secretariat', 'unit']),
  rooms: z.string().optional(),
});

bulkImportRoutes.post('/directorates', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const body = await c.req.json() as { rows: unknown[] };
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return error(c, 'EMPTY', 'No rows to import', 400);
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < body.rows.length; i++) {
    const parsed = dirRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, abbreviation, type, rooms } = parsed.data;
    const abbr = abbreviation.toUpperCase();

    const existing = await c.env.DB.prepare(
      'SELECT id FROM directorates WHERE abbreviation = ?'
    ).bind(abbr).first();

    if (existing) {
      errors.push({ row: i + 1, message: `Duplicate code: ${abbr}` });
      skipped++;
      continue;
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      'INSERT INTO directorates (id, name, abbreviation, type, rooms) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, name, abbr, type, rooms || null).run();

    imported++;
  }

  return success(c, { imported, skipped, errors });
});

// Bulk import officers
const officerRowSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  directorate_code: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  office_number: z.string().optional(),
});

bulkImportRoutes.post('/officers', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const body = await c.req.json() as { rows: unknown[] };
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return error(c, 'EMPTY', 'No rows to import', 400);
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < body.rows.length; i++) {
    const parsed = officerRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, title, directorate_code, email, phone, office_number } = parsed.data;

    // Look up directorate by code
    const dir = await c.env.DB.prepare(
      'SELECT id FROM directorates WHERE abbreviation = ?'
    ).bind(directorate_code.toUpperCase()).first<{ id: string }>();

    if (!dir) {
      errors.push({ row: i + 1, message: `Unknown directorate code: ${directorate_code}` });
      skipped++;
      continue;
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      'INSERT INTO officers (id, name, title, directorate_id, email, phone, office_number) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, title || null, dir.id, email || null, phone || null, office_number || null).run();

    imported++;
  }

  return success(c, { imported, skipped, errors });
});
