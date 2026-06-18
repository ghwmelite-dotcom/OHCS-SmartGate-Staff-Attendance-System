# Interns in the Staff Clock-In System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Intern" personnel category to the staff clock-in system by generalising the NSS subsystem to serve both NSS and Interns (one `user_type` discriminator), with a generated intern code, institution/programme/supervisor fields, a combined "NSS & Interns" admin tab, an Intern login tab, and end-of-service handling — all reusing the existing clock-in, auth, today-board, export and EOS machinery.

**Architecture:** Interns are `users.user_type='intern'`, reusing `nss_start_date`/`nss_end_date` as their posting window so EOS/exports/today-board work unchanged once the type filter is widened. New `users` columns: `intern_code`, `institution`, `programme`, `supervisor_user_id` (FK→users). The read/lifecycle endpoints under `/api/admin/nss` become type-aware (`?type=nss|intern|all`); creation is a dedicated `POST /api/admin/interns`. Login adds `intern_code` as a third disjoint identifier. Reference spec: `docs/superpowers/specs/2026-06-18-interns-personnel-design.md`.

**Tech Stack:** Hono + D1 (Cloudflare Workers), React 18 + Vite (web admin + staff PWA), Zod, react-hook-form, vitest.

**Toolchain note (repo path has a space + `&` — never `npm run`):**
- API type-check: from `packages/api` → `node ../../node_modules/typescript/bin/tsc --noEmit`
- API tests: from `packages/api` → `node ../../node_modules/vitest/vitest.mjs run`
- Web type-check: from `packages/web` → `node ../../node_modules/typescript/bin/tsc --noEmit`
- Web tests: from `packages/web` → `node ../../node_modules/vitest/vitest.mjs run`
- Web build: from `packages/web` → `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`
- Staff type-check: from `packages/staff` → `node ../../node_modules/typescript/bin/tsc --noEmit`
- wrangler: `node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" ...` (run from `packages/api`)

