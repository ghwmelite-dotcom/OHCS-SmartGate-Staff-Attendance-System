# Absence Notice ("Can't make it today") — Premium Refinement — Design

**Date:** 2026-08-02 · **Status:** approved by user (2 decisions locked) · **Scope:** staff PWA + API + admin portal

## 1. Goal

Bring the absence-notice feature to the same premium standard as the rest of the
staff app: meaningful, complete data on every notice (required fields, real date
handling, specified "Other"), and delivery to the right person — the **head of
the staff member's org entity** — with Telegram as a first-class channel.

## 2. Locked decisions

- **NOTE and EXPECTED BACK become required** (no more optional fields).
- **EXPECTED BACK** gets quick-pick chips + native date input.
- **Other → required specify field** (stored in `note`, no schema change).
- **Routing:** org-entity Head (revived `directorates.head_officer_id`) →
  director-role users of the entity → superadmins **as fallback only** (not cc'd).
- **Retract is in scope** — staff can withdraw a same-day notice.

## 3. Staff PWA form (`AbsenceNoticeModal.tsx`)

- **Reason** — unchanged 2×2 tile grid (Sick / Family emergency / Transport / Other).
- **"Other" specify** — selecting Other reveals a required text input ("Please
  specify"), max 100 chars. Submitted as `note` when `reason='other'` (server
  enforces: `note` required iff `reason='other'`). When reason ≠ other, `note`
  is a separate required field (below) — the two never collide because Other
  uses `note` for its specify text and non-Other reasons require `note` as
  "Reason detail".
  - *Simplification:* `note` is **always required** (≤200 chars); label changes
    by reason: "Please specify" for Other, "Brief detail (e.g. clinic visit,
    funeral)" otherwise.
- **Expected back** — required. Quick-pick chips: **Tomorrow / 2 days / 1 week /
  Pick a date**. Chips set the date; "Pick a date" reveals the native
  `<input type="date">` (min = tomorrow). Helper copy: "First day you'll be
  back at work."
- **Success copy** stays; button disabled until form valid.
- **Retract** — when a notice covers today, the chip (`AbsenceNoticeButton`)
  gains a "Withdraw" action (confirm step), calling the new DELETE endpoint;
  on success the clock-in UI returns to normal.

## 4. API changes (`packages/api/src/routes/attendance.ts`)

- `POST /absence-notice` zod: `reason` enum (unchanged); `note`
  `string.trim().min(2).max(200)` **required**; `expected_return_date`
  `YYYY-MM-DD` **required**, strictly after today, ≤ today+30 days (longer
  absences belong to the leave-requests workflow).
- **One active notice per user per day** (upsert, no migration): if a row
  exists for `(user_id, notice_date = today)`, UPDATE it instead of inserting
  a duplicate.
- `DELETE /absence-notice/today` (new) — deletes the caller's row for today
  (404 if none). Retract is same-day only by construction.
- `recordAudit` on submit, update (re-submit), and retract.
- Server reason-label map: fix `'other' → "Absent"` to `"Other"`.
- **Date-semantics alignment:** reminder suppression (`reminders.ts`
  `AUDIENCE_SQL`) currently treats the return date as *inclusive* (nudges stay
  suppressed the morning you're back) while `GET /today` treats it as
  exclusive. Align reminders to the exclusive form
  (`today >= notice_date AND today < COALESCE(expected_return_date, notice_date + 1 day)`),
  so nudges resume the morning the person is expected back.

## 5. Head-of-entity routing

- **Admin wiring (no migration):** `admin-directorates.ts` PUT accepts
  `head_officer_id` (nullable; validate the officer belongs to that entity).
  DirectoratesTab gains a **Head** dropdown per entity row (officers of that
  entity; shows current head's name; superadmin-only).
- **Resolution chain** (`sendAbsenceNoticePush`, `reminders.ts:323-362`):
  1. `directorates.head_officer_id` → officer → linked user via
     `officers.staff_id` (fallback email/name, existing `findUserByOfficer`
     pattern) → in-app + push via `sendTypedNotification`; **plus Telegram** to
     `officers.telegram_chat_id` via the main bot when set (heads are officers
     who already receive arrival alerts there). If the head officer resolves
     to **no** user account **and** no Telegram link, fall through to step 2 —
     a head that can't be reached must not swallow the notice.
  2. Else: active users `role='director'` in the entity (current behavior).
  3. Else: superadmins.
  - Submitter excluded at every step. Users without `directorate_id` → step 3.
- **Message** (all channels): "<First Last> won't be in today" or "…out until
  <d MMM>" + reason label + note + "Expected back <date>". Telegram gets the
  HTML-escaped variant.

## 6. Hygiene folded in

- `schema.sql` drift fix: add missing `officers.staff_id` column (matches the
  already-applied migration; fresh-init parity).
- Docs page: new "Absence notices" card in `packages/web/src/docs/content.ts`
  (the feature has none today — convention gap).

## 7. Out of scope (YAGNI)

- Admin list/report of notices (the notification is the surface; revisit if
  heads ask for a register).
- Multi-day notice editing beyond same-day retract + re-submit.
- `leave_requests` workflow changes (separate feature).

## 8. Testing

- API (vitest, node:sqlite shim): required-field validation matrix (note
  required, other-specify required, return date required/range/≤30d);
  upsert-not-duplicate on re-submit; DELETE today (200/404); audit rows on all
  three; routing chain (head → director → superadmin fallback; submitter
  excluded; head gets Telegram when linked, in-app+push always); reminders
  audience resumes on the return date.
- Staff PWA: form validation states (Other→specify required, chips set date,
  submit disabled until valid); retract confirm flow. Component tests in the
  existing vitest pattern.
- Web: DirectoratesTab head picker typecheck + existing suites.
