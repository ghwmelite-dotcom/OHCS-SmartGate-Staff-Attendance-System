# Kiosk Purpose-First Auto-Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the kiosk form to purpose-first and auto-select the directorate (→ reception officer) as the visitor types their purpose, mirroring the VMS staff form.

**Architecture:** One file (`KioskPage.tsx`). Move the Purpose block above Directorate; add an `onChange` on the purpose textarea that calls the existing `suggestDirectorate` keyword matcher and sets `directorate_id` only when it's empty. No API/schema/routing-logic change.

**Tech Stack:** React 18 + react-hook-form; the keyword matcher + hint already exist.

**Reference spec:** `docs/superpowers/specs/2026-06-18-kiosk-purpose-first-routing-design.md`

**Toolchain note (repo path has a space + `&`):** never `npm run`; from `packages/web`:
- type-check: `node ../../node_modules/typescript/bin/tsc --noEmit`
- build: `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`

**Verified current code (`packages/web/src/pages/KioskPage.tsx`):** form-mode fields run Name → Phone → Organisation → **Directorate `<select>`** (lines ~197-204) → **received-by IIFE** (~205-212) → **host_name** (~213-215) → **`SmartIdFields`** (~216-228) → **Purpose textarea** `{...form.register('purpose_raw')}` (~229-231) → **`PurposeRoutingHint`** (~232-237). `PurposeRoutingHint` is imported from `@/components/checkin/PurposeRoutingHint`; `suggestDirectorate` (from `@/lib/directorate-routing`) is **not** currently imported here. `directorates` is the fetched `KioskDirectorate[]` state; `fieldCls` is the local touch-sized input class.

---

### Task 1: Reorder to purpose-first + wire keyword auto-fill

**Files:** Modify `packages/web/src/pages/KioskPage.tsx`.

- [ ] **Step 1: Add the `suggestDirectorate` import**

Next to the existing `PurposeRoutingHint` import, add:
```tsx
import { suggestDirectorate } from '@/lib/directorate-routing';
```

- [ ] **Step 2: Replace the Directorate-through-Hint block with the reordered version**

Replace the current block (the Directorate `FieldWrapper` + received-by IIFE + host `FieldWrapper` + `SmartIdFields` + Purpose `FieldWrapper` + `PurposeRoutingHint` — i.e. everything from the `<FieldWrapper ... label="Directorate" ...>` opening through the closing `/>` of `<PurposeRoutingHint .../>`) with this reordered block (Purpose+hint first, then Directorate+received-by, then host, then ID):
```tsx
              <FieldWrapper label="Purpose of Visit" error={form.formState.errors.purpose_raw?.message}>
                <textarea
                  {...form.register('purpose_raw', {
                    onChange: (e) => {
                      const match = suggestDirectorate(e.currentTarget.value, directorates);
                      if (match && !form.getValues('directorate_id')) {
                        form.setValue('directorate_id', match.id);
                      }
                    },
                  })}
                  rows={2}
                  className={`${fieldCls} h-auto py-2 resize-none`}
                  placeholder="e.g. Submit documents, salary enquiry, training..."
                />
              </FieldWrapper>
              <PurposeRoutingHint
                purpose={form.watch('purpose_raw') ?? ''}
                directorates={directorates}
                currentDirectorateId={form.watch('directorate_id') ?? ''}
                onAccept={(id) => form.setValue('directorate_id', id)}
              />
              <FieldWrapper icon={<Building2 className="h-4 w-4" />} label="Directorate" error={form.formState.errors.directorate_id?.message}>
                <select {...form.register('directorate_id')} className={fieldCls}>
                  <option value="">Select directorate...</option>
                  {directorates.map((d) => (
                    <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
                  ))}
                </select>
              </FieldWrapper>
              {(() => {
                const sel = directorates.find((d) => d.id === form.watch('directorate_id'));
                return sel?.reception_officer_name ? (
                  <p className="text-[13px] text-muted -mt-2">
                    You'll be received by <span className="font-semibold text-foreground">{sel.reception_officer_name}</span>.
                  </p>
                ) : null;
              })()}
              <FieldWrapper icon={<User className="h-4 w-4" />} label="Who are you visiting? (optional)" error={form.formState.errors.host_name?.message}>
                <input {...form.register('host_name')} className={fieldCls} placeholder="e.g. Mr. Mensah" />
              </FieldWrapper>
              <SmartIdFields
                idType={form.watch('id_type')}
                idNumber={form.watch('id_number') ?? ''}
                onIdTypeChange={(v) => {
                  form.setValue('id_type', v as never);
                  if (v) form.clearErrors('id_type');
                  else form.setValue('id_number', '');
                }}
                onIdNumberChange={(v) => form.setValue('id_number', v)}
                idTypeError={form.formState.errors.id_type?.message}
                idNumberError={form.formState.errors.id_number?.message}
                inputClassName={fieldCls}
              />
```
Notes:
- This is purely a **reorder** (Purpose+hint moved above Directorate; host + ID unchanged in content, now below Directorate) plus the **new `onChange`** on the purpose textarea. The Directorate `<select>`, received-by IIFE, host field, and `SmartIdFields` are byte-identical to before — only their position changed.
- `e.currentTarget.value` is used (not `e.target`) for the correctly-typed textarea event under RHF's `onChange` option.
- The `!form.getValues('directorate_id')` guard makes auto-fill fire only when the directorate is empty — it won't overwrite a manual pick or re-fire once set.
- If the file's exact whitespace makes a precise string-Edit hard, rewrite the form-card inner section with the Write tool, preserving every other line (header `h2`, the `<div className="bg-surface ...">` wrapper, name/phone/organisation blocks above, and the buttons below) exactly.

