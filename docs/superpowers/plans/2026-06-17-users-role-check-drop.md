# Drop `users.role` CHECK Constraint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 3 mutates the production database — run it deliberately, verify each gate, and STOP on any mismatch. Do not delegate Task 3 to an unattended agent.**

**Goal:** Remove the drifted `role` CHECK constraint from the production `users` table (which silently blocks the `hr`, `visitor`, and `f_and_a_admin` roles) via a table-rebuild migration, and re-seed the missing `user_kiosk`.

**Architecture:** SQLite can't `ALTER` a CHECK out, so a registered migration rebuilds `users` without the role CHECK (preserving all columns, other CHECKs, defaults, indexes, FKs), then re-seeds `user_kiosk`. Tested locally, backed up, and applied to prod via `wrangler --file` (not the migration runner, whose `applied_migrations` is out of sync in prod).

**Tech Stack:** Cloudflare D1 (SQLite), wrangler CLI.

---

## Spec reference

`docs/superpowers/specs/2026-06-17-users-role-check-drop-design.md`

## Conventions / ENVIRONMENT

- The repo path has a space and `&`; invoke wrangler directly via node (the `.cmd` shim breaks). From `packages/api`:
  - Local: `node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local <args>`
  - Remote: `node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote <args>`
- API type-check (repo root): `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`.
- **`wrangler --remote` `changes`/`rows_written` meta is unreliable in this environment.** Trust only row data from `SELECT` and `... RETURNING`. For a primary-consistent read that defeats replica lag, use a no-op `UPDATE users SET role=role ... RETURNING`.
- Branch: `fix/users-role-check-drop` (already created; do not switch).

---

## Task 1: Create the migration + register it

