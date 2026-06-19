# Interns in the Staff Clock-In System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DESIGN REVISION (2026-06-19, as shipped in PR #18):** This plan originally modeled interns as a new `user_type='intern'` value requiring a `users` table rebuild to widen the `CHECK`. That rebuild is **infeasible on Cloudflare D1** (D1 forces `foreign_keys` ON and ignores `PRAGMA foreign_keys=OFF`; `defer_foreign_keys` trips at COMMIT on the rows orphaned by `DROP TABLE users`, which has 8 populated FK children). We pivoted to a **discriminator model**: interns are **`user_type='nss'` with a non-null `intern_code`** (real NSS have `nss_number`); the `user_type` CHECK stays `('staff','nss')`; the migration is additive `ALTER ADD COLUMN` only. The task bodies below have been updated to the shipped model; the SQL clauses use `intern_code IS NULL/NOT NULL` rather than `user_type IN ('nss','intern')`. See memory `d1-cannot-rebuild-referenced-table`.

**Goal:** Add an "Intern" personnel category to the staff clock-in system by generalising the NSS subsystem to serve both NSS and Interns (discriminated by `intern_code`), with a generated intern code, institution/programme/supervisor fields, a combined "NSS & Interns" admin tab, an Intern login tab, and end-of-service handling — all reusing the existing clock-in, auth, today-board, export and EOS machinery.

**Architecture:** Interns are `users.user_type='nss'` with a non-null `intern_code` (real NSS have `nss_number`), reusing `nss_start_date`/`nss_end_date` as the posting window so EOS/exports/today-board work unchanged. The `user_type` CHECK is unchanged (`'staff','nss'`). New `users` columns (additive `ALTER ADD COLUMN`): `intern_code`, `institution`, `programme`, `supervisor_user_id` (FK→users). The read/lifecycle endpoints under `/api/admin/nss` become type-aware (`?type=nss|intern|all`, resolved via `intern_code`); creation is a dedicated `POST /api/admin/interns`. Login adds `intern_code` as a third disjoint identifier. Reference spec: `docs/superpowers/specs/2026-06-18-interns-personnel-design.md`.

**Tech Stack:** Hono + D1 (Cloudflare Workers), React 18 + Vite (web admin + staff PWA), Zod, react-hook-form, vitest.

**Toolchain note (repo path has a space + `&` — never `npm run`):**
- API type-check: from `packages/api` → `node ../../node_modules/typescript/bin/tsc --noEmit`
- API tests: from `packages/api` → `node ../../node_modules/vitest/vitest.mjs run`
- Web type-check: from `packages/web` → `node ../../node_modules/typescript/bin/tsc --noEmit`
- Web tests: from `packages/web` → `node ../../node_modules/vitest/vitest.mjs run`
- Web build: from `packages/web` → `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`
- Staff type-check: from `packages/staff` → `node ../../node_modules/typescript/bin/tsc --noEmit`
- wrangler: `node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" ...` (run from `packages/api`)

**Migration approach (as shipped):** because the `user_type` CHECK is left unchanged, the migration is purely additive `ALTER TABLE ADD COLUMN` (four columns + two indexes) — which D1 fully supports, including a nullable self-FK column. No table rebuild, no FK-disable, no data risk. It IS registered in the `MIGRATIONS` array (the per-statement runner in `routes/admin-migrations.ts` runs additive ALTERs fine), and was also applied to prod `smartgate-db` via `wrangler d1 execute --remote --file` then recorded in `applied_migrations`. (The original "out-of-band rebuild" approach was abandoned — see the DESIGN REVISION banner above.)

---

## File Structure

- **Create:**
  - `packages/api/src/db/migration-intern-foundation.sql` — additive `ALTER ADD COLUMN` migration (registered in MIGRATIONS).
  - `packages/api/src/services/intern-code.ts` — intern-code generator.
  - `packages/api/src/services/intern-code.test.ts` — generator unit tests.
  - `packages/api/src/routes/admin-interns.ts` — `POST /api/admin/interns` create.
  - `packages/api/src/routes/admin-interns.test.ts` — create-route tests.
  - `packages/web/src/components/admin/InternRegistrationFields.tsx` — intern branch of the registration modal (keeps the modal file focused).
- **Modify (API):** `db/schema.sql`, `db/migrations-index.ts` (register the migration), `types.ts`, `routes/admin-nss.ts` (generalise + export helpers), `routes/admin-interns.ts` mount in `index.ts`, `services/nss-eos.ts`, `routes/auth.ts`, `routes/auth-webauthn.ts`, `routes/users.ts`, `routes/attendance.ts`.
- **Modify (web admin):** `pages/AdminPage.tsx`, `components/layout/Sidebar.tsx`, `components/admin/NssTab.tsx`, `components/admin/NssRegistrationModal.tsx`, `components/admin/NssDetailModal.tsx`, `lib/pdf.ts`, `components/admin/AttendanceTab.tsx`.
- **Modify (staff PWA):** `pages/LoginPage.tsx`, `stores/auth.ts`, `lib/webauthnClient.ts`.

