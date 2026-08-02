import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { success, created, notFound, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { escapeHtml } from '../lib/html';
import { sendTelegramMessage } from '../services/telegram';
import { performCheckIn } from '../services/check-in';
import { normalizeKioskPhone, KIOSK_USER_ID } from './kiosk';

export const appointmentsPublicRoutes = new Hono<{ Bindings: Env }>();

// ─── Helpers ────────────────────────────────────────────────────────────────

export function generateTimeSlots(startTime: string, endTime: string, durationMins: number): string[] {
  const startParts = startTime.split(':').map(Number);
  const endParts = endTime.split(':').map(Number);
  const sh = startParts[0] ?? 0;
  const sm = startParts[1] ?? 0;
  const eh = endParts[0] ?? 0;
  const em = endParts[1] ?? 0;
  let mins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const slots: string[] = [];
  while (mins + durationMins <= endMins) {
    slots.push(`${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
    mins += durationMins;
  }
  return slots;
}

const REF_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateReferenceCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => REF_CHARSET[b % REF_CHARSET.length]).join('');
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const BookSchema = z.object({
  officer_id: z.string(),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_slot: z.string().regex(/^\d{2}:\d{2}$/),
  visitor_name: z.string().min(2).max(100),
  visitor_phone: z.string().min(7).max(20),
  visitor_email: z.string().email().optional(),
  organisation: z.string().max(100).optional(),
  purpose: z.string().min(5).max(500),
});

const ArriveSchema = z.object({
  reference_code: z.string(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookableOfficerRow {
  slot_start_time: string;
  slot_end_time: string;
  slot_duration_mins: number;
  advance_days_min: number;
  advance_days_max: number;
}

interface BookedSlotRow {
  time_slot: string;
}

interface AppointmentApproverRow {
  user_id: string;
  telegram_chat_id: string | null;
}

interface AppointmentRow {
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
  created_at: string;
  updated_at: string;
}

interface AppointmentWithOfficer extends AppointmentRow {
  officer_name: string;
  officer_title: string | null;
  officer_telegram_chat_id: string | null;
  directorate_id: string;
  directorate_name: string;
  directorate_floor: string | null;
  directorate_wing: string | null;
}

// Split a free-text appointment visitor_name into the visitors table's
// NOT NULL first/last columns; a single-word name doubles as both.
export function splitVisitorName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? full.trim();
  return { first, last: parts.slice(1).join(' ') || first };
}

// Find-or-create the visitors row for an arriving appointment. Appointments
// carry free-text name/phone (no visitor FK), so we mirror the kiosk's
// find-by-phone behavior: same normalizeKioskPhone canonical forms and the
// same REPLACE-chain match, WITHOUT the visitor-by-phone endpoint's
// completed-visit gate (that gate is an anti-enumeration oracle guard; here
// the reference code already proves the booking). Non-Ghana numbers fall
// back to an exact-string match. A new visitor is created only when no row
// matches, so repeat appointment visitors accumulate one history.
// Shared with the admin desk-completion path (appointments-admin.ts).
export async function findOrCreateAppointmentVisitor(
  env: Env,
  appt: {
    visitor_name: string;
    visitor_phone: string;
    visitor_email: string | null;
    organisation: string | null;
  },
): Promise<string> {
  const stripped = `REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '')`;
  const forms = normalizeKioskPhone(appt.visitor_phone);
  const found = forms
    ? await env.DB.prepare(
        `SELECT id FROM visitors WHERE ${stripped} IN (?, ?) ORDER BY last_visit_at DESC LIMIT 1`
      ).bind(forms.local, forms.intl).first<{ id: string }>()
    : await env.DB.prepare(
        `SELECT id FROM visitors WHERE ${stripped} = ? LIMIT 1`
      ).bind(appt.visitor_phone.trim()).first<{ id: string }>();
  if (found) return found.id;

  const { first, last } = splitVisitorName(appt.visitor_name);
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO visitors (id, first_name, last_name, phone, email, organisation)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, first, last, appt.visitor_phone, appt.visitor_email ?? null, appt.organisation ?? null).run();
  return id;
}

// Slim projection for the PUBLIC ref lookup — display fields only, no
// visitor_phone / visitor_email (PII minimization on an unauthenticated route).
interface AppointmentRefLookup {
  id: string;
  reference_code: string;
  appointment_date: string;
  time_slot: string;
  visitor_name: string;
  organisation: string | null;
  purpose: string;
  status: string;
  officer_name: string;
  officer_title: string | null;
  directorate_name: string;
  directorate_floor: string | null;
  directorate_wing: string | null;
}

// ─── Route: GET /officers ────────────────────────────────────────────────────

appointmentsPublicRoutes.get('/officers', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT bo.id as bookable_id, bo.officer_id, bo.slot_duration_mins,
            bo.slot_start_time, bo.slot_end_time,
            bo.advance_days_min, bo.advance_days_max,
            o.name as officer_name, o.title as officer_title,
            d.name as directorate_name,
            d.floor as directorate_floor, d.wing as directorate_wing
     FROM bookable_officers bo
     JOIN officers o ON o.id = bo.officer_id
     JOIN directorates d ON d.id = o.directorate_id
     WHERE bo.is_active = 1 AND o.is_available = 1
     ORDER BY o.name`
  ).all();
  return success(c, { officers: rows.results ?? [] });
});

