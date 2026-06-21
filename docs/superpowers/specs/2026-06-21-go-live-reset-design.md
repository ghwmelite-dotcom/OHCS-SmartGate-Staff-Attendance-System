# Go-Live Reset — Design Spec

**Date:** 2026-06-21  **Status:** Approved (build)

## Goal

A guarded, one-time superadmin action to clear demo/seed content before the office
goes live, so production starts from a clean directory + zero test activity.

## Decisions (locked)

- **Scope:** delete the demo directory + all test activity. KEEP the real org config.
- **Confirm:** typed phrase `RESET` + superadmin PIN re-entry. **Always backs up first.** Irreversible.

## Behaviour

`POST /api/admin/maintenance/go-live-reset` (superadmin), body `{ confirm: "RESET", pin }`.

1. requireSuperadmin.
2. Re-auth: verify `pin` against the acting superadmin's `pin_hash` (401 on fail).
3. **Backup first** (`exportBackupToR2`) — if it throws, ABORT (no data deleted).
4. FK-safe **atomic** wipe (`DB.batch`, children→parents, circular FKs nulled first):
   null `directorates.reception_officer_id` + `users.supervisor_user_id`; delete
   notifications, push_subscriptions, leave_requests, absence_notices, clock_records,
   visits, visitors, directorate_receivers, officers, `users WHERE id NOT IN (acting superadmin, user_kiosk)`, audit_log.
5. Write a fresh audit genesis entry (`system.go_live_reset`) recording who/when + the backup id.
6. Return `{ ok, backup, ... }`.

**KEEPS:** directorates, visit_categories, holidays, app_settings, the acting
superadmin user, and `user_kiosk` (needed for kiosk check-ins). Deleted users' KV
sessions are revoked automatically by the existing session-revocation middleware
(getUserAuthState → null → 401 + session delete).

## UI

A red **Danger zone — Go-Live Reset** block at the bottom of the Settings modal
(superadmin only): button → inline confirm requiring the user to type `RESET` and
enter their PIN, with an explicit "permanent, backed-up-first" warning. On success,
invalidate the users/officers/directorates queries.

## Notes
- Other real superadmins/users (if any) ARE removed (scope = clean slate; acting
  superadmin re-creates real accounts). Documented in the warning.
- The "users ⊂ officers" modelling concern is not changed here; the reset just
  removes the inconsistent demo rows so a clean real population can be entered.