**Files:**
- Create: `packages/api/src/db/migration-users-role-check-drop.sql`
- Modify: `packages/api/src/db/migrations-index.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/api/src/db/migration-users-role-check-drop.sql` with EXACTLY this content (statements are `;`-then-newline terminated and `--` comments are on their own lines, so both `wrangler --file` and the in-app runner's splitter handle it):

```sql
-- Drop the legacy users.role CHECK constraint (prod drifted from schema.sql) via
-- a table rebuild. Companion spec: 2026-06-17-users-role-check-drop-design.md
-- Rebuilds users WITHOUT the role CHECK, preserving all columns / other CHECKs /
-- defaults / indexes / FKs, then re-seeds the kiosk system user (role 'visitor',
-- which the old CHECK rejected). Harmless on already-CHECK-free DBs.
CREATE TABLE users_new (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    staff_id         TEXT UNIQUE,
    pin_hash         TEXT,
    pin_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(pin_acknowledged IN (0, 1)),
    role             TEXT NOT NULL DEFAULT 'staff',
    grade            TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    last_login_at    TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    current_streak   INTEGER NOT NULL DEFAULT 0,
    longest_streak   INTEGER NOT NULL DEFAULT 0,
    directorate_id   TEXT REFERENCES directorates(id),
    user_type        TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss')),
    nss_number       TEXT,
    nss_start_date   TEXT,
    nss_end_date     TEXT
);
INSERT INTO users_new (id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active, last_login_at, created_at, updated_at, current_streak, longest_streak, directorate_id, user_type, nss_number, nss_start_date, nss_end_date)
SELECT id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active, last_login_at, created_at, updated_at, current_streak, longest_streak, directorate_id, user_type, nss_number, nss_start_date, nss_end_date
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_staff_id ON users(staff_id);
CREATE UNIQUE INDEX idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;
CREATE INDEX idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';
INSERT OR IGNORE INTO users (id, name, email, role) VALUES ('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'visitor');
```

The column list and types/defaults/CHECKs above are copied from the authoritative prod `users` DDL with ONLY the `role` CHECK removed. The four indexes match `schema.sql` exactly.

- [ ] **Step 2: Register the migration last in the index**

In `packages/api/src/db/migrations-index.ts`, add the import after the existing `hrRole` import:

```typescript
import usersRoleCheckDrop from './migration-users-role-check-drop.sql';
```

And append as the **last** entry of the `MIGRATIONS` array (after the `migration-hr-role.sql` entry):

```typescript
  { filename: 'migration-users-role-check-drop.sql', sql: usersRoleCheckDrop },
```

- [ ] **Step 3: Type-check**

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`
Expected: PASS (the `.sql` import resolves via the wrangler text-loader type shim, same as the other migration imports).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migration-users-role-check-drop.sql packages/api/src/db/migrations-index.ts
git commit -m "feat(db): migration to drop users.role CHECK constraint + reseed kiosk user"
```

---

## Task 2: Apply + verify on the LOCAL D1

Validates the rebuild mechanics (column order, data copy, indexes, kiosk reseed) before touching prod. Run all commands from `packages/api`.

- [ ] **Step 1: Snapshot local user count + roles (before)**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --command "SELECT role, COUNT(*) n FROM users GROUP BY role;"
```
Expected: prints the current local role distribution (note the total for comparison).

- [ ] **Step 2: Apply the migration locally**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --file=src/db/migration-users-role-check-drop.sql
```
Expected: completes with no SQL error (all statements succeed).

- [ ] **Step 3: Verify schema, data, indexes, kiosk user**

Run each and check:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='users';"
```
Expected: the `role` column reads `role TEXT NOT NULL DEFAULT 'staff'` with **no** `CHECK(role IN ...)`; the `pin_acknowledged`, `is_active`, `user_type` CHECKs are still present.

```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users' ORDER BY name;"
```
Expected: includes `idx_users_email`, `idx_users_staff_id`, `idx_users_nss_active`, `idx_users_nss_number_unique` (plus any auto-indexes for the UNIQUE columns).

```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --command "SELECT id, role FROM users WHERE id='user_kiosk';"
```
Expected: one row, `role='visitor'`.

- [ ] **Step 4: Prove the role CHECK is gone (assign + revert `hr`)**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --command "UPDATE users SET role='hr' WHERE id='user_kiosk'; UPDATE users SET role='visitor' WHERE id='user_kiosk';"
```
Expected: succeeds with no `CHECK constraint failed` error (proves an arbitrary new role is now accepted). The second statement reverts the kiosk user to `visitor`.

- [ ] **Step 5: No commit**

Local DB state is not version-controlled; nothing to commit here. Proceed only if every Step 3–4 expectation held.

---

## Task 3: Back up + apply to PRODUCTION + verify

**Production mutation. Execute deliberately. STOP and do not proceed past any step whose verification fails — fall back to Rollback.** Run from `packages/api`.

- [ ] **Step 1: Back up all prod user rows**

Run (saves a JSON backup):
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --json --command "SELECT * FROM users;" > ../../docs/ops/backups/users-backup-2026-06-17.json
```
Expected: the file contains all 6 current users with every column. Open it and confirm it has 6 rows with non-empty `id`/`email`. **Do not proceed if the backup is empty or partial.**

- [ ] **Step 2: Record the pre-state (primary-consistent)**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "UPDATE users SET role=role RETURNING id, role;"
```
Expected: returns exactly the 6 known users (System Administrator, Carl Amoah Buahin, Ephraim K Vorgbe, John Sulemana = superadmin; OHCS Reception = receptionist; Boatemaa D. Bonney = director). Note the exact ids/roles for the post-check.

- [ ] **Step 3: Apply the migration to prod**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --file=src/db/migration-users-role-check-drop.sql
```
Expected: completes with no SQL error. (Ignore the `changes`/`rows_written` meta — verify with reads below.)

- [ ] **Step 4: Verify prod — CHECK removed**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='users';"
```
Expected: `role TEXT NOT NULL DEFAULT 'staff'` with **no** `CHECK(role IN ...)`; the other three CHECKs remain.

- [ ] **Step 5: Verify prod — data intact + kiosk user present (primary-consistent)**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "UPDATE users SET role=role RETURNING id, name, email, role;"
```
Expected: **7 rows** — the original 6 (same ids/roles/emails as Step 2) PLUS `user_kiosk` with `role='visitor'`. The presence of a `visitor`-role row is itself proof the CHECK is gone (the old constraint would have rejected it). No original row changed.

- [ ] **Step 6: Verify prod indexes**

Run:
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users' ORDER BY name;"
```
Expected: includes `idx_users_email`, `idx_users_staff_id`, `idx_users_nss_active`, `idx_users_nss_number_unique`.

- [ ] **Step 7: Commit the backup artifact**

```bash
git add docs/ops/backups/users-backup-2026-06-17.json
git commit -m "chore(db): backup prod users before role-CHECK-drop migration"
```

### Rollback (only if a verification step fails)

If Step 4/5/6 shows a missing/renamed/empty `users` table (e.g., apply failed after `DROP TABLE users`):

1. Recreate the table from the migration's `CREATE TABLE users_new (...)` block but named `users` (run that CREATE with `users` in place of `users_new`), then recreate the four indexes.
2. Re-insert the backed-up rows from `docs/ops/backups/users-backup-2026-06-17.json` (one `INSERT` per row, all columns).
3. Re-verify the 6 original users are present. Then stop and re-investigate before re-attempting.

---

## Task 4: Final verification

**Files:** none.

- [ ] **Step 1: Type-check + confirm migration registered**

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

Confirm `migration-users-role-check-drop.sql` is the last entry in `packages/api/src/db/migrations-index.ts`.

- [ ] **Step 2: Confirm the original asks are now satisfiable in prod**

- `hr` assignable: the prod `users` DDL (Task 3 Step 4) has no role CHECK → assigning `hr` via the admin UI / `PUT /api/users/:id` will no longer be rejected.
- Kiosk attribution fixed: `user_kiosk` exists in prod (Task 3 Step 5) → kiosk check-ins' `created_by='user_kiosk'` now references a real row.

(No throwaway `hr` write is made against prod — the presence of the `visitor`-role `user_kiosk` row already proves the CHECK is gone, and the app enforces role validity at the API layer.)

---

## Self-Review notes (for the implementer)

- **Spec coverage:** drop the role CHECK via rebuild → Task 1 SQL; preserve columns/CHECKs/defaults/indexes/FKs → Task 1 CREATE + index recreation; re-seed `user_kiosk` → Task 1 final statement; local test → Task 2; backup + prod apply + verify → Task 3; rollback → Task 3 Rollback; registered for fresh-DB convergence → Task 1 Step 2.
- **No transaction / atomicity risk:** mitigated by local test (Task 2), backup (Task 3 Step 1), tiny table, and per-step verification with explicit STOP/Rollback.
- **Reliability caveat baked in:** every verification uses row-data reads (`SELECT` / `UPDATE … RETURNING`), never the `changes` meta.
- **Consistency:** the 19-column list is identical in the `CREATE TABLE`, the `INSERT … (cols)`, and the `SELECT cols` — must stay in lockstep; the index names match `schema.sql`.

---

## REVISED TASKS (2026-06-18 — `batch()` endpoint delivery)

**Why revised:** remote D1 enforces foreign keys, so `DROP TABLE users` via
`wrangler d1 execute --file` fails (two prod attempts auto-rolled-back; prod
intact). `PRAGMA defer_foreign_keys=true` is only honored inside a single
transaction — a Workers `DB.batch()`. Prod's `applied_migrations` only records
`migration-nss-foundation.sql`, so the general `/migrations/run` runner is
unusable. **Tasks 1–2 stand** (migration file written + locally validated). **Task 3
(wrangler `--file` prod apply) is SUPERSEDED** by R1–R5 below.

### Task R1: Commit the migration's `defer_foreign_keys` pragma

The local file `migration-users-role-check-drop.sql` already has
`PRAGMA defer_foreign_keys=TRUE;` added as its first statement (uncommitted).

- [ ] Commit it:
```bash
git add packages/api/src/db/migration-users-role-check-drop.sql
git commit -m "fix(db): defer foreign keys in users-role-check-drop migration (D1 enforces FKs)"
```

### Task R2: Add the focused superadmin endpoint

**Files:** Modify `packages/api/src/routes/admin-migrations.ts`.

- [ ] **Step 1:** Ensure the response import includes `error`. Change the import line `import { success } from '../lib/response';` to:
```typescript
import { success, error } from '../lib/response';
```

- [ ] **Step 2:** Append this route to `adminMigrationsRoutes` (after the existing `/run` handler):
```typescript
// One-time, idempotent fix: drop the legacy users.role CHECK constraint via a
// single DB.batch() transaction (the only place PRAGMA defer_foreign_keys is
// honored). Not handled by /run because prod's applied_migrations is out of sync.
adminMigrationsRoutes.post('/drop-users-role-check', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const ddl = await c.env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).first<{ sql: string }>();
  if (!ddl) return error(c, 'NO_USERS_TABLE', 'users table not found', 500);

  // Idempotent: if the role CHECK is already gone, do nothing.
  if (!/CHECK\s*\(\s*role\s+IN/i.test(ddl.sql)) {
    return success(c, { status: 'already-dropped' });
  }

  const migration = MIGRATIONS.find((m) => m.filename === 'migration-users-role-check-drop.sql');
  if (!migration) return error(c, 'MIGRATION_MISSING', 'migration not registered', 500);

  // Same strip-comments / split-on-`;\n` logic as the /run handler.
  const cleaned = migration.sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = cleaned
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  try {
    // Single transaction → PRAGMA defer_foreign_keys=TRUE (first statement) holds,
    // so DROP TABLE users is allowed and FK integrity re-checks at commit.
    await c.env.DB.batch(statements.map((s) => c.env.DB.prepare(s)));
    return success(c, { status: 'applied', statements: statements.length });
  } catch (err) {
    return error(c, 'MIGRATION_FAILED', err instanceof Error ? err.message : String(err), 500);
  }
});
```

- [ ] **Step 3:** Type-check: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json` → PASS.

- [ ] **Step 4:** Commit:
```bash
git add packages/api/src/routes/admin-migrations.ts
git commit -m "feat(api): superadmin endpoint to drop users.role CHECK via DB.batch()"
```

### Task R3: Local sanity check

Local D1 has no FK enforcement and its `users` table CHECK was already dropped in
Task 2, so the endpoint's idempotent guard is what's exercisable locally.

- [ ] Type-check passes (R2 Step 3).
- [ ] (Optional) With `wrangler dev` + a local superadmin session, `POST
  /api/admin/migrations/drop-users-role-check` returns `{ status: 'already-dropped' }`
  (the local CHECK is gone), confirming the guard + routing. The `batch()` rebuild
  + FK deferral is validated against prod in R5 (atomic + backed up).

### Task R4: Finish the branch → deploy

- [ ] Use `superpowers:finishing-a-development-branch`: push, PR, merge to `main`.
  CI (`deploy.yml`) auto-deploys the Worker with the new endpoint.
- [ ] Confirm the deploy run is green.

### Task R5: Trigger on prod (superadmin) + verify

**The assistant cannot call this — it's superadmin-gated. The superadmin user
triggers it once.**

- [ ] **Trigger** (superadmin, against the prod API), e.g.:
```bash
curl -X POST https://ohcs-smartgate-api.ohcsghana-main.workers.dev/api/admin/migrations/drop-users-role-check \
  -H "Authorization: Bearer <SUPERADMIN_SESSION_TOKEN>"
```
Expected: `{ "data": { "status": "applied", "statements": 9 }, "error": null }`
(or `"already-dropped"` if re-run).

- [ ] **Verify** (assistant runs these reads from `packages/api`):
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='users';"
```
Expected: `role TEXT NOT NULL DEFAULT 'staff'` with NO `CHECK(role IN ...)`.
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "UPDATE users SET role=role RETURNING id, role;"
```
Expected: the 6 original users unchanged PLUS `user_kiosk` (role `visitor`) = 7 rows.

- [ ] If the trigger returns `MIGRATION_FAILED`, the `batch()` rolled back
  atomically (prod intact). Capture the error message and STOP — the FK-deferral
  assumption needs re-evaluation before any further attempt; restore is not needed
  (atomic rollback), and the backup remains available regardless.