// ─── Route: GET /slots ───────────────────────────────────────────────────────

appointmentsPublicRoutes.get('/slots', async (c) => {
  const officerId = c.req.query('officer_id');
  const date = c.req.query('date');

  if (!officerId || !date) {
    return error(c, 'MISSING_PARAMS', 'officer_id and date are required', 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error(c, 'INVALID_DATE', 'date must be YYYY-MM-DD', 400);
  }

  const config = await c.env.DB.prepare(
    `SELECT bo.slot_start_time, bo.slot_end_time, bo.slot_duration_mins,
            bo.advance_days_min, bo.advance_days_max
     FROM bookable_officers bo
     WHERE bo.officer_id = ? AND bo.is_active = 1`
  ).bind(officerId).first<BookableOfficerRow>();

  if (!config) {
    return notFound(c, 'Bookable officer');
  }

  // Validate date is within allowed range
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setUTCDate(minDate.getUTCDate() + config.advance_days_min);
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + config.advance_days_max);

  const requested = new Date(date + 'T00:00:00Z');
  if (requested < minDate || requested > maxDate) {
    return error(
      c,
      'DATE_OUT_OF_RANGE',
      `Appointments can only be booked between ${config.advance_days_min} and ${config.advance_days_max} days from today`,
      422,
    );
  }

  const booked = await c.env.DB.prepare(
    `SELECT time_slot FROM appointments
     WHERE officer_id = ? AND appointment_date = ?
     AND status IN ('pending', 'confirmed')`
  ).bind(officerId, date).all<BookedSlotRow>();

  const bookedSet = new Set((booked.results ?? []).map(r => r.time_slot));
  const allSlots = generateTimeSlots(config.slot_start_time, config.slot_end_time, config.slot_duration_mins);
  const available = allSlots.filter(s => !bookedSet.has(s));

  return success(c, { slots: available });
});

// ─── Route: POST /book ───────────────────────────────────────────────────────

