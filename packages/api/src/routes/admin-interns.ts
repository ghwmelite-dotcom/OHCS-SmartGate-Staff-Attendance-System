import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { error, created, success } from '../lib/response';
import { hashPin } from '../services/auth';
import { requireRole } from '../lib/require-role';
import { nextInternCode } from '../services/intern-code';
import {
  generateInitialPin,
  isValidIsoDate,
  PERSONNEL_SELECT_COLUMNS,
  type NssUserRow,
} from './admin-nss';

export const adminInternRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

export const createInternSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).toLowerCase().trim(),
  institution: z.string().max(200).optional().or(z.literal('')),
  programme: z.string().max(200).optional().or(z.literal('')),
  supervisor_user_id: z.string().max(64).optional().or(z.literal('')),
  directorate_id: z.string().min(1, 'directorate_id is required'),
  nss_start_date: z.string().refine(isValidIsoDate, 'nss_start_date must be ISO YYYY-MM-DD'),
  nss_end_date: z.string().refine(isValidIsoDate, 'nss_end_date must be ISO YYYY-MM-DD'),
  grade: z.string().max(100).optional().or(z.literal('')),
});

/** Reusable supervisor validity check — must be an existing staff user. */
export async function assertValidSupervisor(db: D1Database, supervisorId: string): Promise<boolean> {
  const sup = await db
    .prepare(`SELECT id FROM users WHERE id = ? AND user_type = 'staff'`)
    .bind(supervisorId)
    .first<{ id: string }>();
  return !!sup;
}

// GET /api/admin/interns/supervisors — active staff users (id + name) for the supervisor picker.
// Reachable by admin (the full /users list is superadmin-only), exposes only id+name.
adminInternRoutes.get('/supervisors', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;
  const res = await c.env.DB
    .prepare(`SELECT id, name FROM users WHERE user_type = 'staff' AND is_active = 1 ORDER BY name ASC`)
    .all<{ id: string; name: string }>();
  return success(c, res.results ?? []);
});

adminInternRoutes.post('/', zValidator('json', createInternSchema), async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const body = c.req.valid('json');
  if (body.nss_end_date <= body.nss_start_date) {
    return error(c, 'INVALID_RANGE', 'nss_end_date must be after nss_start_date', 400);
  }

  const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?')
    .bind(body.directorate_id).first<{ id: string }>();
  if (!dir) return error(c, 'INVALID_DIRECTORATE', 'directorate_id does not reference an existing directorate', 400);

  if (body.supervisor_user_id && !(await assertValidSupervisor(c.env.DB, body.supervisor_user_id))) {
    return error(c, 'INVALID_SUPERVISOR', 'supervisor_user_id must reference an existing staff user', 400);
  }

  const dupEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
  if (dupEmail) return error(c, 'DUPLICATE_EMAIL', 'A user with this email already exists', 409);

  const id = crypto.randomUUID().replace(/-/g, '');
  const initialPin = generateInitialPin();
  const pinHash = await hashPin(initialPin);
  const year = new Date().getUTCFullYear();

  let internCode = await nextInternCode(c.env.DB, year);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO users
           (id, name, email, pin_hash, pin_acknowledged, role, grade, directorate_id,
            user_type, nss_start_date, nss_end_date,
            intern_code, institution, programme, supervisor_user_id, is_active)
         VALUES (?, ?, ?, ?, 0, 'staff', ?, ?, 'intern', ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        id, body.name, body.email, pinHash, body.grade || null, body.directorate_id,
        body.nss_start_date, body.nss_end_date,
        internCode, body.institution || null, body.programme || null, body.supervisor_user_id || null,
      ).run();
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0 && /UNIQUE/i.test(msg) && /intern_code/i.test(msg)) {
        internCode = await nextInternCode(c.env.DB, year);
        continue;
      }
      if (/UNIQUE/i.test(msg) && /intern_code/i.test(msg)) {
        return error(c, 'CODE_COLLISION', 'Could not allocate an intern code, please retry', 409);
      }
      throw e;
    }
  }

  const user = await c.env.DB.prepare(
    `SELECT ${PERSONNEL_SELECT_COLUMNS}
       FROM users u
       LEFT JOIN directorates d ON u.directorate_id = d.id
       LEFT JOIN users sup ON sup.id = u.supervisor_user_id
      WHERE u.id = ?`
  ).bind(id).first<NssUserRow>();

  return created(c, { user, initial_pin: initialPin });
});
