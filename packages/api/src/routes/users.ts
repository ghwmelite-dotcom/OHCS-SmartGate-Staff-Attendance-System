import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, created, notFound } from '../lib/response';
import { hashPin } from '../services/auth';

export const userRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Superadmin guard
function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  const session = c.get('session');
  return session.role === 'superadmin';
}

// List all users
userRoutes.get('/', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const results = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.staff_id, u.role, u.grade, u.is_active, u.last_login_at, u.created_at,
            u.user_type, u.nss_number, u.nss_start_date, u.nss_end_date,
            d.abbreviation as directorate_abbr
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id
     ORDER BY u.created_at DESC`
  ).all();

  return success(c, results.results ?? []);
});

// Get single user
userRoutes.get('/:id', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const id = c.req.param('id');
  const user = await c.env.DB.prepare(
    `SELECT id, name, email, staff_id, role, is_active, last_login_at, created_at, updated_at,
            user_type, nss_number, nss_start_date, nss_end_date
     FROM users WHERE id = ?`
  ).bind(id).first();

  if (!user) return notFound(c, 'User');
  return success(c, user);
});

// Create user
const createUserSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).toLowerCase().trim(),
  staff_id: z.string().min(1).max(20).trim(),
  pin: z.string().length(4).regex(/^\d{4}$/, 'PIN must be 4 digits'),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().max(100).optional().or(z.literal('')),
  directorate_code: z.string().max(20).optional().or(z.literal('')),
});

userRoutes.post('/', zValidator('json', createUserSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const body = c.req.valid('json');

  // Check uniqueness
  const existingEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
  if (existingEmail) return error(c, 'DUPLICATE', 'A user with this email already exists', 409);

  const existingStaffId = await c.env.DB.prepare('SELECT id FROM users WHERE staff_id = ?').bind(body.staff_id.toUpperCase()).first();
  if (existingStaffId) return error(c, 'DUPLICATE', 'A user with this staff ID already exists', 409);

  const id = crypto.randomUUID().replace(/-/g, '');
  const pinHash = await hashPin(body.pin);

  // Resolve directorate code to ID
  let directorateId: string | null = null;
  if (body.directorate_code) {
    const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE abbreviation = ?')
      .bind(body.directorate_code.toUpperCase()).first<{ id: string }>();
    if (dir) directorateId = dir.id;
  }

  await c.env.DB.prepare(
    `INSERT INTO users (id, name, email, staff_id, pin_hash, role, grade, directorate_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.name, body.email, body.staff_id.toUpperCase(), pinHash, body.role, body.grade || null, directorateId).run();

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.staff_id, u.role, u.grade, u.is_active, u.created_at,
            d.abbreviation as directorate_abbr
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id WHERE u.id = ?`
  ).bind(id).first();

  return created(c, user);
});

// Update user
const updateUserSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  email: z.string().email().max(255).toLowerCase().trim().optional(),
  staff_id: z.string().min(1).max(20).trim().optional(),
  pin: z.string().length(4).regex(/^\d{4}$/).optional(),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']).optional(),
  grade: z.string().max(100).optional().or(z.literal('')),
  directorate_code: z.string().max(20).optional().or(z.literal('')),
  is_active: z.number().min(0).max(1).optional(),
});

userRoutes.put('/:id', zValidator('json', updateUserSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_type FROM users WHERE id = ?'
  ).bind(id).first<{ id: string; user_type: string }>();
  if (!existing) return notFound(c, 'User');

  // Service personnel (NSS/Intern) are not eligible for admin roles. Block any role
  // change on those users that would land outside of plain 'staff'.
  if (
    body.role !== undefined &&
    body.role !== 'staff' &&
    existing.user_type === 'nss'
  ) {
    return error(c, 'NSS_NOT_PROMOTABLE', 'Service personnel (NSS/Intern) cannot be promoted to an admin role', 400);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email); }
  if (body.staff_id !== undefined) { fields.push('staff_id = ?'); values.push(body.staff_id.toUpperCase()); }
  if (body.role !== undefined) { fields.push('role = ?'); values.push(body.role); }
  if (body.grade !== undefined) { fields.push('grade = ?'); values.push(body.grade || null); }
  if (body.directorate_code !== undefined) {
    if (body.directorate_code) {
      const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE abbreviation = ?')
        .bind(body.directorate_code.toUpperCase()).first<{ id: string }>();
      fields.push('directorate_id = ?'); values.push(dir?.id ?? null);
    } else {
      fields.push('directorate_id = ?'); values.push(null);
    }
  }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active); }
  if (body.pin !== undefined) {
    const pinHash = await hashPin(body.pin);
    fields.push('pin_hash = ?');
    values.push(pinHash);
  }

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  if (fields.length > 1) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const user = await c.env.DB.prepare(
    `SELECT id, name, email, staff_id, role, is_active, last_login_at, created_at, updated_at,
            user_type, nss_number, nss_start_date, nss_end_date
     FROM users WHERE id = ?`
  ).bind(id).first();

  return success(c, user);
});

// Delete (deactivate) user
userRoutes.delete('/:id', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const id = c.req.param('id');
  const session = c.get('session');

  if (id === session.userId) {
    return error(c, 'SELF_DELETE', 'You cannot deactivate your own account', 400);
  }

  await c.env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(id).run();
  return success(c, { message: 'User deactivated' });
});
