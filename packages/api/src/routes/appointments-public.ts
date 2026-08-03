import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { success, created, notFound, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { escapeHtml } from '../lib/html';
import { sendTelegramMessage } from '../services/telegram';
import { sendAppointmentReceivedEmail } from '../services/email';
import { findUserIdByOfficer } from '../services/sla-escalation';
import { respondToProposal, rebookUrl } from '../services/appointment-reschedule';
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
// Race-safe: the insert carries a deterministic idempotency key per
// appointment (idx_visitors_idem_unique); a concurrent arrival that loses
// the insert re-reads the winner's row (mirrors check-in.ts race recovery).
// Shared with the admin desk-completion path (appointments-admin.ts).
export async function findOrCreateAppointmentVisitor(
  env: Env,
  appt: {
    visitor_name: string;
    visitor_phone: string;
    visitor_email: string | null;
    organisation: string | null;
  },
  appointmentId: string,
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

  const idempotencyKey = `appt-visitor:${appointmentId}`;
  const { first, last } = splitVisitorName(appt.visitor_name);
  const id = crypto.randomUUID().replace(/-/g, '');
  try {
    await env.DB.prepare(
      `INSERT INTO visitors (id, first_name, last_name, phone, email, organisation, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, first, last, appt.visitor_phone, appt.visitor_email ?? null, appt.organisation ?? null, idempotencyKey).run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Idempotency-key race: a concurrent arrival won the insert. Re-read and
    // return the existing visitor.
    if (/UNIQUE/i.test(msg) && /idempotency_key/i.test(msg)) {
      const hit = await env.DB.prepare('SELECT id FROM visitors WHERE idempotency_key = ? LIMIT 1')
        .bind(idempotencyKey).first<{ id: string }>();
      if (hit) return hit.id;
    }
    throw e;
  }
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
            o.name as officer_name, o.directorate_id,
            o.telegram_chat_id as officer_telegram_chat_id
     FROM bookable_officers bo
     JOIN officers o ON o.id = bo.officer_id
     WHERE bo.officer_id = ? AND bo.is_active = 1 AND o.is_available = 1`
  ).bind(body.officer_id).first<BookableOfficerRow & {
    officer_name: string;
    directorate_id: string | null;
    officer_telegram_chat_id: string | null;
  }>();

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

  // 7. Notify approvers + the host directorate's reception team (in-app +
  // Telegram) — non-fatal: booking succeeds even if this fails.
  const notifTitle = `New appointment request`;
  const notifBody = `${body.visitor_name} requests a meeting with ${config.officer_name} on ${body.appointment_date} at ${body.time_slot}`;
  // Telegram sends with parse_mode HTML — escape user-controlled values at
  // this boundary; the in-app notification keeps the raw text (React escapes).
  const notifBodyTg = `${escapeHtml(body.visitor_name)} requests a meeting with ${escapeHtml(config.officer_name)} on ${escapeHtml(body.appointment_date)} at ${escapeHtml(body.time_slot)}`;
  // Cross-audience dedupe (Feature B, spec 2026-08-03): a person who is both
  // an approver (or the host) and a directorate receiver gets exactly one
  // notification per channel — user id for in-app, chat id for Telegram.
  const notifiedUserIds = new Set<string>();
  const notifiedChatIds = new Set<string>();
  try {
    const approvers = await c.env.DB.prepare(
      `SELECT aa.user_id, u.telegram_chat_id
       FROM appointment_approvers aa
       JOIN users u ON u.id = aa.user_id
       WHERE aa.officer_id = ?`
    ).bind(body.officer_id).all<AppointmentApproverRow>();

    for (const approver of approvers.results ?? []) {
      try {
        const notifId = `appt-${crypto.randomUUID()}`;
        await c.env.DB.prepare(
          `INSERT INTO notifications (id, user_id, type, title, body, visit_id, created_at)
           VALUES (?, ?, 'appointment_request', ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
        ).bind(notifId, approver.user_id, notifTitle, notifBody).run();
        notifiedUserIds.add(approver.user_id);

        if (approver.telegram_chat_id) {
          notifiedChatIds.add(approver.telegram_chat_id);
          await sendTelegramMessage({
            chatId: approver.telegram_chat_id,
            text: `📋 New Appointment Request\n${notifBodyTg}`,
            token: c.env.TELEGRAM_BOT_TOKEN,
          }).catch(() => {});
        }
      } catch { /* non-fatal per-approver */ }
    }
  } catch { /* non-fatal: appointment_approvers table may not exist yet */ }

  // Receiver fanout (Feature B): the host directorate's reception team
  // (directorate_receivers) hears about every new request so they can track
  // incoming approvals. Same content as the approver alert; the host officer
  // is folded into the dedupe sets so they're never double-notified.
  try {
    if (config.directorate_id) {
      const hostUserId = await findUserIdByOfficer(body.officer_id, c.env);
      if (hostUserId) notifiedUserIds.add(hostUserId);
      if (config.officer_telegram_chat_id) notifiedChatIds.add(config.officer_telegram_chat_id);

      const receivers = await c.env.DB.prepare(
        `SELECT o.id AS officer_id, o.telegram_chat_id
         FROM directorate_receivers dr
         JOIN officers o ON o.id = dr.officer_id
         WHERE dr.directorate_id = ?`
      ).bind(config.directorate_id).all<{ officer_id: string; telegram_chat_id: string | null }>();

      for (const receiver of receivers.results ?? []) {
        try {
          const userId = await findUserIdByOfficer(receiver.officer_id, c.env);
          if (userId && !notifiedUserIds.has(userId)) {
            notifiedUserIds.add(userId);
            const notifId = `appt-${crypto.randomUUID()}`;
            await c.env.DB.prepare(
              `INSERT INTO notifications (id, user_id, type, title, body, visit_id, created_at)
               VALUES (?, ?, 'appointment_request', ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
            ).bind(notifId, userId, notifTitle, notifBody).run();
          }

          if (receiver.telegram_chat_id && !notifiedChatIds.has(receiver.telegram_chat_id)) {
            notifiedChatIds.add(receiver.telegram_chat_id);
            await sendTelegramMessage({
              chatId: receiver.telegram_chat_id,
              text: `📋 New Appointment Request\n${notifBodyTg}`,
              token: c.env.TELEGRAM_BOT_TOKEN,
            }).catch(() => {});
          }
        } catch { /* non-fatal per-receiver */ }
      }
    }
  } catch { /* non-fatal: directorate_receivers table may not exist yet */ }

  // Visitor Telegram deep-link (spec 2026-08-03): the booking-success page
  // turns this into a "Get updates on Telegram" button. Bots can't DM
  // strangers, so the visitor's own tap is what binds their chat — the
  // one-time KV token (24h) is consumed by the /start visit-link branch.
  let telegramLinkUrl: string | null = null;
  const botUsername = c.env.TELEGRAM_BOT_USERNAME;
  if (botUsername && botUsername !== 'REPLACE_WITH_BOT_USERNAME') {
    const linkToken = crypto.randomUUID().replace(/-/g, '');
    await c.env.KV.put(`visit-link:${linkToken}`, apptId, { expirationTtl: 86_400 });
    telegramLinkUrl = `https://t.me/${botUsername}?start=${linkToken}`;
  }

  // Visitor acknowledgment email (Feature A, spec 2026-08-03): "Request
  // received — pending approval". Best-effort via waitUntil — the service
  // never throws and the booking never depends on it.
  if (body.visitor_email) {
    c.executionCtx.waitUntil(sendAppointmentReceivedEmail(c.env, {
      visitorName: body.visitor_name,
      visitorEmail: body.visitor_email,
      officerName: config.officer_name,
      appointmentDate: body.appointment_date,
      timeSlot: body.time_slot,
      referenceCode,
      telegramUpdates: telegramLinkUrl !== null,
    }));
  }

  return created(c, {
    reference_code: referenceCode,
    appointment_date: body.appointment_date,
    time_slot: body.time_slot,
    officer_name: config.officer_name,
    telegram_link_url: telegramLinkUrl,
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
  const visitorId = await findOrCreateAppointmentVisitor(c.env, appointment, appointment.id);
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
  // the visits row is the arrival record. The flip is GUARDED on the current
  // status so a raced second arrival (both requests passed the status check
  // above) loses here and skips the approver fan-out — first writer wins.
  const flip = await c.env.DB.prepare(
    `UPDATE appointments
     SET status = 'completed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND status = 'confirmed'`
  ).bind(appointment.id).run();

  if ((flip.meta?.changes ?? 0) === 0) {
    return error(c, 'APPT_ALREADY_COMPLETED', 'This appointment has already been checked in', 422);
  }

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

// ─── Route: GET /respond/:code/:action ───────────────────────────────────────

// Public one-shot verdict links from the reschedule-proposal email (unlinked
// visitors — spec 2026-08-03). Same transitions as the Telegram appt-respond
// callback, keyed by reference code; both share respondToProposal's guarded
// UPDATE so first response wins across channels. Returns a small branded HTML
// page (the visitor followed a link in a mail client, not an API client) with
// every interpolated value escaped. The guessed code itself is NEVER reflected.
// Rate limit mirrors /ref.
function respondPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — OHCS SmartGate</title></head>
<body style="margin:0;background:#F8F9FA;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
      <div style="background:#1A4D2E;color:#fff;padding:20px;text-align:center;">
        <h1 style="margin:0;font-size:16px;font-weight:700;">${title}</h1>
        <p style="margin:4px 0 0;font-size:12px;opacity:.75;">Office of the Head of the Civil Service, Ghana</p>
      </div>
      <div style="height:3px;background:linear-gradient(90deg,#CE1126 33%,#FCD116 33% 66%,#006B3F 66%);"></div>
      <div style="padding:24px;">${bodyHtml}</div>
      <div style="padding:12px 24px;border-top:1px solid #E5E7EB;text-align:center;font-size:11px;color:#9CA3AF;">Office of the Head of the Civil Service</div>
    </div>
  </div>
</body></html>`;
}

const RESPOND_ACTIONS = new Set(['accept', 'decline']);

appointmentsPublicRoutes.get('/respond/:code/:action', async (c) => {
  const clientIP = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const rl = await rateLimit(c.env, `appt-respond:${clientIP}`, 20, 60);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }

  const code = c.req.param('code');
  const action = c.req.param('action');
  if (!RESPOND_ACTIONS.has(action)) {
    return c.html(respondPage('Link not recognised', '<p style="margin:0;font-size:14px;color:#374151;">This response link is not valid. Please use the exact links from your email.</p>'), 404);
  }

  const { outcome, appt } = await respondToProposal(c.env, { refCode: code }, action as 'accept' | 'decline');

  if (outcome === 'not_found') {
    return c.html(respondPage('Appointment not found', '<p style="margin:0;font-size:14px;color:#374151;">We couldn&#39;t find an appointment for this link. It may have been removed — please contact the office or book a new appointment.</p>'), 404);
  }

  if (outcome === 'already_handled') {
    return c.html(respondPage('Already responded', '<p style="margin:0;font-size:14px;color:#374151;">This proposal has already been responded to — your first response is the one that counts. If you think this is wrong, please contact the office.</p>'));
  }

  const p = [
    ['Visitor', escapeHtml(appt!.visitor_name)],
    ['Officer', escapeHtml(appt!.officer_name)],
    ['Date', escapeHtml(appt!.appointment_date)],
    ['Time', escapeHtml(appt!.time_slot)],
    ['Reference', `<span style="font-family:monospace;font-weight:700;letter-spacing:2px;">${escapeHtml(appt!.reference_code)}</span>`],
  ];
  const rows = p.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#6B7280;vertical-align:top;">${k}</td><td style="padding:6px 0;font-size:14px;color:#111827;">${v}</td></tr>`).join('');
  const detailTable = `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;">${rows}</table>`;

  if (outcome === 'accepted') {
    return c.html(respondPage(
      'Appointment confirmed',
      `<p style="margin:0 0 16px;font-size:14px;color:#374151;">Thank you — your appointment is <strong style="color:#1A4D2E;">confirmed</strong> for the proposed time:</p>${detailTable}<p style="margin:0;font-size:13px;color:#6B7280;">Show the reference code at the reception kiosk when you arrive.</p>`,
    ));
  }

  const rebook = escapeHtml(rebookUrl(c.env));
  return c.html(respondPage(
    'Appointment declined',
    `<p style="margin:0 0 16px;font-size:14px;color:#374151;">No problem — the proposed time has been declined and the office has been notified.</p>${detailTable}<p style="margin:0;font-size:13px;color:#6B7280;">You&#39;re welcome to <a href="${rebook}" style="color:#1A4D2E;">request a new slot</a> whenever suits you.</p>`,
  ));
});
