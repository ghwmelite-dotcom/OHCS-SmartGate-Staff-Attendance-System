# Merge `f_and_a_admin` → `hr` Role + HR Oversight of Reception — Design

**Date:** 2026-06-17
**Status:** Approved (pending implementation plan)

## Summary

Replace the access role `f_and_a_admin` with a single `hr` role (F&A folded into
HR), and — because the HR head supervises the receptionist — grant the `hr` role
full visitor-management access plus analytics/reports oversight, on top of the
NSS/F&A powers it already carries. RBAC-only: no schema change beyond a defensive
data migration.

## Context

- `f_and_a_admin` is a wired role used by the API to gate **11 NSS-management
  endpoints** (`packages/api/src/routes/admin-nss.ts`) and listed in the user
  create/update (`users.ts`) and bulk-import (`bulk-import.ts`) role enums. It is
  declared in two `Role` unions: `packages/api/src/types.ts` and
  `packages/api/src/lib/require-role.ts`.
- The web app references the role in `Sidebar.tsx` (admin nav gating),
  `AdminPage.tsx` (role label map + role enums + tab-visibility logic),
  `UserRoleToggle.tsx` (a staff↔F&A promote toggle), and `NssTab.tsx` (EOS
  permission check).
- **No users hold `f_and_a_admin`** in either the local or remote (production) D1
  — confirmed by `SELECT role, COUNT(*) FROM users GROUP BY role` (only
  `superadmin`, `receptionist`, `director`, plus the credential-less `visitor`
  kiosk user). So the rename needs no data migration in practice.
- Visitor-management reads (`/visits`, `/visitors`) are gated to
  `superadmin, admin, receptionist, director`. Check-in/check-out endpoints have
  **no** `requireRole` gate (any authenticated user may perform them).

## The one critical distinction (role vs. directorate)

"F&A" appears in two unrelated capacities. Only the **role** changes:

| Kind | Examples | Action |
| --- | --- | --- |
| **Access role** `f_and_a_admin` | `Role` unions; `admin-nss.ts` gates; `users.ts`/`bulk-import.ts` enums; web `Sidebar.tsx`/`AdminPage.tsx`/`UserRoleToggle.tsx`/`NssTab.tsx` | **Rename → `hr`** |
| **F&A *directorate*** (org structure) | `dir_fa` in `seed.sql`; AI routing knowledge in `services/assistant.ts` and `routes/admin-eval-assistant.ts`; "F&A issues NSS PINs" wording in `routes/auth.ts`; the `F&A` routing keyword in `CheckInPage.tsx` | **Leave untouched** |

Renaming the directorate would break visitor purpose-routing and NSS-issuance
semantics. The role label becomes HR; the F&A department stays F&A.

## Decisions (resolved during brainstorming)

1. **Role name:** rename `f_and_a_admin` → `hr` (not a separate combined role).
2. **HR access scope:** full + oversight — everything the receptionist can do
   (manage visits & visitors) **plus** analytics/reports, in addition to the
   existing NSS/F&A powers.
3. **Supervision model:** access-only via RBAC (add `hr` to the relevant route
   allowlists). No supervisor column, no directorate link.

## Changes

### A. API — rename + access grant

**Rename `f_and_a_admin` → `hr`:**
- `packages/api/src/types.ts` — `Role` union member.
- `packages/api/src/lib/require-role.ts` — `Role` union member.
- `packages/api/src/routes/admin-nss.ts` — all 11 `requireRole(c, 'superadmin',
  'f_and_a_admin')` calls → `'hr'` (and the "F&A admin" code comment).
- `packages/api/src/routes/users.ts` — both `role` enums (create + update).
- `packages/api/src/routes/bulk-import.ts` — the `role` enum.

HR retains every current F&A power (NSS register, end-of-service run, NSS PDFs)
unchanged — only the identifier and labels change.