**Migration approach (corrects the spec's risk note):** there is **no** `users-role-check-drop` migration in the repo to mirror — that drift was prod-only. The app migration runner (`routes/admin-migrations.ts`) splits SQL on `;\n` and runs **each statement separately with no transaction**, so a `users` table rebuild can NOT go through it safely. The CHECK widening is therefore done **out-of-band via `wrangler d1 execute --file`** (single transaction, `PRAGMA defer_foreign_keys`), local first, then remote with the user's confirmation and a backup, and is **not** registered in the `MIGRATIONS` array.

---

## File Structure

- **Create:**
  - `packages/api/src/db/migration-intern-foundation.sql` — canonical rebuild SQL (applied out-of-band; documented, not in MIGRATIONS).
  - `packages/api/src/services/intern-code.ts` — intern-code generator.
  - `packages/api/src/services/intern-code.test.ts` — generator unit tests.
  - `packages/api/src/routes/admin-interns.ts` — `POST /api/admin/interns` create.
  - `packages/api/src/routes/admin-interns.test.ts` — create-route tests.
  - `packages/web/src/components/admin/InternRegistrationFields.tsx` — intern branch of the registration modal (keeps the modal file focused).
- **Modify (API):** `db/schema.sql`, `db/migrations-index.ts` (comment only), `types.ts`, `routes/admin-nss.ts` (generalise + export helpers), `routes/admin-interns.ts` mount in `index.ts`, `services/nss-eos.ts`, `routes/auth.ts`, `routes/auth-webauthn.ts`, `routes/users.ts`, `routes/attendance.ts`.
- **Modify (web admin):** `pages/AdminPage.tsx`, `components/layout/Sidebar.tsx`, `components/admin/NssTab.tsx`, `components/admin/NssRegistrationModal.tsx`, `components/admin/NssDetailModal.tsx`, `lib/pdf.ts`, `components/admin/AttendanceTab.tsx`.
- **Modify (staff PWA):** `pages/LoginPage.tsx`, `stores/auth.ts`, `lib/webauthnClient.ts`.

---

## Task 1: Data-model rebuild (widen `user_type` + add intern columns)

**Files:** Create `packages/api/src/db/migration-intern-foundation.sql`; modify `packages/api/src/db/schema.sql`, `packages/api/src/db/migrations-index.ts`.

This task is **DB-only**; no app code depends on it compiling. It is the highest-risk task — do it first and verify hard.

- [ ] **Step 1: Write the canonical rebuild SQL**

Create `packages/api/src/db/migration-intern-foundation.sql`:
```sql
-- migration-intern-foundation.sql
-- Adds 'intern' to users.user_type and the intern-specific columns.
--
-- APPLIED OUT-OF-BAND ONLY:
--   node "<repo>/node_modules/wrangler/bin/wrangler.js" d1 execute ohcs-smartgate \
--        --file=src/db/migration-intern-foundation.sql            (local)
--   …add --remote for production (after a backup + confirmation).
--
-- This file is intentionally NOT in the MIGRATIONS array in migrations-index.ts:
-- the per-statement app runner (routes/admin-migrations.ts) cannot run a table
-- rebuild safely (no transaction). SQLite cannot ALTER a column CHECK, so the
-- users table must be rebuilt. defer_foreign_keys defers FK validation to COMMIT;
-- all row ids are preserved through the copy, so the 8 child FKs stay valid.
PRAGMA defer_foreign_keys=on;
BEGIN TRANSACTION;

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
    user_type        TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss','intern')),
    nss_number       TEXT,
    nss_start_date   TEXT,   -- reused as the posting/placement window start for interns too
    nss_end_date     TEXT,   -- reused as the posting/placement window end for interns too
    intern_code         TEXT,
    institution         TEXT,
    programme           TEXT,
    supervisor_user_id  TEXT REFERENCES users(id)
);

INSERT INTO users_new
  (id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active,
   last_login_at, created_at, updated_at, current_streak, longest_streak,
   directorate_id, user_type, nss_number, nss_start_date, nss_end_date)
SELECT
   id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active,
   last_login_at, created_at, updated_at, current_streak, longest_streak,
   directorate_id, user_type, nss_number, nss_start_date, nss_end_date
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE user_type = 'intern';

COMMIT;
```

- [ ] **Step 2: Update `schema.sql` (fresh-DB composite) to the post-rebuild state**

In `packages/api/src/db/schema.sql`: change line 35 CHECK to `CHECK(user_type IN ('staff','nss','intern'))`; add the four columns after `nss_end_date` (matching the rebuild block above, including the `nss_start_date`/`nss_end_date` reuse comments); and add the two new indexes after line 43:
```sql
    nss_end_date     TEXT,
    intern_code         TEXT,
    institution         TEXT,
    programme           TEXT,
    supervisor_user_id  TEXT REFERENCES users(id)
);
-- …existing indexes…
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE user_type = 'intern';
```

- [ ] **Step 3: Note in `migrations-index.ts` (no array entry)**

Add a comment above the `MIGRATIONS` array:
```ts
// NOTE: migration-intern-foundation.sql is applied OUT-OF-BAND via `wrangler d1 execute --file`
// (it rebuilds the users table to widen the user_type CHECK; the per-statement runner below
// cannot do that in a transaction). It is deliberately NOT listed here. After applying it,
// record it manually: INSERT INTO applied_migrations (filename, hash) VALUES ('migration-intern-foundation.sql', '<sha256>').
```

- [ ] **Step 4: Apply locally + verify**

From `packages/api`:
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute ohcs-smartgate --local --file=src/db/migration-intern-foundation.sql
```
(Confirm the D1 binding name — read `wrangler.toml` `[[d1_databases]]` `database_name`; use that in place of `ohcs-smartgate` if different.)
Then verify the constraint + columns:
```
… d1 execute ohcs-smartgate --local --command "SELECT sql FROM sqlite_master WHERE name='users';"
```
Expected: the printed `CREATE TABLE` includes `'intern'` and the four new columns. Then prove an intern row inserts and a bad type still fails:
```
… --command "INSERT INTO users (name,email,user_type) VALUES ('T','t@x.io','intern'); SELECT user_type FROM users WHERE email='t@x.io'; DELETE FROM users WHERE email='t@x.io';"
… --command "INSERT INTO users (name,email,user_type) VALUES ('B','b@x.io','bogus');"   -- expect CHECK constraint failure
```

- [ ] **Step 5: Commit** (DB + schema only — remote apply happens in the deploy task, gated on user confirmation)
```
git add packages/api/src/db/migration-intern-foundation.sql packages/api/src/db/schema.sql packages/api/src/db/migrations-index.ts
git commit -m "feat(interns): users rebuild — widen user_type to include 'intern' + intern columns"
```

---

## Task 2: API types + intern-code generator

**Files:** Modify `packages/api/src/types.ts`; create `packages/api/src/services/intern-code.ts` + `intern-code.test.ts`.

- [ ] **Step 1: Extend types**

In `types.ts`: `export type UserType = 'staff' | 'nss' | 'intern';` and add to the `User` interface (after `nss_end_date`):
```ts
  intern_code: string | null;
  institution: string | null;
  programme: string | null;
  supervisor_user_id: string | null;
```

- [ ] **Step 2: Write failing generator tests**

Create `packages/api/src/services/intern-code.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatInternCode, nextInternSeqFrom } from './intern-code';

describe('formatInternCode', () => {
  it('zero-pads the sequence to 3 digits', () => {
    expect(formatInternCode(2026, 1)).toBe('OHCS-INT-2026-001');
    expect(formatInternCode(2026, 42)).toBe('OHCS-INT-2026-042');
    expect(formatInternCode(2026, 999)).toBe('OHCS-INT-2026-999');
  });
});

