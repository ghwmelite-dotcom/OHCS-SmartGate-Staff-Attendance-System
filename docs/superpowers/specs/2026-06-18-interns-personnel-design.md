# Interns in the Staff Clock-In System — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Builds on:** the NSS personnel subsystem (`user_type='nss'`, `admin-nss.ts`, `NssTab`, `nss-eos`).

## Summary

Add **Interns** as a personnel category in the staff attendance / clock-in system, parallel to
NSS. Interns are operationally a sibling of NSS — temporary, with a dated posting window, clocking
in through the same machinery, needing attendance tracking and auto-deactivation at the end of their
placement. Rather than duplicate the ~1,400 lines of NSS route + tab code, we **generalise the NSS
subsystem into one "service personnel" module that serves both NSS and Interns**, discriminated by
`user_type`. One source of truth, two personnel types.

Decisions locked during brainstorming:
1. **Identity:** interns get a server-minted code `OHCS-INT-YYYY-NNN` and log in with it + PIN (third
   login tab in the staff app). No NSS number.
2. **Placement:** combined with NSS in one admin area, renamed **"NSS & Interns"**, with a Type
   filter (All · NSS · Interns).
3. **Captured fields:** institution/school, programme/field, and a supervisor that **links to an
   existing staff user** (FK), on top of name/email/directorate/start–end dates.
4. **End-of-service:** interns auto-deactivate at their end date and appear in "ending soon" alerts,
   exactly like NSS.
5. **Out of scope (v1):** intern bulk-CSV import; end-of-internship certificates/sign-off.

## Context (verified)

- `users.user_type TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss'))`
  (`schema.sql:35`), added by `migration-nss-foundation.sql` via `ALTER TABLE ADD COLUMN … CHECK(…)`.
  NSS posting window lives in `nss_start_date` / `nss_end_date`; identifier in `nss_number`
  (regex `^NSS[A-Z]{3}\d{7}$`).
- **Clock-in (`routes/clock.ts`) and PIN login (`routes/auth.ts`) are entirely `user_type`-agnostic.**
  `pin-login` already accepts exactly one of `staff_id` *or* `nss_number` (disjoint queries) + PIN;
  the clock route only reads `session.userId`. So interns clock in and authenticate through the
  existing flow with zero change to it.
- NSS admin surface: `routes/admin-nss.ts` (create, list with `status` filter active/expiring/ended/all,
  `/today` board, `/export` range roll-up with per-user working-day clamping, `/run-eos`,
  `/:id/activity`, detail/update/soft-delete, reset-pin, bulk-import). Every read filters
  `WHERE u.user_type = 'nss'`.
- `services/nss-eos.ts` hardcodes `user_type='nss'` + `nss_end_date` to deactivate expired NSS and
  send the Telegram "ending this week" digest.
- Frontend: `components/admin/NssTab.tsx` (header, ending-soon banner, 4 stat cards, status +
  directorate + search filters, today board, kebab actions, run-eos footer), `NssRegistrationModal.tsx`
  (single create + bulk import), `NssDetailModal.tsx` (edit + 14-day activity). Mounted in
  `AdminPage.tsx`; visible to superadmin + admin.
- Reporting: `AttendanceTab.tsx` has a `segment: 'staff'|'nss'|'all'` that sends `?user_type=` to
  `/attendance/*`; `lib/pdf.ts` branches on segment and has a dedicated `generateNssReportPdf()`.
- Types: `types.ts:27` `export type UserType = 'staff' | 'nss'`. Web mirrors:
  `AttendanceTab` segment type, `LoginPage` `Tab` type.
- `routes/users.ts:112` blocks promoting an NSS user to a non-staff role (`NSS_NOT_PROMOTABLE`).

## Architecture

The change is a **generalisation, not a parallel copy.** The NSS subsystem's read/lifecycle endpoints
and the NSS admin tab become *type-aware* and serve both `nss` and `intern`. Only the two things that
genuinely differ per type — the **identifier** and the **create/captured fields** — branch.

```
user_type:  'staff'  |  'nss'  |  'intern'      ← widened enum
                          \________/
                     "service personnel": shared posting window (nss_start_date/nss_end_date),
                     shared clock-in, shared today-board / export / activity / EOS / PIN reset,
                     shared "NSS & Interns" admin tab.
identity:   staff_id    nss_number   intern_code   ← three disjoint login identifiers
```

## Data model changes (`users`)

### A. Widen the `user_type` enum
`CHECK(user_type IN ('staff','nss'))` → `CHECK(user_type IN ('staff','nss','intern'))`.