**Grant visitor oversight (full + oversight):** add `'hr'` to the
`requireRole(...)` allowlists wherever `receptionist`/`director` currently appear
for viewing/managing visitor data:
- `routes/visits.ts` — `GET /` (list) and `GET /active`.
- `routes/visitors.ts` — `GET /` (list) and `GET /:id` (detail).
- `routes/analytics.ts` — view endpoints (add `hr` alongside the existing
  director/admin allowance).
- `routes/reports.ts` — view/export endpoints (same).

Check-in (`POST /visits/check-in`) and check-out (`POST /visits/:id/check-out`)
are not role-gated, so HR can already perform them — no change needed there.

> Implementation note: enumerate the exact `requireRole(...)` call sites in
> `analytics.ts` and `reports.ts` during planning and add `'hr'` to each; the
> visits/visitors sites are the four listed above.

### B. Web — rename + labels (no nav restructuring)

The main nav (`Dashboard, Check-In, Visitors, Visit Log, Analytics, Reports` in
`Sidebar.tsx`) is shown to **every** authenticated user already; the API is the
real access boundary. So once the API allows `hr`, its visitor/analytics/reports
access surfaces automatically — the web work is a mechanical rename + relabel:

- `Sidebar.tsx` — `isFAndAAdmin` → `isHr`, comparing `user?.role === 'hr'`. The
  admin-section "NSS Admin" link for this role stays.
- `AdminPage.tsx` — role label map entry `{ value: 'f_and_a_admin', label: 'F&A
  Admin', ... }` → `{ value: 'hr', label: 'HR', ... }`; both `role` enums;
  `isFAndA` → `isHr` and its comments.
- `UserRoleToggle.tsx` — toggle target `f_and_a_admin` → `hr`; copy "F&A Admin
  Access" → "HR Access"; toast/aria text "F&A Admin" → "HR"; update the
  description to note it also grants visitor oversight (in addition to NSS).
- `NssTab.tsx` — the `role === 'f_and_a_admin'` EOS-permission check → `'hr'`.

### C. Data migration (defensive, RBAC-only)

New registered migration `packages/api/src/db/migration-hr-role.sql`:

```sql
-- Merge the f_and_a_admin role into hr. No-op on current data (no users hold
-- f_and_a_admin), but guarantees any stray row keeps access under the new name.
UPDATE users SET role = 'hr' WHERE role = 'f_and_a_admin';
```

Register it in `migrations-index.ts` (last entry). No columns, constraints, or
seed users change. `seed.sql` already seeds no `f_and_a_admin` user, so it needs
no edit.

## Error handling & security

- The `Role` union narrowing (removing `f_and_a_admin`) makes any missed
  reference a **compile error** — the primary safety net against an orphaned
  literal. Type-check both packages.
- Access is unchanged in spirit: HR = former F&A powers + visitor oversight. No
  endpoint loses a guard; `hr` is added to allowlists, never removed.
- A stray `f_and_a_admin` DB row (none today) is healed by the migration so it
  cannot silently lose access.

## Testing

- **Unit (vitest, `packages/api`):** a focused `require-role` test — `requireRole`
  admits `hr` (returns `null`) and rejects a non-allowed role (returns a 403
  Response), exercised against a representative allowlist. (Mirrors the existing
  service-test style; `requireRole` reads `c.get('session').role`, so the test
  builds a minimal mock context.)
- **Static:** type-check `packages/api` and `packages/web` with the direct-`tsc`
  commands; build the web app; grep the repo to confirm **no `f_and_a_admin`
  literal remains** and that the only remaining "F&A" strings are the intentional
  directorate/routing/NSS text listed in the role-vs-directorate table.
- **Manual smoke (optional):** with `wrangler dev`, confirm an `hr`-role session
  can read `/api/visits` and `/api/admin/nss/...` and that `staff` still gets 403
  on those.

## Out of scope (YAGNI)

- A separate combined `hr_fa_admin` role (decided against — single `hr`).
- A supervisor/`reports_to` column or linking the receptionist to a directorate
  (decided against — access-only RBAC).
- Renaming the F&A directorate or any AI-routing/NSS-issuance wording.
- Creating a specific HR user account (can be done later via the admin UI's
  staff↔HR toggle or bulk import).
