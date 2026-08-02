# Oversight Roles — Chief Director & Head of Service — Design

**Date:** 2026-08-02 · **Status:** model approved by user · **Scope:** API scoping + VMS portal overviews

## 1. Goal

Give directors a complete overview of their own directorate/unit, and give the
Chief Director (CD) and Head of Service (HoS) a complete overview of all of
OHCS — read-only oversight, no new `users.role` values.

## 2. Role model (locked)

- **No new role values.** `users.role` has a CHECK constraint and the table is
  FK-referenced — additive-only migrations rule it out (the Client Service
  precedent). CD/HoS are `display_role` overlays: `display_role =
  'chief_director' | 'head_of_service'` on a base `role = 'director'` account
  (login + read gates work; display_role drives scope).
- **Identical visibility for CD and HoS.** Hierarchy lives in authority, not
  data access. Both get the same org-wide read-only overview. (Any future
  HoS-only content would be a separate gated module, not a diluted dashboard.)
- **Acting appointments:**
  - Director acting as CD → superadmin sets `display_role='chief_director'`
    on that director's account; cleared when the period ends. Audited.
  - Deputy acting as Director → real, reversible `role` change by superadmin
    (existing admin action, audited, session-epoch bumped). No new machinery.
  - No `acting_until` auto-revert in v1 (audit trail + manual flip suffices).

## 3. Scope resolution (`packages/api/src/lib/directorate-scope.ts`)

- Today: director without `directorate_id` fails closed (`__no_directorate__`
  sentinel, deny-all). Directors with one are scoped to it; other roles pass
  unscoped.
- Change: **before** the sentinel path, if the user's `display_role` is
  `chief_director` or `head_of_service`, resolve as **org-wide** (same
  "unscoped" semantics admin-tier gets). The user row read must include
  `display_role` (check the existing query).
- Every consumer of `resolveDirectorateScope` (visits, visitors, reports,
  analytics, photos) inherits CD/HoS org-wide read for free.

## 4. Attendance endpoints open to oversight (`attendance.ts`)

- `/attendance/today`, `/attendance/records`, `/attendance/by-directorate` are
  currently `superadmin|admin` only. Extend the gate to include `director`
  **scoped**: a director sees only their directorate's rows (force
  `directorate_id` filter via the scope resolver; 403/fail-closed for a
  director with no entity). CD/HoS pass **org-wide** via §3.
- `/attendance/records` gains the forced filter the same way visits does.
- `by-directorate` for a director collapses to their own entity (or simply
  force-filter it; the UI will show the single card).

## 5. Portal overview (packages/web)

- **Role-aware dashboard home** (`DashboardPage` or a dedicated
  `OverviewPage` mounted at `/` for these roles — follow the existing
  ProtectedRoute + AppLayout structure):
  - **Director**: entity card — today's present/absent/late + notified-absent
    list for their directorate, active visits for their entity, open SLA
    issues. Data: §4 endpoints (scoped) + already-scoped `/visits` +
    `/analytics`.
  - **CD/HoS**: org-wide — same card shape with org totals + the existing
    by-directorate breakdown cards; today's visits org-wide.
  - Reception dashboard content stays unchanged for reception-tier roles.
- **Sidebar**: directors and CD/HoS see: Overview (home), Visit Log,
  Analytics, Reports (all already role-consistent from the portal-gaps fix).
  No new top-level nav items — the Overview covers attendance for these roles.
- **Admin users UI**: extend the `display_role` dropdown (currently Client
  Service) with Chief Director / Head of Service options; `roleLabel()` in
  `web/lib/roles.ts` gains labels + badge colors (CD ≠ HoS ≠ client service).
- Audit entries already exist for user edits — display_role changes ride them.

## 6. Notifications

- Daily summary fan-out selects `role IN ('superadmin','director')` — CD/HoS
  (base role director) are included automatically. No change.
- Absence notices: directors already receive their entity's notices (shipped
  today). CD/HoS visibility of notices = the overview's notified-absent list,
  not per-notice pushes (avoid top-of-org noise; revisit if asked).

## 7. Out of scope (YAGNI)

- CD/HoS write powers of any kind (read-only oversight).
- Auto-reverting acting appointments (`acting_until`).
- HoS-only content divergence.
- Any change to the CHECK constraint / real role values.

## 8. Testing

- API: scope resolver returns org-wide for cd/hos display_roles, keeps
  fail-closed sentinel for plain directors without entity; attendance
  endpoints: director sees own entity only (forced filter, 403 without
  entity), cd/hos see all, staff-role 403 unchanged.
- Web: roleLabel coverage for the two new labels; suites + typecheck green.
- Acting flow: setting/clearing display_role flips scope (route test).
