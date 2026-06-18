# Revert to 6 Roles + HR-as-`admin` + IT Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 4 writes to the production database — run it deliberately (it's a safe `INSERT OR IGNORE` of an allowed-role row).**

**Goal:** Revert the role model to the six roles prod's `users.role` CHECK permits (`superadmin, admin, receptionist, it, director, staff`), deliver HR oversight via `admin`, add `it` to visitor-record reads, seed the kiosk system user with an allowed role, and remove the abandoned CHECK-drop migration + endpoint.

**Architecture:** Narrow the `Role` union back to six (any missed reference becomes a compile error), re-gate the NSS-admin endpoints from `hr`→`admin`, swap `hr`→`it` on the visitor-record read allowlists, repoint the web `hr` wiring to `admin`, and reseed `user_kiosk` with role `staff`.

**Tech Stack:** Hono on Cloudflare Workers (D1), React + Vite, Zod, vitest.

---

## Spec reference

`docs/superpowers/specs/2026-06-18-roles-revert-hr-as-admin-design.md`

## Conventions / ENVIRONMENT

- Repo path has a space + `&`; invoke tools via node directly:
  - API type-check (repo root): `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`
  - Web type-check: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json`
  - API tests: `npm test -w packages/api`
  - Web build: `node "node_modules/vite/bin/vite.js" build packages/web`
  - Remote D1: from `packages/api`, `node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote <args>`
  - `wrangler --remote` `changes` meta is unreliable — verify writes with `... RETURNING`.
- Branch: `fix/roles-revert-hr-as-admin` (already created; do not switch).
- Current role literals to remove: `'hr'` and `'visitor'`. Do NOT touch the F&A *directorate* text (assistant/seed/auth/eval/CheckInPage).

---

## Task 1: API — revert `Role` to six + re-gate (atomic)

Must be one commit: narrowing the union turns every `'hr'`/`'visitor'` reference into a compile error, so all change together.

**Files:** `types.ts`, `lib/require-role.ts`, `lib/require-role.test.ts`, `routes/admin-nss.ts`, `routes/users.ts`, `routes/bulk-import.ts`, `routes/visits.ts`, `routes/visitors.ts`, `routes/analytics.ts`, `routes/reports.ts` (all under `packages/api/src/`).

- [ ] **Step 1: Role unions → six.** In `packages/api/src/types.ts` and `packages/api/src/lib/require-role.ts`, the `Role` union currently ends `... | 'staff' | 'hr' | 'visitor';`. Change BOTH to:
```typescript
export type Role =
  | 'superadmin'
  | 'admin'
  | 'receptionist'
  | 'it'
  | 'director'
  | 'staff';
```

- [ ] **Step 2: NSS-admin gates `hr`→`admin`.** In `packages/api/src/routes/admin-nss.ts`, replace every occurrence (11) of:
```typescript
  const forbidden = requireRole(c, 'superadmin', 'hr');
```
with:
```typescript
  const forbidden = requireRole(c, 'superadmin', 'admin');
```

- [ ] **Step 3: user enums drop `hr`.** In `packages/api/src/routes/users.ts` (both `role: z.enum([...])`, create + update) and `packages/api/src/routes/bulk-import.ts` (one), remove `'hr'` so each reads:
```typescript
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']),
```
(the update schema in users.ts keeps its trailing `.optional()`).

- [ ] **Step 4: visitor-record reads `hr`→`it`.** In `packages/api/src/routes/visits.ts` (2 sites) and `packages/api/src/routes/visitors.ts` (2 sites), replace:
```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'hr');
```
with:
```typescript
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
```

- [ ] **Step 5: analytics/reports drop `hr`.** In `packages/api/src/routes/analytics.ts` (3 sites) replace `requireRole(c, 'superadmin', 'admin', 'director', 'hr')` with `requireRole(c, 'superadmin', 'admin', 'director')`. In `packages/api/src/routes/reports.ts` (1 site) replace `requireRole(c, 'superadmin', 'admin', 'director', 'receptionist', 'hr')` with `requireRole(c, 'superadmin', 'admin', 'director', 'receptionist')`.

- [ ] **Step 6: update the require-role test.** Replace the body of `packages/api/src/lib/require-role.test.ts` with (drops the now-invalid `hr` literal; asserts the new access model):
```typescript
import { describe, it, expect } from 'vitest';
import { requireRole } from './require-role';

type Ctx = Parameters<typeof requireRole>[0];
function mockCtx(role: string): Ctx {
  return {
    get: (key: string) => (key === 'session' ? { role } : undefined),
    json: (body: unknown, status = 200) => ({ body, status }),
  } as unknown as Ctx;
}

