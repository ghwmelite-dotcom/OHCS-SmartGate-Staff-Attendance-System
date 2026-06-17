# HR Role Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `f_and_a_admin` access role to `hr` and grant `hr` full visitor management + analytics/reports oversight (on top of its existing NSS/F&A powers), RBAC-only.

**Architecture:** A mechanical, type-checked rename of the role identifier across the API `Role` unions and all call sites, an additive grant of `hr` to the relevant `requireRole(...)` allowlists, the matching web renames/labels, and a defensive no-op data migration. The narrowed `Role` union makes any missed reference a compile error — that's the primary safety net.

**Tech Stack:** Hono on Cloudflare Workers (D1), React + Vite, Zod, vitest.

---

## Spec reference

`docs/superpowers/specs/2026-06-17-hr-role-merge-design.md`

## Conventions (read before starting)

- **ENVIRONMENT:** the repo path contains a space and `&`, which breaks the `.cmd` npm shims. Use these exact commands:
  - API type-check: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json` (from repo root)
  - Web type-check: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json`
  - API tests: `npm test -w packages/api` (or `-- <pattern>` to filter)
  - Web build: `node "node_modules/vite/bin/vite.js" build packages/web`
  - Do NOT use `npm run type-check` / `npm run build:web`.
- The role literal `'f_and_a_admin'` is unique, so per-file find-and-replace of that exact string is safe. **Do NOT** touch the F&A *directorate* text (in `services/assistant.ts`, `db/seed.sql`, `routes/auth.ts`, `routes/admin-eval-assistant.ts`, `pages/CheckInPage.tsx`) — that is org structure, not the role.
- Branch: `feat/hr-role-merge` (already created; do not switch).

---

## Task 1: API — rename `f_and_a_admin` → `hr` (atomic) + require-role test

This must be done in one commit: the moment the `Role` union drops `f_and_a_admin`, every remaining reference is a compile error, so all API references change together.

**Files:**
- Test: `packages/api/src/lib/require-role.test.ts` (create)
- Modify: `packages/api/src/lib/require-role.ts`, `packages/api/src/types.ts`, `packages/api/src/routes/admin-nss.ts`, `packages/api/src/routes/users.ts`, `packages/api/src/routes/bulk-import.ts`

- [ ] **Step 1: Write the require-role guard test**

Create `packages/api/src/lib/require-role.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { requireRole } from './require-role';

// Minimal Hono context mock: requireRole only uses c.get('session') and c.json().
type Ctx = Parameters<typeof requireRole>[0];
function mockCtx(role: string): Ctx {
  return {
    get: (key: string) => (key === 'session' ? { role } : undefined),
    json: (body: unknown, status = 200) => ({ body, status }),
  } as unknown as Ctx;
}

describe('requireRole', () => {
  it('admits the hr role when allowed (visitor-read style allowlist)', () => {
    expect(requireRole(mockCtx('hr'), 'superadmin', 'admin', 'receptionist', 'director', 'hr')).toBeNull();
  });

  it('admits hr on an NSS-style allowlist', () => {
    expect(requireRole(mockCtx('hr'), 'superadmin', 'hr')).toBeNull();
  });

  it('rejects a non-allowed role with 403 FORBIDDEN', () => {
    const blocked = requireRole(mockCtx('staff'), 'superadmin', 'hr') as unknown as
      { body: { error: { code: string } }; status: number } | null;
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
    expect(blocked!.body.error.code).toBe('FORBIDDEN');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -w packages/api -- require-role`
Expected: PASS (3 tests). Note: vitest/esbuild strips types without type-checking, so this passes at runtime; it is the behavioral regression guard. The compile-time guarantee that `hr` is a valid `Role` and that no `f_and_a_admin` literal remains comes from the type-check in Step 6.

- [ ] **Step 3: Rename the role in both `Role` unions**

In `packages/api/src/types.ts`, change the `Role` union member `| 'f_and_a_admin'` to `| 'hr'` (line ~25).

In `packages/api/src/lib/require-role.ts`, change the `Role` union member `| 'f_and_a_admin'` to `| 'hr'` (line ~12).

