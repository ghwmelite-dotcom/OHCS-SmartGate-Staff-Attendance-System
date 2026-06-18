# Stricter Kiosk Form: Required Fields + Host — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)

## Summary

The lobby kiosk's self-check-in form currently requires only first/last name; phone,
organisation, ID type, ID number, and purpose are optional, the face/ID photos are
skippable, and there is **no field for who/where the visitor is here to see**. For a
government-building VMS that's too weak a record. This tightens the kiosk to capture a
genuinely useful, contactable, attributable visit: require **phone, purpose,
directorate, host name, ID type, face photo, and ID photo**; add the missing **host /
directorate** capture; keep **organisation** and the **typed ID number** optional.
Enforced at both the web form and the API, via **kiosk-specific** schemas so the staff
flows are unaffected.

## Context

- Kiosk form lives in `packages/web/src/pages/KioskPage.tsx` (`visitorSchema` +
  the `form` mode). Current required: `first_name`, `last_name` only. The kiosk
  flow: form → face photo → ID photo → check-in. `finishCheckIn` sends only
  `{ visitor_id, purpose_raw }` — it captures **no** directorate or host today.
- The staff flow (`CheckInPage.tsx`) captures host (searchable officer picker +
  manual name) + directorate + smart purpose routing, writing
  `visits.host_officer_id` / `host_name_manual` / `directorate_id`. The kiosk reuses
  none of that.
- Kiosk API surface (`packages/api/src/routes/kiosk.ts`, public + rate-limited):
  `POST /visitors` (uses shared `CreateVisitorSchema`), photo uploads, `POST
  /check-in` (uses `KioskCheckInSchema`), `POST /check-out`. `/api/officers` and
  `/api/directorates` are **auth-gated** (not reachable from the unauthenticated
  kiosk).
- `PhotoCapture.tsx` always renders a "Skip Photo" button (via `onSkip`).
- Schemas in `packages/api/src/lib/validation.ts`: `CreateVisitorSchema` (shared by
  staff `/api/visitors`), `KioskCheckInSchema`, `KioskCheckOutSchema`.

## Decisions (resolved during brainstorming)

1. Required: `phone`, `purpose_raw`, `directorate_id`, host name (`host_name_manual`),
   `id_type`, face photo, ID photo. Optional: `organisation`, typed `id_number`.
2. Host capture = **directorate `<select>` + free-text host name** (NOT an officer
   picker) — avoids exposing the staff directory at a public kiosk; only a
   low-sensitivity directorate list is published.
3. Enforce with **kiosk-specific** schemas; the shared staff `CreateVisitorSchema`
   and the staff check-in keep their looser rules.
4. Photo "required" = the visitor must **capture** both photos in the flow (no skip).
   Server-side enforcement that a visit row has photos attached is **out of scope**
   (the kiosk is receptionist-supervised).

## Changes

### A. New public endpoint — `GET /api/kiosk/directorates`

In `packages/api/src/routes/kiosk.ts`, add a rate-limited (reusing `kioskRateLimit`)
GET that returns active directorates with **only** `id`, `name`, `abbreviation`
(no officer/PII data):

```sql
SELECT id, name, abbreviation FROM directorates WHERE is_active = 1 ORDER BY name;
```

It is mounted with the other kiosk routes (before `authMiddleware`).

### B. API validation — kiosk-specific schemas (`lib/validation.ts`)

- **New `KioskCreateVisitorSchema`** (used by `POST /api/kiosk/visitors` instead of
  the shared `CreateVisitorSchema`):
  - `first_name`, `last_name`: required (min 1, max 100).
  - `phone`: **required**, Ghana format `^(\+233|0)\d{9}$` (no empty allowed).
  - `id_type`: **required** (`idTypeSchema`).
  - `organisation`: optional (`max 200`, or empty).
  - `id_number`: optional (`max 50`, or empty).