**SQLite constraint (the one real risk):** a column-level `CHECK` cannot be altered in place. Widening
it requires a **one-time `users` table rebuild** (new table with the widened CHECK + all current
columns and new ones → copy rows → drop old → rename → recreate every index). This must run with
`PRAGMA foreign_keys=OFF` around the swap (tables `clock_records`, `leave_requests`,
`absence_notices`, `notifications`, `push_subscriptions`, `webauthn_credentials`,
`directorate_receivers` FK-reference `users`). The repo has precedent (`2026-06-17-users-role-check-drop`);
mirror that migration's structure. **Prod verification is mandatory** — `[[prod-users-role-check-drift]]`
records that prod's `users` constraints have drifted from the repo before, so the implementation must
read prod's *actual* `user_type` CHECK (`SELECT sql FROM sqlite_master WHERE name='users'`) before and
after, not assume it matches the repo.

### B. New columns (added in the same rebuild, or via `ALTER ADD COLUMN` after it)
| Column | Type | Notes |
|---|---|---|
| `intern_code` | TEXT | Login identifier for interns, e.g. `OHCS-INT-2026-001`. NULL for staff/NSS. |
| `institution` | TEXT | Intern's school/university. NULL otherwise. |
| `programme` | TEXT | Intern's course/field of study. NULL otherwise. |
| `supervisor_user_id` | TEXT | FK → `users(id)`. The OHCS staff member supervising the intern. |

Indexes:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique
  ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active
  ON users(user_type, nss_end_date) WHERE user_type = 'intern';
