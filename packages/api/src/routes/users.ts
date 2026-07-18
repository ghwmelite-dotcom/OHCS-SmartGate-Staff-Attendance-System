import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, created, notFound } from '../lib/response';
import { hashPin, bumpSessionEpoch } from '../services/auth';
import { sendWelcomeEmail } from '../services/email';
import { recordAudit, auditActorFromContext, diffRecords } from '../services/audit';

const AUDITED_USER_FIELDS = ['name', 'email', 'staff_id', 'role', 'grade', 'directorate_id', 'is_active', 'phone'];

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
    `SELECT u.id, u.name, u.email, u.staff_id, u.phone, u.role, u.grade, u.is_active, u.last_login_at, u.created_at,
            u.user_type, u.nss_number, u.nss_start_date, u.nss_end_date,
            d.abbreviation as directorate_abbr
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id
     ORDER BY u.created_at DESC`
  ).all();

  return success(c, results.results ?? []);
});

// Count officers who have a staff_id but no matching Staff Attendance account.
userRoutes.get('/unprovisioned-count', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM officers o
     WHERE o.staff_id IS NOT NULL AND o.staff_id != ''
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.staff_id = o.staff_id)`
  ).first<{ count: number }>();
  return success(c, { count: row?.count ?? 0 });
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
  phone: z.string().max(20).optional().or(z.literal('')),
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
    `INSERT INTO users (id, name, email, staff_id, pin_hash, role, grade, directorate_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.name, body.email, body.staff_id.toUpperCase(), pinHash, body.role, body.grade || null, directorateId, body.phone || null).run();

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.staff_id, u.role, u.grade, u.is_active, u.created_at,
            d.abbreviation as directorate_abbr
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id WHERE u.id = ?`
  ).bind(id).first();

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'user.create', entityType: 'user', entityId: id,
    summary: `Created user ${body.name} (${body.email}) · role=${body.role} · staff_id=${body.staff_id.toUpperCase()}`,
  });

  // Fire-and-forget welcome email (best-effort — never blocks/fails creation).
  c.executionCtx.waitUntil(sendWelcomeEmail(c.env, {
    userId: id,
    name: body.name,
    email: body.email,
    role: body.role,
    identifierLabel: 'Staff ID',
    identifierValue: body.staff_id.toUpperCase(),
    pin: body.pin,
  }));

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
  phone: z.string().max(20).optional().or(z.literal('')),
  directorate_code: z.string().max(20).optional().or(z.literal('')),
  is_active: z.number().min(0).max(1).optional(),
});

userRoutes.put('/:id', zValidator('json', updateUserSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_type, name, email, staff_id, role, grade, directorate_id, is_active FROM users WHERE id = ?'
  ).bind(id).first<Record<string, unknown> & { id: string; user_type: string }>();
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
  if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone || null); }
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

  const after = await c.env.DB.prepare(
    'SELECT name, email, staff_id, role, grade, directorate_id, is_active FROM users WHERE id = ?'
  ).bind(id).first<Record<string, unknown>>();
  const changes = diffRecords(existing, after, AUDITED_USER_FIELDS);
  if (body.pin !== undefined) changes.pin = { from: '[redacted]', to: '[redacted]' };
  if (Object.keys(changes).length > 0) {
    const roleChanged = !!changes.role;
    await recordAudit(c.env, auditActorFromContext(c), {
      action: roleChanged ? 'user.role_change' : 'user.update',
      entityType: 'user', entityId: id,
      summary: roleChanged
        ? `Changed role of ${existing.name} (${existing.email}): ${existing.role} → ${after?.role}`
        : `Updated user ${existing.name} (${existing.email})${body.pin !== undefined ? ' · PIN reset' : ''}`,
      changes,
    });
  }

  // Revoke existing sessions when access materially changes: role, PIN, or
  // deactivation (is_active → 0). Forces re-login with the new state.
  if (body.pin !== undefined || 'role' in changes || 'is_active' in changes) {
    await bumpSessionEpoch(c.env, id);
  }

  return success(c, user);
});

// Batch-provision Staff Attendance accounts for all officers who have a staff_id
// but no matching users row yet. Returns counts of created / already-existing.
userRoutes.post('/provision-from-officers', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const officers = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.email, o.staff_id, o.phone, o.directorate_id
     FROM officers o
     WHERE o.staff_id IS NOT NULL AND o.staff_id != ''
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.staff_id = o.staff_id)
     ORDER BY o.name`
  ).all<{ id: string; name: string; email: string | null; staff_id: string; phone: string | null; directorate_id: string }>();

  const rows = officers.results ?? [];
  let provisioned = 0;
  const skippedRows: string[] = [];

  for (const officer of rows) {
    const staffId = officer.staff_id.toUpperCase();
    const digits = staffId.replace(/\D/g, '');
    const pin = digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
    const pinHash = await hashPin(pin);
    const userId = crypto.randomUUID().replace(/-/g, '');
    const userEmail = officer.email || `${staffId.toLowerCase()}@ohcs.internal`;

    const emailClash = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first();
    if (emailClash) {
      skippedRows.push(`${officer.name} (email clash: ${userEmail})`);
      continue;
    }

    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, staff_id, pin_hash, role, directorate_id, phone)
       VALUES (?, ?, ?, ?, ?, 'staff', ?, ?)`
    ).bind(userId, officer.name, userEmail, staffId, pinHash, officer.directorate_id, officer.phone ?? null).run();

    if (officer.email) {
      c.executionCtx.waitUntil(sendWelcomeEmail(c.env, {
        userId, name: officer.name, email: officer.email, role: 'staff',
        identifierLabel: 'Staff ID', identifierValue: staffId, pin,
      }));
    }
    provisioned++;
  }

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'users.provision_from_officers', entityType: 'user', entityId: null,
    summary: `Provisioned ${provisioned} Staff Attendance accounts from officer roster${skippedRows.length ? `; ${skippedRows.length} skipped` : ''}`,
  });

  return success(c, { provisioned, skipped: skippedRows.length, skipped_details: skippedRows });
});

// Delete (deactivate) user
userRoutes.delete('/:id', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const id = c.req.param('id');
  const session = c.get('session');

  if (id === session.userId) {
    return error(c, 'SELF_DELETE', 'You cannot deactivate your own account', 400);
  }

  const target = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
    .bind(id).first<{ name: string; email: string }>();
  await c.env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(id).run();
  await bumpSessionEpoch(c.env, id); // revoke any active sessions
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'user.deactivate', entityType: 'user', entityId: id,
    summary: `Deactivated user ${target?.name ?? id}${target?.email ? ` (${target.email})` : ''}`,
  });
  return success(c, { message: 'User deactivated' });
});
