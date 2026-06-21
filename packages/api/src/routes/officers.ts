import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, notFound } from '../lib/response';
import { requireRole } from '../lib/require-role';

export const officerRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Explicit column list — never expose officers.telegram_chat_id to API consumers.
const OFFICER_COLUMNS = `o.id, o.name, o.title, o.directorate_id, o.email, o.phone,
       o.office_number, o.is_available, o.created_at, o.updated_at,
       (o.override_pin_hash IS NOT NULL) as has_override_pin,
       d.name as directorate_name, d.abbreviation as directorate_abbr`;

officerRoutes.get('/', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const directorateId = c.req.query('directorate_id');
  let sql = `SELECT ${OFFICER_COLUMNS}
             FROM officers o
             JOIN directorates d ON o.directorate_id = d.id`;
  const params: unknown[] = [];

  if (directorateId) {
    sql += ' WHERE o.directorate_id = ?';
    params.push(directorateId);
  }
  sql += ' ORDER BY d.abbreviation, o.name';

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

officerRoutes.get('/:id', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const id = c.req.param('id');
  const officer = await c.env.DB.prepare(
    `SELECT ${OFFICER_COLUMNS}
     FROM officers o JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
  ).bind(id).first();
  if (!officer) return notFound(c, 'Officer');
  return success(c, officer);
});