---

## Task 1: Data model — additive intern columns (no rebuild)

**Files:** Create `packages/api/src/db/migration-intern-foundation.sql`; modify `packages/api/src/db/schema.sql`, `packages/api/src/db/migrations-index.ts`.

This task is **DB-only**. The `user_type` CHECK is left UNCHANGED — interns are `user_type='nss'` distinguished by a non-null `intern_code`, so we only ADD columns (D1-safe; no rebuild, no FK risk).

- [ ] **Step 1: Write the additive migration**

Create `packages/api/src/db/migration-intern-foundation.sql`:
```sql
-- migration-intern-foundation.sql
-- Interns share the NSS user_type ('nss') and are distinguished by a non-null intern_code.
-- No CHECK change / no table rebuild — only additive ALTER ADD COLUMN, which D1 supports.
-- Posting/placement window reuses nss_start_date / nss_end_date for both NSS and interns.
ALTER TABLE users ADD COLUMN intern_code TEXT;
ALTER TABLE users ADD COLUMN institution TEXT;
ALTER TABLE users ADD COLUMN programme TEXT;
ALTER TABLE users ADD COLUMN supervisor_user_id TEXT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE intern_code IS NOT NULL;
```
(A nullable self-FK column adds cleanly via `ALTER ADD COLUMN` on D1. Each statement is independent — safe for the per-statement app runner.)

- [ ] **Step 2: Update `schema.sql` (fresh-DB composite)**

In `packages/api/src/db/schema.sql`: keep the `user_type` CHECK as `CHECK(user_type IN ('staff','nss'))` (UNCHANGED); add the four columns after `nss_end_date` (with reuse comments on nss_start_date/nss_end_date); add the two indexes (intern-active predicate is `WHERE intern_code IS NOT NULL`):
```sql
    nss_end_date     TEXT,
    intern_code         TEXT,
    institution         TEXT,
    programme           TEXT,
    supervisor_user_id  TEXT REFERENCES users(id)
);
-- …existing indexes…
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE intern_code IS NOT NULL;
```

- [ ] **Step 3: Register the migration in `migrations-index.ts`**

Add `import internFoundation from './migration-intern-foundation.sql';` with the other imports, and append `{ filename: 'migration-intern-foundation.sql', sql: internFoundation },` as the LAST entry of the `MIGRATIONS` array.

- [ ] **Step 4: Apply locally + verify** (the D1 db name is `smartgate-db`)

From `packages/api` (if the local DB predates these columns, re-init from schema.sql which now has the final shape):
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=src/db/schema.sql
… d1 execute smartgate-db --local --command "SELECT sql FROM sqlite_master WHERE name='users';"
```
Expected: the `user_type` CHECK is `('staff','nss')` (unchanged) and the four new columns are present. Prove an intern-shaped row inserts:
```
… --command "INSERT INTO users (id,name,email,user_type,intern_code) VALUES ('t1','T','t@x.io','nss','OHCS-INT-2026-001'); SELECT user_type,intern_code FROM users WHERE id='t1'; DELETE FROM users WHERE id='t1';"
```

- [ ] **Step 5: Commit**
```
git add packages/api/src/db/migration-intern-foundation.sql packages/api/src/db/schema.sql packages/api/src/db/migrations-index.ts
git commit -m "feat(interns): additive intern columns (user_type='nss' + intern_code discriminator)"
```

---

## Task 2: API types + intern-code generator

**Files:** Modify `packages/api/src/types.ts`; create `packages/api/src/services/intern-code.ts` + `intern-code.test.ts`.

- [ ] **Step 1: Extend types**

In `types.ts`: keep `export type UserType = 'staff' | 'nss';` (UNCHANGED — interns are nss + intern_code, never a distinct enum value) and add to the `User` interface (after `nss_end_date`):
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
git commit -m "feat(interns): User intern fields and OHCS-INT code generator"
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
/** Resolve the optional ?type= filter into a SQL WHERE clause over service personnel.
 *  Interns are user_type='nss' with a non-null intern_code; real NSS have intern_code NULL. */
export function personnelTypeWhere(typeParam: string | null | undefined): string {
  if (typeParam === 'nss') return `u.user_type = 'nss' AND u.intern_code IS NULL`;
  if (typeParam === 'intern') return `u.user_type = 'nss' AND u.intern_code IS NOT NULL`;
  return `u.user_type = 'nss'`;
}
```
In **list** (`GET /`): replace the seed `const where = [\`u.user_type = 'nss'\`]` with `const where = [personnelTypeWhere(c.req.query('type'))]`. In **/today** and **/export**: replace the literal `u.user_type = 'nss'` in the SQL (and in the `INNER JOIN users u ON u.id = cr.user_id AND u.user_type = 'nss'` CTE in /export) with the resolved clause — build the clause string from `personnelTypeWhere(c.req.query('type'))` and interpolate it (fixed literals only — safe). Add `u.intern_code` to the `/today` SELECT (and `intern_code` to `NssTodayRow`) so the UI can render the NSS/Intern badge.

