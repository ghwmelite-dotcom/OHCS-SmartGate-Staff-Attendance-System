import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { resolveDirectorateScope, DIRECTORATE_SCOPE_NONE } from '../lib/directorate-scope';
import { sendTelegramMessage, buildAppointmentRespondKeyboard } from '../services/telegram';
import { sendAppointmentConfirmedEmail, sendAppointmentDeclinedEmail, sendAppointmentRescheduleProposalEmail } from '../services/email';
import { notifyAppointmentApprovers, sendAppointmentConfirmationTelegram, sendAppointmentDeclineTelegram } from '../services/appointment-reschedule';
import { escapeHtml } from '../lib/html';
import { performCheckIn } from '../services/check-in';
import { findOrCreateAppointmentVisitor } from './appointments-public';

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

  // Appointments is an OVERSIGHT module (product decision 2026-08-03): admin
  // tier + directors (scoped) + CD/HoS (org-wide). Reception and RCU staff do
  // NOT get it — their front-desk work lives in Check-In/Visitors/Visit Log.
  // Approver delegates keep their scoped read below (they need it to act).
  const isAdminLevel = ['superadmin', 'admin'].includes(session.role);

  // Directors get read-only oversight of their own entity (the appointment's
  // OFFICER's directorate); oversight display roles (chief director / head of
  // service) resolve org-wide via the scope resolver. Fail-closed: a director
  // with no linked entity is denied rather than silently unscoped.
  let directorScope: string | null = null;
  if (session.role === 'director') {
    directorScope = await resolveDirectorateScope(c);
    if (directorScope === DIRECTORATE_SCOPE_NONE) {
      return error(c, 'FORBIDDEN', 'Your account is not linked to a directorate', 403);
    }
  }

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
    if (directorScope) {
      // Forced scope — applied regardless of any client-passed filter, so an
      // officer_id outside the director's entity simply matches nothing.
      conditions.push(`o.directorate_id = ?`);
      params.push(directorScope);
    } else if (session.role !== 'director') {
      // Approver-scoped visibility is for actual approvers only; anyone else
      // (plain staff, it) fails closed instead of getting an empty 200.
      const approver = await c.env.DB.prepare(
        'SELECT 1 AS x FROM appointment_approvers WHERE user_id = ? LIMIT 1',
      )
        .bind(session.userId)
        .first();
      if (!approver) {
        return error(c, 'FORBIDDEN', 'You do not have access to this resource', 403);
      }
      conditions.push(`a.officer_id IN (SELECT officer_id FROM appointment_approvers WHERE user_id = ?)`);
      params.push(session.userId);
    }
    // director with directorScope === null ⇒ CD/HoS — org-wide, no condition.
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

// ─── Route: PATCH /:id/propose ────────────────────────────────────────────────

