import type { Env } from '../types';
import { escapeHtml } from '../lib/html';

// Admin-type roles use the management/VMS portal; everyone else (staff, NSS,
// interns) uses the staff attendance PWA. The welcome email links each user to
// the app they will actually use.
const ADMIN_ROLES = new Set(['superadmin', 'admin', 'receptionist', 'it', 'director']);

const DEFAULT_STAFF_URL = 'https://staff-attendance.ohcsghana.org';
const DEFAULT_ADMIN_URL = 'https://smartgate.ohcsghana.org';

export interface WelcomeEmailInput {
  userId: string;
  name: string;
  email: string;
  role: string;
  identifierLabel: string;  // "Staff ID" | "NSS Number" | "Intern Code"
  identifierValue: string;
  pin: string;              // plaintext initial PIN (set/generated at creation)
}

function appUrlForRole(env: Env, role: string): string {
  const staffUrl = env.STAFF_APP_URL || DEFAULT_STAFF_URL;
  const adminUrl = env.ADMIN_APP_URL || DEFAULT_ADMIN_URL;
  return ADMIN_ROLES.has(role) ? adminUrl : staffUrl;
}

/**
 * Sends the new-user welcome email via Resend. Best-effort: returns false (never
 * throws) when email isn't configured or the send fails — user creation must not
 * depend on it. Call inside `c.executionCtx.waitUntil(...)`.
 */
export async function sendWelcomeEmail(env: Env, input: WelcomeEmailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.warn(JSON.stringify({ kind: 'email', type: 'welcome', ok: false, detail: 'not_configured', user_id: input.userId }));
    return false;
  }

  const loginUrl = appUrlForRole(env, input.role);
  const subject = 'Welcome to OHCS SmartGate — your login details';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.email],
        subject,
        html: welcomeHtml(input, loginUrl),
        text: welcomeText(input, loginUrl),
      }),
    });
    const ok = res.ok;
    // Log status only — no email address / PIN in logs.
    console.warn(JSON.stringify({ kind: 'email', type: 'welcome', ok, status: res.status, user_id: input.userId }));
    return ok;
  } catch {
    console.warn(JSON.stringify({ kind: 'email', type: 'welcome', ok: false, detail: 'exception', user_id: input.userId }));
    return false;
  }
}

// ─── Appointment status emails ────────────────────────────────────────────────

export interface AppointmentEmailInput {
  visitorName: string;
  visitorEmail: string;
  officerName: string;
  officerTitle: string | null;
  directorateName: string;
  appointmentDate: string;
  timeSlot: string;
  referenceCode: string;
  declineReason?: string;
}

export async function sendAppointmentConfirmedEmail(env: Env, input: AppointmentEmailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.visitorEmail],
        subject: `Appointment confirmed — ${input.appointmentDate} at ${input.timeSlot}`,
        html: appointmentConfirmedHtml(input),
        text: appointmentConfirmedText(input),
      }),
    });
    return res.ok;
  } catch { return false; }
}

export async function sendAppointmentDeclinedEmail(env: Env, input: AppointmentEmailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.visitorEmail],
        subject: `Appointment request update — Ref ${input.referenceCode}`,
        html: appointmentDeclinedHtml(input),
        text: appointmentDeclinedText(input),
      }),
    });
    return res.ok;
  } catch { return false; }
}

function appointmentConfirmedText(i: AppointmentEmailInput): string {
  return [
    `Hello ${i.visitorName},`,
    '',
    `Your appointment at the Office of the Head of the Civil Service has been confirmed.`,
    '',
    `Details:`,
    `  Officer : ${i.officerName}${i.officerTitle ? ` (${i.officerTitle})` : ''}`,
    `  Office  : ${i.directorateName}`,
    `  Date    : ${i.appointmentDate}`,
    `  Time    : ${i.timeSlot}`,
    `  Ref     : ${i.referenceCode}`,
    '',
    `Please arrive a few minutes early and present your reference code at the reception kiosk.`,
    '',
    `— Office of the Head of the Civil Service`,
  ].join('\n');
}

