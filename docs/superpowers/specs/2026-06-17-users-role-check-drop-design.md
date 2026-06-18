# Drop the Production `users.role` CHECK Constraint — Design

**Date:** 2026-06-17
**Status:** Approved (pending implementation plan)

## Summary

The production `users` table carries a `role` CHECK constraint that only permits
six roles and silently rejects `hr`, `visitor`, and `f_and_a_admin`. The repo's
`schema.sql` has no such CHECK. This drift means the `hr` role can't be assigned
in prod and the kiosk's `user_kiosk` (role `visitor`) was never created there.
Fix: a table-rebuild migration that drops the `role` CHECK (converging prod with
`schema.sql`) and re-seeds `user_kiosk`. SQLite cannot `ALTER` a CHECK in place,
so a rebuild is the only option.

## Context & root cause

Authoritative prod `users` DDL (`SELECT sql FROM sqlite_master WHERE name='users'`):

```
role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('superadmin','admin','receptionist','it','director','staff'))
```

- The CHECK excludes `f_and_a_admin`, `hr`, and `visitor`.
- `INSERT OR IGNORE` of a disallowed role returns `changes:0` (looks like "already
  exists"), masking the rejection; a plain `INSERT` surfaces
  `CHECK constraint failed: role IN (...)`.
- Prod was built from an older schema and drifted; `schema.sql` was later edited
  to remove the role CHECK but prod was never rebuilt.

**Confirmed prod state** (via primary-consistent `UPDATE … RETURNING` reads —
`wrangler --remote` `changes` meta is unreliable, but row data from `RETURNING`
and `SELECT` reads are reliable):

- 6 users: 4 `superadmin`, 1 `receptionist`, 1 `director`. No `hr`, no
  `f_and_a_admin`, no `user_kiosk`.
- Kiosk columns `visits.check_in_source` and `visitors.id_photo_url` **do** exist
  (ALTERs aren't constrained). 0 kiosk-source visits so far.

**Impact:** `hr` is unassignable in prod; `user_kiosk` is missing so the first
prod kiosk check-in references a non-existent `created_by` user (latent — D1 does
not enforce FKs by default, so it would store a dangling ref rather than error).

## Decision (resolved during brainstorming)

Drop the `role` CHECK entirely (Option A), matching `schema.sql`'s CHECK-free
design. Role validity is already enforced at every write boundary by the app's
Zod enums + the `Role` TS union. A replacement full-role CHECK (Option B) was
rejected — it would recreate the exact lockstep-maintenance hazard that caused
this bug.

## The migration

New file `packages/api/src/db/migration-users-role-check-drop.sql`, registered
**last** in `migrations-index.ts`. Statements are `;\n`-terminated with `--`
comments on their own lines so the migration runner's splitter
(`admin-migrations.ts`: strips `--` lines, splits on `;\n`) handles them. The
rebuilt table reproduces prod's exact schema **minus** the `role` CHECK (keeping
the `pin_acknowledged` / `is_active` / `user_type` CHECKs, all defaults,
`UNIQUE(email)`, `UNIQUE(staff_id)`, and the `directorate_id` FK).

Statement order:

1. `CREATE TABLE users_new (...)` — all 19 columns; `role TEXT NOT NULL DEFAULT
   'staff'` with **no** CHECK; every other column/CHECK/default identical to the
   prod DDL.
2. `INSERT INTO users_new (<explicit 19-column list>) SELECT <same list> FROM users;`
   (explicit columns, never `*`).
3. `DROP TABLE users;`
4. `ALTER TABLE users_new RENAME TO users;`
5. Recreate the four indexes exactly as in `schema.sql`:
   - `CREATE INDEX idx_users_email ON users(email);`
   - `CREATE UNIQUE INDEX idx_users_staff_id ON users(staff_id);`
   - `CREATE UNIQUE INDEX idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;`
   - `CREATE INDEX idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';`
6. `INSERT OR IGNORE INTO users (id, name, email, role) VALUES ('user_kiosk',
   'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'visitor');` — now succeeds.

`schema.sql` needs no change (already CHECK-free). On a CHECK-free DB (local /
fresh) the migration is a harmless equivalent rebuild.

## Safety, risk & rollback

The runner and `wrangler --file` do **not** wrap the file in a transaction, so a
failure after `DROP TABLE users` would leave the table missing. Mitigations:

1. **Test locally first** — apply the full migration to the local D1 and verify
   (DDL has no role CHECK; all rows intact; `user_kiosk` present; a sample
   `UPDATE … SET role='hr'` is accepted, then reverted).
2. **Back up prod users before touching it** — export all user rows to a JSON
   file (`wrangler d1 execute --remote --json "SELECT * FROM users"` saved to
   `docs/ops/backups/`), so the 6 rows can be restored if needed.
3. **Small, pre-tested SQL** — 6 rows; the rebuild SQL is identical to what was
   validated locally.
4. **Apply via `wrangler d1 execute --remote --file`** (one-time), **not** the
   admin migration runner: prod's `applied_migrations` is out of sync (kiosk/hr
   migrations were applied via `wrangler`, not the runner, so the runner would
   try to re-apply them and fail on duplicate `ALTER`s).