- [ ] **Step 3: Loosen the per-id guards** (detail, patch, delete, reset-pin, activity)

Since interns are `user_type='nss'`, the guard simply checks for the umbrella type:
```ts
// guard pattern (covers both real NSS and interns):
if (existing.user_type !== 'nss') {
  return error(c, 'NOT_PERSONNEL', 'Target user is not service personnel', 400);
}
// detail query WHERE:
WHERE u.id = ? AND u.user_type = 'nss'
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
// 1. superadmin creates an intern → 201; body.user.user_type === 'nss' AND body.user.intern_code is set;
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
         VALUES (?, ?, ?, ?, 0, 'staff', ?, ?, 'nss', ?, ?, ?, ?, ?, ?, 1)`  -- interns are user_type='nss' + intern_code
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

In `runNssEndOfServiceCheck`: keep both queries filtered to `user_type = 'nss'` (the umbrella already covers interns — no change needed there). Add `intern_code` to the expiring SELECT and to `interface ExpiringRow` (`intern_code: string | null`). In `buildMessage`, change the header to `⏰ <b>Service Personnel End-of-Date — This Week</b>`, the count line to `… National Service Personnel & Interns finish in the next 7 days.`, and append the type to each row, labelling by `intern_code` presence: `const typeTag = r.intern_code ? 'Intern' : 'NSS';` and show `intern_code` instead of `nss_number` for interns.

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

