import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { hashPin } from '../services/auth';
import { recordAudit, auditActorFromContext } from '../services/audit';
import { sendWelcomeEmail } from '../services/email';
import { generateInitialPin, isValidIsoDate } from './admin-nss';
import { nextInternCode } from '../services/intern-code';

function defaultPinFromStaffId(staffId: string): string {
  const digits = staffId.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
}

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

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'users.bulk_import', entityType: 'user', entityId: null,
    summary: `Bulk import (users): ${imported} imported, ${skipped} skipped`,
  });
  return success(c, { imported, skipped, errors });
});

// Bulk import directorates
const dirRowSchema = z.object({
  name: z.string().min(1).max(255),
  abbreviation: z.string().min(1).max(255),
  type: z.enum(['directorate', 'secretariat', 'unit']),
  rooms: z.string().max(255).optional(),
  floor: z.string().max(255).optional(),
  wing: z.string().max(255).optional(),
});

bulkImportRoutes.post('/directorates', async (c) => {
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
    const parsed = dirRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, abbreviation, type, rooms, floor, wing } = parsed.data;
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
      'INSERT INTO directorates (id, name, abbreviation, type, rooms, floor, wing) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, abbr, type, rooms || null, floor || null, wing || null).run();

    imported++;
  }

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'directorates.bulk_import', entityType: 'directorate', entityId: null,
    summary: `Bulk import (directorates): ${imported} imported, ${skipped} skipped`,
  });
  return success(c, { imported, skipped, errors });
});

// Bulk import officers
const officerRowSchema = z.object({
  name: z.string().min(1).max(255),
  title: z.string().max(255).optional(),
  directorate_code: z.string().min(1).max(255),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(255).optional(),
  office_number: z.string().max(255).optional(),
  staff_id: z.string().max(20).optional().or(z.literal('')),
});

bulkImportRoutes.post('/officers', async (c) => {
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
    const parsed = officerRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, title, directorate_code, email, phone, office_number, staff_id } = parsed.data;
    const normalizedStaffId = staff_id ? staff_id.toUpperCase().trim() : null;

    // Look up directorate by code
    const dir = await c.env.DB.prepare(
      'SELECT id FROM directorates WHERE abbreviation = ?'
    ).bind(directorate_code.toUpperCase()).first<{ id: string }>();

    if (!dir) {
      errors.push({ row: i + 1, message: `Unknown directorate code: ${directorate_code}` });
      skipped++;
      continue;
    }

    // Check for duplicate staff_id in officers
    if (normalizedStaffId) {
      const existingOfficer = await c.env.DB.prepare(
        'SELECT id FROM officers WHERE staff_id = ?'
      ).bind(normalizedStaffId).first();
      if (existingOfficer) {
        errors.push({ row: i + 1, message: `Staff ID already exists: ${normalizedStaffId}` });
        skipped++;
        continue;
      }
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      'INSERT INTO officers (id, name, title, directorate_id, email, phone, office_number, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, title || null, dir.id, email || null, phone || null, office_number || null, normalizedStaffId).run();

    // Auto-provision a Staff Attendance user account when staff_id is provided
    if (normalizedStaffId) {
      const existingUser = await c.env.DB.prepare(
        'SELECT id FROM users WHERE staff_id = ?'
      ).bind(normalizedStaffId).first();

      if (!existingUser) {
        const pin = defaultPinFromStaffId(normalizedStaffId);
        const pinHash = await hashPin(pin);
        const userId = crypto.randomUUID().replace(/-/g, '');
        const userEmail = email || `${normalizedStaffId.toLowerCase()}@ohcs.internal`;

        const emailClash = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
          .bind(userEmail).first();

        if (!emailClash) {
          await c.env.DB.prepare(
            `INSERT INTO users (id, name, email, staff_id, pin_hash, role, directorate_id)
             VALUES (?, ?, ?, ?, ?, 'staff', ?)`
          ).bind(userId, name, userEmail, normalizedStaffId, pinHash, dir.id).run();

          if (email) {
            c.executionCtx.waitUntil(sendWelcomeEmail(c.env, {
              userId,
              name,
              email,
              role: 'staff',
              identifierLabel: 'Staff ID',
              identifierValue: normalizedStaffId,
              pin,
            }));
          }
        }
      }
    }

    imported++;
  }

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'officers.bulk_import', entityType: 'officer', entityId: null,
    summary: `Bulk import (officers): ${imported} imported, ${skipped} skipped`,
  });
  return success(c, { imported, skipped, errors });
});

// Bulk import NSS service personnel
const NSS_NUMBER_REGEX = /^NSS[A-Z]{3}\d{7}$/;

const nssRowSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  nss_number: z.string().min(1),
  nss_start_date: z.string().min(1),
  nss_end_date: z.string().min(1),
  directorate_code: z.string().min(1),
  grade: z.string().optional().or(z.literal('')),
});