describe('requireRole', () => {
  it('admits admin on the visitor-record allowlist', () => {
    expect(requireRole(mockCtx('admin'), 'superadmin', 'admin', 'receptionist', 'director', 'it')).toBeNull();
  });

  it('admits it (IT) on the visitor-record allowlist', () => {
    expect(requireRole(mockCtx('it'), 'superadmin', 'admin', 'receptionist', 'director', 'it')).toBeNull();
  });

  it('admits admin on the NSS-admin allowlist', () => {
    expect(requireRole(mockCtx('admin'), 'superadmin', 'admin')).toBeNull();
  });

  it('rejects a non-allowed role with 403 FORBIDDEN', () => {
    const blocked = requireRole(mockCtx('staff'), 'superadmin', 'admin') as unknown as
      { body: { error: { code: string } }; status: number } | null;
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
    expect(blocked!.body.error.code).toBe('FORBIDDEN');
  });
});
```

- [ ] **Step 7: type-check + tests (the gate).**
Run: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json` → PASS (if any `'hr'`/`'visitor'` literal was missed, it errors as "not assignable to Role"). Then `npm test -w packages/api` → all pass.

- [ ] **Step 8: commit.**
```bash
git add packages/api/src/types.ts packages/api/src/lib/require-role.ts packages/api/src/lib/require-role.test.ts packages/api/src/routes/admin-nss.ts packages/api/src/routes/users.ts packages/api/src/routes/bulk-import.ts packages/api/src/routes/visits.ts packages/api/src/routes/visitors.ts packages/api/src/routes/analytics.ts packages/api/src/routes/reports.ts
git commit -m "revert(api): role set back to six, HR-as-admin, IT can read visitor records"
```

---

## Task 2: API — remove abandoned migration/endpoint + fix kiosk seed

**Files:** delete `db/migration-hr-role.sql`, `db/migration-users-role-check-drop.sql`; modify `db/migrations-index.ts`, `routes/admin-migrations.ts`, `db/migration-kiosk-visitor.sql`, `db/seed.sql` (all under `packages/api/src/`).

