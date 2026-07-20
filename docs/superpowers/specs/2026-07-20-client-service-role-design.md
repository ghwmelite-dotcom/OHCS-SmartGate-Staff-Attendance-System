# Client Service Role — Design

Date: 2026-07-20 · Status: implemented (this doc records the shipped design)

## Problem

OHCS wants a **Client Service** role in the VMS so Client Service Unit staff can be
provisioned with reception-level front-desk access, visibly badged as "Client
Service" rather than "Receptionist".

## Hard constraint: prod `users.role` CHECK

The production `users` table carries `CHECK(role IN ('superadmin','admin',
'receptionist','it','director','staff'))`. SQLite cannot drop a CHECK without a
table rebuild, `users` is the most FK-referenced table in the schema, and D1's
always-on FK enforcement makes the rebuild unsafe. A CHECK-drop was already
attempted and abandoned on 2026-06-17/18 (see git history around `52bff16` /
`4af0036`); the project convention is additive-only migrations, no rebuilds of
referenced tables.

## Decision: display-tier role (no new DB role value)

Add `users.display_role TEXT` (nullable, additive). **Client Service is
`role='receptionist'` + `display_role='client_service'`** — reception parity by
construction (every route guard, nav gate, wizard step, evacuation right and
notification recipient list keyed on `receptionist` applies automatically:
dashboard, visitor check-in/out, visit log, appointments, evacuation roll),
with a distinct UI identity. Admin-and-above surfaces (analytics, NSS/intern
management, attendance views, the AdminPage tabs) stay out of reach.

The mapping is invisible in the admin UI: the System Role dropdown shows
"Client Service" as a first-class option; selecting it stores
`role='receptionist', display_role='client_service'`. Any other selection clears
`display_role` (NULL). Badges, the header and the profile page render the
display role when set.

If a future requirement needs Client Service access to *diverge* from
receptionist, that requires the prod CHECK rebuild conversation — out of scope
here by convention.

## Surface changes

- **API**: `users.display_role` column (migration `migration-users-display-role.sql`,
  registered last; `schema.sql` updated to match). `users` create/update accept
  `display_role: 'client_service' | null`; list/get/create responses and
  `GET /auth/me` return it; `display_role` is an audited user field.
- **Web**: `ROLES` in `AdminPage.tsx` gains
  `{ value: 'client_service', label: 'Client Service', color: 'bg-service/10 text-service' }`;
  badge lookup uses `display_role ?? role`; create/edit modals map the
  pseudo-role at the submit/load boundary. `Header.tsx` and `ProfilePage.tsx`
  show the display role via a shared `roleLabel()` helper (`lib/roles.ts`).
- **Theme**: new `--color-service` token (violet family — distinct from the
  green/gold/red/blue already taken by other roles), light + dark variants in
  `tokens.css`.

## Out of scope

- Route-guard changes (none needed — parity by construction).
- Bulk-import designation support (roster import stays plain staff).
- A second display role value — the zod enum is a single value today, cheap to
  extend when another unit needs the same treatment.