// Reschedule proposal (spec 2026-08-03): the approver counter-proposes a new
// date/slot for a PENDING appointment. One round only — the visitor's verdict
// (Telegram inline keyboard when linked, email links otherwise) ends it;
// accept confirms on the proposed slot, decline is terminal.
appointmentsAdminRoutes.patch(
  '/:id/propose',
  zValidator('json', z.object({
    proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    proposed_time_slot: z.string().regex(/^\d{2}:\d{2}$/),
  })),
  async (c) => {
    const session = c.get('session');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    // Strictly future-or-today (string compare is safe on YYYY-MM-DD).
    const todayStr = new Date().toISOString().slice(0, 10);
    if (body.proposed_date < todayStr) {
      return error(c, 'DATE_IN_PAST', 'proposed_date must be today or later', 422);
    }

    const appt = await c.env.DB.prepare(
      `SELECT a.id, a.officer_id, a.reference_code, a.appointment_date, a.time_slot,
              a.visitor_name, a.visitor_email, a.status,
              o.name as officer_name, o.title as officer_title,
              d.name as directorate_name
       FROM appointments a
       JOIN officers o ON o.id = a.officer_id
       JOIN directorates d ON d.id = o.directorate_id
       WHERE a.id = ?`,
    )
      .bind(id)
      .first<{
        id: string; officer_id: string; reference_code: string;
        appointment_date: string; time_slot: string;
        visitor_name: string; visitor_email: string | null; status: string;
        officer_name: string; officer_title: string | null; directorate_name: string;
      }>();

    if (!appt) return notFound(c, 'Appointment');

    const allowed = await canActOnAppointment(c.env, session, appt.officer_id);
    if (!allowed) return error(c, 'FORBIDDEN', 'You do not have permission to propose a new time for this appointment', 403);

    if (appt.status !== 'pending') {
      return error(c, 'INVALID_STATE', `A new time can only be proposed while the appointment is pending (current: ${appt.status})`, 422);
    }

    // Guarded flip: only from pending, so a raced double-propose loses here.
    const flip = await c.env.DB.prepare(
      `UPDATE appointments
       SET status = 'reschedule_proposed',
           proposed_date = ?,
           proposed_time_slot = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ? AND status = 'pending'`,
    )
      .bind(body.proposed_date, body.proposed_time_slot, id)
      .run();

    if ((flip.meta?.changes ?? 0) === 0) {
      return error(c, 'INVALID_STATE', 'This appointment is no longer pending', 422);
    }

    // Delivery — Telegram-primary: the linked visitor gets the inline
    // Accept/Decline keyboard; unlinked visitors get the email fallback with
    // the two public respond links. All sends are best-effort.
    let deliveredVia: 'telegram' | 'email' | 'none' = 'none';
    try {
      const visitorChatId = await c.env.KV.get(`telegram-visitor:${appt.id}`);
      if (visitorChatId) {
        const sent = await sendTelegramMessage({
          chatId: visitorChatId,
          text: [
            `📅 <b>New time proposed for your appointment</b>`,
            '',
            `${escapeHtml(appt.officer_name)} has proposed <b>${escapeHtml(body.proposed_date)}</b> at <b>${escapeHtml(body.proposed_time_slot)}</b> for your meeting (was ${escapeHtml(appt.appointment_date)} at ${escapeHtml(appt.time_slot)}).`,
            `Ref: <code>${escapeHtml(appt.reference_code)}</code>`,
          ].join('\n'),
          token: c.env.TELEGRAM_BOT_TOKEN,
          replyMarkup: buildAppointmentRespondKeyboard(appt.id),
        });
        if (sent) deliveredVia = 'telegram';
      }
      if (deliveredVia === 'none' && appt.visitor_email) {
        const base = c.env.ADMIN_APP_URL || 'https://smartgate.ohcsghana.org';
        c.executionCtx.waitUntil(sendAppointmentRescheduleProposalEmail(c.env, {
          visitorName: appt.visitor_name,
          visitorEmail: appt.visitor_email,
          officerName: appt.officer_name,
          officerTitle: appt.officer_title,
          directorateName: appt.directorate_name,
          appointmentDate: appt.appointment_date,
          timeSlot: appt.time_slot,
          referenceCode: appt.reference_code,
          proposedDate: body.proposed_date,
          proposedTimeSlot: body.proposed_time_slot,
          acceptUrl: `${base}/api/appointments/public/respond/${appt.reference_code}/accept`,
          declineUrl: `${base}/api/appointments/public/respond/${appt.reference_code}/decline`,
        }));
        deliveredVia = 'email';
      }
    } catch { /* non-fatal — the proposal state stands regardless */ }

    // Approver in-app confirmation that the proposal went out.
    await notifyAppointmentApprovers(c.env, appt.officer_id, {
      type: 'appointment_reschedule_proposed',
      title: 'Reschedule proposal sent',
      body: `${session.name} proposed ${body.proposed_date} at ${body.proposed_time_slot} to ${appt.visitor_name} (Ref ${appt.reference_code}) — awaiting the visitor's response.`,
    });

    return success(c, { ok: true, delivered_via: deliveredVia });
  },
);

// ─── Route: PATCH /:id/confirm ────────────────────────────────────────────────