describe('nextInternSeqFrom', () => {
  it('starts at 1 when there is no prior code for the year', () => {
    expect(nextInternSeqFrom(null, 2026)).toBe(1);
  });
  it('increments the sequence of the latest code for the year', () => {
    expect(nextInternSeqFrom('OHCS-INT-2026-007', 2026)).toBe(8);
  });
  it('restarts at 1 when the latest code is from a different year', () => {
    expect(nextInternSeqFrom('OHCS-INT-2025-050', 2026)).toBe(1);
  });
  it('ignores a malformed tail', () => {
    expect(nextInternSeqFrom('OHCS-INT-2026-xyz', 2026)).toBe(1);
  });
});
```
Run (expect FAIL — module not found): from `packages/api` → `node ../../node_modules/vitest/vitest.mjs run intern-code`

- [ ] **Step 3: Implement the generator**

Create `packages/api/src/services/intern-code.ts`:
```ts
/** Intern login/identity code: OHCS-INT-YYYY-NNN (NNN zero-padded, year-scoped). */
export function formatInternCode(year: number, seq: number): string {
  return `OHCS-INT-${year}-${String(seq).padStart(3, '0')}`;
}

/** Pure helper: next sequence given the latest existing code for a year (or null). */
export function nextInternSeqFrom(latestCode: string | null, year: number): number {
  const prefix = `OHCS-INT-${year}-`;
  if (!latestCode || !latestCode.startsWith(prefix)) return 1;
  const n = parseInt(latestCode.slice(prefix.length), 10);
  return Number.isFinite(n) ? n + 1 : 1;
}

/**
 * Compute the next intern code for `year` by reading the highest existing code.
 * Zero-padding to 3 digits makes lexicographic ORDER BY == numeric order up to 999
 * codes/year (far above OHCS volume). The unique index on intern_code is the backstop.
 */
export async function nextInternCode(db: D1Database, year: number): Promise<string> {
  const prefix = `OHCS-INT-${year}-`;
  const row = await db
    .prepare(`SELECT intern_code FROM users WHERE intern_code LIKE ? ORDER BY intern_code DESC LIMIT 1`)
    .bind(`${prefix}%`)
    .first<{ intern_code: string }>();
  return formatInternCode(year, nextInternSeqFrom(row?.intern_code ?? null, year));
}
```
Run the tests again → expect PASS.

- [ ] **Step 4: API type-check** — from `packages/api` → `node ../../node_modules/typescript/bin/tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**
```
git add packages/api/src/types.ts packages/api/src/services/intern-code.ts packages/api/src/services/intern-code.test.ts
git commit -m "feat(interns): UserType+User intern fields and OHCS-INT code generator"
```

---

## Task 3: Generalise `admin-nss.ts` to serve NSS + Interns and export shared helpers

**Files:** Modify `packages/api/src/routes/admin-nss.ts`.

- [ ] **Step 1: Export the shared helpers** (so `admin-interns.ts` can reuse them)

Add `export` to `generateInitialPin`, `isValidIsoDate`, and the `NssUserRow` interface, and replace the `NSS_SELECT_COLUMNS` const with an exported one that includes the intern fields + supervisor name:
```ts
export const PERSONNEL_SELECT_COLUMNS = `
  u.id, u.name, u.email, u.staff_id, u.role, u.grade, u.is_active,
  u.user_type, u.nss_number, u.nss_start_date, u.nss_end_date,
  u.intern_code, u.institution, u.programme, u.supervisor_user_id,
  sup.name AS supervisor_name,
  u.directorate_id, d.abbreviation AS directorate_abbr,
  u.pin_acknowledged, u.last_login_at, u.created_at, u.updated_at
`;
```
Replace every `${NSS_SELECT_COLUMNS}` usage with `${PERSONNEL_SELECT_COLUMNS}`, and every `FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id` with that join **plus** `LEFT JOIN users sup ON sup.id = u.supervisor_user_id`. Extend `interface NssUserRow` with `intern_code: string | null; institution: string | null; programme: string | null; supervisor_user_id: string | null; supervisor_name: string | null;`.

- [ ] **Step 2: Add a type-filter helper and apply it to read endpoints**

Add near the top:
```ts
/** Resolve the optional ?type= filter into a SQL WHERE clause over service-personnel types. */
export function personnelTypeWhere(typeParam: string | null | undefined): string {
  if (typeParam === 'nss') return `u.user_type = 'nss'`;
  if (typeParam === 'intern') return `u.user_type = 'intern'`;
  return `u.user_type IN ('nss','intern')`;
}
```
In **list** (`GET /`): replace the seed `const where = [\`u.user_type = 'nss'\`]` with `const where = [personnelTypeWhere(c.req.query('type'))]`. In **/today** and **/export**: replace the literal `u.user_type = 'nss'` in the SQL (and in the `INNER JOIN users u ON u.id = cr.user_id AND u.user_type = 'nss'` CTE in /export) with the resolved clause — build the clause string from `personnelTypeWhere(c.req.query('type'))` and interpolate it (it contains no user input — only fixed literals — so interpolation is safe). Also widen the `idx`-friendly `WHERE u.user_type = 'nss'` in /today the same way.

