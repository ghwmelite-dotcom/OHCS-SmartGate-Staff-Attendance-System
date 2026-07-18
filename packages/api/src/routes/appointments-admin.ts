import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { sendTelegramMessage } from '../services/telegram';

export const appointmentsAdminRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: SessionData };
}>();

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppointmentAdminRow {
  id: string;
  officer_id: string;
  reference_code: string;
  appointment_date: string;
  time_slot: string;
  visitor_name: string;
  visitor_phone: string;
  visitor_email: string | null;
  organisation: string | null;
  purpose: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  approver_notes: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
  officer_name: string;
  officer_title: string | null;
  directorate_name: string;
  approved_by_name: string | null;
}

interface OfficerTelegramRow {
  telegram_chat_id: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function canActOnAppointment(
  env: Env,
  session: SessionData,
  officerId: string,
): Promise<boolean> {
  if (session.role === 'superadmin' || session.role === 'admin') return true;
  const row = await env.DB.prepare(
    'SELECT id FROM appointment_approvers WHERE officer_id = ? AND user_id = ?',
  )
    .bind(officerId, session.userId)
    .first();
  return row !== null;
}

// ─── Route: GET / ─────────────────────────────────────────────────────────────

appointmentsAdminRoutes.get('/', async (c) => {
  const session = c.get('session');
  const statusFilter = c.req.query('status');
  const officerIdFilter = c.req.query('officer_id');
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const offset = (page - 1) * limit;

  const isAdminLevel = session.role === 'superadmin' || session.role === 'admin';

  const baseSelect = `SELECT a.*, o.name as officer_name, o.title as officer_title,
       d.name as directorate_name,
       u.name as approved_by_name
FROM appointments a
JOIN officers o ON o.id = a.officer_id
JOIN directorates d ON d.id = o.directorate_id
LEFT JOIN users u ON u.id = a.approved_by`;

  const baseCount = `SELECT COUNT(*) as total
FROM appointments a
JOIN officers o ON o.id = a.officer_id
JOIN directorates d ON d.id = o.directorate_id
LEFT JOIN users u ON u.id = a.approved_by`;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!isAdminLevel) {
    conditions.push(`a.officer_id IN (SELECT officer_id FROM appointment_approvers WHERE user_id = ?)`);
    params.push(session.userId);
  }

  if (officerIdFilter) {
    conditions.push(`a.officer_id = ?`);
    params.push(officerIdFilter);
  }
  if (statusFilter) {
    conditions.push(`a.status = ?`);
    params.push(statusFilter);
  }
  if (dateFrom) {
    conditions.push(`a.appointment_date >= ?`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`a.appointment_date <= ?`);
    params.push(dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderClause = `ORDER BY a.appointment_date DESC, a.time_slot DESC`;

  const countSql = `${baseCount} ${whereClause}`;
  const listSql = `${baseSelect} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;

  const countRow = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const listParams = [...params, limit, offset];
  const rows = await c.env.DB.prepare(listSql)
    .bind(...listParams)
    .all<AppointmentAdminRow>();

  return success(c, {
    appointments: rows.results ?? [],
    total,
    page,
    limit,
  });
});

// ─── Route: PATCH /:id/confirm ────────────────────────────────────────────────

appointmentsAdminRoutes.patch(
  '/:id/confirm',
  zValidator('json', z.object({ approver_notes: z.string().max(500).optional() })),
  async (c) => {
    const session = c.get('session');
    const id = c.req.param('id');
    const { approver_notes } = c.req.valid('json');

    const appt = await c.env.DB.prepare(
      `SELECT a.*, o.telegram_chat_id
       FROM appointments a
       JOIN officers o ON o.id = a.officer_id
       WHERE a.id = ?`,
    )
      .bind(id)
      .first<AppointmentAdminRow & OfficerTelegramRow>();

    if (!appt) return notFound(c, 'Appointment');

    const allowed = await canActOnAppointment(c.env, session, appt.officer_id);
    if (!allowed) return error(c, 'FORBIDDEN', 'You do not have permission to confirm this appointment', 403);

    if (appt.status !== 'pending') {
      return error(c, 'INVALID_STATE', `Appointment is already ${appt.status}`, 422);
    }

    await c.env.DB.prepare(
      `UPDATE appointments
       SET status = 'confirmed',
           approved_by = ?,
           approved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           approver_notes = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`,
    )
      .bind(session.userId, approver_notes ?? null, id)
      .run();

    // Notify officer via Telegram if they have a chat_id
    const chatId = appt.telegram_chat_id;
    if (chatId) {
      try {
        await sendTelegramMessage({
          chatId,
          text: `📅 Appointment confirmed\n${appt.visitor_name} (${appt.visitor_phone}) — ${appt.appointment_date} at ${appt.time_slot}\nPurpose: ${appt.purpose}`,
          token: c.env.TELEGRAM_BOT_TOKEN,
        });
      } catch {
        // Non-fatal
      }
    }

    return success(c, { ok: true });
  },
);

// ─── Route: PATCH /:id/decline ────────────────────────────────────────────────

appointmentsAdminRoutes.patch(
  '/:id/decline',
  zValidator('json', z.object({ decline_reason: z.string().min(5).max(500) })),
  async (c) => {
    const session = c.get('session');
    const id = c.req.param('id');
    const { decline_reason } = c.req.valid('json');

    const appt = await c.env.DB.prepare('SELECT id, officer_id, status FROM appointments WHERE id = ?')
      .bind(id)
      .first<{ id: string; officer_id: string; status: string }>();

    if (!appt) return notFound(c, 'Appointment');

    const allowed = await canActOnAppointment(c.env, session, appt.officer_id);
    if (!allowed) return error(c, 'FORBIDDEN', 'You do not have permission to decline this appointment', 403);

    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      return error(c, 'INVALID_STATE', `Appointment cannot be declined when status is ${appt.status}`, 422);
    }

    await c.env.DB.prepare(
      `UPDATE appointments
       SET status = 'declined',
           approved_by = ?,
           approved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           decline_reason = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`,
    )
      .bind(session.userId, decline_reason, id)
      .run();

    return success(c, { ok: true });
  },
);

// ─── Route: PATCH /:id/cancel ─────────────────────────────────────────────────

appointmentsAdminRoutes.patch(
  '/:id/cancel',
  zValidator('json', z.object({ decline_reason: z.string().max(500).optional() })),
  async (c) => {
    const session = c.get('session');
    const id = c.req.param('id');

    if (session.role !== 'superadmin' && session.role !== 'admin') {
      return error(c, 'FORBIDDEN', 'Only admins can cancel appointments', 403);
    }

    const { decline_reason } = c.req.valid('json');

    const appt = await c.env.DB.prepare('SELECT id, status FROM appointments WHERE id = ?')
      .bind(id)
      .first<{ id: string; status: string }>();

    if (!appt) return notFound(c, 'Appointment');

    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      return error(c, 'INVALID_STATE', `Appointment cannot be cancelled when status is ${appt.status}`, 422);
    }

    await c.env.DB.prepare(
      `UPDATE appointments
       SET status = 'cancelled',
           approved_by = ?,
           approved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           decline_reason = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`,
    )
      .bind(session.userId, decline_reason ?? null, id)
      .run();

    return success(c, { ok: true });
  },
);

// ─── Route: PATCH /:id/complete ───────────────────────────────────────────────

appointmentsAdminRoutes.patch('/:id/complete', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');

  const appt = await c.env.DB.prepare('SELECT id, officer_id, status FROM appointments WHERE id = ?')
    .bind(id)
    .first<{ id: string; officer_id: string; status: string }>();

  if (!appt) return notFound(c, 'Appointment');

  const allowed = await canActOnAppointment(c.env, session, appt.officer_id);
  if (!allowed) return error(c, 'FORBIDDEN', 'You do not have permission to complete this appointment', 403);

  if (appt.status !== 'confirmed') {
    return error(c, 'INVALID_STATE', `Appointment must be confirmed to mark as completed (current: ${appt.status})`, 422);
  }

  await c.env.DB.prepare(
    `UPDATE appointments
     SET status = 'completed',
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`,
  )
    .bind(id)
    .run();

  return success(c, { ok: true });
});

// ─── Route: GET /setup/bookable-officers ──────────────────────────────────────

appointmentsAdminRoutes.get('/setup/bookable-officers', async (c) => {
  const session = c.get('session');

  if (session.role !== 'superadmin' && session.role !== 'admin') {
    return error(c, 'FORBIDDEN', 'Only admins can manage bookable officer setup', 403);
  }

  const rows = await c.env.DB.prepare(
    `SELECT bo.*, o.name as officer_name, o.title as officer_title,
            d.name as directorate_name
     FROM bookable_officers bo
     JOIN officers o ON o.id = bo.officer_id
     JOIN directorates d ON d.id = o.directorate_id
     ORDER BY o.name`,
  ).all();

  return success(c, { bookable_officers: rows.results ?? [] });
});

// ─── Route: POST /setup/bookable-officers ─────────────────────────────────────

const BookableOfficerSchema = z.object({
  officer_id: z.string(),
  is_active: z.boolean().default(true),
  slot_duration_mins: z.number().int().min(15).max(120).default(30),
  slot_start_time: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  slot_end_time: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
  advance_days_min: z.number().int().min(0).max(90).default(1),
  advance_days_max: z.number().int().min(1).max(365).default(30),
});

appointmentsAdminRoutes.post(
  '/setup/bookable-officers',
  zValidator('json', BookableOfficerSchema),
  async (c) => {
    const session = c.get('session');

    if (session.role !== 'superadmin' && session.role !== 'admin') {
      return error(c, 'FORBIDDEN', 'Only admins can manage bookable officer setup', 403);
    }

    const body = c.req.valid('json');

    await c.env.DB.prepare(
      `INSERT INTO bookable_officers
         (id, officer_id, is_active, slot_duration_mins,
          slot_start_time, slot_end_time, advance_days_min, advance_days_max, updated_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(officer_id) DO UPDATE SET
         is_active = excluded.is_active,
         slot_duration_mins = excluded.slot_duration_mins,
         slot_start_time = excluded.slot_start_time,
         slot_end_time = excluded.slot_end_time,
         advance_days_min = excluded.advance_days_min,
         advance_days_max = excluded.advance_days_max,
         updated_at = excluded.updated_at`,
    )
      .bind(
        body.officer_id,
        body.is_active ? 1 : 0,
        body.slot_duration_mins,
        body.slot_start_time,
        body.slot_end_time,
        body.advance_days_min,
        body.advance_days_max,
      )
      .run();

    return success(c, { ok: true });
  },
);

// ─── Route: DELETE /setup/bookable-officers/:officerId ────────────────────────

appointmentsAdminRoutes.delete('/setup/bookable-officers/:officerId', async (c) => {
  const session = c.get('session');

  if (session.role !== 'superadmin' && session.role !== 'admin') {
    return error(c, 'FORBIDDEN', 'Only admins can manage bookable officer setup', 403);
  }

  const officerId = c.req.param('officerId');

  await c.env.DB.prepare('DELETE FROM bookable_officers WHERE officer_id = ?')
    .bind(officerId)
    .run();

  return success(c, { ok: true });
});

// ─── Route: GET /setup/approvers/:officerId ───────────────────────────────────

appointmentsAdminRoutes.get('/setup/approvers/:officerId', async (c) => {
  const session = c.get('session');

  if (session.role !== 'superadmin' && session.role !== 'admin') {
    return error(c, 'FORBIDDEN', 'Only admins can manage appointment approvers', 403);
  }

  const officerId = c.req.param('officerId');

  const rows = await c.env.DB.prepare(
    `SELECT aa.id, aa.officer_id, aa.user_id, aa.created_at,
            u.name as user_name, u.email as user_email, u.role as user_role
     FROM appointment_approvers aa
     JOIN users u ON u.id = aa.user_id
     WHERE aa.officer_id = ?
     ORDER BY u.name`,
  )
    .bind(officerId)
    .all();

  return success(c, { approvers: rows.results ?? [] });
});

// ─── Route: POST /setup/approvers ─────────────────────────────────────────────

appointmentsAdminRoutes.post(
  '/setup/approvers',
  zValidator('json', z.object({ officer_id: z.string(), user_id: z.string() })),
  async (c) => {
    const session = c.get('session');

    if (session.role !== 'superadmin' && session.role !== 'admin') {
      return error(c, 'FORBIDDEN', 'Only admins can manage appointment approvers', 403);
    }

    const { officer_id, user_id } = c.req.valid('json');

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO appointment_approvers (id, officer_id, user_id)
       VALUES (lower(hex(randomblob(16))), ?, ?)`,
    )
      .bind(officer_id, user_id)
      .run();

    return success(c, { ok: true });
  },
);

// ─── Route: DELETE /setup/approvers/:id ──────────────────────────────────────

appointmentsAdminRoutes.delete('/setup/approvers/:id', async (c) => {
  const session = c.get('session');

  if (session.role !== 'superadmin' && session.role !== 'admin') {
    return error(c, 'FORBIDDEN', 'Only admins can manage appointment approvers', 403);
  }

  const id = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM appointment_approvers WHERE id = ?')
    .bind(id)
    .run();

  return success(c, { ok: true });
});