function appointmentDeclinedText(i: AppointmentEmailInput): string {
  return [
    `Hello ${i.visitorName},`,
    '',
    `Unfortunately, your appointment request (Ref: ${i.referenceCode}) could not be approved.`,
    ...(i.declineReason ? [``, `Reason: ${i.declineReason}`] : []),
    '',
    `Please contact the office to arrange an alternative time.`,
    '',
    `— Office of the Head of the Civil Service`,
  ].join('\n');
}

function appointmentConfirmedHtml(i: AppointmentEmailInput): string {
  const name = escapeHtml(i.visitorName);
  const officer = escapeHtml(`${i.officerName}${i.officerTitle ? ` — ${i.officerTitle}` : ''}`);
  const dir = escapeHtml(i.directorateName);
  const ref = escapeHtml(i.referenceCode);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F8F9FA;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
      <div style="background:#1A4D2E;color:#fff;padding:24px;text-align:center;">
        <h1 style="margin:0;font-size:16px;font-weight:700;">Appointment Confirmed</h1>
        <p style="margin:4px 0 0;font-size:12px;opacity:.75;">Office of the Head of the Civil Service, Ghana</p>
      </div>
      <div style="height:3px;background:linear-gradient(90deg,#CE1126 33%,#FCD116 33% 66%,#006B3F 66%);"></div>
      <div style="padding:28px 24px;">
        <p style="margin:0 0 18px;font-size:15px;">Hello <strong>${name}</strong>,</p>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;">Your appointment has been <strong style="color:#1A4D2E;">confirmed</strong>. Please find your details below:</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;background:#F0FDF4;border-radius:12px;margin:0 0 20px;border:1px solid #BBF7D0;">
          <tr><td style="padding:12px 16px 4px;font-size:11px;color:#166534;text-transform:uppercase;letter-spacing:.5px;">Officer</td></tr>
          <tr><td style="padding:0 16px 10px;font-size:15px;font-weight:600;color:#14532D;">${officer}</td></tr>
          <tr><td style="padding:0 16px 4px;font-size:11px;color:#166534;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #BBF7D0;">Office / Directorate</td></tr>
          <tr><td style="padding:0 16px 10px;font-size:14px;color:#14532D;">${dir}</td></tr>
          <tr><td style="padding:0 16px 4px;font-size:11px;color:#166534;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #BBF7D0;">Date &amp; Time</td></tr>
          <tr><td style="padding:0 16px 10px;font-size:15px;font-weight:600;color:#14532D;">${escapeHtml(i.appointmentDate)} at ${escapeHtml(i.timeSlot)}</td></tr>
          <tr><td style="padding:0 16px 4px;font-size:11px;color:#166534;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #BBF7D0;">Reference Code</td></tr>
          <tr><td style="padding:0 16px 14px;font-size:22px;font-weight:700;font-family:monospace;color:#14532D;letter-spacing:4px;">${ref}</td></tr>
        </table>
        <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">Please arrive a few minutes early and present your reference code at the reception kiosk.</p>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E5E7EB;text-align:center;font-size:11px;color:#9CA3AF;">Office of the Head of the Civil Service</div>
    </div>
  </div>
</body></html>`;
}

function appointmentDeclinedHtml(i: AppointmentEmailInput): string {
  const name = escapeHtml(i.visitorName);
  const ref = escapeHtml(i.referenceCode);
  const reason = i.declineReason ? `<p style="margin:0 0 18px;font-size:14px;color:#374151;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 16px;"><strong>Reason:</strong> ${escapeHtml(i.declineReason)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F8F9FA;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
      <div style="background:#7F1D1D;color:#fff;padding:24px;text-align:center;">
        <h1 style="margin:0;font-size:16px;font-weight:700;">Appointment Not Approved</h1>
        <p style="margin:4px 0 0;font-size:12px;opacity:.75;">Office of the Head of the Civil Service, Ghana</p>
      </div>
      <div style="height:3px;background:linear-gradient(90deg,#CE1126 33%,#FCD116 33% 66%,#006B3F 66%);"></div>
      <div style="padding:28px 24px;">
        <p style="margin:0 0 18px;font-size:15px;">Hello <strong>${name}</strong>,</p>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;">Unfortunately your appointment request (Ref: <strong style="font-family:monospace;">${ref}</strong>) could not be approved at this time.</p>
        ${reason}
        <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">Please contact the office to arrange an alternative time.</p>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E5E7EB;text-align:center;font-size:11px;color:#9CA3AF;">Office of the Head of the Civil Service</div>
    </div>
  </div>
</body></html>`;
}

function welcomeText(i: WelcomeEmailInput, loginUrl: string): string {
  return [
    `Hello ${i.name},`,
    '',
    `An account has been created for you on OHCS SmartGate.`,
    '',
    `${i.identifierLabel}: ${i.identifierValue}`,
    `Temporary PIN: ${i.pin}`,
    '',
    `Sign in here: ${loginUrl}`,
    `Use your ${i.identifierLabel} and the PIN above. You'll be asked to confirm and change your PIN the first time you sign in.`,
    '',
    `If you did not expect this email, please contact your administrator.`,
    '',
    `— Office of the Head of the Civil Service`,
  ].join('\n');
}