- [ ] **Step 4: Rename the role at the NSS gates**

In `packages/api/src/routes/admin-nss.ts`, replace **every** occurrence of the literal `'f_and_a_admin'` with `'hr'` (11 `requireRole(c, 'superadmin', 'f_and_a_admin')` calls become `requireRole(c, 'superadmin', 'hr')`). Also update the code comment on/near line 256 that reads "Used by the F&A admin to download…" to "Used by HR to download…".

- [ ] **Step 5: Rename the role in the user-management enums**

In `packages/api/src/routes/users.ts`, in both `role: z.enum([...])` arrays (create + update, lines ~52 and ~99), replace `'f_and_a_admin'` with `'hr'`.

In `packages/api/src/routes/bulk-import.ts`, in the `role: z.enum([...])` array (line ~20), replace `'f_and_a_admin'` with `'hr'`.

- [ ] **Step 6: Type-check + test (the real gate)**

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`
Expected: PASS with no output. (If any `'f_and_a_admin'` literal was missed in the API, this errors with "Type '\"f_and_a_admin\"' is not assignable to … Role".)

Run: `npm test -w packages/api`
Expected: all pass (existing 35 + 3 new require-role tests = 38).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/lib/require-role.ts packages/api/src/lib/require-role.test.ts packages/api/src/types.ts packages/api/src/routes/admin-nss.ts packages/api/src/routes/users.ts packages/api/src/routes/bulk-import.ts
git commit -m "refactor(api): rename f_and_a_admin role to hr"
```

---

## Task 2: API — grant `hr` visitor + analytics/reports oversight

Additive: add `'hr'` to the `requireRole(...)` allowlists wherever `receptionist`/`director` already appear for viewing visitor data and analytics/reports. Check-in/check-out are ungated, so HR can already perform those.

**Files:**
- Modify: `packages/api/src/routes/visits.ts`, `packages/api/src/routes/visitors.ts`, `packages/api/src/routes/analytics.ts`, `packages/api/src/routes/reports.ts`

- [ ] **Step 1: Add `hr` to the visits allowlists**

In `packages/api/src/routes/visits.ts`, replace **both** occurrences (lines ~26 and ~88) of:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director');
```

with:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'hr');
```

- [ ] **Step 2: Add `hr` to the visitors allowlists**

In `packages/api/src/routes/visitors.ts`, replace **both** occurrences (lines ~18 and ~53) of:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director');
```

with:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'hr');
```

(Leave the superadmin-only DELETE handler — `if (session.role !== 'superadmin')` — unchanged.)

- [ ] **Step 3: Add `hr` to the analytics allowlists**

In `packages/api/src/routes/analytics.ts`, replace **all three** occurrences (lines ~12, ~65, ~133) of:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'director');
```

with:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'director', 'hr');
```

- [ ] **Step 4: Add `hr` to the reports allowlist**

In `packages/api/src/routes/reports.ts`, replace the occurrence (line ~18) of:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'director', 'receptionist');
```

with:

```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'director', 'receptionist', 'hr');
```

- [ ] **Step 5: Type-check + test**

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

Run: `npm test -w packages/api`
Expected: all pass (38).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/visits.ts packages/api/src/routes/visitors.ts packages/api/src/routes/analytics.ts packages/api/src/routes/reports.ts
git commit -m "feat(api): grant hr role visitor management + analytics/reports access"
```

---

## Task 3: Web — rename `f_and_a_admin` → `hr` + relabel

Mechanical rename + label updates. The web does not import the API `Role` type (it uses string literals / its own zod enums), so the web compiles regardless; we rename for correctness and so the admin UI offers/handles `hr`. The main nav is already shown to all authenticated users, so HR's new access surfaces automatically once the API allows it (Task 2) — no nav restructuring.

**Files:**
- Modify: `packages/web/src/components/layout/Sidebar.tsx`, `packages/web/src/pages/AdminPage.tsx`, `packages/web/src/components/admin/UserRoleToggle.tsx`, `packages/web/src/components/admin/NssTab.tsx`

