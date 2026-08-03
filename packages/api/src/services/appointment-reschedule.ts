import QRCode from 'qrcode';
import type { Env } from '../types';
import { escapeHtml } from '../lib/html';
import { sendTelegramMessage, sendTelegramPhoto, type AppointmentRespondAction } from './telegram';

// Appointment reschedule proposals (spec 2026-08-03): the visitor's verdict on
// a proposed new slot, shared by the Telegram `appt-respond:` callback handler
// and the public email-link route. Accept confirms ON the proposed slot and
// clears the proposal columns; decline is terminal (never back to pending).
// Both transitions are guarded UPDATEs on status='reschedule_proposed' —
// first response wins, whichever channel fires second loses on meta.changes.

export type AppointmentRespondOutcome = 'accepted' | 'declined' | 'already_handled' | 'not_found';

export interface AppointmentRespondRow {
  id: string;
  officer_id: string;
  reference_code: string;
  appointment_date: string;
  time_slot: string;
  visitor_name: string;
  status: string;
  proposed_date: string | null;
  proposed_time_slot: string | null;
  officer_name: string;
  directorate_name: string;
}

const DEFAULT_ADMIN_URL = 'https://smartgate.ohcsghana.org';

// The public booking page — the rebook invite on a decline.
export function rebookUrl(env: Env): string {
  return `${env.ADMIN_APP_URL || DEFAULT_ADMIN_URL}/book`;
}