- **Tighten `KioskCheckInSchema`**: make `directorate_id` (min 1), `host_name_manual`
  (min 1, max 100), and `purpose_raw` (min 1, max 500) **required** (keep
  `visitor_id`, `idempotency_key`). `host_officer_id` is no longer relevant to the
  kiosk (host is free-text) — drop it from the kiosk schema.
- The shared `CreateVisitorSchema` and the staff `CheckInSchema` are **unchanged**.
- `routes/kiosk.ts`: `POST /visitors` switches its `zValidator('json', ...)` to
  `KioskCreateVisitorSchema`; `POST /check-in` continues using the tightened
  `KioskCheckInSchema` and passes `directorate_id` + `host_name_manual` +
  `purpose_raw` through to `performCheckIn`.

### C. `PhotoCapture` — `required` prop

Add `required?: boolean` (default `false`) to `PhotoCaptureProps`. When `true`, the
"Skip Photo" button is not rendered (and the existing-photo "Continue/Skip" path is
not offered). Staff `CheckInPage` usage is unchanged (omits the prop → skippable).

### D. Kiosk form (`KioskPage.tsx`)

- Extend `visitorSchema` (the client zod): `phone` required (Ghana format, no empty);
  `purpose_raw` required (min 1); `id_type` required; add `directorate_id` required
  (min 1) and `host_name` required (min 1, max 100); `organisation` + `id_number`
  stay optional.
- Fetch directorates via a new `kioskApi.getDirectorates()` when entering the `form`
  mode; render a required **Directorate** `<select>` and a required **Host / who
  you're visiting** text input. Remove the `(optional)` labels from now-required
  fields; mark required fields; show inline errors.
- `onSubmitForm` → `kioskApi.createVisitor({ first_name, last_name, phone,
  organisation, id_type, id_number })`. Stash `directorate_id` + `host_name` +
  `purpose_raw` in state for check-in.
- Face + ID `PhotoCapture` steps pass `required` (no skip).
- `finishCheckIn` → `kioskApi.checkIn({ visitor_id, directorate_id,
  host_name_manual: host_name, purpose_raw })`.
- Photo uploads stay best-effort but a failure surfaces a visible error/retry rather
  than silently proceeding.

### E. `kioskApi.ts`

- Add `getDirectorates(): Promise<KioskDirectorate[]>` (GET; unauthenticated) with a
  `KioskDirectorate = { id: string; name: string; abbreviation: string }` type.
- `checkIn` body type already accepts the extra fields (`Record<string, unknown>`).

## Error handling & security

- The new endpoint is public, rate-limited, and returns no officer/PII data — only
  directorate id/name/abbreviation (already effectively public via routing/badges).
- Both layers validate; the API is authoritative — a crafted request cannot check in
  without `directorate_id` + `host_name_manual` + `purpose_raw`, nor create a kiosk
  visitor without `phone` + `id_type`.
- Staff flows are untouched (separate schemas; `PhotoCapture` default skippable).
- Required photos are enforced as in-flow capture (no skip); server-side
  photo-presence enforcement is intentionally out of scope.

## Testing

- **API unit (vitest):** `KioskCreateVisitorSchema` rejects missing/empty `phone` and
  missing `id_type`, accepts a valid payload; `KioskCheckInSchema` rejects missing
  `directorate_id`/`host_name_manual`/`purpose_raw`. (Pure schema `.safeParse` tests.)
- **API static:** type-check; confirm `routes/kiosk.ts` uses the kiosk schemas and the
  directorates endpoint returns the three fields.
- **Web:** type-check + production build; update the headless kiosk E2E
  (`webapp-testing`) to fill the new required fields (directorate, host, phone,
  id_type) and assert the photo steps have no Skip button.
- **Manual (on-device):** the no-skip face+ID capture flow on the tablet.

## Out of scope (YAGNI)

- An officer picker / public officer directory (decided against — directorate + free
  text).
- Server-side enforcement that a visit has photos attached.
- Tightening the staff (`/api/visitors`, staff check-in) requirements — kiosk-only.
- Smart purpose→directorate routing on the kiosk (staff-flow feature; not required).