- [ ] **Step 1: Sidebar**

In `packages/web/src/components/layout/Sidebar.tsx`:

Rename the admin-nav array (line ~20) for clarity:
```typescript
const ADMIN_NAV_HR = [
  { to: '/admin?tab=nss', icon: Settings, label: 'NSS Admin' },
];
```

Replace the role check + derived flag (lines ~32-33):
```typescript
  const isHr = user?.role === 'hr';
  const canSeeAdmin = isSuperadmin || isHr;
```

In the admin-section render (line ~100), update the array reference:
```typescript
            {(isSuperadmin ? ADMIN_NAV_SUPER : ADMIN_NAV_HR).map((item) => (
```

- [ ] **Step 2: AdminPage — role label + enums**

In `packages/web/src/pages/AdminPage.tsx`:

Line ~40, replace the ROLES entry:
```typescript
  { value: 'hr', label: 'HR', color: 'bg-secondary/10 text-secondary' },
```

Lines ~52 and ~62, in both `role: z.enum([...])` arrays, replace `'f_and_a_admin'` with `'hr'`:
```typescript
  role: z.enum(['superadmin', 'admin', 'hr', 'receptionist', 'it', 'director', 'staff']),
```

- [ ] **Step 3: AdminPage — rename the `isFAndA` flag**

In `packages/web/src/pages/AdminPage.tsx`, rename the variable `isFAndA` to `isHr` and point it at the new role. There are 6 references — line ~74 (definition), ~101, ~126, ~129 (effect deps), ~131, ~141. After the change:

- Line ~74: `const isHr = role === 'hr';`
- Line ~101: `if (isHr) return 'nss';`
- Line ~126: `if (!isSuperadmin && !isHr) {`
- Line ~129: `}, [isSuperadmin, isHr, navigate]);`
- Line ~131: `if (!isSuperadmin && !isHr) return null;`
- Line ~141: `{isHr`

Also update the comments at lines ~79 and ~94 that say "f_and_a_admin" / "F&A admin" to "hr" / "HR".

- [ ] **Step 4: UserRoleToggle**

In `packages/web/src/components/admin/UserRoleToggle.tsx`:

- Line ~17 (doc comment): change "between `staff` and `f_and_a_admin`" to "between `staff` and `hr`".
- Line ~24: `const isHr = user.role === 'hr';` (rename `isFA` → `isHr`).
- Lines ~26-30: update the mutation to use the renamed flag + new role:
```typescript
  const mutation = useMutation({
    mutationFn: () =>
      api.put(`/users/${user.id}`, {
        role: isHr ? 'staff' : 'hr',
      }),
    onSuccess: () => {
      toast.success(isHr ? 'Demoted to Staff' : 'Promoted to HR');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
```
- Update the remaining `isFA` references (the `aria-pressed`, `aria-label`, and the two `isFA ?` className/transform ternaries) to `isHr`. Line ~61 aria-label: `aria-label={isHr ? 'Demote to staff' : 'Promote to HR'}`.
- Line ~50 heading: `<p className="text-[13px] font-semibold text-foreground">HR Access</p>`.
- Lines ~51-54 description: replace with:
```typescript
          <p className="text-[12px] text-muted mt-0.5">
            Grants the HR admin views (NSS register, attendance reports) plus
            visitor-management oversight. Toggle off to revert to plain staff.
          </p>
```

- [ ] **Step 5: NssTab**

In `packages/web/src/components/admin/NssTab.tsx`, line ~64, replace:
```typescript
  const canRunEos = currentUser?.role === 'superadmin' || currentUser?.role === 'hr';
```

- [ ] **Step 6: Type-check + build web**

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json`
Expected: PASS.

Run: `node "node_modules/vite/bin/vite.js" build packages/web`
Expected: ends with `✓ built in …` (pre-existing chunk-size warnings are fine; no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/layout/Sidebar.tsx packages/web/src/pages/AdminPage.tsx packages/web/src/components/admin/UserRoleToggle.tsx packages/web/src/components/admin/NssTab.tsx
git commit -m "refactor(web): rename f_and_a_admin role to hr + relabel"
```

