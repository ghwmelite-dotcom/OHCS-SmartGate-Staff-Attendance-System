# Oversight Roles (CD / HoS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Directors get a scoped overview of their directorate/unit; Chief Director and Head of Service get an org-wide read-only overview — no new `users.role` values (display_role overlays). Per spec `docs/superpowers/specs/2026-08-02-oversight-roles-cd-hos-design.md`.

**Architecture:** API — `resolveDirectorateScope` learns the two display roles (org-wide); attendance endpoints open to scoped directors. Web — role-aware home page, two new display_role options in admin users UI.

**Tech Stack:** Hono/D1, React+Vite, vitest + node:sqlite shims.

## Global Constraints

- Per package: typecheck `node ../../node_modules/typescript/bin/tsc --noEmit`; tests `node ../../node_modules/vitest/vitest.mjs run <file>`. API full runs may show 4 pre-existing `.sql` collection errors — ignore.
- No migrations. `display_role` values: `'chief_director'`, `'head_of_service'` (existing column; `'client_service'` precedent).
- Fail-closed preserved: plain `role='director'` without `directorate_id` keeps the `__no_directorate__` deny-all sentinel.

## API/Client contract (parallel tasks depend on this)

- `GET /api/attendance/today` — roles now `superadmin|admin|director`; director → counts forced to their `directorate_id`; cd/hos (display_role) → org-wide. Response shape unchanged.
- `GET /api/attendance/records` — same roles; director → rows forced to their entity; response shape unchanged.
- `GET /api/attendance/by-directorate` — same roles; director → only their entity's card.
- `GET /api/auth/me` already returns `display_role` (verify; if not, add it — client needs it to pick the home view).

---

### Task 1: API — scope resolver learns CD/HoS

**Files:**
- Modify: `packages/api/src/lib/directorate-scope.ts`
- Test: `packages/api/src/lib/directorate-scope.test.ts` (new or extend)

- [ ] **Step 1: failing tests** — session with `display_role='chief_director'` (no directorate) → resolver returns unscoped (null); same for head_of_service; plain director without entity → `__no_directorate__` sentinel; director WITH entity → their id (display_role empty); cd/hos WITH an entity → still org-wide (acting-CD case).
- [ ] **Step 2-4:** implement — the resolver's user read must include `display_role` (check the actual query — session may carry it already; if the resolver reads from DB, add the column). Check display_role before the sentinel path.
- [ ] **Step 5: commit** (folds into Task 2's commit).

### Task 2: API — attendance endpoints open to oversight

**Files:**
- Modify: `packages/api/src/routes/attendance.ts` (`requireAdmin` helper ~:13-16; `/today` ~:55-113; `/records` ~:116-164; `/by-directorate` ~:262-291)
- Test: extend `packages/api/src/routes/attendance.test.ts`

**Interfaces:**
- Consumes: Task 1 resolver (`resolveDirectorateScope(c)` → `string | null`; null = unscoped).
- Produces: the contract above.

- [ ] **Step 1: failing tests** — director gets own-entity counts/rows only (forced filter beats any `directorate_id` param they pass); director without entity → 403 (not zeros); cd/hos → full data; staff role → 403 unchanged; by-directorate returns only the director's card.
- [ ] **Step 2-4:** implement — widen the role gate to include `director`; apply the scope resolver: director → force `u.directorate_id = <id>` in `/records` and the count subqueries in `/today`; `by-directorate` add `WHERE d.id = ?` when scoped. Sentinel ⇒ 403.
- [ ] **Step 5: commit** — `feat(attendance): oversight roles — directors scoped, CD/HoS org-wide`

### Task 3: Web — role-aware home + admin display_role options

**Files:**
- Create: `packages/web/src/pages/OverviewPage.tsx`
- Modify: `packages/web/src/App.tsx` (home route picks by role), `src/components/layout/Sidebar.tsx` + `BottomNav.tsx` (Overview item for director + cd/hos; keep the portal-gaps MODULE_ROLES gating), `src/pages/AdminPage.tsx` or `components/admin/UsersTab.tsx` (display_role dropdown options), `src/lib/roles.ts` (roleLabel + badge colors)
- Test: `src/lib/roles.test.ts` (extend)

**Interfaces:**
- Consumes: the contract endpoints + `/auth/me` (`role`, `display_role`); `/visits` (already scoped server-side); `/analytics/today` (already scoped).
- Produces: `/` renders `OverviewPage` when `role==='director'` OR `display_role` in the two oversight values; everyone else keeps `DashboardPage`.

- [ ] **Step 1: roles lib** — `roleLabel()` + badge classes for Chief Director / Head of Service; `OVERSIGHT_DISPLAY_ROLES` const; extend `roles.test.ts` (watch fail → pass).
- [ ] **Step 2: OverviewPage** — director: entity name header, today's present/absent/late/noticed counts (`/attendance/today`), absent-with-notice list (`/attendance/records?date=today` — rows with a notice / null clock-in), active visits (`/visits?status=checked_in`), SLA note. CD/HoS: same cards org-wide + by-directorate breakdown grid (`/attendance/by-directorate`). Match DashboardPage styling idioms (cards, emerald, auto-refresh via react-query refetchInterval like the dashboard).
- [ ] **Step 3: routing + nav** — home-route role switch; sidebar/bottom-nav "Overview" for director + oversight display_roles (label "Overview", home icon); hide reception-centric nav items these roles can't use per MODULE_ROLES.
- [ ] **Step 4: admin dropdown** — UsersTab display_role select gains "Chief Director" / "Head of Service" (values exactly `'chief_director'` / `'head_of_service'`); badges render via roleLabel.
- [ ] **Step 5: verify** — typecheck + full web suite green.
- [ ] **Step 6: commit** — `feat(portal): role-aware overview home for directors and CD/HoS`

---

## Self-review notes
- Spec coverage: §3→T1, §4→T2, §5→T3, §6→no change needed (verified in spec), §8→test steps. Acting-CD flip covered by T1's cd-with-entity test.
- Type consistency: display_role string literals identical in T1/T3; resolver return `string | null` used consistently.
- `auth/me` display_role: T3 verifies presence; if missing it's a one-line add to `auth.ts` `/me` select — the web agent must flag it if so (then fold the api change into T2's commit instead).