- [ ] **Step 3: Loosen the per-id guards** (detail, patch, delete, reset-pin, activity)

Replace each `if (existing.user_type !== 'nss')` / `WHERE u.id = ? AND u.user_type = 'nss'` with an "nss or intern" check:
```ts
// guard pattern:
if (existing.user_type !== 'nss' && existing.user_type !== 'intern') {
  return error(c, 'NOT_PERSONNEL', 'Target user is not service personnel', 400);
}
// detail query WHERE:
WHERE u.id = ? AND u.user_type IN ('nss','intern')
```
In **PATCH /:id** also allow editing the intern fields when present: add to `updateNssSchema` `institution`, `programme` (`.max(200).optional().or(z.literal(''))`) and `supervisor_user_id` (`.string().optional().or(z.literal(''))`); and in the field-assembly block append:
```ts
if (body.institution !== undefined) { fields.push('institution = ?'); values.push(body.institution || null); }
if (body.programme !== undefined) { fields.push('programme = ?'); values.push(body.programme || null); }
if (body.supervisor_user_id !== undefined) { fields.push('supervisor_user_id = ?'); values.push(body.supervisor_user_id || null); }
```
(When `supervisor_user_id` is provided non-empty, validate it references a `user_type='staff'` user — reuse the validation helper from Task 4 Step 2; on failure return `INVALID_SUPERVISOR` 400.)

- [ ] **Step 4: API type-check** → 0 errors. (Existing NSS tests, if any, must still pass: `node ../../node_modules/vitest/vitest.mjs run`.)

- [ ] **Step 5: Commit**
```
git add packages/api/src/routes/admin-nss.ts
git commit -m "feat(interns): generalise NSS admin endpoints to NSS+intern with ?type filter"
```

---

## Task 4: Intern create route — `POST /api/admin/interns`

**Files:** Create `packages/api/src/routes/admin-interns.ts` + `admin-interns.test.ts`; modify `packages/api/src/index.ts`.

- [ ] **Step 1: Write failing route tests**

Create `packages/api/src/routes/admin-interns.test.ts` mirroring the existing route-test harness in the repo (look at `require-role.test.ts` and any `*.routes.test.ts` for the in-memory D1 / app bootstrap pattern; reuse it). Cover:
```ts
// (pseudocode-level expectations — flesh out with the repo's test harness)
// 1. superadmin creates an intern → 201; body.user.user_type === 'intern';
//    body.user.intern_code matches /^OHCS-INT-\d{4}-\d{3}$/; body.initial_pin is 6 digits.
// 2. second create in same year → intern_code sequence increments (…-001 then …-002).
// 3. supervisor_user_id pointing at a non-staff/absent user → 400 INVALID_SUPERVISOR.
// 4. duplicate email → 409 DUPLICATE_EMAIL.
// 5. nss_end_date <= nss_start_date → 400 INVALID_RANGE.
// 6. non-admin role → 403.
```
Run → expect FAIL.

- [ ] **Step 2: Implement the route**