bulkImportRoutes.post('/nss', async (c) => {
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
  const pins: Array<{ row: number; name: string; email: string; identifier: string; initial_pin: string }> = [];

  for (let i = 0; i < body.rows.length; i++) {
    const parsed = nssRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, email, nss_number, nss_start_date, nss_end_date, directorate_code, grade } = parsed.data;
    const normalizedNss = nss_number.toUpperCase().trim();

    if (!NSS_NUMBER_REGEX.test(normalizedNss)) {
      errors.push({ row: i + 1, message: `Invalid NSS number: ${nss_number} — expected NSS + 3 letters + 7 digits (e.g. NSSGUE8364724)` });
      skipped++;
      continue;
    }

    if (!isValidIsoDate(nss_start_date) || !isValidIsoDate(nss_end_date)) {
      errors.push({ row: i + 1, message: `Invalid date format for ${name} — expected YYYY-MM-DD` });
      skipped++;
      continue;
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? OR nss_number = ?'
    ).bind(email.toLowerCase(), normalizedNss).first();

    if (existing) {
      errors.push({ row: i + 1, message: `Duplicate email or NSS number: ${email} / ${normalizedNss}` });
      skipped++;
      continue;
    }

    const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE abbreviation = ?')
      .bind(directorate_code.toUpperCase()).first<{ id: string }>();

    if (!dir) {
      errors.push({ row: i + 1, message: `Unknown directorate code: ${directorate_code}` });
      skipped++;
      continue;
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    const initialPin = generateInitialPin();
    const pinHash = await hashPin(initialPin);

    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, pin_hash, role, grade, directorate_id, user_type, nss_number, nss_start_date, nss_end_date)
       VALUES (?, ?, ?, ?, 'staff', ?, ?, 'nss', ?, ?, ?)`
    ).bind(id, name, email.toLowerCase(), pinHash, grade || null, dir.id, normalizedNss, nss_start_date, nss_end_date).run();

    pins.push({ row: i + 1, name, email: email.toLowerCase(), identifier: normalizedNss, initial_pin: initialPin });

    c.executionCtx.waitUntil(sendWelcomeEmail(c.env, {
      userId: id, name, email: email.toLowerCase(), role: 'staff',
      identifierLabel: 'NSS Number', identifierValue: normalizedNss, pin: initialPin,
    }));

    imported++;
  }

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'nss.bulk_import', entityType: 'user', entityId: null,
    summary: `Bulk import (NSS): ${imported} imported, ${skipped} skipped`,
  });
  return success(c, { imported, skipped, errors, pins });
});

// Bulk import interns
const internRowSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  nss_start_date: z.string().min(1),
  nss_end_date: z.string().min(1),
  directorate_code: z.string().min(1),
  institution: z.string().optional().or(z.literal('')),
  programme: z.string().optional().or(z.literal('')),
  grade: z.string().optional().or(z.literal('')),
});

bulkImportRoutes.post('/interns', async (c) => {
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
  const pins: Array<{ row: number; name: string; email: string; identifier: string; initial_pin: string }> = [];

  const year = new Date().getUTCFullYear();

  for (let i = 0; i < body.rows.length; i++) {
    const parsed = internRowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid data' });
      skipped++;
      continue;
    }

    const { name, email, nss_start_date, nss_end_date, directorate_code, institution, programme, grade } = parsed.data;

    if (!isValidIsoDate(nss_start_date) || !isValidIsoDate(nss_end_date)) {
      errors.push({ row: i + 1, message: `Invalid date format for ${name} — expected YYYY-MM-DD` });
      skipped++;
      continue;
    }

    const existingEmail = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (existingEmail) {
      errors.push({ row: i + 1, message: `Duplicate email: ${email}` });
      skipped++;
      continue;
    }

    const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE abbreviation = ?')
      .bind(directorate_code.toUpperCase()).first<{ id: string }>();

    if (!dir) {
      errors.push({ row: i + 1, message: `Unknown directorate code: ${directorate_code}` });
      skipped++;
      continue;
    }

    const id = crypto.randomUUID().replace(/-/g, '');
    const initialPin = generateInitialPin();
    const pinHash = await hashPin(initialPin);
    const internCode = await nextInternCode(c.env.DB, year);

    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, pin_hash, role, grade, directorate_id, user_type, intern_code, institution, programme, nss_start_date, nss_end_date)
       VALUES (?, ?, ?, ?, 'staff', ?, ?, 'nss', ?, ?, ?, ?, ?)`
    ).bind(id, name, email.toLowerCase(), pinHash, grade || null, dir.id, internCode, institution || null, programme || null, nss_start_date, nss_end_date).run();

    pins.push({ row: i + 1, name, email: email.toLowerCase(), identifier: internCode, initial_pin: initialPin });

    c.executionCtx.waitUntil(sendWelcomeEmail(c.env, {
      userId: id, name, email: email.toLowerCase(), role: 'staff',
      identifierLabel: 'Intern Code', identifierValue: internCode, pin: initialPin,
    }));

    imported++;
  }

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'interns.bulk_import', entityType: 'user', entityId: null,
    summary: `Bulk import (interns): ${imported} imported, ${skipped} skipped`,
  });
  return success(c, { imported, skipped, errors, pins });
});
