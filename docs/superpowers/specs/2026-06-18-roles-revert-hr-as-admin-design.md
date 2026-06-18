# Revert to 6 Roles, HR-as-`admin`, Kiosk Records Visible to IT — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)

## Summary

Roll the role model back to the six roles the **production** `users.role` CHECK
already permits (`superadmin, admin, receptionist, it, director, staff`) — abandoning
the earlier `hr`/`visitor` additions and the (failed) attempt to drop the prod CHECK.
HR supervisory access is delivered by assigning the existing **`admin`** role rather
than a dedicated `hr` role. Add **`it`** to the visitor-record read access so kiosk
check-ins/checkouts are instantly visible to receptionist, admin, superadmin, IT, and
director. Keep the kiosk feature; seed its system user with an allowed role.

## Context & why this pivot

- Prod `users.role` has `CHECK(role IN ('superadmin','admin','receptionist','it','director','staff'))`.
  It never permitted `f_and_a_admin`, and rejects `hr`/`visitor`. Three attempts to
  drop the CHECK (table rebuild) failed because remote D1 enforces foreign keys and
  `DROP TABLE users` is blocked; all attempts auto-rolled-back (prod intact). See
  `2026-06-17-users-role-check-drop-design.md`.
- Decision: stop fighting the CHECK. Make the code's role set match prod's six, and
  satisfy the original goals within those six:
  - **HR supervisor of reception → `admin`** (existing role; already broad).
  - **Kiosk** stays (visitor self check-in/checkout in reception, receptionist-
    supervised); its `created_by` system user just needs to exist with an allowed
    role — the role value is FK attribution only, never a login.
  - **Instant visibility:** kiosk writes directly to `visits`/`visitors`, so the only
    change needed is read-access — add `it` so all five oversight roles can view.

## Decisions (resolved during brainstorming)

1. Role set = the six; remove `hr` and `visitor` from the code entirely.
2. HR supervisor = `admin`; the NSS-admin endpoints (formerly F&A/`hr`) re-gate to
   `superadmin, admin`.
3. Visitor records (`/visits`, `/visitors` reads) viewable by `superadmin, admin,
   receptionist, director, it`. Analytics/reports: just remove `hr` (no `it` added —
   out of scope; the ask was the records/log).
4. `user_kiosk` role = `staff` (allowed; non-login attribution user).
5. Remove the `UserRoleToggle` (staff↔F&A/HR quick-toggle); role changes go through
   the deliberate role dropdown in the user edit form. `admin` is granted via that.
6. Remove the abandoned CHECK-drop migration + endpoint; keep the prod users backup.

## Changes

### A. API — role set back to six + re-gate

- `packages/api/src/types.ts` and `packages/api/src/lib/require-role.ts`: `Role`
  union → remove `| 'hr'` and `| 'visitor'`, leaving the six. (This narrowing makes
  any missed reference a compile error — the safety net.)
- `packages/api/src/routes/admin-nss.ts`: the 11 `requireRole(c, 'superadmin', 'hr')`
  → `requireRole(c, 'superadmin', 'admin')`.
- `packages/api/src/routes/users.ts` (both enums) and `bulk-import.ts` (one enum):
  remove `'hr'` from the `role` `z.enum([...])` → the six.
- `packages/api/src/lib/require-role.test.ts`: replace the `hr`-based assertions
  (now-invalid literal) — admit `admin` on a visitor-read-style allowlist, admit
  `superadmin` on an NSS-style allowlist, reject `staff` (403 FORBIDDEN).

### B. API — visitor-record read access

- `visits.ts` (`GET /`, `GET /active`) and `visitors.ts` (`GET /`, `GET /:id`):
  allowlist → `'superadmin', 'admin', 'receptionist', 'director', 'it'` (drop `hr`,
  add `it`).
- `analytics.ts` (3 sites) and `reports.ts` (1 site): drop `'hr'` only (revert to
  their prior role sets; no `it` added).

### C. Kiosk attribution

- `seed.sql` and `migration-kiosk-visitor.sql`: the `user_kiosk` seed INSERT role
  `'visitor'` → `'staff'`.
- `routes/kiosk.ts`: unchanged (`KIOSK_USER_ID='user_kiosk'`, `created_by`,
  `check_in_source='kiosk'`). Kiosk check-ins/checkouts continue writing to
  `visits`/`visitors`, instantly visible to the five read roles.
- **Prod data:** seed `user_kiosk` with role `staff` via a single
  `INSERT OR IGNORE` (the deferred "quick-fix"; allowed by the CHECK).

### D. Web — revert `hr` wiring, route NSS-admin to `admin`

- `components/layout/Sidebar.tsx`: replace `isHr` (role `hr`) with `isAdmin`
  (role `admin`); `canSeeAdmin = isSuperadmin || isAdmin`; `admin` sees the NSS-admin
  nav entry that F&A/HR previously saw (superadmin still sees full Admin).
- `pages/AdminPage.tsx`: replace `isHr`→`isAdmin` (admin reaches the NSS tab / page);
  remove the `HR` entry from the `ROLES` label list (back to six); remove the
  `<UserRoleToggle ... />` usage + its import.
- `components/admin/UserRoleToggle.tsx`: delete the file.
- `components/admin/NssTab.tsx`: the `=== 'hr'` EOS-permission check → `=== 'admin'`.

### E. Cleanup

- Delete `packages/api/src/db/migration-users-role-check-drop.sql` and its
  registration in `migrations-index.ts`; delete the
  `POST /api/admin/migrations/drop-users-role-check` endpoint from
  `routes/admin-migrations.ts`.
- Delete `packages/api/src/db/migration-hr-role.sql` and its registration (a no-op
  that references the now-removed `hr` role).
- Keep `docs/ops/backups/users-backup-2026-06-17.json`.

## Error handling & security

- The `Role` union narrowing is the primary guard — a missed `hr`/`visitor`
  reference fails the type-check.
- No endpoint loses a guard; `admin` already had broad API access, and now also has
  the NSS-admin area (UI + the re-gated endpoints). `it` gains read-only access to
  visitor records only.
- `user_kiosk` is a non-login system row (no `pin_hash`); its `staff` role grants no
  effective access (it never authenticates).

## Testing

- **Unit (vitest, API):** updated `require-role` test (admit `admin`/`superadmin`,
  reject `staff`). Full suite green.
- **Static:** type-check API + web (the union change surfaces any missed reference);
  build web; grep confirms no `hr`/`visitor` role literal remains in `packages/`
  except the F&A-directorate text (unrelated) and `'staff'` for `user_kiosk`.
- **Manual smoke (post-deploy):** an `admin` session reads `/visits`, `/visitors`,
  and the NSS-admin area; an `it` session reads `/visits` & `/visitors` (and is
  denied `/admin/nss`); `staff` denied the records; a kiosk check-in appears in the
  visit log for those roles.

## Out of scope (YAGNI)

- Dropping/altering the prod `role` CHECK (abandoned — we conform to it).
- Adding `it` to analytics/reports (records-only per the requirement).
- A dedicated `hr` role (replaced by `admin`).
- Reverting the kiosk feature itself (it stays).