```

### C. Reused (NOT renamed)
Interns reuse `nss_start_date` / `nss_end_date` as their posting window. This is deliberate: it lets the
existing EOS, export-clamping, status filters and today-board work unchanged for interns once their
`user_type` is included. The columns keep their names (documented with a comment) to avoid a high-risk
rename across ~15 query sites.

## Identity & login

- **Code scheme:** `OHCS-INT-YYYY-NNN`, where `YYYY` is the registration year and `NNN` is a
  zero-padded sequence within that year (001, 002, …). Minted server-side on create as
  `OHCS-INT-{year}-{(max existing seq for year)+1 padded to 3}`. Computed with a single
  `SELECT MAX(...)`-style query inside the create handler; low volume makes contention a non-issue,
  and the unique index is the backstop (retry once on collision).
- **Login:** add `intern_code` as a third disjoint identifier to `pin-login` — the `refine` becomes
  "exactly one of staff_id / nss_number / intern_code". Staff app `LoginPage` gains an **Intern** tab
  (`Tab` type adds `'intern'`; `TAB_KIND`/`TAB_COPY` get an intern entry: label "Intern code",
  placeholder `OHCS-INT-2026-001`). `auth store` sends `intern_code` when that tab is active.
- **Clock-in:** unchanged.

## Backend changes

### Generalise `admin-nss.ts` (the read/lifecycle endpoints)
- Replace the hardcoded `u.user_type = 'nss'` in list / `/today` / `/export` / `/:id/activity` /
  detail / update / delete / reset-pin with a **type set** `u.user_type IN ('nss','intern')`, plus an
  optional `?type=nss|intern|all` query param (default `all`) that narrows it. The `/:id` guards that
  currently reject non-NSS users (`NOT_NSS`) become "not service personnel" (accept nss **or** intern).
- `NSS_SELECT_COLUMNS` gains `intern_code, institution, programme, supervisor_user_id` and the
  supervisor's name via a self-join (`LEFT JOIN users sup ON sup.id = u.supervisor_user_id`).
- **Two create paths:**
  - `POST /api/admin/nss` — unchanged (NSS number + regex, `user_type='nss'`).
  - `POST /api/admin/interns` — new. Body: `name`, `email`, `institution?`, `programme?`,
    `supervisor_user_id?`, `directorate_id`, `nss_start_date` (= placement start),
    `nss_end_date` (= placement end), `grade?`. Validates the directorate exists, the supervisor
    (if given) is an existing **staff** user, generates the intern code + initial PIN, inserts with
    `user_type='intern'`, returns `{ user, initial_pin }`.
- Update (`PATCH /:id`) accepts the intern fields (`institution`, `programme`, `supervisor_user_id`)
  when the target is an intern; existing NSS fields unchanged.
- Mount (decided): the read/lifecycle endpoints stay under `/api/admin/nss` and serve both types;
  intern creation is a **dedicated `POST /api/admin/interns`** (keeps the NSS create handler and its
  regex untouched, and keeps the two create bodies cleanly separate).

### End-of-service (`services/nss-eos.ts`)
Widen the "expired" and "ending soon" queries from `user_type='nss'` to
`user_type IN ('nss','intern')` (still keyed on `nss_end_date`). Telegram digest copy becomes
"NSS / Interns ending this week" and labels each row with its type. No new cron — the existing
00:30 UTC job + `/run-eos` cover both.

### Users route
`NSS_NOT_PROMOTABLE` guard (`users.ts:112`) extends to interns: a `user_type IN ('nss','intern')`
user cannot be promoted off `role='staff'`.

### Reporting
`AttendanceTab` segment type gains `'intern'`; the segment dropdown gets an Interns option; the
`?user_type=intern` param already flows through `attendance.ts` filters unchanged. `pdf.ts` gets an
intern-aware title/slug (reuse the NSS range-report layout; the export endpoint already serves interns
via `?type=intern`).

## Frontend changes

### Tab → "NSS & Interns"
- `AdminPage.tsx`: rename the tab label to **"NSS & Interns"**; keep the same `nss` tab key + role
  visibility. (Sidebar label updated to match.)
- `NssTab.tsx` (generalised):
  - Add a **Type filter** (All · NSS · Interns) → passes `?type=` to the list/today queries.
  - Add a **Type badge column** in the today board (NSS / Intern).
  - "Register" button (decided): a **single** button opening the type-aware registration modal, which
    leads with a **Type toggle (NSS / Intern)** that swaps the field set below.
  - Stat-card and ending-soon copy generalised ("Active", "Present today", "Late today",
    "Ending in 30 days") — already type-neutral wording.
- `NssRegistrationModal.tsx` (type-aware):
  - NSS branch = current fields.
  - **Intern branch** = name, email, institution, programme, **supervisor** (searchable select of
    active staff users via a lightweight `/api/admin/users?role=staff&q=` lookup or the existing users
    list), directorate, start date, end date. **No code field** — the generated `OHCS-INT-YYYY-NNN`
    is shown once in the PIN-result modal alongside the initial PIN.
- `NssDetailModal.tsx`: show a Type badge; when intern, render institution / programme / supervisor
  (name) and allow editing them; reuse the rest (activity grid, PIN reset, end service, dates).

### Staff app login
`LoginPage.tsx` + `auth.ts` store: add the **Intern** tab (identifier = intern_code).

## Types

- `packages/api/src/types.ts`: `UserType = 'staff' | 'nss' | 'intern'`; `User` interface gains
  `intern_code`, `institution`, `programme`, `supervisor_user_id` (all `string | null`).
- Web: `AttendanceTab` segment + `LoginPage` `Tab` add `'intern'`; the NSS list/detail row types
  gain the four new fields + `supervisor_name`.

## Error handling & edge cases

- **Intern code collision** (concurrent registration): the unique index rejects the dup; the create
  handler retries once with the recomputed next sequence, then surfaces a 409 if it still collides.
- **Supervisor validity:** `supervisor_user_id`, if provided, must reference an existing
  `user_type='staff'` user; otherwise 400 `INVALID_SUPERVISOR`. A supervisor who is later deactivated
  is still shown (FK intact); editing can clear/replace them.
- **Type guards:** lifecycle endpoints accept nss **or** intern; a `staff` user hitting them returns
  the (renamed) "not service personnel" 400.
- **EOS:** an intern past `nss_end_date` is deactivated and drops off the active today-board, same as
  NSS; the "ending soon" window is the existing 30-day / digest logic.
- **Migration idempotency + prod drift:** the rebuild migration is guarded so re-running is a no-op;
  prod's `user_type` CHECK is read before/after and the run aborts loudly if the post-state doesn't
  include `'intern'`.

## Testing

- **Unit:** intern-code generator (format, zero-pad, year rollover, next-sequence); `pin-login`
  `refine` now accepts exactly one of three identifiers (add intern cases); supervisor validation.
- **Route:** intern create (happy path returns code+PIN; bad supervisor → 400; dup email → 409);
  generalised list/today/export include interns and honour `?type=`; lifecycle guards accept intern,
  reject staff.
- **Static:** API + web type-check; web build.
- **Migration:** apply local, assert `SELECT sql FROM sqlite_master WHERE name='users'` contains
  `'intern'` and the new columns/indexes exist; insert an `intern` row succeeds, an invalid
  `user_type` still fails.
- **Runtime (verify skill, post-deploy):** register an intern in the admin tab → code+PIN shown;
  it appears in the "NSS & Interns" board with an Intern badge and the Type filter; log into the
  staff app via the Intern tab with the code+PIN; clock in; confirm the record + today-board reflect
  it; confirm an intern past end date is deactivated by `/run-eos`.

## Out of scope (YAGNI)

- Intern **bulk-CSV import** (NSS has one; interns are lower-volume — single registration first).
- End-of-internship **certificates / supervisor sign-off**.
- Renaming `nss_start_date` / `nss_end_date` to neutral names (high-churn, low value — reused as-is).
- Notifying supervisors on intern events (the FK is in place to enable this later).