5. **Verify after** with primary-consistent reads: `users` DDL no longer contains
   the `role` CHECK; the 6 original users are present and unchanged; `user_kiosk`
   exists with role `visitor`; total = 7.

**Rollback:** if the apply fails mid-way, recreate `users` from `schema.sql`'s
definition and re-insert the backed-up rows (+ `user_kiosk`).

FK note: D1 does not enforce foreign keys by default, so `DROP`/`RENAME` of
`users` will not break the `directorate_id` self-ish ref or the inbound refs from
`visits.created_by`, `clock_records.user_id`, `leave_requests`, `notifications`,
`webauthn_credentials`, `push_subscriptions`. No `PRAGMA` gymnastics required.

## Testing

- **Local (vitest is not relevant here — this is SQL/DDL):** apply the migration
  to the local D1; assert via `SELECT sql FROM sqlite_master WHERE name='users'`
  that the role CHECK is gone and the other CHECKs/columns remain; assert
  `SELECT count(*) FROM users` is unchanged plus `user_kiosk`; run a throwaway
  `UPDATE users SET role='hr' WHERE id='user_kiosk'` → succeeds → revert to
  `visitor`.
- **Prod:** backup → apply → verify (DDL, row counts, `user_kiosk`, role-`hr`
  assignability). Then confirm a kiosk check-in attributes to a now-existing
  `user_kiosk`.

## Out of scope (YAGNI)

- Assigning `hr` or `visitor` to specific real staff (separate admin action).
- Reconciling prod's `applied_migrations` table with migrations applied via
  `wrangler` (tracked separately if needed).
- Any other schema drift beyond the `role` CHECK.
- A replacement role CHECK (decided against).

## Revision 2026-06-18 — corrected delivery (remote D1 enforces foreign keys)

The original plan applied the rebuild via `wrangler d1 execute --remote --file`. Two
prod attempts **failed and auto-rolled-back** (prod left 100% intact):

```
FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY
```

**Corrected root cause:** the spec's earlier claim that "D1 does not enforce
foreign keys" is **wrong for remote D1**. `DROP TABLE users` is blocked because
`visits.created_by`, `clock_records.user_id`, `leave_requests`, `notifications`,
`webauthn_credentials`, `push_subscriptions`, etc. reference `users(id)`.
`PRAGMA foreign_key_check` shows **no** pre-existing dangling refs — the block is
purely the live child FKs. The documented fix, `PRAGMA defer_foreign_keys = true`,
**did not take effect via `wrangler d1 execute --file`** (that path does not run
the file as a single deferred-FK transaction). It is only honored inside a real
single transaction — a Workers `DB.batch()`.

**Also:** prod's `applied_migrations` table records only `migration-nss-foundation.sql`
(prod was migrated via schema.sql bootstrap + `wrangler`, not the runner). So the
general `POST /api/admin/migrations/run` runner is **unusable** here — it would
treat ~20 migrations as pending and fail re-applying duplicate `ALTER`s.

### Corrected approach: focused, idempotent superadmin endpoint running `DB.batch()`

- Add `POST /api/admin/migrations/drop-users-role-check` (superadmin-only) that:
  1. Reads the `users` DDL; if it no longer contains `CHECK(role IN` → returns
     `{ status: 'already-dropped' }` (idempotent — safe to call repeatedly).
  2. Otherwise splits `migration-users-role-check-drop.sql` into statements (same
     strip-`--`-lines / split-on-`;\n` logic as the existing runner) and runs them
     as a single `c.env.DB.batch(stmts.map(s => c.env.DB.prepare(s)))`. The
     migration's first statement is `PRAGMA defer_foreign_keys = TRUE;`, honored
     within the batch transaction, so the `DROP`/rebuild succeeds and FK integrity
     re-checks at commit (the rebuilt `users` holds the same ids → children stay
     valid).
- The migration file gains `PRAGMA defer_foreign_keys=TRUE;` as its first
  statement (done). It stays registered in `migrations-index.ts` for fresh-DB /
  record-keeping; on fresh childless DBs the sequential runner still works.
- **Atomicity:** `batch()` is all-or-nothing — no half-migration risk. The prod
  users backup (`docs/ops/backups/users-backup-2026-06-17.json`, 6 rows) is taken.
- **Delivery:** merge → CI auto-deploys the Worker → a **superadmin triggers the
  endpoint once** (the assistant cannot — it is auth-gated). Idempotent, so
  re-triggering is harmless. Verify prod after (DDL has no role CHECK; 6 originals
  intact; `user_kiosk` present with role `visitor`).
- **Local testing limits:** local D1 does not enforce FKs, so the FK-deferral path
  can't be fully reproduced locally; local validates the endpoint logic, statement
  splitting, idempotency guard, and that the rebuild SQL is valid (already done in
  the earlier local apply). Prod (via the superadmin trigger) is the real test,
  made safe by `batch()` atomicity + the backup.
- **Follow-up (optional):** the one-off endpoint may be removed in a later change;
  being idempotent + superadmin-only, leaving it is harmless.
