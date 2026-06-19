# Kiosk ID-Photo Gate + Reception Override — Design

**Date:** 2026-06-19
**Status:** Approved in brainstorming (pending spec review → plan).
**Builds on:** the kiosk ID-photo AI check (PR #8, `services/id-check.ts`, non-blocking soft-flag) and the kiosk check-in flow (`routes/kiosk.ts`, `KioskPage.tsx`).

## Summary

Harden the public kiosk visitor flow so a fake or non-ID photo can't sail through. Two changes:

1. **Mandatory ID-photo step** — capturing a photo of the selected ID becomes a required step (the
   current skip path is removed); it directly follows the ID-type/number selection.
2. **AI document gate, enforced server-side, with a reception-PIN override** — the existing AI vision
   verdict (`document` / `not_document` / `indeterminate`) stops being a passive flag and becomes a
   gate: a confident `not_document` **blocks** check-in. Because the kiosk is public (a nefarious
   client could bypass a browser-only check), the gate is enforced in the **check-in API**, not just
   the UI. To ensure the AI never *traps* a legitimate visitor whose ID it misreads, a receptionist
   can vouch by entering a configurable **reception override PIN**; the override is recorded on the
   visit.

**Explicitly out of scope (this round):** phone-number ownership verification (would require a paid
Ghana SMS gateway). The phone stays format-validated free text. May revisit later.

**Honest limit (documented, not solved):** this stops "photo of a wall / receipt / random object,"
but a person photographing *someone else's real ID* still passes the AI. The live receptionist + the
visitor's face photo on the badge remain the ultimate authority. This raises the bar; it is not
bulletproof, and the design must not pretend otherwise.

## Context (verified)

- `POST /api/kiosk/visitors/:id/id-photo` (`routes/kiosk.ts:70`) → `checkIdDocument(env, buf)`
  (`services/id-check.ts`, model `@cf/meta/llama-3.2-11b-vision-instruct`, ~5s race) → stashes the
  verdict in KV `idcheck:${visitorId}` (900s TTL) and returns `{ id_photo_url, id_check }`.
- Verdict shape (`lib/id-check.ts IdCheckVerdict`): `{ verdict: 'document'|'not_document'|'indeterminate',
  detected_type?, confidence?: 0..1, model?, checked_at? }`. Every failure path (timeout, model error,
  unparseable, license-not-accepted) degrades to `indeterminate`.
- `POST /api/kiosk/check-in` (`routes/kiosk.ts:91`) reads + deletes KV `idcheck:${visitor_id}`, prefers
  `body.id_check` when present (added in Batch 5), and persists the JSON onto `visits.id_photo_check`.
  Today it **never blocks** on the verdict.
- `KioskPage.tsx` flow: `form` (incl. `SmartIdFields` = ID type + number) → `face` (face photo) →
  `id` (ID photo; currently `onSkip={finishCheckIn}` — skippable) → `submitting` → `success`. The
  success screen already surfaces a soft "⚠ ID looks unclear / mismatched" note via `IdCheckBadge`.
- `app_settings` (`services/settings.ts`): singleton row; `admin-settings.ts` PUT currently edits only
  the 3 work-time fields (superadmin-gated). Other settings (clockin_*) are not exposed there.

## Decisions (from brainstorming)

1. ID photo: **mandatory**, directly following ID selection.
2. AI check: **gate** (block confident `not_document`), enforced **server-side**.
3. `indeterminate` / `document` verdicts **pass** (don't punish uncertainty → avoids false-rejects).
4. Override: a **reception override PIN** (superadmin-configurable), validated server-side, recorded
   on the visit.
5. Phone: out of scope.

## Changes

### A. Data model
- New migration `migration-reception-override-pin.sql` (additive `ALTER ADD COLUMN`, D1-safe — the
  established pattern; no rebuild): `ALTER TABLE app_settings ADD COLUMN reception_override_pin TEXT;`
  Register in `migrations-index.ts`; add the column to `schema.sql`.
- `services/settings.ts`: add `reception_override_pin: string | null` to `AppSettings` + `DEFAULTS`
  (default `null` = override disabled until configured). Include it in the settings SELECT.

### B. Settings management (superadmin)
- `routes/admin-settings.ts`: extend the GET and the PUT schema to include `reception_override_pin`
  (`z.string().regex(/^\d{4,8}$/).optional().or(z.literal(''))` — empty string clears/disables it).
  Keep superadmin gating. Persist it to `app_settings`.
- Web admin settings UI: add a "Reception override PIN" field (superadmin) with guidance ("receptionists
  enter this to approve a check-in the ID-photo check flagged; leave blank to disable overrides").

### C. The gate — server-enforced (`routes/kiosk.ts` check-in)
Define a small helper `isBlockingVerdict(v)`: returns true when `v.verdict === 'not_document'` AND
(`v.confidence == null || v.confidence >= ID_BLOCK_CONFIDENCE`) where `ID_BLOCK_CONFIDENCE = 0.55`
(a low-confidence `not_document` is treated as uncertain → passes, reducing false-rejects).

In the check-in handler, after resolving the effective verdict (`body.id_check ?? KV idcheck`):
- If `isBlockingVerdict(verdict)`:
  - If `body.reception_override_pin` is provided, non-empty, **and** equals
    `settings.reception_override_pin` (and the setting is configured/non-empty) → **proceed**, and
    annotate the stored `id_photo_check` JSON with `override: { by: 'reception', at: <iso> }`.
  - Else → **reject** with `error(c, 'ID_NOT_VERIFIED', 'The ID photo could not be verified as a valid document. Please retake or ask reception to assist.', 422)`. No visit row is created.
- Else (`document` / `indeterminate` / low-confidence `not_document`) → proceed as today.

Constant-time compare the override PIN (reuse the `timingSafeEqual` helper added in the PIN-KDF work,
or an inline equivalent). Rate-limit override attempts per visitor/IP (reuse the kiosk rate-limit) to
stop PIN brute-forcing.

### D. Validation
`lib/validation.ts KioskCheckInSchema`: add optional `reception_override_pin: z.string().max(8).optional()`.
(`id_check` is already optional per Batch 5.)

### E. Kiosk UI (`KioskPage.tsx` + `kioskApi.ts`)
- **Mandatory ID photo:** remove the `onSkip` bypass on the `id`-mode `PhotoCapture` (the visitor must
  capture; the existing `qualityGuard` still rejects blank/dark frames). Sequence unchanged
  (`form → face → id`) — the ID-photo step already follows the ID selection; confirm with the user
  whether they also want `id` moved *before* `face`. (Default: keep `face → id`.)
- **Gate handling:** `handleIdCapture` uploads the ID photo and gets `id_check`. It then calls
  `finishCheckIn` passing `id_check` in the body (already wired). If the check-in returns `422
  ID_NOT_VERIFIED`, the kiosk shows a **blocked** sub-state on the `id` step: "That doesn't look like a
  valid ID — retake with the whole ID in frame and good lighting," with **Retake** and **"Reception
  assistance"** actions.
- **Reception assistance:** tapping it reveals a PIN input; on submit, re-call `finishCheckIn` with
  `reception_override_pin` set. Success → proceeds to the badge; still-422 (wrong/just-disabled PIN) →
  inline "Incorrect PIN — ask reception." If no PIN is configured server-side, the override always
  fails → the visitor is directed to the reception desk (copy reflects this).
- `kioskApi.checkIn(...)` gains optional `id_check` (already) + `reception_override_pin`.
- The success-screen soft-flag (`IdCheckBadge`) stays for `indeterminate` / mismatched-type cases that
  pass the gate.

## Error handling & edge cases

- **AI unavailable / timeout / license issue** → verdict `indeterminate` → **passes** the gate (we
  never hard-block on infra failure; degrades to today's behaviour). The gate only fires on a positive
  `not_document` classification.
- **No override PIN configured** → blocked check-ins cannot self-complete; visitor goes to the desk.
  Surfaced in rollout notes (superadmin should set the PIN).
- **Override PIN brute-force** → rate-limited; constant-time compared.
- **Client bypass attempt** (skip the AI call / forge `id_check: document`) → the server prefers
  `body.id_check` today, which a nefarious client could spoof. **The spec must also re-read/trust the
  KV verdict when present and not let a body-supplied `document` override a KV `not_document`.** Rule:
  if a KV verdict exists, the server uses the **more conservative** of (KV verdict, body verdict) for
  the gate (a body `document` cannot unblock a KV `not_document`). If only the body verdict exists
  (KV expired), it's used as-is (best effort) — note this residual.
- **Mandatory photo + quality guard** already prevents empty submissions.

## Testing

- **Unit:** `isBlockingVerdict` (not_document≥0.55 → block; not_document<0.55 → pass; document/indeterminate
  → pass; missing confidence → block on not_document); override PIN compare (match/mismatch/empty/disabled);
  the "conservative merge" of KV vs body verdict.
- **Static:** API + web type-check; web build.
- **Runtime (post-deploy, controller):** on the live kiosk — (a) photograph a non-ID (e.g. a hand/wall)
  → blocked with retake + reception-assist; (b) enter the configured override PIN → proceeds, visit
  shows `override: reception`; (c) a real ID → passes; (d) confirm the ID-photo step can't be skipped.
  Use the headless kiosk recipe (`type()`, wait for selects) per `[[verify-kiosk-form-playwright]]`.

## Out of scope (YAGNI)

- Phone SMS OTP (separate effort + provider/budget).
- OCR / MRZ data-matching of the ID against the typed number (considered; deferred — bigger build, OCR
  accuracy tuning). The gate here is classification-only.
- Per-directorate or per-ID-type override policies.
