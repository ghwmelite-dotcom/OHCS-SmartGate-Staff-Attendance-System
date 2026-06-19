# Kiosk ID-Photo Gate + Reception Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the kiosk ID photo mandatory and turn the AI document check into a **server-enforced gate** (confident `not_document` blocks check-in) with a superadmin-configurable **reception override PIN**. Spec: `docs/superpowers/specs/2026-06-19-kiosk-id-gate-design.md`.

**Architecture:** Gate lives in the kiosk check-in API (public surface — can't trust the browser). `app_settings.reception_override_pin` (additive column) holds the override secret. The kiosk UI makes the ID-photo step mandatory and handles the 422 block with retake + reception-PIN entry.

**Tech:** Hono + D1 (`packages/api`), React + Vite (`packages/web`), Zod, vitest.

**Toolchain (never `npm run`):** API (from `packages/api`) tc `node ../../node_modules/typescript/bin/tsc --noEmit`, tests `node ../../node_modules/vitest/vitest.mjs run`; Web (from `packages/web`) tc + `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`; wrangler db `smartgate-db` via `node "<repo>/node_modules/wrangler/bin/wrangler.js"`.

**Defaults locked:** step order stays `form → face → id`; block threshold `ID_BLOCK_CONFIDENCE = 0.55`.

---

## Task 1: Data model + settings (override PIN)

**Files:** create `packages/api/src/db/migration-reception-override-pin.sql`; modify `db/migrations-index.ts`, `db/schema.sql`, `services/settings.ts`, `routes/admin-settings.ts`, and the web admin settings UI.

- [ ] **Step 1: Migration (additive ALTER — D1-safe, no rebuild).**
```sql
-- migration-reception-override-pin.sql
-- Superadmin-set PIN a receptionist enters at the kiosk to approve a check-in the
-- ID-photo AI gate flagged. NULL/empty = overrides disabled.
ALTER TABLE app_settings ADD COLUMN reception_override_pin TEXT;
```
Register as the LAST entry in `migrations-index.ts` (import + array). Add the column to `app_settings` in `schema.sql`.

- [ ] **Step 2: `services/settings.ts`.** Add `reception_override_pin: string | null` to the `AppSettings` interface + `DEFAULTS` (default `null`). Add the column to the settings SELECT/read so it's loaded. (Read the file; mirror how other nullable settings are read.)

- [ ] **Step 3: `routes/admin-settings.ts` (superadmin).** Extend the GET response to include `reception_override_pin`, and the PUT `settingsSchema` with `reception_override_pin: z.string().regex(/^\d{4,8}$/,'PIN must be 4–8 digits').optional().or(z.literal(''))` (empty string disables it → store NULL). Persist it in the UPDATE. Keep superadmin gating.

- [ ] **Step 4: Web admin settings UI.** Find the settings page/component (the one that PUTs `/admin/settings`). Add a "Reception override PIN" field (superadmin) with helper text: "Receptionists enter this at the kiosk to approve a check-in the ID-photo check flagged. Leave blank to disable overrides." Wire it into the existing form submit. tc + build.

- [ ] **Step 5: Apply migration locally + verify; commit.**
`wrangler d1 execute smartgate-db --local --file=src/db/schema.sql` (re-init) then confirm `reception_override_pin` present (`SELECT sql FROM sqlite_master WHERE name='app_settings'`). API tc + tests green; web tc + build. Commit: "feat(kiosk): reception_override_pin setting (DB + admin settings)".

---

## Task 2: Server-enforced AI document gate (kiosk check-in)

**Files:** modify `packages/api/src/routes/kiosk.ts`, `packages/api/src/lib/validation.ts`; create/extend a unit test (`lib/id-check.test.ts` or a new `routes`-adjacent pure test for the helper).

- [ ] **Step 1: Add the pure gate helper + test (TDD).** In `lib/id-check.ts` (where `IdCheckVerdict` lives) export:
```ts
export const ID_BLOCK_CONFIDENCE = 0.55;
/** A verdict that should BLOCK check-in: a confident not_document. Low-confidence or
 *  indeterminate/document pass (we never hard-block on uncertainty / infra failure). */
export function isBlockingVerdict(v: IdCheckVerdict | null | undefined): boolean {
  if (!v || v.verdict !== 'not_document') return false;
  return v.confidence == null || v.confidence >= ID_BLOCK_CONFIDENCE;
}
/** Pick the more CONSERVATIVE of two verdicts for gating, so a forged body `document`
 *  can't unblock a KV `not_document`. Blocking beats non-blocking. */
export function mostConservativeVerdict(a, b): IdCheckVerdict | null { /* return whichever isBlockingVerdict()==true; prefer a blocking one; else a ?? b */ }
```
Write `lib/id-check.test.ts` cases first (fail), then implement: `isBlockingVerdict` — not_document@0.9→true, not_document@0.3→false, not_document@undefined→true, document→false, indeterminate→false, null→false; `mostConservativeVerdict` — (document, not_document@0.9)→the not_document; (indeterminate, document)→non-blocking; (null, x)→x. Run `vitest run id-check` → PASS.

- [ ] **Step 2: Validation schema.** `lib/validation.ts KioskCheckInSchema`: add `reception_override_pin: z.string().max(8).optional()`. (`id_check` is already optional.)

- [ ] **Step 3: Enforce the gate in `POST /api/kiosk/check-in` (`routes/kiosk.ts`).** READ the current handler (it reads `idcheck:${visitor_id}` from KV and prefers `body.id_check`). Change to:
  - Parse the KV verdict (if any) and the body verdict (if any).
  - `const effective = mostConservativeVerdict(kvVerdict, bodyVerdict)` — use this BOTH for the gate AND for what gets persisted to `visits.id_photo_check` (so the conservative verdict is recorded).
  - If `isBlockingVerdict(effective)`:
    - If `body.reception_override_pin` is non-empty AND the setting `reception_override_pin` is configured (non-empty) AND they match via a **constant-time** compare (reuse `timingSafeEqual` from `services/auth.ts` or inline) → proceed; set an `override` field on the persisted id_photo_check JSON: `{ ...effective, override: { by: 'reception', at: new Date().toISOString() } }`.
    - Else → `return error(c, 'ID_NOT_VERIFIED', 'The ID photo could not be verified as a valid document. Please retake or ask reception to assist.', 422)` (no visit created; KV verdict left intact so a retry/override still sees it — only delete KV on successful completion).
  - Else → proceed as today (persist `effective`).
  - Load settings via the existing `getAppSettings(c.env)`.
  - Rate-limit is already applied to kiosk routes; confirm override attempts are covered (the per-IP kiosk limit applies). If a tighter per-visitor override cap is cheap, add it; else rely on the existing limit + note it.
  - IMPORTANT: only `KV.delete(idcheck:...)` after a successful (non-blocked or overridden) check-in, so a blocked visitor's retry/override still has the verdict. (Today it deletes before deciding — move the delete after the gate passes.)

- [ ] **Step 4: API tc + tests green. Commit:** "feat(kiosk): server-enforced AI document gate + reception override on check-in".

---

## Task 3: Kiosk UI — mandatory ID photo + block/override flow

**Files:** modify `packages/web/src/pages/KioskPage.tsx`, `packages/web/src/lib/kioskApi.ts`.

- [ ] **Step 1: `kioskApi.ts`.** The `checkIn` payload type: add optional `id_check?` (if not already) and `reception_override_pin?: string`. Pass them through.

- [ ] **Step 2: Mandatory ID photo.** In `KioskPage.tsx` `id` mode, remove the `onSkip={finishCheckIn}` bypass from `<PhotoCapture>` (the visitor must capture; `qualityGuard` stays). If `PhotoCapture` requires an `onSkip`, pass a no-op or adjust its prop so no skip control renders.

- [ ] **Step 3: Block + reception-assist sub-state.** `handleIdCapture` uploads the ID photo, gets `id_check`, then calls `finishCheckIn` (passing `id_check`). `finishCheckIn` already calls `kioskApi.checkIn`. Handle a **422 `ID_NOT_VERIFIED`** response distinctly (not the generic error): set a new piece of state (e.g. `idBlocked = true`) and STAY on the `id` step showing:
  - message: "That doesn't look like a valid ID. Please retake — fit the whole ID in the frame with good lighting."
  - **Retake** (re-arm `PhotoCapture`) and **"Reception assistance"** actions.
  - "Reception assistance" reveals a numeric PIN input (4–8 digits) + Submit; on submit, call `finishCheckIn` again with `reception_override_pin` set. On success → badge/success. On another 422 → inline "Incorrect PIN — please ask reception" (and if no PIN configured server-side it will always 422 → the copy directs them to the desk).
  - Keep `finishCheckIn` idempotent (it already guards with `checkingInRef`); ensure a blocked attempt resets `checkingInRef` so retake/override can retry. (Read the current `finishCheckIn` — it sets `checkingInRef.current=true` then `finally=false`; on a 422 the catch path runs `finally`, so a retry is allowed. Verify the 422 is caught and routed to the blocked state, not the generic `submitError`.)
- The existing success-screen soft-flag (`IdCheckBadge`) stays for passing-but-flagged verdicts.

- [ ] **Step 4: Web tc + build green. Commit:** "feat(kiosk): mandatory ID photo + AI-gate block/retake/reception-override UI".

---

## Task 4: Verification

**Files:** none.

- [ ] **Step 1: Static** — API tc + tests; web tc + build; (staff unaffected).
- [ ] **Step 2: Migration to prod (gated on user confirm).** Additive `ALTER ADD COLUMN` (D1-safe, zero data risk). Apply `--remote --file=migration-reception-override-pin.sql`, verify the column, record in `applied_migrations`. Then have the superadmin set a reception override PIN via Settings (or set it directly for testing).
- [ ] **Step 3: Deploy** — merge → `deploy.yml` green.
- [ ] **Step 4: Runtime (verify skill, headless per `[[verify-kiosk-form-playwright]]`):** on the live kiosk — (a) ID-photo step can't be skipped; (b) photograph a non-ID (hand/wall) → 422 block with retake + reception-assist; (c) wrong override PIN → still blocked; (d) correct PIN → proceeds, `visits.id_photo_check` shows `override.by='reception'`; (e) a real ID (or `indeterminate`) → passes. Screenshot evidence. Honest verdict.

---

## Self-Review
- **Spec coverage:** mandatory photo (T3.2), server gate + 422 (T2.3), conservative-merge anti-bypass (T2.1/T2.3), override PIN setting (T1) + UI (T3.3), confidence threshold 0.55 (T2.1), indeterminate/infra-failure passes (isBlockingVerdict), KV-delete-after-success fix (T2.3). Phone explicitly excluded. ✓
- **Type consistency:** `isBlockingVerdict`/`mostConservativeVerdict` operate on `IdCheckVerdict` (from `lib/id-check.ts`), consumed by `kiosk.ts`; `reception_override_pin` typed in `AppSettings` + the validation schema + `kioskApi` payload. ✓
- **No DB rebuild:** additive ALTER only (per `[[d1-cannot-rebuild-referenced-table]]`). ✓
- **Repo test convention:** pure unit tests only (gate helpers); the route gate + UI are verified at runtime (no DB/route harness in repo). ✓
