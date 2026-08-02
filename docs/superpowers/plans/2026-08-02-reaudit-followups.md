# Re-audit follow-up fixes — 2026-08-02

From the 4-pass re-audit. One surgical commit each side (api / web), TDD.

## API (`packages/api`)
1. `/records` absence join fans out duplicate rows for overlapping notices →
   join only the LATEST applicable notice per user (correlated subquery
   `ORDER BY a.created_at DESC LIMIT 1`) or GROUP BY u.id — register must stay
   one row per user.
2. Head-is-submitter swallow (`reminders.ts` sendAbsenceNoticePush): when the
   head officer resolves to the submitter (or `!linked`), do NOT return after
   a Telegram self-send — fall through to director/superadmin steps.
3. `/link` staff-ID enumeration oracle (`telegram.ts:314-336`): drop the DB
   lookup; reply with the "linking moved" text unconditionally (uniform
   response whether or not the ID exists).
4. Daily-summary noticed-absent span inclusive → exclusive
   (`daily-summary.ts:57-59`): `? >= notice_date AND ? < COALESCE(expected_return_date, date(notice_date,'+1 day'))`.
5. Absence upsert race (`attendance.ts`): make it atomic without a migration —
   UPDATE first; if 0 changes, `INSERT ... SELECT ... WHERE NOT EXISTS
   (SELECT 1 FROM absence_notices WHERE user_id=? AND notice_date=?)`; if that
   inserted 0 (lost race), UPDATE. No un-retractable duplicates.
6. Head→user name fallback collision (`reminders.ts:385-388`): name leg must
   match exactly ONE active user (`LIMIT 2`, skip leg if >1) — rename attacks
   and innocent collisions can't misdirect a note.
7. Jan-1 double yearly report (`index.ts` monthly case `'0 9 1 * *'`): skip
   `sendDailySummaryFn` when the date is Jan 1 (the yearly case `'0 9 1 1 *'`
   covers it); keep `sendMonthlyReportReady`.
8. Double-arrive approver fan-out race (`appointments-public.ts:487-527`):
   guard the status flip `UPDATE appointments SET status='completed' WHERE id=? AND status='confirmed'`,
   check `meta.changes === 0` → skip notifications (first writer wins).
9. Dead `/api/telegram/link` route: remove `telegramLinkRoute`, its mount in
   `index.ts:143`, `generateLinkCode` (`services/telegram.ts:270`), and the
   unused import (`telegram.ts:5`).
10. Duplicate visitor race (`appointments-public.ts` findOrCreateAppointmentVisitor):
    deterministic idempotency key `appt-visitor:<appointmentId>` on insert +
    UNIQUE-race recovery re-read (visitors.idempotency_key partial unique
    index already exists).
11. `/unlink` strands admin registration (`telegram.ts` handleUnlink): if
    `telegram-admin-chat-id` equals the sender's chat, delete it too, and say
    so in the reply.
12. Comment drift: `users.ts:69` (client_service rides receptionist since
    0f7f3dc) and `appointments-admin.ts:363` ("reception/admin" — reception
    can't complete).

## Web (`packages/web`)
13. Blank `/admin` for non-admin direct-URL (`AdminPage.tsx:166-184`): the
    tab-reflect effect's `setSearchParams` wins the replace race over the
    guard's `navigate('/')`. Bail BEFORE effects: early
    `if (!isSuperadmin && !isAdmin) return <Navigate to="/" replace />`.

## Deferred (documented)
- PIN-reset gate covers only role='staff' — widening to PIN-bearing non-staff
  risks locking OTP admins (they carry admin-set PINs); needs a distinct
  "admin-issued PIN" marker, not role checks.
- Director-tier clock-photo 403 — Overview doesn't render photos; revisit if
  directors need photo evidence.
- /records reminder effective-date edge (D7) — arguably desirable.
