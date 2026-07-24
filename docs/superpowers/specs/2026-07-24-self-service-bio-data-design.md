# Self-Service Bio Data — Design

Date: 2026-07-24
Status: shipped

## Problem

Non-admin users cannot correct their own basic bio data. The VMS "My Profile"
page already edits phone + email, but **name** is display-only (admin-only
today), and the staff PWA has **no profile surface at all** — staff/NSS/interns
can change their PIN there but cannot view or correct name, phone, or email.

## Scope

Key basic bio data = **name, phone, email**. Everything else (staff_id, role,
grade, directorate, NSS/intern fields) stays admin-managed.

## Design

### API — `PATCH /auth/profile` (`packages/api/src/routes/auth.ts`)

- Schema gains `name: z.string().trim().min(2).max(120).optional()`.
- **Identity fields (name, email) are PIN-gated**: `current_pin` required when
  either changes — same verification path as the existing email flow (PIN lock,
  failure recording, PBKDF2 verify). Phone remains ungated, as today.
- Name change does **not** bump the session epoch (email still does — it is the
  login identifier; name is display data, and `/auth/me` reads it fresh from DB
  on every call so all surfaces update without re-login).
- Name and email changes are written to the hash-chained `audit_log`
  (`profile.update` action) — name lands on attendance records, so corrections
  must be traceable. Phone-only changes stay unaudited, matching today.

### VMS — `ProfilePage.tsx`

- New editable **Full Name** field above phone/email. The existing PIN
  confirmation input appears when name *or* email is changed; one PIN confirms
  the whole submit.

### Staff PWA — new profile surface

- `ProfileModal.tsx` styled on `PinChangeModal` (gold top bar, Playfair heading):
  identity header (name, staff_id / NSS no. / intern code, role label),
  editable name / phone / email, PIN field shown when name or email changes.
- Opened from a new **Profile** item in `BottomNav` (UserRound icon), sitting
  beside Settings / PIN / Sign Out.
- `stores/auth.ts`: `User` gains `staff_id`, `nss_number`, `intern_code`,
  `phone`; new `updateProfile(patch)` mirroring the web store, updating the
  cached user from the response.
- `/auth/me` already returns staff_id/phone; it gains nss_number/intern_code so
  the identity header can show the right identifier.

## Non-goals

- Editing staff_id, role, grade, directorate, NSS/intern metadata (admin-only).
- Officer-directory fields (title, office_number) — separate concern.

## Verification

- `tsc --noEmit` + `vitest run` in `packages/api`, `packages/web`, `packages/staff`.
- Extended `auth-profile.test.ts` schema cases (name valid/invalid, PIN gate).
- Playwright screenshots: VMS profile page; staff modal is validated by build +
  typecheck (mobile PWA, no Chrome harness here).