function welcomeHtml(i: WelcomeEmailInput, loginUrl: string): string {
  const name = escapeHtml(i.name);
  const idLabel = escapeHtml(i.identifierLabel);
  const idValue = escapeHtml(i.identifierValue);
  const pin = escapeHtml(i.pin);
  const safeUrl = escapeHtml(loginUrl);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F8F9FA;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
      <div style="background:#1B3A5C;color:#fff;padding:24px;text-align:center;">
        <h1 style="margin:0;font-size:16px;font-weight:700;letter-spacing:.3px;">OHCS SmartGate</h1>
        <p style="margin:4px 0 0;font-size:12px;opacity:.75;">Office of the Head of the Civil Service, Ghana</p>
      </div>
      <div style="height:3px;background:linear-gradient(90deg,#CE1126 33%,#FCD116 33% 66%,#006B3F 66%);"></div>
      <div style="padding:28px 24px;">
        <p style="margin:0 0 14px;font-size:15px;">Hello <strong>${name}</strong>,</p>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;">An account has been created for you on OHCS SmartGate. Here are your sign-in details:</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;background:#FEF3C7;border-radius:12px;margin:0 0 20px;">
          <tr><td style="padding:14px 16px 4px;font-size:12px;color:#92400E;text-transform:uppercase;letter-spacing:.5px;">${idLabel}</td></tr>
          <tr><td style="padding:0 16px 12px;font-size:18px;font-weight:700;font-family:monospace;color:#92400E;letter-spacing:1px;">${idValue}</td></tr>
          <tr><td style="padding:0 16px 4px;font-size:12px;color:#92400E;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid rgba(146,64,14,.15);">Temporary PIN</td></tr>
          <tr><td style="padding:0 16px 14px;font-size:22px;font-weight:700;font-family:monospace;color:#92400E;letter-spacing:4px;">${pin}</td></tr>
        </table>
        <table role="presentation" style="margin:0 auto 18px;"><tr><td style="border-radius:12px;background:#1B3A5C;">
          <a href="${safeUrl}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#fff;text-decoration:none;border-radius:12px;">Sign in to SmartGate</a>
        </td></tr></table>
        <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">Or open: <a href="${safeUrl}" style="color:#1B3A5C;">${safeUrl}</a></p>
        <p style="margin:0 0 18px;font-size:13px;color:#6B7280;">Sign in with your <strong>${idLabel}</strong> and the PIN above. You'll be asked to confirm and change your PIN the first time you sign in.</p>
        <p style="margin:0;font-size:12px;color:#9CA3AF;">If you didn't expect this email, please contact your administrator.</p>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E5E7EB;text-align:center;font-size:11px;color:#9CA3AF;">Office of the Head of the Civil Service</div>
    </div>
  </div>
</body></html>`;
}
