# Appointment reschedule proposals (Telegram-primary) — Design

**Date:** 2026-08-03 · **Status:** approved · **Scope:** api + web

## 1. Goal

Approvers (Director/CD/HoS/admin) can counter-propose a new date/slot for a
pending appointment; the visitor receives the proposal on **Telegram**
(inline Accept/Decline) when linked, **email** otherwise (fallback). Accept →
confirmed on the new slot + QR photo in Telegram. Decline → clean close +
rebook invite. Never bounce to pending.

## 2. Locked decisions

- Telegram-primary; email only for unlinked visitors.
- Accept = Telegram ref-code + QR photo only (no duplicate email).
- Decline = terminal + rebook link (no pending ping-pong).
- Visitor links at booking-success via deep link to `@ohcs_smartgate_bot`
  (bots can't DM strangers — first contact is the success page or email).

## 3. Data (one additive migration — gated)

`migration-appointments-reschedule.sql`: `ALTER TABLE appointments ADD COLUMN
proposed_date TEXT; ADD COLUMN proposed_time_slot TEXT;` + schema.sql parity +
registered LAST in migrations-index.

## 4. Flow

1. **Booking success** (`BookingPage.tsx`): if bot username configured, the
   API's book response includes `telegram_link_url` (KV
   `visit-link:<token>` → appointmentId, 24h TTL). Page shows "Get updates on
   Telegram" button.
2. **Bot /start visit-link branch** (`telegram.ts handleStart`, main bot):
   binds `telegram-visitor:<appointmentId>` → chatId, replies a confirmation
   naming the officer. (Officer-link and telegram-user-link branches untouched;
   attendance webhook untouched.)
3. **Propose** (portal, AppointmentsTab): new action on pending appointments →
   date input + slot picker → `PATCH /api/appointments/admin/:id/propose
   {proposed_date, proposed_time_slot}` (admin/superadmin/approver delegates).
   Sets status `reschedule_proposed` + the two columns.
   Delivery: linked visitor → Telegram with inline keyboard
   `[✅ Accept] [❌ Decline]` (callback_data `appt-respond:<id>:accept|decline`);
   unlinked → email with two public links
   `/api/appointments/public/respond/:code/:action` (HTML confirm page).
4. **Accept** (callback or public link, first-response-wins): guard current
   status === 'reschedule_proposed' (changes check). appointment_date/slot :=
   proposed values, proposed_* cleared, status='confirmed'. Visitor (linked):
   Telegram confirmation + QR **photo** (server-side `qrcode` package — already
   in node_modules — PNG of the ref code, sendPhoto with text fallback).
   Approver: in-app + Telegram "visitor accepted".
5. **Decline**: status='declined', decline_reason='visitor declined proposed
   time'; visitor gets polite close + rebook link (`/book`); approver notified.
6. Appointments list shows the proposal state chip ("Proposed — awaiting
   visitor") with the proposed slot.

## 5. Non-goals

- Approver-side Telegram propose action (portal only for now).
- Multiple proposal rounds (one proposal; visitor verdict ends it).
- Cancelling/altering the QR-email path for unlinked visitors (unchanged).

## 6. Testing

- propose: role gates, validation (date future, slot format), state guard
  (only pending), telegram keyboard sent when linked, email sent when not.
- visit-link: /start binds chat; expired/unknown token → greeting.
- accept: only from reschedule_proposed, first-response-wins (422 on replay),
  slot columns moved, QR photo attempted (mocked fetch), approver notified.
- decline: terminal state, approver notified, rebook link in visitor message.
- public respond page: same transitions, HTML 200, invalid code → friendly 404.
