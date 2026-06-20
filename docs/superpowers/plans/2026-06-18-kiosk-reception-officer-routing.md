# Kiosk Reception-Officer Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-route a kiosk visitor to their selected directorate's admin-designated reception officer — set as the visit host and notified — without exposing a browsable officer directory.

**Architecture:** New `directorates.reception_officer_id` (admin-set via the directorate admin tab, validated same-directorate). The kiosk's public directorate list returns the receiver's display name; the kiosk shows "You'll be received by <name>" and relaxes the host field to optional. On kiosk check-in the **server** resolves the directorate's reception officer and passes it as `host_officer_id` to the existing `performCheckIn`, which already INSERTs it and fires `notifyOnCheckIn`.

**Tech Stack:** Cloudflare Workers (Hono), D1, KV; React 18 + react-hook-form + zod + TanStack Query; vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-18-kiosk-auto-route-reception-officer-design.md`

**Toolchain note (repo path has a space + `&`):** never `npm run`; invoke binaries directly.
- API type-check (from `packages/api`): `node ../../node_modules/typescript/bin/tsc --noEmit`
- API tests (from `packages/api`): `node ../../node_modules/vitest/vitest.mjs run`
- Web type-check / build (from `packages/web`): `node ../../node_modules/typescript/bin/tsc --noEmit` · `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`
- Wrangler local D1 (from `packages/api`): `node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=<sql>`

**Verified facts:**
- `api.put<T>(path, body)` exists (`packages/web/src/lib/api.ts:51`).
- Auth `GET /api/directorates` is `SELECT * FROM directorates` (`routes/directorates.ts:9`) → a new column auto-returns to the admin UI.
- `performCheckIn` (`services/check-in.ts`) already accepts `host_officer_id` in `CheckInParams`, INSERTs it, and fires `notifyOnCheckIn` when set — **no change needed there**.
- Directorate admin lives in `packages/web/src/components/admin/DirectoratesTab.tsx`; it already loads `/directorates` (as `DirectorateExt[]`) and `/officers` (as `OfficerExt[]`).
- Admin directorate update: `PUT /api/admin/directorates/:id` (`routes/admin-directorates.ts:37`), superadmin-only.
- Migrations registered in `db/migrations-index.ts`; applied via `POST /api/admin/migrations/run`.

---

## File Structure

**Create:**
- `packages/api/src/db/migration-reception-officer.sql` — `ALTER TABLE directorates ADD COLUMN reception_officer_id TEXT REFERENCES officers(id);`

**Modify:**
- `packages/api/src/db/migrations-index.ts` — register the migration.
- `packages/api/src/db/schema.sql` — add the column to `directorates`.
- `packages/api/src/routes/admin-directorates.ts` — accept + validate `reception_officer_id` on directorate update.
- `packages/api/src/routes/kiosk.ts` — directorate list returns `reception_officer_name`; check-in resolves the receiver → `host_officer_id`.
- `packages/api/src/lib/validation.ts` — `KioskCheckInSchema.host_name_manual` → optional.
- `packages/web/src/lib/api.ts` — `Directorate` type gains `reception_officer_id`; confirm `Officer` has `directorate_id`.
- `packages/web/src/components/admin/DirectoratesTab.tsx` — Reception Officer column + inline picker.
- `packages/web/src/lib/kioskApi.ts` — `KioskDirectorate` gains `reception_officer_name`.
- `packages/web/src/pages/KioskPage.tsx` — host optional; "You'll be received by <name>" line.

---

### Task 1: DB migration — `directorates.reception_officer_id`

**Files:** Create `packages/api/src/db/migration-reception-officer.sql`; Modify `migrations-index.ts`, `schema.sql`.

- [ ] **Step 1: Create the migration**

`packages/api/src/db/migration-reception-officer.sql`:
```sql
-- Officer who receives kiosk visitors routed to this directorate. Auto-set as the
-- visit host (host_officer_id) and notified on arrival. Nullable: unconfigured
-- directorates fall back to manual handling (no notification). Never blocks check-in.
ALTER TABLE directorates ADD COLUMN reception_officer_id TEXT REFERENCES officers(id);
```

- [ ] **Step 2: Register in `migrations-index.ts`**

Add the import next to the other migration imports:
```ts
import receptionOfficer from './migration-reception-officer.sql';
```
Add as the LAST entry of the `MIGRATIONS` array:
```ts
  { filename: 'migration-reception-officer.sql', sql: receptionOfficer },
