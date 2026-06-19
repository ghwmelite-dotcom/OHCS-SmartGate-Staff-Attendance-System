# Interns in the Staff Clock-In System — Design

**Date:** 2026-06-18 (data-model revised 2026-06-19 — see "Design revision" below)
**Status:** Implemented & deployed (PR #18).
**Builds on:** the NSS personnel subsystem (`admin-nss.ts`, `NssTab`, `nss-eos`).

## Design revision (2026-06-19) — discriminator model, not a new `user_type`

The original design (below, kept for context) modeled interns as a **new `user_type='intern'`** enum value, which required widening the `users.user_type` `CHECK` constraint. Implementation proved that is **infeasible on Cloudflare D1**: widening/dropping a column `CHECK` needs a create-new→copy→`DROP`→rename table rebuild, and D1 cannot rebuild a table that has FK children with rows (D1 forces `foreign_keys` ON and ignores `PRAGMA foreign_keys=OFF`; `defer_foreign_keys` trips at COMMIT on the rows momentarily orphaned by `DROP TABLE users`). `users` has 8 populated FK children, so it is effectively un-rebuildable on D1. (See memory `d1-cannot-rebuild-referenced-table`.)

**Shipped model:** interns are **`user_type='nss'` distinguished by a non-null `intern_code`**:
- Real NSS → `user_type='nss'` with `nss_number` set, `intern_code` NULL.
- Interns → `user_type='nss'` with `intern_code` set, `nss_number` NULL.
- "NSS" is the **service-personnel umbrella**; the discriminator is `intern_code IS NOT NULL`.
- The `user_type` `CHECK` stays `('staff','nss')` — **unchanged**. New columns are added with additive `ALTER TABLE ADD COLUMN` (fully D1-supported, no rebuild, no FK risk).

Everything else in the original design (one combined "NSS & Interns" admin area, the `OHCS-INT-YYYY-NNN` code, the Intern login tab, institution/programme/supervisor fields, shared EOS/today-board/export) shipped as designed.

## Summary

Add **Interns** as a personnel category in the staff attendance / clock-in system, parallel to NSS.
Interns are operationally a sibling of NSS — temporary, with a dated posting window, clocking in
through the same machinery, needing attendance tracking and auto-deactivation at the end of their
placement. Rather than duplicate the NSS route + tab code, we **generalise the NSS subsystem into one
"service personnel" module that serves both NSS and Interns**, discriminated by `intern_code`.

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
  (`schema.sql`). NSS posting window lives in `nss_start_date` / `nss_end_date`; identifier in
  `nss_number` (regex `^NSS[A-Z]{3}\d{7}$`).
- **Clock-in (`routes/clock.ts`) and PIN login (`routes/auth.ts`) are entirely
  personnel-type-agnostic.** `pin-login` already accepts exactly one of `staff_id` *or* `nss_number`
  + PIN; the clock route only reads `session.userId`. So interns clock in and authenticate through
  the existing flow with zero change to it.
- NSS admin surface: `routes/admin-nss.ts` (create, list with `status` filter, `/today` board,
  `/export` range roll-up, `/run-eos`, `/:id/activity`, detail/update/soft-delete, reset-pin,
  bulk-import). `services/nss-eos.ts` auto-deactivates expired personnel + Telegram digest.
- Frontend: `components/admin/NssTab.tsx`, `NssRegistrationModal.tsx`, `NssDetailModal.tsx`, mounted
  in `AdminPage.tsx` (superadmin + admin). Reporting: `AttendanceTab.tsx` segment + `lib/pdf.ts`.

## Architecture

The change is a **generalisation, not a parallel copy.** The NSS subsystem's read/lifecycle endpoints
and the NSS admin tab become *service-personnel-aware* and serve both real NSS and interns. Only the
two things that genuinely differ — the **identifier** and the **create/captured fields** — branch.

```
user_type:  'staff'  |  'nss'                      ← CHECK unchanged
                          └── service personnel (the umbrella)
                                ├─ real NSS  : nss_number set,  intern_code NULL
                                └─ intern    : intern_code set, nss_number  NULL   ← discriminator
identity:   staff_id    nss_number   intern_code   ← three disjoint login identifiers
```

## Data model changes (`users`) — additive only

### A. New columns (via `ALTER TABLE ADD COLUMN`, D1-safe, no rebuild)
| Column | Type | Notes |
|---|---|---|
| `intern_code` | TEXT | Login identifier for interns, e.g. `OHCS-INT-2026-001`. NULL for staff/NSS. **Non-null ⇒ intern.** |
| `institution` | TEXT | Intern's school/university. NULL otherwise. |
| `programme` | TEXT | Intern's course/field of study. NULL otherwise. |
| `supervisor_user_id` | TEXT | FK → `users(id)`. The OHCS staff member supervising the intern. (Nullable FK adds cleanly via `ALTER ADD COLUMN` on D1.) |

Indexes:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique
  ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active
  ON users(user_type, nss_end_date) WHERE intern_code IS NOT NULL;
```

### B. Reused (NOT renamed)
Interns reuse `nss_start_date` / `nss_end_date` as their posting/placement window. This lets the
existing EOS, export-clamping, status filters and today-board work unchanged for interns (they are
`user_type='nss'`). Columns keep their names (documented with a comment).

### C. `user_type` CHECK — unchanged
Stays `CHECK(user_type IN ('staff','nss'))`. Interns are `user_type='nss'`. No CHECK change, no
table rebuild — the only D1-viable approach (see "Design revision").

## Identity & login

- **Code scheme:** `OHCS-INT-YYYY-NNN` — `YYYY` = registration year, `NNN` = zero-padded sequence
  within that year. Minted server-side on create (`services/intern-code.ts`); the unique index on
  `intern_code` is the backstop (create retries once on collision).
- **Login:** add `intern_code` as a third disjoint identifier to `pin-login` (the `refine` becomes
  "exactly one of staff_id / nss_number / intern_code") and to the WebAuthn login identifier
  (`auth-webauthn.ts` `resolveIdentifier`). Staff app `LoginPage` gains an **Intern** tab.
- **Clock-in:** unchanged.

## Backend changes

### Generalise `admin-nss.ts` read/lifecycle endpoints
- A `personnelTypeWhere(typeParam)` helper resolves the optional `?type=nss|intern|all` filter to a
  fixed SQL clause:
  - `nss` → `u.user_type = 'nss' AND u.intern_code IS NULL`
  - `intern` → `u.user_type = 'nss' AND u.intern_code IS NOT NULL`
  - `all` (default) → `u.user_type = 'nss'`
  Applied to list / `/today` / `/export` (and the `/export` CTE join).
- Per-id guards (detail, update, delete, reset-pin, activity) accept service personnel —
  `existing.user_type === 'nss'` (which covers both real NSS and interns); non-personnel →
  `NOT_PERSONNEL` 400.
- `PERSONNEL_SELECT_COLUMNS` includes `intern_code, institution, programme, supervisor_user_id` and
  the supervisor's name via `LEFT JOIN users sup ON sup.id = u.supervisor_user_id`. `/today` returns
  `intern_code` so the UI can render the NSS/Intern badge.
- **Two create paths:**
  - `POST /api/admin/nss` — unchanged (NSS number + regex; `user_type='nss'`, no intern_code).
  - `POST /api/admin/interns` (new) — body `name, email, institution?, programme?,
    supervisor_user_id?, directorate_id, nss_start_date, nss_end_date, grade?`. Validates the
    directorate, the supervisor (must be an existing `user_type='staff'` user), generates the intern
    code + initial PIN, inserts with `user_type='nss'` + `intern_code` set, returns `{ user,
    initial_pin }`.
  - `GET /api/admin/interns/supervisors` (new) — admin-reachable list of active staff (id + name) for
    the supervisor picker (the full `/users` list is superadmin-only).
- Update (`PATCH /:id`) accepts `institution`, `programme`, `supervisor_user_id` (validated).

### End-of-service (`services/nss-eos.ts`)
Queries filter `user_type='nss'` (the umbrella covers interns). Each digest row is labelled by type
via `intern_code` presence (`intern_code ? 'Intern' : 'NSS'`) and shows the right identifier. No new
cron — the existing 00:30 UTC job + `/run-eos` cover both.

### Users route
The `NSS_NOT_PROMOTABLE` guard (`users.ts`) blocks promoting any `user_type='nss'` user (NSS or
intern) off `role='staff'`.

### Reporting
`AttendanceTab` segment gains `intern`; `attendance.ts` maps segments to fixed clauses —
`staff`→`user_type='staff'`, `nss`→`user_type='nss' AND intern_code IS NULL`, `intern`→`user_type='nss'
AND intern_code IS NOT NULL`, `all`→no filter. `pdf.ts` gets an intern title/slug.

## Frontend changes

- **`AdminPage.tsx` / `Sidebar.tsx`:** NSS tab label → **"NSS & Interns"** (key `'nss'` + role
  visibility unchanged).
- **`NssTab.tsx`:** Type filter (All · NSS · Interns) → `?type=`; a Type badge that reads
  **intern when `row.intern_code != null`, else NSS**; a single "Register" button opening the
  type-aware modal.
- **`InternRegistrationFields.tsx` (new) + `NssRegistrationModal.tsx`:** a Type toggle (NSS / Intern);
  the Intern branch captures name, email, institution, programme, supervisor (searchable select of
  active staff from `/api/admin/interns/supervisors`), directorate, start/end dates. Submits to
  `POST /api/admin/interns`; the result modal shows the generated `intern_code` + initial PIN. Bulk
  import stays NSS-only.
- **`NssDetailModal.tsx`:** `isIntern = detail.intern_code != null`; shows/edits institution,
  programme, supervisor; "Placement window" relabel; PATCH sends only changed fields (so it never
  nulls a supervisor it didn't touch) and injects the current supervisor as an option if absent.
- **Staff app:** `LoginPage.tsx` + `webauthnClient.ts` + `stores/auth.ts` add the **Intern** tab
  (`IdentifierKind` gains `intern_code`).

## Error handling & edge cases

- **Intern code collision** (concurrent registration): the unique index rejects the dup; the create
  handler retries once with the recomputed next sequence, then 409 if it still collides.
- **Supervisor validity:** `supervisor_user_id`, if provided, must reference an existing
  `user_type='staff'` user; otherwise 400 `INVALID_SUPERVISOR`.
- **Type guards:** lifecycle endpoints accept `user_type='nss'` (NSS or intern); a `staff` user →
  `NOT_PERSONNEL` 400.
- **EOS:** an intern past `nss_end_date` is deactivated and drops off the active board, same as NSS.

## Testing

- **Unit:** intern-code generator (format, zero-pad, year rollover, next-sequence) + the
  `createInternSchema` validation. (`pin-login`/route behaviour is verified at runtime — the repo has
  no DB/route integration harness, by convention.)
- **Static:** API + web + staff type-check; web build.
- **Migration:** additive `ALTER ADD COLUMN`; applied local + remote, assert the 4 columns + indexes
  exist and the `user_type` CHECK is unchanged; an `intern`-shaped row (`user_type='nss'` +
  `intern_code`) inserts.
- **Runtime (post-deploy):** register an intern in the admin tab → code+PIN shown; it shows in the
  "NSS & Interns" board with an Intern badge + Type filter; log into the staff app via the Intern
  tab; clock in; confirm an intern past end date is deactivated by `/run-eos`.

## Out of scope (YAGNI)

- Intern **bulk-CSV import**; end-of-internship **certificates / supervisor sign-off**.
- Renaming `nss_start_date` / `nss_end_date` to neutral names (reused as-is).
- Notifying supervisors on intern events (the FK is in place to enable this later).
