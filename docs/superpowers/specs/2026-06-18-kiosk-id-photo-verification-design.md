# Kiosk ID-Photo Verification — Design (Sub-project B)

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Sibling:** `2026-06-18-kiosk-vms-form-parity-design.md` (build that one first)

## Summary

The kiosk already requires an ID photo (non-skippable). But the system can't tell whether
what was photographed is actually an ID — and **no software can prove ID authenticity**;
even commercial KYC only estimates it. The kiosk is **receptionist-supervised by design**,
so the model here is: *the machine ensures a usable ID photo exists and assists; the
receptionist + audit trail are the authority.* This adds three non-blocking layers — a
client quality guard, a server-side AI document-presence check, and review surfacing — that
**raise the bar and create an audit trail without ever rejecting a genuine visitor.**

## Decisions (resolved during brainstorming)

1. **Mandatory capture + AI soft-flag + supervise** (not a hard AI gate).
2. **Inline ~5s AI check** (raced with a timeout) so the supervising receptionist gets a
   real-time verdict while the visitor is present — accepting a few seconds added latency
   on the ID step. On timeout/error → `indeterminate`, proceed.
3. **Verdict stored per-visit** (on the `visits` row), not on the visitor.

## Data flow & the sequencing solution

Kiosk order is `createVisitor → uploadFacePhoto → uploadIdPhoto → checkIn (creates the
visit)`. The verdict is computed at ID-photo upload, **before the visit exists**. To keep
it per-visit *and* server-authoritative (not client-forged):

1. `POST /api/kiosk/visitors/:id/id-photo` stores the photo, runs the AI check inline
   (raced ~5s), then **(a)** returns the verdict in the response (for the live UI nudge)
   and **(b)** stashes it in KV at `idcheck:${visitorId}` with a short TTL (≈15 min).
2. `POST /api/kiosk/check-in` reads `idcheck:${visitorId}` from KV, writes it onto the new
   `visits` row, and deletes the KV key. If absent (timeout/skip/expired) → store
   `indeterminate`.

## Changes

### A. DB migration — verdict column on `visits`

`packages/api/src/db/migration-kiosk-id-check.sql`:
```sql
-- Soft, non-authoritative AI verdict on the ID photo captured for this visit.
-- JSON: { verdict, detected_type, confidence, model, checked_at }.
-- verdict ∈ 'document' | 'not_document' | 'indeterminate'.
ALTER TABLE visits ADD COLUMN id_photo_check TEXT;
```
Also add the column to `packages/api/src/db/schema.sql` and register the migration in the
runner / `applied_migrations` (apply local + remote per the established process).

### B. Client-side quality guard (`PhotoCapture.tsx`)

Add an opt-in prop `qualityGuard?: boolean` (default `false` → staff flow unaffected).
When `true`, before firing `onCapture`, inspect the captured frame off the canvas:
- Downscale to a small sample; compute **mean luminance** and **luminance variance**.
- Reject if mean is near-black/near-white **or** variance is below a flat-frame threshold
  (a blank wall / lens-covered shot), showing "Image too dark or empty — please retake."
Pure, deterministic math in a helper `packages/web/src/lib/image-quality.ts`
(`assessFrameQuality(imageData) → { ok, reason? }`) so it is unit-testable. The kiosk **ID**
step passes `qualityGuard`; the face step may too (decided in the plan).

### C. Server-side AI document check (`packages/api/src/services/id-check.ts`)

New service `checkIdDocument(env, bytes): Promise<IdCheckVerdict>`:
- Calls a Workers AI multimodal model (target `@cf/llava-hf/llava-1.5-7b-hf`; **confirm the
  exact available model at build time and note a fallback**) with the image bytes and a
  prompt asking for strict JSON: `{ is_document: boolean, detected_type:
  'ghana_card'|'passport'|'drivers_license'|'staff_id'|'other'|'none', confidence: 0..1 }`.
- Wrapped in `raceWithTimeout` (~5s) mirroring `services/liveness/ai.ts`. Timeout / error /
  unparseable JSON → `{ verdict: 'indeterminate' }`.
- Maps to `verdict: 'document' | 'not_document' | 'indeterminate'` and attaches
  `detected_type`, `confidence`, `model`, `checked_at`.

Wire into `POST /api/kiosk/visitors/:id/id-photo` (`routes/kiosk.ts`): after
`uploadVisitorPhoto`, run `checkIdDocument`, stash in KV, and return
`{ id_photo_url, id_check }`. **Rate-limit** the endpoint (reuse `lib/rate-limit.ts`,
keyed per IP) since it triggers an AI call and is public. The check is best-effort: a
failure never fails the upload.

`POST /api/kiosk/check-in` (`KioskCheckInSchema` / `performCheckIn`): read+delete
`idcheck:${visitorId}` from KV and persist onto `visits.id_photo_check` (default
`indeterminate`).

### D. Verdict typing & helpers

In `lib/validation.ts` (or a small `lib/id-check.ts`): a Zod schema / TS type for
`IdCheckVerdict` and a parser that safely coerces the model's text output into it
(defensive — models return loose text). Unit-tested.

### E. Surfacing

- **Kiosk (real-time):** `KioskPage` keeps the `id_check` from the upload response in state.
  If `verdict === 'not_document'` **or** `detected_type` ≠ the visitor's declared `id_type`
  → show a subtle warning on the confirm/success screen: *"⚠ ID photo unclear — please
  verify."* Visitor still proceeds. `indeterminate`/`document` → no nag.
- **VMS (audit):** the visit detail (`VisitorDetailPage` / visit record) renders an "ID
  photo: verified / flagged / unverified" badge derived from `visits.id_photo_check`, near
  the existing ID photo. Read-only.

## Error handling & security

- **Never blocks check-in.** Every failure path (quality guard is client-only advisory at
  worst; AI timeout/error; KV miss) degrades to "proceed", with `indeterminate` recorded.
- **Server-authoritative verdict** (computed server-side, persisted via KV) — the client
  can't forge a "verified" flag onto the visit.
- **Rate-limited public endpoint** to cap AI spend / abuse.
- Photo size cap (`MAX_PHOTO_BYTES = 500_000`) already enforced before the AI call.
- **Honest limitation (must stay in the UI framing):** this is a *soft signal + audit
  trail*, not proof of authenticity. A determined person can still photograph a fake; the
  receptionist and the stored photo remain the real control.

## Testing

- **Unit:** `assessFrameQuality` (blank/dark/normal frames); the verdict parser (valid
  JSON, garbage text, partial JSON → `indeterminate`); type-mismatch → flagged logic.
- **API:** `checkIdDocument` with a mocked `env.AI.run` (document / not_document / throws /
  times out); the id-photo route returns `id_check` and stashes KV; check-in persists it
  and clears KV; rate-limit triggers.
- **Static:** api + web type-check; migration applies clean local + remote.
- **Manual (on-device, user-run):** photograph a real ID → no nag; photograph a blank
  surface → quality-guard retake; photograph a non-ID object → flagged nudge.

## Out of scope (YAGNI)

- Hard-blocking on the AI verdict (explicitly rejected).
- A third-party ID-authenticity / KYC vendor (possible future escalation; not now).
- Verifying the **face** photo is a real face (separate liveness concern; the existing
  insightface liveness is for clock-in, not the kiosk).
- Re-running the check on already-stored photos / backfilling old visits.