// Server-side PNG of the reference code for the Telegram QR photo. qrcode's
// PNG renderer (pngjs) runs on Buffer/node:zlib, both provided by the
// workerd nodejs_compat flag (wrangler.toml). Best-effort by contract: callers
// have already sent the text confirmation when this fails.
export async function qrPng(payload: string): Promise<ArrayBuffer | null> {
  try {
    const buf = (await QRCode.toBuffer(payload, { type: 'png', margin: 2, width: 512 })) as unknown as Uint8Array;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch (err) {
    console.error('[Appointments] QR PNG render failed:', err);
    return null;
  }
}

// Visitor-facing Telegram for straight confirm/decline actions (the
// reschedule-verdict path has its own copy inline). escapeHtml on every
// interpolated value; QR photo is best-effort after the text lands.
export async function sendAppointmentConfirmationTelegram(
  env: Env,
  opts: { chatId: string; officerName: string; directorateName: string; date: string; slot: string; ref: string },
): Promise<void> {
  try {
    await sendTelegramMessage({
      chatId: opts.chatId,
      text: `✅ <b>Appointment confirmed</b>\n\nOfficer: ${escapeHtml(opts.officerName)}\nOffice: ${escapeHtml(opts.directorateName)}\nDate: ${escapeHtml(opts.date)} at ${escapeHtml(opts.slot)}\nRef: <code>${escapeHtml(opts.ref)}</code>\n\nShow this code (or the QR below) at the reception kiosk.`,
      token: env.TELEGRAM_BOT_TOKEN,
    });
    const png = await qrPng(opts.ref);
    if (png) {
      await sendTelegramPhoto({
        chatId: opts.chatId,
        photo: png,
        caption: `Your appointment QR — Ref <code>${escapeHtml(opts.ref)}</code>`,
        token: env.TELEGRAM_BOT_TOKEN,
        photoType: 'image/png',
        photoName: 'appointment-qr.png',
      });
    }
  } catch (err) {
    console.error('[Appointments] confirmation telegram failed:', err);
  }
}

export async function sendAppointmentDeclineTelegram(
  env: Env,
  opts: { chatId: string; officerName: string; date: string; slot: string; reason: string },
): Promise<void> {
  try {
    await sendTelegramMessage({
      chatId: opts.chatId,
      text: `❌ <b>Appointment declined</b>\n\nUnfortunately your appointment with ${escapeHtml(opts.officerName)} on ${escapeHtml(opts.date)} at ${escapeHtml(opts.slot)} was declined.\nReason: ${escapeHtml(opts.reason)}\n\nYou're welcome to book another time.`,
      token: env.TELEGRAM_BOT_TOKEN,
    });
  } catch (err) {
    console.error('[Appointments] decline telegram failed:', err);
  }
}

interface ApproverRow {
  user_id: string;
  telegram_chat_id: string | null;
}

// In-app + (optionally) Telegram fan-out to the appointment's approver chain —
// the same audience the booking request and arrival lifecycle notify.
export async function notifyAppointmentApprovers(
  env: Env,
  officerId: string,
  opts: { type: string; title: string; body: string; tgText?: string },
): Promise<void> {
  try {
    const approvers = await env.DB.prepare(
      `SELECT aa.user_id, u.telegram_chat_id
       FROM appointment_approvers aa
       JOIN users u ON u.id = aa.user_id
       WHERE aa.officer_id = ?`
    ).bind(officerId).all<ApproverRow>();

    for (const approver of approvers.results ?? []) {
      try {
        const notifId = `appt-${crypto.randomUUID()}`;
        await env.DB.prepare(
          `INSERT INTO notifications (id, user_id, type, title, body, visit_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
        ).bind(notifId, approver.user_id, opts.type, opts.title, opts.body).run();

        if (opts.tgText && approver.telegram_chat_id) {
          await sendTelegramMessage({
            chatId: approver.telegram_chat_id,
            text: opts.tgText,
            token: env.TELEGRAM_BOT_TOKEN,
          }).catch(() => {});
        }
      } catch { /* non-fatal per-approver */ }
    }
  } catch { /* non-fatal: appointment_approvers table may not exist yet */ }
}

async function loadAppointment(env: Env, lookup: { id?: string; refCode?: string }): Promise<AppointmentRespondRow | null> {
  const sql = `SELECT a.id, a.officer_id, a.reference_code, a.appointment_date, a.time_slot,
                      a.visitor_name, a.status, a.proposed_date, a.proposed_time_slot,
                      o.name AS officer_name, d.name AS directorate_name
               FROM appointments a
               JOIN officers o ON o.id = a.officer_id
               JOIN directorates d ON d.id = o.directorate_id
               WHERE ${lookup.id ? 'a.id = ?' : 'a.reference_code = ?'}`;
  return env.DB.prepare(sql)
    .bind(lookup.id ?? lookup.refCode)
    .first<AppointmentRespondRow>();
}

export async function respondToProposal(
  env: Env,
  lookup: { id?: string; refCode?: string },
  action: AppointmentRespondAction,
): Promise<{ outcome: AppointmentRespondOutcome; appt: AppointmentRespondRow | null }> {
  const appt = await loadAppointment(env, lookup);
  if (!appt) return { outcome: 'not_found', appt: null };

  // First response wins: the transition is a guarded UPDATE on the proposed
  // state, so a raced second response (either channel, either action) loses.
  const flip = action === 'accept'
    ? await env.DB.prepare(
        `UPDATE appointments
         SET status = 'confirmed',
             appointment_date = proposed_date,
             time_slot = proposed_time_slot,
             proposed_date = NULL,
             proposed_time_slot = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ? AND status = 'reschedule_proposed'`
      ).bind(appt.id).run()
    : await env.DB.prepare(
        `UPDATE appointments
         SET status = 'declined',
             decline_reason = 'visitor declined proposed time',
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ? AND status = 'reschedule_proposed'`
      ).bind(appt.id).run();

  if ((flip.meta?.changes ?? 0) === 0) {
    return { outcome: 'already_handled', appt };
  }

  const updated = (await loadAppointment(env, { id: appt.id })) ?? appt;
  const outcome: AppointmentRespondOutcome = action === 'accept' ? 'accepted' : 'declined';

  // Side effects are best-effort — the transition above is the source of truth.
  try {
    const visitorChatId = await env.KV.get(`telegram-visitor:${appt.id}`);
    const officer = escapeHtml(updated.officer_name);
    const visitor = escapeHtml(updated.visitor_name);
    const when = `<b>${escapeHtml(updated.appointment_date)}</b> at <b>${escapeHtml(updated.time_slot)}</b>`;
    const ref = escapeHtml(updated.reference_code);

    if (action === 'accept') {
      if (visitorChatId) {
        await sendTelegramMessage({
          chatId: visitorChatId,
          text: `✅ <b>Appointment confirmed</b>\n\nYour appointment with ${officer} is confirmed for ${when}.\nRef: <code>${ref}</code>\n\nShow this code (or the QR below) at the reception kiosk.`,
          token: env.TELEGRAM_BOT_TOKEN,
        });
        // QR photo is strictly best-effort — the text above already landed.
        const png = await qrPng(updated.reference_code);
        if (png) {
          await sendTelegramPhoto({
            chatId: visitorChatId,
            photo: png,
            caption: `Your appointment QR — Ref <code>${ref}</code>`,
            token: env.TELEGRAM_BOT_TOKEN,
            photoType: 'image/png',
            photoName: 'appointment-qr.png',
          });
        }
      }
      await notifyAppointmentApprovers(env, appt.officer_id, {
        type: 'appointment_reschedule_accepted',
        title: 'Visitor accepted proposed time',
        body: `${updated.visitor_name} accepted the proposed time — appointment confirmed for ${updated.appointment_date} at ${updated.time_slot} (Ref ${updated.reference_code})`,
        tgText: `✅ Visitor accepted proposed time\n${visitor} — confirmed for ${when} (Ref <code>${ref}</code>)`,
      });
    } else {
      if (visitorChatId) {
        await sendTelegramMessage({
          chatId: visitorChatId,
          text: `Your appointment with ${officer} can't be scheduled for the proposed time. You're welcome to request a new slot here: ${escapeHtml(rebookUrl(env))}`,
          token: env.TELEGRAM_BOT_TOKEN,
        });
      }
      await notifyAppointmentApprovers(env, appt.officer_id, {
        type: 'appointment_reschedule_declined',
        title: 'Visitor declined proposed time',
        body: `${updated.visitor_name} declined the proposed time — appointment ${updated.reference_code} is closed. They have been invited to rebook.`,
        tgText: `❌ Visitor declined proposed time\n${visitor} declined the proposed slot for appointment <code>${ref}</code>. They have been invited to rebook.`,
      });
    }
  } catch (err) {
    console.error('[Appointments] reschedule response side effects failed:', err);
  }

  return { outcome, appt: updated };
}