```

- [ ] **Step 3: Add the column to `schema.sql`**

In `CREATE TABLE IF NOT EXISTS directorates (...)`, add a line after `head_officer_id TEXT,`:
```sql
    reception_officer_id TEXT REFERENCES officers(id),
```

- [ ] **Step 4: Apply LOCAL + verify**

From `packages/api`:
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=src/db/migration-reception-officer.sql
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM pragma_table_info('directorates') WHERE name='reception_officer_id'"
```
Expected: one row `reception_officer_id`. (Remote apply is a confirmed deploy step — see Deployment.)

- [ ] **Step 5: Type-check + commit**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
```
git add packages/api/src/db/migration-reception-officer.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): add directorates.reception_officer_id column + migration"
```

---

### Task 2: Admin — set + validate the reception officer

**Files:** Modify `packages/api/src/routes/admin-directorates.ts`.

- [ ] **Step 1: Extend the directorate update schema**

Change `updateSchema` (currently `createSchema.partial().extend({ is_active: ... })`) to also accept the field:
```ts
const updateSchema = createSchema.partial().extend({
  is_active: z.number().min(0).max(1).optional(),
  reception_officer_id: z.string().nullable().optional(),
});
```

- [ ] **Step 2: Validate + apply in the PUT handler**

In `adminDirectorateRoutes.put('/:id', ...)`, after the existing `if (body.is_active !== undefined) {...}` line and BEFORE `if (fields.length > 0) {`, insert:
```ts
  if (body.reception_officer_id !== undefined) {
    const recId = body.reception_officer_id || null;
    if (recId !== null) {
      const officer = await c.env.DB.prepare('SELECT directorate_id FROM officers WHERE id = ?')
        .bind(recId).first<{ directorate_id: string }>();
      if (!officer) return error(c, 'INVALID_OFFICER', 'Officer not found', 400);
      if (officer.directorate_id !== id) {
        return error(c, 'INVALID_OFFICER', 'Reception officer must belong to this directorate', 400);
      }
    }
    fields.push('reception_officer_id = ?');
    values.push(recId);
  }
```
(`id` is the directorate id from `c.req.param('id')`. An empty string clears the receiver → NULL.)

- [ ] **Step 3: Type-check**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**
```
git add packages/api/src/routes/admin-directorates.ts
git commit -m "feat(api): admin can set directorate reception officer (validated same-directorate)"
```

---

### Task 3: Kiosk API — expose receiver name + route check-in to it

**Files:** Modify `packages/api/src/routes/kiosk.ts`, `packages/api/src/lib/validation.ts`.

- [ ] **Step 1: Relax `KioskCheckInSchema.host_name_manual` to optional**

In `packages/api/src/lib/validation.ts`, change the `KioskCheckInSchema`:
```ts
export const KioskCheckInSchema = z.object({
  visitor_id: z.string().min(1),
  directorate_id: z.string().min(1),
  host_name_manual: z.string().max(100).optional(),
  purpose_raw: z.string().min(1).max(500),
  idempotency_key: z.string().min(1).max(100).optional(),
});
```

- [ ] **Step 2: Kiosk directorate list returns the receiver's display name**

In `packages/api/src/routes/kiosk.ts`, replace the `/directorates` query:
```ts
kioskRoutes.get('/directorates', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.name, d.abbreviation, o.name AS reception_officer_name
     FROM directorates d
     LEFT JOIN officers o ON d.reception_officer_id = o.id
     WHERE d.is_active = 1 ORDER BY d.name`
  ).all();
  return success(c, rows.results ?? []);
});
```

- [ ] **Step 3: Check-in resolves the directorate's reception officer → `host_officer_id`**

Replace the `/check-in` handler so it looks up the receiver and passes it (keeping the existing KV id-check read):
```ts
kioskRoutes.post('/check-in', zValidator('json', KioskCheckInSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const idCheckRaw = await c.env.KV.get(`idcheck:${body.visitor_id}`);
  if (idCheckRaw !== null) await c.env.KV.delete(`idcheck:${body.visitor_id}`);
  const dir = await c.env.DB.prepare('SELECT reception_officer_id FROM directorates WHERE id = ?')
    .bind(body.directorate_id).first<{ reception_officer_id: string | null }>();
  const result = await performCheckIn(c.env, c.executionCtx, {
    ...body,
    host_officer_id: dir?.reception_officer_id ?? null,
    created_by: KIOSK_USER_ID,
    check_in_source: 'kiosk',
    id_photo_check: idCheckRaw ?? JSON.stringify({ verdict: 'indeterminate' }),
  });
  if (!result.ok) return notFound(c, 'Visitor');
  return created(c, result.visit);
});
```
`host_officer_id` is set AFTER `...body` and is NOT in `KioskCheckInSchema`, so it stays server-derived (client can't inject it). `performCheckIn` already INSERTs `host_officer_id` and notifies when set.

- [ ] **Step 4: Type-check + tests**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/vitest/vitest.mjs run` → all existing tests PASS (no regression).