- [ ] **Step 1: remove the CHECK-drop endpoint.** In `packages/api/src/routes/admin-migrations.ts`, delete the entire `adminMigrationsRoutes.post('/drop-users-role-check', ...)` handler. Then change the response import back to `import { success } from '../lib/response';` (the `error` helper is now unused; the `/run` handler doesn't use it).

- [ ] **Step 2: unregister + delete the two dead migrations.** In `packages/api/src/db/migrations-index.ts`, remove the two import lines (`hrRole`, `usersRoleCheckDrop`) and their two `MIGRATIONS` array entries (`migration-hr-role.sql`, `migration-users-role-check-drop.sql`). Then delete the files:
```bash
rm packages/api/src/db/migration-hr-role.sql packages/api/src/db/migration-users-role-check-drop.sql
```

- [ ] **Step 3: kiosk system user → allowed role.** In `packages/api/src/db/migration-kiosk-visitor.sql`, change the seed line role from `'visitor'` to `'staff'`:
```sql
INSERT OR IGNORE INTO users (id, name, email, role)
VALUES ('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'staff');
```
In `packages/api/src/db/seed.sql`, change the kiosk user block likewise to role `'staff'`:
```sql
INSERT OR IGNORE INTO users (id, name, email, role) VALUES
('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'staff');
```

- [ ] **Step 4: type-check + tests.**
Run the api type-check and `npm test -w packages/api`. Expected: PASS (no dangling reference to the removed endpoint/migrations).

- [ ] **Step 5: commit.**
```bash
git add packages/api/src/db/migrations-index.ts packages/api/src/routes/admin-migrations.ts packages/api/src/db/migration-kiosk-visitor.sql packages/api/src/db/seed.sql packages/api/src/db/migration-hr-role.sql packages/api/src/db/migration-users-role-check-drop.sql
git commit -m "chore(api): remove abandoned CHECK-drop migration+endpoint; kiosk user role=staff"
```

---

## Task 3: Web — repoint `hr` wiring to `admin`

**Files:** `components/layout/Sidebar.tsx`, `pages/AdminPage.tsx`, `components/admin/NssTab.tsx`; delete `components/admin/UserRoleToggle.tsx` (all under `packages/web/src/`).

- [ ] **Step 1: Sidebar.** In `packages/web/src/components/layout/Sidebar.tsx`:
  - Rename the nav const `ADMIN_NAV_HR` → `ADMIN_NAV_ADMIN` (keep its `NSS Admin` entry).
  - Replace `const isHr = user?.role === 'hr';` with `const isAdmin = user?.role === 'admin';`.
  - Replace `const canSeeAdmin = isSuperadmin || isHr;` with `const canSeeAdmin = isSuperadmin || isAdmin;`.
  - In the admin-section render, change `(isSuperadmin ? ADMIN_NAV_SUPER : ADMIN_NAV_HR)` to `(isSuperadmin ? ADMIN_NAV_SUPER : ADMIN_NAV_ADMIN)`.

- [ ] **Step 2: AdminPage.** In `packages/web/src/pages/AdminPage.tsx`:
  - In the `ROLES` array, delete the entry `{ value: 'hr', label: 'HR', color: 'bg-secondary/10 text-secondary' },` (back to six entries).
  - Rename the flag `isHr` → `isAdmin` everywhere it appears (definition `const isHr = role === 'hr';` becomes `const isAdmin = role === 'admin';`, plus all usages: the `if (isHr) return 'nss'`, the two `!isSuperadmin && !isHr` guards, the effect dep array, and the `{isHr ? ...}` JSX). Update the related comments from "f_and_a_admin"/"HR" to "admin".
  - Remove the `<UserRoleToggle user={user} />` line from `EditUserModal` and delete the `import { UserRoleToggle } from '@/components/admin/UserRoleToggle';` import.

- [ ] **Step 3: NssTab.** In `packages/web/src/components/admin/NssTab.tsx`, change `currentUser?.role === 'hr'` to `currentUser?.role === 'admin'`.

- [ ] **Step 4: delete the toggle component.**
```bash
rm packages/web/src/components/admin/UserRoleToggle.tsx
```

- [ ] **Step 5: type-check + build + grep.**
Run the web type-check and `node "node_modules/vite/bin/vite.js" build packages/web` → both PASS (`✓ built`). Then grep `packages/web/src` for `f_and_a_admin`, `'hr'`, `isHr`, `UserRoleToggle` → expect zero matches.

- [ ] **Step 6: commit.**
```bash
git add packages/web/src/components/layout/Sidebar.tsx packages/web/src/pages/AdminPage.tsx packages/web/src/components/admin/NssTab.tsx packages/web/src/components/admin/UserRoleToggle.tsx
git commit -m "revert(web): repoint hr admin-area wiring to the admin role; drop role toggle"
```

---

## Task 4: Prod data — seed `user_kiosk` (role `staff`)

**Production write — deliberate. Safe: a single `INSERT OR IGNORE` of an allowed-role, child-less row.** Run from `packages/api`.

- [ ] **Step 1: seed.**
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "INSERT OR IGNORE INTO users (id,name,email,role) VALUES ('user_kiosk','Self-Service Kiosk','kiosk@ohcs.gov.gh','staff');"
```

- [ ] **Step 2: verify (primary-consistent).**
```
node "../../node_modules/wrangler/bin/wrangler.js" d1 execute smartgate-db --remote --command "UPDATE users SET role=role WHERE id='user_kiosk' RETURNING id, name, role;"
```
Expected: one row — `user_kiosk`, role `staff`. (If it returns nothing, the INSERT didn't land — re-check; the CHECK permits `staff`, so this should succeed where the `visitor` attempt failed.)

---

## Task 5: Finish branch + deploy + verify

- [ ] **Step 1:** Use `superpowers:finishing-a-development-branch`: push, PR, merge to `main`. CI (`deploy.yml`) auto-deploys.
- [ ] **Step 2:** Confirm the deploy run is green.
- [ ] **Step 3: post-deploy verification (assistant + optional manual).**
  - Grep repo `packages/` for `'hr'`/`'visitor'` role literals → only `'staff'` for `user_kiosk` + F&A-directorate text remain; zero role-`hr`/`visitor`.
  - (Manual, optional) an `admin` session reads `/api/visits`, `/api/visitors`, and the NSS-admin area; an `it` session reads `/api/visits` & `/api/visitors` but is denied `/api/admin/nss/...`; `staff` denied the records; a kiosk check-in appears in the visit log.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** six-role union + enums → Task 1 (Steps 1,3); NSS `hr`→`admin` → Task 1 Step 2; visitor reads `hr`→`it` → Task 1 Step 4; analytics/reports drop `hr` → Task 1 Step 5; test update → Task 1 Step 6; remove CHECK-drop endpoint+migrations & `hr-role` migration → Task 2 (Steps 1,2); kiosk user role=`staff` (code+prod) → Task 2 Step 3 + Task 4; web `hr`→`admin` + drop toggle → Task 3; deploy+verify → Task 5.
- **Atomicity:** Task 1 changes the union and every dependent reference in one commit so the type-check stays green.
- **Consistency:** the six-role list is identical across `types.ts`, `require-role.ts`, `users.ts`, `bulk-import.ts`. `it` is added only to `visits`/`visitors` reads (not analytics/reports). `admin` replaces `hr` in `admin-nss.ts` and all web admin-area gating.
- **Reliability caveat:** verify the prod seed (Task 4) with `RETURNING`, not the `changes` meta.
