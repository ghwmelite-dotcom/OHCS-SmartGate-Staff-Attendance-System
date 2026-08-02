# Role-display + Appointments for director+ + RCU reception parity — 2026-08-03

Three user-reported refinements. No migrations. TDD.

## Contract (api ↔ web)
- `GET /api/auth/me` gains `directorate_abbr: string | null` (web needs it for
  the RCU rule + entity display).
- Effective reception tier (server): `role === 'staff' && directorate_abbr === 'RCU'`
  ⇒ treated as `receptionist` by `requireRole`. Client mirror: `hasRoleAccess`
  treats the same user as receptionist-tier. `session.role` itself is NOT
  rewritten (identity stays honest; only the gate consults the rule).
- Appointments read: `GET /api/appointments/admin` allows `director`
  (force-scoped to appointments whose officer belongs to their directorate)
  and cd/hos (org-wide via the scope resolver). Action endpoints unchanged
  (admin/superadmin/approvers only).

## API (`packages/api`)
1. `auth.ts` `/me`: add directorate abbreviation (LEFT JOIN directorates).
2. `middleware/auth.ts` UserAuthState/session: carry `directorate_abbr`
   (extend the existing live-state query — single indexed join, same cache).
3. `lib/require-role.ts`: effective-tier rule — session role 'staff' with
   `directorate_abbr === 'RCU'` satisfies any role list containing
   'receptionist'. Tests: RCU staff passes reception gates, non-RCU staff
   403s, real receptionist unaffected, superadmin unaffected.
4. `appointments-admin.ts` GET: gate widened to director/cd-hos with forced
   scope (officer's directorate), fail-closed sentinel preserved. Tests:
   director sees own entity only + param beaten; cd/hos all; staff 403.

## Web (`packages/web`)
5. Badges prefer display_role: header user chip + profile page + anywhere
   roleLabel is called with only `role` — pass display_role too (roleLabel
   already has the labels; make the call sites consistent).
6. Nav: Appointments visible to director + oversight display roles
   (MODULE_ROLES update); the page already has a read-only mode (receptionist)
   — directors land in it.
7. `roles.ts` `hasRoleAccess`: RCU rule (`directorate_abbr === 'RCU'` +
   role 'staff' ⇒ receptionist tier) — mirror of the server. Nav + pages then
   show reception modules (check-in incl. register, visitors, visit log,
   feedback, appointments) to RCU staff automatically.
8. Tests: roles.test.ts for the RCU matrix + label preferences.

## Explicit non-goals
- Appointment actions for directors (read-only oversight).
- Making the RCU abbreviation configurable (org data is stable; constant is
  documented in one place per side).