---

## Task 4: Defensive data migration

**Files:**
- Create: `packages/api/src/db/migration-hr-role.sql`
- Modify: `packages/api/src/db/migrations-index.ts`

- [ ] **Step 1: Write the migration**

Create `packages/api/src/db/migration-hr-role.sql`:

```sql
-- Merge the f_and_a_admin role into hr — companion spec:
-- 2026-06-17-hr-role-merge-design.md
-- No-op on current data (no users hold f_and_a_admin), but guarantees any stray
-- row (e.g. from a past bulk import) keeps access under the new role name.
UPDATE users SET role = 'hr' WHERE role = 'f_and_a_admin';
```

- [ ] **Step 2: Register the migration**

In `packages/api/src/db/migrations-index.ts`, add the import after the `kioskVisitor` import:

```typescript
import hrRole from './migration-hr-role.sql';
```

And append as the **last** entry of the `MIGRATIONS` array:

```typescript
  { filename: 'migration-hr-role.sql', sql: hrRole },
```

- [ ] **Step 3: Apply locally + verify it runs cleanly**

Run: `node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --local --file=src/db/migration-hr-role.sql` from `packages/api`.
Expected: succeeds (0 rows changed — no `f_and_a_admin` users locally). If wrangler can't run in this environment, instead re-read the SQL to confirm it is valid SQLite and note the command was not executed.

- [ ] **Step 4: Type-check + commit**

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

```bash
git add packages/api/src/db/migration-hr-role.sql packages/api/src/db/migrations-index.ts
git commit -m "feat(api): defensive migration merging f_and_a_admin into hr"
```

---

## Task 5: Verification pass

**Files:** none (verification only)

- [ ] **Step 1: No role literal remains**

Run a search for the old role literal across source (excluding the spec/plan docs):

Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json && node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json`
Expected: both PASS.

Then grep the source for `f_and_a_admin`:
Run (from repo root): use the Grep tool / ripgrep for `f_and_a_admin` under `packages/`.
Expected: **zero matches** (the only `f_and_a_admin` strings left in the repo should be inside `docs/superpowers/`). If any remain in `packages/`, fix them and re-run Task 1/3's type-check.

- [ ] **Step 2: Confirm the F&A directorate text was preserved**

Grep `packages/` for `F&A` (with the literal ampersand).
Expected: matches remain ONLY in the intended directorate/routing/NSS places — `services/assistant.ts`, `db/seed.sql`, `routes/auth.ts`, `routes/admin-eval-assistant.ts`, `pages/CheckInPage.tsx`. None should be a role reference.

- [ ] **Step 3: Full test suite + web build**

Run: `npm test -w packages/api`
Expected: all pass (38).

Run: `node "node_modules/vite/bin/vite.js" build packages/web`
Expected: `✓ built in …`, no errors.

- [ ] **Step 4 (optional manual smoke):** with `wrangler dev`, sign in as an `hr`-role user and confirm `GET /api/visits`, `GET /api/analytics/...`, and an `/api/admin/nss/...` route return data, while a `staff` session gets `403` on those.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** rename in both unions + all API sites → Task 1; `hr` access grant (visits/visitors/analytics/reports) → Task 2; web rename/labels → Task 3; defensive migration → Task 4; "no `f_and_a_admin` literal remains" + "F&A directorate preserved" + type-check safety net → Task 5. F&A-directorate text is explicitly excluded throughout.
- **Type consistency:** the role identifier is exactly `'hr'` everywhere (unions, gates, enums, web checks). The web flag is renamed consistently `isFAndA`→`isHr` (AdminPage) and `isFA`→`isHr` (UserRoleToggle); the Sidebar flag `isFAndAAdmin`→`isHr` and array `ADMIN_NAV_F_AND_A`→`ADMIN_NAV_HR`.
- **Atomicity:** Task 1 changes the union and all API references in one commit so the type-check stays green; Task 2 is purely additive.
```