- [ ] **Step 5: Commit**
```
git add packages/api/src/routes/kiosk.ts packages/api/src/lib/validation.ts
git commit -m "feat(kiosk): route check-in to the directorate's reception officer; expose receiver name"
```

---

### Task 4: Admin UI — Reception Officer picker in DirectoratesTab

**Files:** Modify `packages/web/src/lib/api.ts`, `packages/web/src/components/admin/DirectoratesTab.tsx`.

- [ ] **Step 1: Type changes in `@/lib/api`**

Add `reception_officer_id?: string | null;` to the `Directorate` interface. Confirm the `Officer` interface includes `directorate_id: string;` — if it does not, add it (the `/officers` payload includes it). READ the file to place these correctly.

- [ ] **Step 2: Add the inline picker component to `DirectoratesTab.tsx`**

At the bottom of the file (alongside the other local components), add:
```tsx
function ReceptionOfficerCell({ directorate, officers, onSaved }: {
  directorate: DirectorateExt;
  officers: OfficerExt[];
  onSaved: () => void;
}) {
  const mutation = useMutation({
    mutationFn: (reception_officer_id: string) =>
      api.put(`/admin/directorates/${directorate.id}`, { reception_officer_id }),
    onSuccess: onSaved,
  });
  const own = officers.filter((o) => o.directorate_id === directorate.id);
  return (
    <select
      value={directorate.reception_officer_id ?? ''}
      onChange={(e) => mutation.mutate(e.target.value)}
      disabled={mutation.isPending}
      className="h-8 px-2 rounded-lg border border-border bg-background text-[13px] disabled:opacity-50"
    >
      <option value="">— none —</option>
      {own.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
```

- [ ] **Step 3: Add the column to the directorates table**

In the directorates table `<thead>` row, add a header after the Rooms `<th>`:
```tsx
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Reception</th>
```
In the `<tbody>` row (the `directorates.map(d => ...)` return), add a cell after the Rooms `<td>`:
```tsx
                    <td className="px-6 py-3">
                      <ReceptionOfficerCell
                        directorate={d}
                        officers={officers}
                        onSaved={() => queryClient.invalidateQueries({ queryKey: ['directorates-admin'] })}
                      />
                    </td>
```
(`queryClient` and `officers` are already in scope in the component.)

- [ ] **Step 4: Type-check + build**

From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.

- [ ] **Step 5: Commit**
```
git add packages/web/src/lib/api.ts packages/web/src/components/admin/DirectoratesTab.tsx
git commit -m "feat(admin): pick a directorate's reception officer inline"
```

---

### Task 5: Kiosk UI — optional host + "You'll be received by" line

**Files:** Modify `packages/web/src/lib/kioskApi.ts`, `packages/web/src/pages/KioskPage.tsx`.

- [ ] **Step 1: `KioskDirectorate` gains the receiver name**

In `packages/web/src/lib/kioskApi.ts`, extend the interface:
```ts
export interface KioskDirectorate {
  id: string;
  name: string;
  abbreviation: string;
  reception_officer_name: string | null;
}
```

- [ ] **Step 2: Make the kiosk host field optional**