Create `packages/api/src/routes/admin-interns.ts`:
```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { error, created } from '../lib/response';
import { hashPin } from '../services/auth';
import { requireRole } from '../lib/require-role';
import { nextInternCode } from '../services/intern-code';
import {
  generateInitialPin,
  isValidIsoDate,
  PERSONNEL_SELECT_COLUMNS,
  type NssUserRow,
} from './admin-nss';

export const adminInternRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const createInternSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).toLowerCase().trim(),
  institution: z.string().max(200).optional().or(z.literal('')),
  programme: z.string().max(200).optional().or(z.literal('')),
  supervisor_user_id: z.string().max(64).optional().or(z.literal('')),
  directorate_id: z.string().min(1, 'directorate_id is required'),
  nss_start_date: z.string().refine(isValidIsoDate, 'nss_start_date must be ISO YYYY-MM-DD'),
  nss_end_date: z.string().refine(isValidIsoDate, 'nss_end_date must be ISO YYYY-MM-DD'),
  grade: z.string().max(100).optional().or(z.literal('')),
});

/** Reusable supervisor validity check — must be an existing staff user. */
export async function assertValidSupervisor(db: D1Database, supervisorId: string): Promise<boolean> {
  const sup = await db
    .prepare(`SELECT id FROM users WHERE id = ? AND user_type = 'staff'`)
    .bind(supervisorId)
    .first<{ id: string }>();
  return !!sup;
}

adminInternRoutes.post('/', zValidator('json', createInternSchema), async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'admin');
  if (forbidden) return forbidden;

  const body = c.req.valid('json');
  if (body.nss_end_date <= body.nss_start_date) {
    return error(c, 'INVALID_RANGE', 'nss_end_date must be after nss_start_date', 400);
  }

  const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?')
    .bind(body.directorate_id).first<{ id: string }>();
  if (!dir) return error(c, 'INVALID_DIRECTORATE', 'directorate_id does not reference an existing directorate', 400);

  if (body.supervisor_user_id && !(await assertValidSupervisor(c.env.DB, body.supervisor_user_id))) {
    return error(c, 'INVALID_SUPERVISOR', 'supervisor_user_id must reference an existing staff user', 400);
  }

  const dupEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
  if (dupEmail) return error(c, 'DUPLICATE_EMAIL', 'A user with this email already exists', 409);

  const id = crypto.randomUUID().replace(/-/g, '');
  const initialPin = generateInitialPin();
  const pinHash = await hashPin(initialPin);
  const year = new Date().getUTCFullYear();

  // Insert with one collision-retry on the unique intern_code index.
  let internCode = await nextInternCode(c.env.DB, year);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO users
           (id, name, email, pin_hash, pin_acknowledged, role, grade, directorate_id,
            user_type, nss_start_date, nss_end_date,
            intern_code, institution, programme, supervisor_user_id, is_active)
         VALUES (?, ?, ?, ?, 0, 'staff', ?, ?, 'intern', ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        id, body.name, body.email, pinHash, body.grade || null, body.directorate_id,
        body.nss_start_date, body.nss_end_date,
        internCode, body.institution || null, body.programme || null, body.supervisor_user_id || null,
      ).run();
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0 && /UNIQUE/i.test(msg) && /intern_code/i.test(msg)) {
        internCode = await nextInternCode(c.env.DB, year);
        continue;
      }
      if (/UNIQUE/i.test(msg) && /intern_code/i.test(msg)) {
        return error(c, 'CODE_COLLISION', 'Could not allocate an intern code, please retry', 409);
      }
      throw e;
    }
  }

  const user = await c.env.DB.prepare(
    `SELECT ${PERSONNEL_SELECT_COLUMNS}
       FROM users u
       LEFT JOIN directorates d ON u.directorate_id = d.id
       LEFT JOIN users sup ON sup.id = u.supervisor_user_id
      WHERE u.id = ?`
  ).bind(id).first<NssUserRow>();

  return created(c, { user, initial_pin: initialPin });
});
```

- [ ] **Step 3: Mount in `index.ts`**

Find where `adminNssRoutes` is mounted (search `adminNssRoutes` / `/admin/nss`) and add alongside it:
```ts
import { adminInternRoutes } from './routes/admin-interns';
// …next to the nss mount (same auth middleware chain):
app.route('/api/admin/interns', adminInternRoutes);
```
(Match the exact mounting style used for `adminNssRoutes` — same `app`/`api` variable and any shared auth middleware.)

- [ ] **Step 4: Run tests + type-check** → route tests PASS; `tsc --noEmit` 0 errors.

- [ ] **Step 5: Commit**
```
git add packages/api/src/routes/admin-interns.ts packages/api/src/routes/admin-interns.test.ts packages/api/src/index.ts
git commit -m "feat(interns): POST /api/admin/interns create endpoint"
```

---

## Task 5: End-of-service covers interns

**Files:** Modify `packages/api/src/services/nss-eos.ts`.

- [ ] **Step 1: Widen the queries + label rows by type**

In `runNssEndOfServiceCheck`: change both `WHERE user_type = 'nss'` / `WHERE u.user_type = 'nss'` to `… user_type IN ('nss','intern')`. Add `user_type` to the expiring SELECT and to `interface ExpiringRow` (`user_type: string`). In `buildMessage`, change the header to `⏰ <b>Service Personnel End-of-Date — This Week</b>`, the count line to `… National Service Personnel & Interns finish in the next 7 days.`, and append the type to each row: `• ${name} (${nssNumber || internLabel}) — ${dir} — ${typeTag} — ends ${ends}` where `typeTag = r.user_type === 'intern' ? 'Intern' : 'NSS'` and for interns show `intern_code` instead of `nss_number` (SELECT `u.intern_code` too and prefer it when type is intern).

- [ ] **Step 2: Type-check** → 0 errors. (No behavioural test here; covered by the runtime `/run-eos` check in Task 10.)

- [ ] **Step 3: Commit**
```
git add packages/api/src/services/nss-eos.ts
git commit -m "feat(interns): end-of-service auto-deactivation + digest cover interns"
```

---

## Task 6: Auth — accept `intern_code` as a third identifier

**Files:** Modify `packages/api/src/routes/auth.ts`, `packages/api/src/routes/auth-webauthn.ts`, `packages/api/src/routes/users.ts`.

- [ ] **Step 1: `pin-login` (`auth.ts`)**