appointmentsAdminRoutes.patch(
  '/:id/confirm',
  zValidator('json', z.object({ approver_notes: z.string().max(500).optional() })),
  async (c) => {
    const session = c.get('session');
    const id = c.req.param('id');
    const { approver_notes } = c.req.valid('json');

    const appt = await c.env.DB.prepare(
      `SELECT a.*, o.telegram_chat_id, o.name AS officer_name, o.title AS officer_title,
              d.name AS directorate_name
       FROM appointments a
       JOIN officers o ON o.id = a.officer_id
       JOIN directorates d ON d.id = o.directorate_id
       WHERE a.id = ?`,
    )
      .bind(id)
      .first<AppointmentAdminRow & OfficerTelegramRow & { officer_name: string; officer_title: string | null; directorate_name: string }>();

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

    const confirmText = `📅 Appointment confirmed\n${appt.visitor_name} (${appt.visitor_phone}) — ${appt.appointment_date} at ${appt.time_slot}\nPurpose: ${appt.purpose}`;

    // Notify officer via Telegram
    if (appt.telegram_chat_id) {
      try {
        await sendTelegramMessage({
          chatId: appt.telegram_chat_id,
          text: confirmText,
          token: c.env.TELEGRAM_BOT_TOKEN,
        });
      } catch { /* non-fatal */ }
    }

    // Notify approvers via Telegram — non-fatal
    try {
      const approversWithTg = await c.env.DB.prepare(
        `SELECT u.telegram_chat_id
         FROM appointment_approvers aa
         JOIN users u ON u.id = aa.user_id
         WHERE aa.officer_id = ? AND u.telegram_chat_id IS NOT NULL`
      ).bind(appt.officer_id).all<{ telegram_chat_id: string }>();

      for (const approver of approversWithTg.results ?? []) {
        await sendTelegramMessage({
          chatId: approver.telegram_chat_id,
          text: confirmText,
          token: c.env.TELEGRAM_BOT_TOKEN,
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    // Email visitor — best-effort
    if (appt.visitor_email) {
      c.executionCtx.waitUntil(sendAppointmentConfirmedEmail(c.env, {
        visitorName: appt.visitor_name,
        visitorEmail: appt.visitor_email,
        officerName: appt.officer_name,
        officerTitle: appt.officer_title,
        directorateName: appt.directorate_name,
        appointmentDate: appt.appointment_date,
        timeSlot: appt.time_slot,
        referenceCode: appt.reference_code,
      }));
    }

    // Telegram visitor (if they linked at booking) — confirmation + QR photo.
    {
      const visitorChatId = await c.env.KV.get(`telegram-visitor:${id}`);
      if (visitorChatId) {
        c.executionCtx.waitUntil(sendAppointmentConfirmationTelegram(c.env, {
          chatId: visitorChatId,
          officerName: appt.officer_name,
          directorateName: appt.directorate_name,
          date: appt.appointment_date,
          slot: appt.time_slot,
          ref: appt.reference_code,
        }));
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

    const appt = await c.env.DB.prepare(
      `SELECT a.id, a.officer_id, a.status, a.visitor_name, a.visitor_email,
              a.reference_code, a.appointment_date, a.time_slot,
              o.name as officer_name, o.title as officer_title,
              d.name as directorate_name
       FROM appointments a
       JOIN officers o ON o.id = a.officer_id
       JOIN directorates d ON d.id = o.directorate_id
       WHERE a.id = ?`,
    )
      .bind(id)
      .first<{ id: string; officer_id: string; status: string; visitor_name: string; visitor_email: string | null; reference_code: string; appointment_date: string; time_slot: string; officer_name: string; officer_title: string | null; directorate_name: string }>();

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

    // Email visitor — best-effort
    if (appt.visitor_email) {
      c.executionCtx.waitUntil(sendAppointmentDeclinedEmail(c.env, {
        visitorName: appt.visitor_name,
        visitorEmail: appt.visitor_email,
        officerName: appt.officer_name,
        officerTitle: appt.officer_title,
        directorateName: appt.directorate_name,
        appointmentDate: appt.appointment_date,
        timeSlot: appt.time_slot,
        referenceCode: appt.reference_code,
        declineReason: decline_reason,
      }));
    }

    // Telegram visitor (if they linked at booking) — decline + reason.
    {
      const visitorChatId = await c.env.KV.get(`telegram-visitor:${id}`);
      if (visitorChatId) {
        c.executionCtx.waitUntil(sendAppointmentDeclineTelegram(c.env, {
          chatId: visitorChatId,
          officerName: appt.officer_name,
          date: appt.appointment_date,
          slot: appt.time_slot,
          reason: decline_reason,
        }));
      }
    }

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

  const appt = await c.env.DB.prepare(
    `SELECT a.*, o.directorate_id
     FROM appointments a
     JOIN officers o ON o.id = a.officer_id
     WHERE a.id = ?`,
  )
    .bind(id)
    .first<AppointmentAdminRow & { directorate_id: string }>();

  if (!appt) return notFound(c, 'Appointment');

  const allowed = await canActOnAppointment(c.env, session, appt.officer_id);
  if (!allowed) return error(c, 'FORBIDDEN', 'You do not have permission to complete this appointment', 403);

  if (appt.status !== 'confirmed') {
    return error(c, 'INVALID_STATE', `Appointment must be confirmed to mark as completed (current: ${appt.status})`, 422);
  }

  // Join the visits pipeline like /appointments/public/arrive does
  // (2026-08-02): a desk completion means the visitor showed without going
  // through the kiosk arrival flow, so create the same visits row — they
  // appear in /visits/active, the visit log, reports, the SLA cron, the
  // checkout sweep and the evacuation roll, and can be checked out like any
  // walk-in. Source is 'staff' (a desk action by admin/superadmin —
  // canActOnAppointment blocks reception from completing;
  // check_in_source's union is 'staff'|'kiosk' and 'kiosk' would
  // misattribute a front-desk completion). The deterministic idempotency
  // key dedupes retried completions at the DB level; the explicit
  // arrive-key check covers the race where the kiosk arrival created the
  // visit first (between its performCheckIn and its status flip this
  // appointment still reads 'confirmed').
  const existingVisit = await c.env.DB.prepare(
    'SELECT id FROM visits WHERE idempotency_key IN (?, ?) LIMIT 1',
  )
    .bind(`appt-arrive:${appt.id}`, `appt-complete:${appt.id}`)
    .first<{ id: string }>();

  let visitId = existingVisit?.id ?? null;
  if (!visitId) {
    const visitorId = await findOrCreateAppointmentVisitor(c.env, appt, appt.id);
    const checkIn = await performCheckIn(c.env, c.executionCtx, {
      visitor_id: visitorId,
      host_officer_id: appt.officer_id,
      directorate_id: appt.directorate_id,
      purpose_raw: appt.purpose,
      purpose_category: 'scheduled_appointment',
      idempotency_key: `appt-complete:${appt.id}`,
      created_by: session.userId,
      check_in_source: 'staff',
    });
    if (!checkIn.ok) {
      return error(c, 'INTERNAL_ERROR', 'Could not register the visit for this appointment', 500);
    }
    visitId = (checkIn.visit as { id?: string }).id ?? null;
  }

  await c.env.DB.prepare(
    `UPDATE appointments
     SET status = 'completed',
         visit_id = COALESCE(visit_id, ?),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`,
  )
    .bind(visitId, id)
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

// ─── Route: GET /setup/approver-candidates ────────────────────────────────────
// Officers (non-director level) who have a linked user account via staff_id.
// These are the staff members eligible to approve appointments on behalf of a director.

appointmentsAdminRoutes.get('/setup/approver-candidates', async (c) => {
  const session = c.get('session');

  if (session.role !== 'superadmin' && session.role !== 'admin') {
    return error(c, 'FORBIDDEN', 'Only admins can view approver candidates', 403);
  }

  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT u.id, u.name, u.email, u.role,
            o.title as officer_title,
            d.name as directorate_name
     FROM users u
     JOIN officers o ON o.staff_id = u.staff_id
     JOIN directorates d ON d.id = o.directorate_id
     WHERE u.is_active = 1
       AND o.is_available = 1
       AND lower(o.title) NOT LIKE 'director%'
       AND lower(o.title) NOT LIKE 'chief director%'
       AND lower(o.title) NOT LIKE 'head of%'
     ORDER BY u.name`
  ).all<{ id: string; name: string; email: string; role: string; officer_title: string; directorate_name: string }>();

  return success(c, { candidates: rows.results ?? [] });
});