In `packages/web/src/pages/KioskPage.tsx`, in `visitorSchema`, change the host line from required to optional:
```ts
  host_name: z.string().max(100).optional(),
```
Update the host `FieldWrapper` label to `"Who are you visiting? (optional)"` and (since it's no longer required) the error prop can stay (`form.formState.errors.host_name?.message`) — it just won't fire on empty.

- [ ] **Step 3: Show "You'll be received by <name>" after directorate selection**

Immediately AFTER the Directorate `FieldWrapper` block in the `form` mode, add:
```tsx
      {(() => {
        const sel = directorates.find((d) => d.id === form.watch('directorate_id'));
        return sel?.reception_officer_name ? (
          <p className="text-[13px] text-muted -mt-2">
            You'll be received by <span className="font-semibold text-foreground">{sel.reception_officer_name}</span>.
          </p>
        ) : null;
      })()}
```
(`directorates` is the existing fetched `KioskDirectorate[]` state; `form.watch('directorate_id')` is the current selection.)

- [ ] **Step 4: Type-check + build**

From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.
(`finishCheckIn` already sends `host_name_manual: form.getValues('host_name')` — now possibly empty/undefined, accepted by the relaxed schema. No further change.)

- [ ] **Step 5: Commit**
```
git add packages/web/src/lib/kioskApi.ts packages/web/src/pages/KioskPage.tsx
git commit -m "feat(kiosk): optional host field + show the routed reception officer"
```

---

### Task 6: Full verification (static)

**Files:** none.

- [ ] **Step 1: API** — from `packages/api`: `node ../../node_modules/vitest/vitest.mjs run` → all PASS; `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
- [ ] **Step 2: Web** — from `packages/web`: `node ../../node_modules/vitest/vitest.mjs run` → all PASS; `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.
- [ ] **Step 3: Confirm local D1 column:**
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM pragma_table_info('directorates') WHERE name='reception_officer_id'"
```
Expected: one row.
- [ ] **Step 4: No commit** — report results.

---

## Deployment (controller-run, after merge — NOT a subagent task)

1. **Remote D1 migration FIRST** (prod write, confirm): apply `migration-reception-officer.sql` with `--remote`, record in `applied_migrations` (`INSERT OR IGNORE ... VALUES ('migration-reception-officer.sql','manual')`), verify the column exists remotely. This is additive/nullable — safe; existing check-ins keep working with NULL.
2. **Deploy** via merge → `deploy.yml`; confirm green.
3. **Configure receivers:** a superadmin sets each directorate's reception officer in the admin tab. Until set, kiosk check-ins for that directorate notify nobody (today's behaviour) — no breakage.

---

## Self-Review

**Spec coverage:**
- A. `directorates.reception_officer_id` migration + schema + register → Task 1. ✓
- B. Admin set/validate (same-directorate, clearable) → Task 2 (API) + Task 4 (UI picker scoped to the directorate's own officers). ✓
- C. Kiosk `/directorates` returns `reception_officer_name` → Task 3 Step 2. ✓
- D. Host field optional + "You'll be received by <name>" → Task 5. ✓
- E. Server resolves receiver → `host_officer_id` → existing `notifyOnCheckIn` → Task 3 Step 3 (reuses `performCheckIn` unchanged). ✓
- F. `KioskCheckInSchema.host_name_manual` optional; `host_officer_id` not client-accepted → Task 3 Steps 1 & 3. ✓
- Fallback (no receiver → null → no notify, never blocks) → Task 3 Step 3 (`dir?.reception_officer_id ?? null`). ✓
- Cross-directorate officer rejected (400) → Task 2 Step 2. ✓

**Placeholder scan:** No TBDs; every code step has full code; commands have expected output. The two conditional reads ("confirm `Officer` has `directorate_id`", "READ the file to place") name the exact file + field — concrete, not vague.

**Type consistency:** `reception_officer_id` (DB + admin schema + web `Directorate` type) and `reception_officer_name` (kiosk SQL alias + `KioskDirectorate` + the KioskPage read) are spelled identically across tasks. `host_officer_id` flows into the existing `CheckInParams` field (unchanged). The admin picker filters `officers` by `directorate_id` — matching the Task 4 Step 1 type confirmation.

**Testability note:** the route/admin DB-bound logic has no integration harness in this repo (tests are on pure libs/services). It's verified by type-check + the existing test suite (no regression) + review + the on-device/post-deploy check — consistent with how the codebase verifies routes. No new pure unit exists that warrants a test file here.