Extend `pinLoginSchema`: add `intern_code: z.string().min(1).max(64).trim().optional(),` and change the `refine` to require exactly one of the three:
```ts
.refine(
  (v) => (v.staff_id ? 1 : 0) + (v.nss_number ? 1 : 0) + (v.intern_code ? 1 : 0) === 1,
  { message: 'Provide exactly one of staff_id, nss_number or intern_code' },
);
```
In the handler, replace the identifier resolution:
```ts
const { staff_id, nss_number, intern_code, pin, remember } = c.req.valid('json');
const rawId = (staff_id ?? nss_number ?? intern_code ?? '').toUpperCase();
const lookupColumn = staff_id ? 'staff_id' : nss_number ? 'nss_number' : 'intern_code';
```
(The rest — rate-limit, `WHERE ${lookupColumn} = ?`, PIN verify — is unchanged; `lookupColumn` is from a fixed set, safe to interpolate.)

- [ ] **Step 2: WebAuthn identifier (`auth-webauthn.ts`)**

Extend `identifierSchema` with `intern_code` + the 3-way `refine` (same shape as Step 1), and extend `resolveIdentifier`:
```ts
function resolveIdentifier(input: { staff_id?: string; nss_number?: string; intern_code?: string }): {
  column: 'staff_id' | 'nss_number' | 'intern_code'; value: string; challengeKey: string;
} {
  if (input.staff_id)  { const v = input.staff_id.toUpperCase();  return { column: 'staff_id',    value: v, challengeKey: `webauthn-auth:sid:${v}` }; }
  if (input.nss_number){ const v = input.nss_number.toUpperCase();return { column: 'nss_number',   value: v, challengeKey: `webauthn-auth:nss:${v}` }; }
  const v = (input.intern_code ?? '').toUpperCase();              return { column: 'intern_code',  value: v, challengeKey: `webauthn-auth:int:${v}` };
}
```

- [ ] **Step 3: Promote guard (`users.ts`)**

At `users.ts:112`, widen the NSS-not-promotable guard to interns:
```ts
if (body.role !== 'staff' && (existing.user_type === 'nss' || existing.user_type === 'intern')) {
  return error(c, 'NSS_NOT_PROMOTABLE', 'Service personnel (NSS/Intern) cannot be promoted to an admin role', 400);
}
```

- [ ] **Step 4: Type-check + existing auth tests** → 0 errors; `node ../../node_modules/vitest/vitest.mjs run` green.

- [ ] **Step 5: Commit**
```
git add packages/api/src/routes/auth.ts packages/api/src/routes/auth-webauthn.ts packages/api/src/routes/users.ts
git commit -m "feat(interns): login (PIN + WebAuthn) accepts intern_code; promote guard covers interns"
```

---

## Task 7: Staff PWA — Intern login tab

**Files:** Modify `packages/staff/src/lib/webauthnClient.ts`, `packages/staff/src/stores/auth.ts`, `packages/staff/src/pages/LoginPage.tsx`.

- [ ] **Step 1: Identifier plumbing (`webauthnClient.ts`)**

`export type IdentifierKind = 'staff_id' | 'nss_number' | 'intern_code';`. In `getLastIdentifier`, widen the validation guard to also accept `'intern_code'`. In `loginWithBiometric`, replace `idBody`:
```ts
const idBody =
  identifier.kind === 'staff_id'   ? { staff_id: value } :
  identifier.kind === 'nss_number' ? { nss_number: value } :
                                     { intern_code: value };
```

- [ ] **Step 2: `identifierBody` (`auth.ts` store)**
```ts
function identifierBody(identifier: Identifier): Record<string, string> {
  const value = identifier.value.toUpperCase();
  if (identifier.kind === 'staff_id') return { staff_id: value };
  if (identifier.kind === 'nss_number') return { nss_number: value };
  return { intern_code: value };
}
```

- [ ] **Step 3: Third tab (`LoginPage.tsx`)**

- `type Tab = 'staff' | 'nss' | 'intern';`
- `TAB_KIND` adds `intern: 'intern_code'`.
- `TAB_COPY` adds `intern: { label: 'Intern Code', placeholder: 'e.g. OHCS-INT-2026-001', helper: 'Issued by HR / F&A' }`.
- `readInitialTab`: add `if (id?.kind === 'intern_code') return 'intern';` and accept `'intern'` from the stored value.
- `value`/`setValue`: add a third `internValue` state and select it when `tab === 'intern'` (replace the binary `tab === 'staff' ? … : …` with a small map/switch over the three).
- The tab pill: change the container to `grid-cols-3`; the sliding indicator + gold bar width to `w-[calc(33.333%-…)]` and `translateX` to `0% / 100% / 200%` based on the active index; iterate `(['staff','nss','intern'] as const)`; icon for intern = `GraduationCap` (or import `BookUser`/another lucide icon — `Briefcase` staff, `GraduationCap` nss, a distinct one for intern; pick an existing lucide export). Compute `const idx = tab === 'staff' ? 0 : tab === 'nss' ? 1 : 2;` and drive both the indicator and bar `transform: translateX(${idx * 100}%)`.
- `inputMode`: intern uses `'text'`.