appointmentsPublicRoutes.post('/book', zValidator('json', BookSchema), async (c) => {
  const clientIP = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const rl = await rateLimit(c.env, `appt-book:${clientIP}`, 5, 3600);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many booking attempts. Please try again later.', 429);
  }

  const body = c.req.valid('json');

  // 1. Verify officer is bookable+active
  const config = await c.env.DB.prepare(
    `SELECT bo.slot_start_time, bo.slot_end_time, bo.slot_duration_mins,
            bo.advance_days_min, bo.advance_days_max,
            o.name as officer_name
     FROM bookable_officers bo
     JOIN officers o ON o.id = bo.officer_id
     WHERE bo.officer_id = ? AND bo.is_active = 1 AND o.is_available = 1`
  ).bind(body.officer_id).first<BookableOfficerRow & { officer_name: string }>();

  if (!config) {
    return error(c, 'OFFICER_NOT_BOOKABLE', 'This officer is not accepting appointments', 422);
  }

  // 2. Verify date is valid (within advance_days_min/max from today)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setUTCDate(minDate.getUTCDate() + config.advance_days_min);
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + config.advance_days_max);

  const requested = new Date(body.appointment_date + 'T00:00:00Z');
  if (requested < minDate || requested > maxDate) {
    return error(
      c,
      'DATE_OUT_OF_RANGE',
      `Appointments can only be booked between ${config.advance_days_min} and ${config.advance_days_max} days from today`,
      422,
    );
  }

  // 3. Verify slot is valid (exists in generated slots)
  const allSlots = generateTimeSlots(config.slot_start_time, config.slot_end_time, config.slot_duration_mins);
  if (!allSlots.includes(body.time_slot)) {
    return error(c, 'INVALID_SLOT', 'The requested time slot is not valid for this officer', 422);
  }

  // 4. Verify slot is available (not already pending/confirmed)
  const existing = await c.env.DB.prepare(
    `SELECT id FROM appointments
     WHERE officer_id = ? AND appointment_date = ? AND time_slot = ?
     AND status IN ('pending', 'confirmed')`
  ).bind(body.officer_id, body.appointment_date, body.time_slot).first();

  if (existing) {
    return error(c, 'SLOT_TAKEN', 'This time slot is no longer available', 409);
  }

  // 5. Generate reference code (retry up to 5 times on collision)
  let referenceCode = '';
  for (let i = 0; i < 5; i++) {
    const candidate = generateReferenceCode();
    const clash = await c.env.DB.prepare(
      'SELECT id FROM appointments WHERE reference_code = ?'
    ).bind(candidate).first();
    if (!clash) {
      referenceCode = candidate;
      break;
    }
  }
  if (!referenceCode) {
    return error(c, 'INTERNAL_ERROR', 'Failed to generate a unique reference code. Please try again.', 500);
  }

  // 6. Insert appointment
  const apptId = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO appointments
       (id, officer_id, reference_code, appointment_date, time_slot,
        visitor_name, visitor_phone, visitor_email, organisation, purpose,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
             strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
  ).bind(
    apptId,
    body.officer_id,
    referenceCode,
    body.appointment_date,
    body.time_slot,
    body.visitor_name,
    body.visitor_phone,
    body.visitor_email ?? null,
    body.organisation ?? null,
    body.purpose,
  ).run();

  // 7. Notify approvers (in-app + Telegram) — non-fatal: booking succeeds even if this fails
  try {
    const approvers = await c.env.DB.prepare(
      `SELECT aa.user_id, u.telegram_chat_id
       FROM appointment_approvers aa
       JOIN users u ON u.id = aa.user_id
       WHERE aa.officer_id = ?`
    ).bind(body.officer_id).all<AppointmentApproverRow>();

    const notifTitle = `New appointment request`;
    const notifBody = `${body.visitor_name} requests a meeting with ${config.officer_name} on ${body.appointment_date} at ${body.time_slot}`;
    // Telegram sends with parse_mode HTML — escape user-controlled values at
    // this boundary; the in-app notification keeps the raw text (React escapes).
    const notifBodyTg = `${escapeHtml(body.visitor_name)} requests a meeting with ${escapeHtml(config.officer_name)} on ${escapeHtml(body.appointment_date)} at ${escapeHtml(body.time_slot)}`;

    for (const approver of approvers.results ?? []) {
      try {
        const notifId = `appt-${crypto.randomUUID()}`;
        await c.env.DB.prepare(
          `INSERT INTO notifications (id, user_id, type, title, body, visit_id, created_at)
           VALUES (?, ?, 'appointment_request', ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
        ).bind(notifId, approver.user_id, notifTitle, notifBody).run();

        if (approver.telegram_chat_id) {
          await sendTelegramMessage({
            chatId: approver.telegram_chat_id,
            text: `📋 New Appointment Request\n${notifBodyTg}`,
            token: c.env.TELEGRAM_BOT_TOKEN,
          }).catch(() => {});
        }
      } catch { /* non-fatal per-approver */ }
    }
  } catch { /* non-fatal: appointment_approvers table may not exist yet */ }

  return created(c, {
    reference_code: referenceCode,
    appointment_date: body.appointment_date,
    time_slot: body.time_slot,
    officer_name: config.officer_name,
  });
});

// ─── Route: GET /ref/:code ───────────────────────────────────────────────────

// Public kiosk lookup. Explicit display columns (never a.*): visitor phone and
// email are NOT display data — a guessed 6-char reference must not leak PII.
// Per-IP rate limit mirrors /arrive.
appointmentsPublicRoutes.get('/ref/:code', async (c) => {
  const clientIP = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const rl = await rateLimit(c.env, `appt-ref:${clientIP}`, 20, 60);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }

  const code = c.req.param('code');

  const appointment = await c.env.DB.prepare(
    `SELECT a.id, a.reference_code, a.appointment_date, a.time_slot,
            a.visitor_name, a.organisation, a.purpose, a.status,
            o.name as officer_name, o.title as officer_title,
            d.name as directorate_name,
            d.floor as directorate_floor, d.wing as directorate_wing
     FROM appointments a
     JOIN officers o ON o.id = a.officer_id
     JOIN directorates d ON d.id = o.directorate_id
     WHERE a.reference_code = ?`
  ).bind(code).first<AppointmentRefLookup>();

  if (!appointment) {
    return notFound(c, 'Appointment');
  }

  return success(c, { appointment });
});

// ─── Route: POST /arrive ─────────────────────────────────────────────────────

appointmentsPublicRoutes.post('/arrive', zValidator('json', ArriveSchema), async (c) => {
  const clientIP = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const rl = await rateLimit(c.env, `appt-arrive:${clientIP}`, 20, 60);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }

  const { reference_code } = c.req.valid('json');

  // 1. Lookup appointment
  const appointment = await c.env.DB.prepare(
    `SELECT a.*, o.name as officer_name, o.title as officer_title,
            o.telegram_chat_id as officer_telegram_chat_id,
            d.id as directorate_id, d.name as directorate_name
     FROM appointments a
     JOIN officers o ON o.id = a.officer_id
     JOIN directorates d ON d.id = o.directorate_id
     WHERE a.reference_code = ?`
  ).bind(reference_code).first<AppointmentWithOfficer>();

  if (!appointment) {
    return notFound(c, 'Appointment');
  }

  // 2. Check status
  if (appointment.status === 'pending') {
    return error(c, 'APPT_NOT_CONFIRMED', 'This appointment has not been confirmed yet', 422);
  }
  if (appointment.status === 'cancelled' || appointment.status === 'declined') {
    return error(c, 'APPT_CANCELLED', 'This appointment has been cancelled or declined', 422);
  }
  if (appointment.status === 'completed') {
    return error(c, 'APPT_ALREADY_COMPLETED', 'This appointment has already been checked in', 422);
  }

  // 3. Check appointment_date is today
  const todayStr = new Date().toISOString().slice(0, 10);
  if (appointment.appointment_date !== todayStr) {
    return error(c, 'APPT_WRONG_DATE', `This appointment is scheduled for ${appointment.appointment_date}, not today`, 422);
  }

  // 4. Join the visits pipeline (Commit F, 2026-08-01): create the visits row
  // through the same performCheckIn service the kiosk walk-in path uses, so
  // the appointment visitor appears in /visits/active, the visit log,
  // reports, the SLA cron, the checkout sweep and the evacuation roll — and
  // can be checked out via badge/PIN/reception like any walk-in. Source is
  // 'kiosk': the arrival happens at the kiosk (check_in_source has no CHECK
  // constraint; 'staff'/'kiosk' are the existing values). The deterministic
  // idempotency key dedupes any raced/retried arrival at the DB level
  // (idx_visits_idem_unique) even if the status guard above is beaten.
  // check_in.ts skips AI classification because the category is pinned.
  const visitorId = await findOrCreateAppointmentVisitor(c.env, appointment);
  const checkIn = await performCheckIn(c.env, c.executionCtx, {
    visitor_id: visitorId,
    host_officer_id: appointment.officer_id,
    directorate_id: appointment.directorate_id,
    purpose_raw: appointment.purpose,
    purpose_category: 'scheduled_appointment',
    idempotency_key: `appt-arrive:${appointment.id}`,
    created_by: KIOSK_USER_ID,
    check_in_source: 'kiosk',
  });
  if (!checkIn.ok) {
    return error(c, 'INTERNAL_ERROR', 'Could not register the arrival. Please see reception.', 500);
  }

  // 5. Update status to completed — the appointment stays the booking record;
  // the visits row is the arrival record.
  await c.env.DB.prepare(
    `UPDATE appointments
     SET status = 'completed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(appointment.id).run();

  const arrivalTitle = `Appointment arrived`;
  const arrivalBody = `${appointment.visitor_name} has arrived for their appointment with ${appointment.officer_name} at ${appointment.time_slot}`;
  const arrivalBodyTg = `${escapeHtml(appointment.visitor_name)} has arrived for their appointment with ${escapeHtml(appointment.officer_name)} at ${escapeHtml(appointment.time_slot)}`;

  // 6. Host arrival alert: fired by performCheckIn through the canonical
  // notifyOnCheckIn fanout (same Coming-down/Waiting-area buttons walk-ins
  // produce) — the old ad-hoc officer text here was removed so the host is
  // never double-notified. Approvers below are a distinct audience (the
  // appointment's approval chain), so their lifecycle notification stays.
  try {
    const approvers = await c.env.DB.prepare(
      `SELECT aa.user_id, u.telegram_chat_id
       FROM appointment_approvers aa
       JOIN users u ON u.id = aa.user_id
       WHERE aa.officer_id = ?`
    ).bind(appointment.officer_id).all<AppointmentApproverRow>();

    for (const approver of approvers.results ?? []) {
      try {
        const notifId = `appt-${crypto.randomUUID()}`;
        await c.env.DB.prepare(
          `INSERT INTO notifications (id, user_id, type, title, body, visit_id, created_at)
           VALUES (?, ?, 'appointment_arrived', ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
        ).bind(notifId, approver.user_id, arrivalTitle, arrivalBody).run();

        if (approver.telegram_chat_id) {
          await sendTelegramMessage({
            chatId: approver.telegram_chat_id,
            text: `🏢 Visitor Arrived\n${arrivalBodyTg}`,
            token: c.env.TELEGRAM_BOT_TOKEN,
          }).catch(() => {});
        }
      } catch { /* non-fatal per-approver */ }
    }
  } catch { /* non-fatal: appointment_approvers table may not exist yet */ }

  // The created visit rides the response (same shape the kiosk walk-in
  // check-in returns) so the kiosk can show the badge QR + checkout PIN —
  // the appointment visitor's self-checkout path.
  return success(c, {
    ok: true,
    visitor_name: appointment.visitor_name,
    officer_name: appointment.officer_name,
    directorate_name: appointment.directorate_name,
    time_slot: appointment.time_slot,
    visit: checkIn.visit,
  });
});