At `users.ts:112`, the NSS-not-promotable guard already covers interns (they are `user_type='nss'`); just update the message to name interns:
```ts
if (body.role !== 'staff' && existing.user_type === 'nss') {
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
- Add a **Type** column/badge to the today board: render **intern when `row.intern_code != null`, else NSS** as a small pill (gold for intern, green for NSS, using existing token classes). The today endpoint must return `intern_code` — add `u.intern_code` to the `/today` SELECT + `NssTodayRow` in `admin-nss.ts` (Task 3 Step 2).
- Replace the single "Register NSS" button with a **"Register"** button that opens `NssRegistrationModal` (now type-aware); pass an initial type if desired.

- [ ] **Step 3: `InternRegistrationFields.tsx` (new) + wire into `NssRegistrationModal.tsx`**

Create `InternRegistrationFields.tsx` — a controlled fieldset for the intern branch: name, email, **institution**, **programme**, **supervisor** (a `<select>` of active staff users from the admin-reachable `GET /api/admin/interns/supervisors` lookup — NOT the superadmin-only `/users` list), directorate (reuse the directorate select already in the NSS modal), start date, end date, grade. No code field. (Add the `GET /supervisors` route to `admin-interns.ts` in Task 4 — gated `requireRole(superadmin, admin)`, returns active staff `{id, name}`.)

In `NssRegistrationModal.tsx`: add a **Type toggle (NSS / Intern)** at the top of the single-registration form. When `Intern`, render `<InternRegistrationFields/>` and submit to `POST /api/admin/interns`; when `NSS`, render the current fields and submit to `POST /api/admin/nss`. Both paths feed the existing `PinResultModal`; for interns it shows the returned `intern_code` **and** the `initial_pin` (label the code "Intern code — give this to the intern to log in"). Leave the **bulk-import** section NSS-only (out of scope for interns).

- [ ] **Step 4: `NssDetailModal.tsx` — show/edit intern fields**

When the loaded record is an intern (`detail.intern_code != null`): show a Type badge; render `institution`, `programme`, and `supervisor_name` in the info panel; in edit mode expose `institution`, `programme`, and a `supervisor_user_id` select (sourced from the admin-reachable `/api/admin/interns/supervisors` lookup — the full `/users` list is superadmin-only). The PATCH must send only **changed** fields (so it never nulls a supervisor it didn't touch), and inject the current supervisor as an option if it's not in the active-staff list. Labels: "Placement window" instead of "Posting window" when intern. Everything else (activity grid, reset PIN, end service) is unchanged.

- [ ] **Step 5: Web type-check + build** — from `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → 0 errors; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`. Add/extend the list/detail row TS types in the web NSS API client with `user_type`, `intern_code`, `institution`, `programme`, `supervisor_user_id`, `supervisor_name`.

- [ ] **Step 6: Commit**
```
git add packages/web/src/pages/AdminPage.tsx packages/web/src/components/layout/Sidebar.tsx packages/web/src/components/admin/NssTab.tsx packages/web/src/components/admin/NssRegistrationModal.tsx packages/web/src/components/admin/NssDetailModal.tsx packages/web/src/components/admin/InternRegistrationFields.tsx
git commit -m "feat(interns): NSS & Interns admin tab — type filter, intern registration + detail"
```

---

## Task 9: Reporting — intern segment

**Files:** Modify `packages/api/src/routes/attendance.ts`, `packages/web/src/components/admin/AttendanceTab.tsx`, `packages/web/src/lib/pdf.ts`.

- [ ] **Step 1: API segment** — in `attendance.ts`, extend `UserTypeSegment` to `'staff' | 'nss' | 'intern' | 'all'`. Because interns are `user_type='nss'`+intern_code, the segment can no longer bind the raw value to `user_type = ?`; replace the filter mechanism with a fixed-clause helper: `staff`→`<alias>.user_type='staff'`, `nss`→`<alias>.user_type='nss' AND <alias>.intern_code IS NULL`, `intern`→`<alias>.user_type='nss' AND <alias>.intern_code IS NOT NULL`, `all`→`''` (no filter). Apply at every SQL site (today, records, by-directorate). Parser still rejects unknown values.

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

- [ ] **Step 2: Remote migration (gated)** — **Confirm with the user before any prod DB write.** The D1 database name is **`smartgate-db`**. The migration is additive `ALTER ADD COLUMN` (no rebuild, no FK risk). Steps:
  1. Back up `users`: `node "…/wrangler.js" d1 execute smartgate-db --remote --command "SELECT * FROM users;" --json > docs/ops/backups/users-pre-intern-<date>.json` (untracked — contains PIN hashes; do NOT commit).
  2. Apply: `… --remote --file=src/db/migration-intern-foundation.sql`.
  3. Verify: `… --remote --command "SELECT sql FROM sqlite_master WHERE name='users';"` — assert the `user_type` CHECK is still `('staff','nss')` (unchanged) and the four new columns are present; spot-check `SELECT COUNT(*) FROM users;` is unchanged.
  4. Record it: `… --remote --command "INSERT INTO applied_migrations (filename, hash) VALUES ('migration-intern-foundation.sql', '<sha256 of the file>');"` (so the deployed runner skips it).

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
- Additive intern columns (discriminator), CHECK unchanged, reuse posting-window cols → Task 1. ✓
- Intern code `OHCS-INT-YYYY-NNN` + generator → Task 2. ✓
- Combined "NSS & Interns" tab, type filter/badge (by intern_code) → Task 8 + the generalised read endpoints (Task 3). ✓
- Dedicated `POST /api/admin/interns` (writes user_type='nss'+intern_code), supervisor=staff-FK validation, institution/programme → Task 4. ✓
- Login via intern_code (PIN + WebAuthn) + Intern tab → Tasks 6–7. ✓
- EOS covers interns (umbrella user_type='nss') → Task 5. ✓
- Reporting intern segment → Task 9. ✓
- Migration applied additively (no rebuild) + prod verification → Tasks 1 + 10 Step 2. ✓
- Out of scope (bulk import, certificates) honoured — not in any task. ✓

**Placeholder scan:** Test bodies in Task 4 Step 1 are expectation-level because the repo's route-test harness must be reused verbatim — the implementer is pointed at the existing pattern (`require-role.test.ts`); the assertions are concrete. Frontend modal tasks give the field list + data sources + submit targets rather than full JSX because they mirror existing components in the same files; every new behaviour (type toggle, submit target, PIN+code result) is specified. No TBDs.

**Type consistency:** `PERSONNEL_SELECT_COLUMNS` + extended `NssUserRow` (Task 3) are consumed by `admin-interns.ts` (Task 4) and the web row types (Task 8 Step 5). `User` (Task 2) gains the four intern fields; `UserType` stays `'staff' | 'nss'` (interns are nss + intern_code, never a distinct enum value). `IdentifierKind` (Task 7) matches the API's three identifier columns (Task 6). `personnelTypeWhere` is defined once (Task 3) and reused.

## Deployment

API Worker + both Pages via `deploy.yml` on merge to `main`. The **one manual prod step** is the additive `ALTER ADD COLUMN` migration (Task 10 Step 2), gated on user confirmation, backed up first, and verified after — run it **before** the code that writes interns goes live (apply the remote migration, then merge/deploy). No table rebuild / no FK-disable (that approach was infeasible on D1 — see the DESIGN REVISION banner at the top).