- [ ] **Step 4: Staff type-check** — from `packages/staff` → `node ../../node_modules/typescript/bin/tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**
```
git add packages/staff/src/lib/webauthnClient.ts packages/staff/src/stores/auth.ts packages/staff/src/pages/LoginPage.tsx
git commit -m "feat(interns): staff PWA Intern login tab (intern_code identifier)"
```

---

## Task 8: Admin dashboard — "NSS & Interns" tab + intern registration/detail

**Files:** Modify `packages/web/src/pages/AdminPage.tsx`, `components/layout/Sidebar.tsx`, `components/admin/NssTab.tsx`, `components/admin/NssRegistrationModal.tsx`, `components/admin/NssDetailModal.tsx`; create `components/admin/InternRegistrationFields.tsx`.

- [ ] **Step 1: Tab label**

In `AdminPage.tsx` and `Sidebar.tsx`, change the NSS tab's display label from "NSS" to **"NSS & Interns"** (keep the tab key `'nss'` and role visibility unchanged).

- [ ] **Step 2: `NssTab.tsx` — Type filter + Type column + register choice**

- Add state `const [typeFilter, setTypeFilter] = useState<'all' | 'nss' | 'intern'>('all');`.
- Add `type` to the list/today query keys and pass `?type=${typeFilter}` (when not `'all'`) to `/admin/nss` and `/admin/nss/today` requests. Default `all` sends no `type` param (server defaults to both).
- Add a **Type filter** control next to the existing status/directorate filters: a 3-way segmented toggle (All · NSS · Interns).
- Add a **Type** column/badge to the today board: render `row.user_type === 'intern' ? 'Intern' : 'NSS'` as a small pill (gold for intern, green for NSS, using existing token classes). The today endpoint must return `user_type` — add `u.user_type` to the `/today` SELECT + `NssTodayRow` in `admin-nss.ts` (Task 3 follow-up: include it in Step 2 there).
- Replace the single "Register NSS" button with a **"Register"** button that opens `NssRegistrationModal` (now type-aware); pass an initial type if desired.

- [ ] **Step 3: `InternRegistrationFields.tsx` (new) + wire into `NssRegistrationModal.tsx`**

Create `InternRegistrationFields.tsx` — a controlled fieldset for the intern branch: name, email, **institution**, **programme**, **supervisor** (a searchable `<select>`/combobox of active staff users fetched from the existing users list endpoint — reuse however `UsersTab`/`UserRoleToggle` fetches users; filter to `user_type==='staff'` & `is_active`), directorate (reuse the directorate select already in the NSS modal), start date, end date, grade. No code field.

In `NssRegistrationModal.tsx`: add a **Type toggle (NSS / Intern)** at the top of the single-registration form. When `Intern`, render `<InternRegistrationFields/>` and submit to `POST /api/admin/interns`; when `NSS`, render the current fields and submit to `POST /api/admin/nss`. Both paths feed the existing `PinResultModal`; for interns it shows the returned `intern_code` **and** the `initial_pin` (label the code "Intern code — give this to the intern to log in"). Leave the **bulk-import** section NSS-only (out of scope for interns).

- [ ] **Step 4: `NssDetailModal.tsx` — show/edit intern fields**

When the loaded record's `user_type === 'intern'`: show a Type badge; render `institution`, `programme`, and `supervisor_name` in the info panel; in edit mode expose `institution`, `programme`, and a `supervisor_user_id` select (same staff-user source as Step 3). PATCH sends those fields (the API accepts them per Task 3 Step 3). Labels: show "Placement window" instead of "Posting window" when intern (cosmetic). Everything else (activity grid, reset PIN, end service) is unchanged.

- [ ] **Step 5: Web type-check + build** — from `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → 0 errors; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`. Add/extend the list/detail row TS types in the web NSS API client with `user_type`, `intern_code`, `institution`, `programme`, `supervisor_user_id`, `supervisor_name`.

- [ ] **Step 6: Commit**
```
git add packages/web/src/pages/AdminPage.tsx packages/web/src/components/layout/Sidebar.tsx packages/web/src/components/admin/NssTab.tsx packages/web/src/components/admin/NssRegistrationModal.tsx packages/web/src/components/admin/NssDetailModal.tsx packages/web/src/components/admin/InternRegistrationFields.tsx
git commit -m "feat(interns): NSS & Interns admin tab — type filter, intern registration + detail"
```

---

## Task 9: Reporting — intern segment

**Files:** Modify `packages/api/src/routes/attendance.ts`, `packages/web/src/components/admin/AttendanceTab.tsx`, `packages/web/src/lib/pdf.ts`.

- [ ] **Step 1: API segment** — in `attendance.ts`, extend `UserTypeSegment` to `'staff' | 'nss' | 'intern' | 'all'`; the existing `?user_type=` parsing + `AND u.user_type = ?` injection then handles `intern` with no further change (verify the parser accepts the new value and rejects unknown ones).

- [ ] **Step 2: Web segment** — in `AttendanceTab.tsx`, add `'intern'` to the segment type + the segment dropdown options (label "Interns"); the `?user_type=intern` param already flows. In `pdf.ts`, add an intern title/slug branch (reuse the NSS range-report layout/columns; the `/admin/nss/export?type=intern` endpoint already serves intern rows).

- [ ] **Step 3: Type-check both packages** → 0 errors; web build `✓`.

- [ ] **Step 4: Commit**
```
git add packages/api/src/routes/attendance.ts packages/web/src/components/admin/AttendanceTab.tsx packages/web/src/lib/pdf.ts
git commit -m "feat(interns): intern segment in attendance reports/exports"
```

---

## Task 10: Verification (static + migration + runtime)

**Files:** none.

- [ ] **Step 1: Static gates** — API: `tsc --noEmit` 0 errors + `vitest run` all green (intern-code + admin-interns + existing). Web: `tsc --noEmit` + build `✓`. Staff: `tsc --noEmit`.

- [ ] **Step 2: Remote migration (gated)** — **Confirm with the user before any prod DB write.** First export a backup of `users` (`wrangler d1 execute … --remote --command "SELECT * FROM users;" --json > docs/ops/backups/users-pre-intern-<date>.json`). Read the current prod constraint (`SELECT sql FROM sqlite_master WHERE name='users';`) — per [[prod-users-role-check-drift]], do **not** assume it matches the repo; if it already lacks the user_type CHECK, the rebuild still applies cleanly (it sets the canonical post-state). Apply `--remote --file=src/db/migration-intern-foundation.sql`; re-read the constraint and assert it now contains `'intern'` + the four columns; then record it: `INSERT INTO applied_migrations (filename, hash) VALUES ('migration-intern-foundation.sql', '<sha256 of the file>');`.

- [ ] **Step 3: Deploy** — merge to `main`, poll `deploy.yml` to `success` (per the standard flow).

- [ ] **Step 4: Runtime (verify skill, post-deploy)** — drive the live app, capture evidence:
  1. Admin → "NSS & Interns" → Register → Intern: fill name/email/institution/programme/supervisor/directorate/dates → submit → an `OHCS-INT-YYYY-NNN` code + 6-digit PIN are shown.
  2. The intern appears in the board with an **Intern** badge; the **Type filter** (Interns) shows only interns; (NSS) hides them.
  3. Staff PWA → **Intern** tab → log in with the code + PIN → lands in.
  4. Clock in → the record persists; the intern shows clocked-in on the today board.
  5. Set an intern's `nss_end_date` to yesterday (via detail edit) → `POST /api/admin/nss/run-eos` → the intern is deactivated and drops off the active board.
  Screenshot each. Honest verdict.

- [ ] **Step 5: No commit** — report results; then `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Widen `user_type` + intern columns, reuse posting-window cols → Task 1. ✓
- Intern code `OHCS-INT-YYYY-NNN` + generator → Task 2. ✓
- Combined "NSS & Interns" tab, type filter/badge → Task 8 + the generalised read endpoints (Task 3). ✓
- Dedicated `POST /api/admin/interns`, supervisor=staff-FK validation, institution/programme → Task 4. ✓
- Login via intern_code (PIN + WebAuthn) + Intern tab → Tasks 6–7. ✓
- EOS covers interns → Task 5. ✓
- Reporting intern segment → Task 9. ✓
- Migration risk handled out-of-band with prod verification → Tasks 1 + 10 Step 2. ✓
- Out of scope (bulk import, certificates) honoured — not in any task. ✓

**Placeholder scan:** Test bodies in Task 4 Step 1 are expectation-level because the repo's route-test harness must be reused verbatim — the implementer is pointed at the existing pattern (`require-role.test.ts`); the assertions are concrete. Frontend modal tasks give the field list + data sources + submit targets rather than full JSX because they mirror existing components in the same files; every new behaviour (type toggle, submit target, PIN+code result) is specified. No TBDs.

**Type consistency:** `PERSONNEL_SELECT_COLUMNS` + extended `NssUserRow` (Task 3) are consumed by `admin-interns.ts` (Task 4) and the web row types (Task 8 Step 5). `UserType`/`User` (Task 2) align with the DB columns (Task 1). `IdentifierKind` (Task 7) matches the API's three identifier columns (Task 6). `personnelTypeWhere` is defined once (Task 3) and reused.

## Deployment

API Worker + both Pages via `deploy.yml` on merge to `main`. The **one manual prod step** is the out-of-band `users` rebuild (Task 10 Step 2), gated on user confirmation, backed up first, and verified before/after — run it **before** the code that inserts `user_type='intern'` goes live (i.e. apply the remote migration, then merge/deploy).