- [ ] **Step 3: Type-check + build**

From `packages/web`:
- `node ../../node_modules/typescript/bin/tsc --noEmit` → 0 errors. (If TS flags `suggestDirectorate` unused, the import/usage didn't wire — fix. If it flags the RHF `onChange` event type, use `e.currentTarget.value`.)
- `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.

- [ ] **Step 4: Commit**
```
git add packages/web/src/pages/KioskPage.tsx
git commit -m "feat(kiosk): purpose-first form — typing purpose auto-selects directorate"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 2: Verification

**Files:** none.

- [ ] **Step 1: Static** — from `packages/web`: `node ../../node_modules/vitest/vitest.mjs run` → all pass (`suggestDirectorate` already covered); `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; build → `✓ built`.

- [ ] **Step 2: Confirm the reorder + guard by reading the diff** — Purpose `FieldWrapper` now precedes the Directorate `FieldWrapper`; the only behavioural addition is the textarea `onChange`; the `!form.getValues('directorate_id')` guard is present; nothing else (schema, finishCheckIn, photo/checkout) changed.

- [ ] **Step 3: Post-deploy headless render (controller, verify skill)** — after merge+deploy, load the live kiosk in headless Chromium (Playwright is already in `node_modules`): Check In → type a keyword purpose (e.g. "salary enquiry" or "submit documents") into Purpose → assert the Directorate `<select>` auto-selects the matched directorate and "You'll be received by …" appears; assert Purpose renders above Directorate; assert that picking a directorate manually first, then typing, does NOT overwrite it. Screenshot as evidence.

- [ ] **Step 4: No commit** — report results.

---

## Self-Review

**Spec coverage:**
- A. Reorder to purpose-first (Purpose above Directorate; host/ID below) → Task 1 Step 2. ✓
- B. `onChange` keyword auto-fill via `suggestDirectorate`, empty-guarded → Task 1 Steps 1-2. ✓
- C. Directorate dropdown stays editable; received-by reacts automatically; `PurposeRoutingHint` + `onAccept` retained; schema/flow unchanged → Task 1 Step 2 (blocks moved, not changed). ✓
- Edge cases (no match → manual; manual-then-type → no overwrite; loading → no-op) → covered by the guard + `suggestDirectorate`'s null returns. ✓

**Placeholder scan:** No TBDs; the full reordered block is shown; commands have expected output. The "rewrite with Write if exact-Edit is hard" note is a concrete fallback, not a gap.

**Type consistency:** `suggestDirectorate(purpose: string, directorates: DirectorateOption[])` — `KioskDirectorate` satisfies `DirectorateOption` (id/name/abbreviation), matching its use in `PurposeRoutingHint`. `form.register('purpose_raw', { onChange })` is the RHF-supported signature; `form.getValues`/`setValue`/`watch` are already used throughout this file.

## Deployment

Frontend-only, no migration — normal merge → `deploy.yml`. Post-deploy: the live-kiosk headless render in Task 2 Step 3 confirms the behaviour.
