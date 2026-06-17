# SmartGate Visitor Self-Service Kiosk + Badge Fixes — Design

**Date:** 2026-06-17
**Status:** Approved (pending implementation plan)

## Summary

Four coordinated changes to the SmartGate VMS, centered on a password-free lobby
**kiosk** for visitor self-check-in:

- **A.** A new `visitor` role plus a public `/api/kiosk/*` API surface and a `/kiosk`
  web route that let a visitor fill the check-in form with no staff login.
- **B.** The identity step captures **two photos** — the visitor's face (front camera)
  and their ID document (rear camera) — keeps the ID-type dropdown, and makes the
  ID-number field optional.
- **C.** Checkout opens a **QR scanner**; scanning the visitor's badge QR matches the
  visit, shows the visitor for confirmation, then checks them out.
- **D.** Fix the bug where the visitor's photo does not display on the generated badge.

## Context (current state)

- **Stack:** Hono v4 API on Cloudflare Workers (D1 SQLite, KV sessions, R2 photo
  storage, Workers AI); React 18 + React Router 7 + TanStack Query + Zustand web app;
  Vite build. Zod validation with `@hono/zod-validator`.
- **Roles today:** `superadmin`, `admin`, `receptionist`, `it`, `director`, `staff`,
  `f_and_a_admin` (see `packages/api/src/lib/require-role.ts`). Auth is PIN-based or
  email-OTP, session in KV via `session_id` cookie / Bearer token.
- **Check-in today:** `packages/web/src/pages/CheckInPage.tsx` — a staff-authenticated
  flow: search existing visitor → optional new-visitor form → single face photo
  (`PhotoCapture.tsx`, front camera) → assign host/purpose. Submits to
  `POST /api/visitors` and `POST /api/visits/check-in`.
- **Photos today:** `PhotoCapture.tsx` uses `getUserMedia` (front camera), uploads raw
  JPEG to `POST /api/photos/visitors/:id/photo` → stored in R2 at
  `photos/visitors/{id}.jpg`, served from auth-gated `GET /api/photos/visitors/:id`,
  path saved in `visitors.photo_url`.
- **Badge today:** `GET /badge/:code` (public, in `packages/api/src/routes/badges.ts`)
  server-renders an HTML badge with a QR code (`qrcode-generator` CDN) encoding the badge
  URL. The badge `<img>` points at `/api/photos/visitors/{id}` — **which requires auth**,
  so the photo silently fails to load on the public badge. **This is the root cause of
  the "photo not showing" bug.**
- **Checkout today:** `BadgeCheckoutPage.tsx` takes a manually-typed badge code, fetches
  the badge, and on "Confirm Check Out" calls `POST /api/visits/:id/check-out`. There is
  **no QR scanner**; no QR-decoding library is installed (only QR generation: `qrcode`).
- **Visits/visitors schema:** `packages/api/src/db/schema.sql`. `visits` has
  `badge_code` (unique, `SG-{timestamp}{random}`), `status`
  (`checked_in`|`checked_out`|`cancelled`), `check_in_at`/`check_out_at`,
  `created_by` → `users(id)`, `idempotency_key`. `visitors` has `photo_url`, `id_type`
  (`ghana_card`|`passport`|`drivers_license`|`staff_id`|`other`), `id_number`.

## Decisions (resolved during brainstorming)

1. **Self-check-in mode:** Reception **kiosk** — a public, rate-limited route on a shared
   lobby tablet. No per-visitor login.
2. **ID capture:** **Two photos** (face + ID), **keep** the ID-type dropdown, **make
   ID-number optional**.
3. **Checkout:** **Scan → confirm** — scan shows matched visitor, then one tap confirms.
4. **Badge photo fix:** **Public badge-scoped photo endpoint** (`/api/badges/:code/photo`),
   not base64 embedding.

## Architecture

### A. `visitor` role + public kiosk surface

- Add `'visitor'` to the TS `Role` union and to the `users.role` CHECK constraint so it
  is a first-class, documented role.
- The kiosk requires **no password**. Mount a narrow public route group `/api/kiosk/*`
  **before** the auth middleware. It exposes only:
  - `POST /api/kiosk/visitors` — create a visitor (no search/list).
  - `POST /api/kiosk/visitors/:id/photo` — upload face photo.
  - `POST /api/kiosk/visitors/:id/id-photo` — upload ID photo.
  - `POST /api/kiosk/check-in` — check in (creates the visit + badge).
  - `GET /api/kiosk/badge/:code` — fetch own badge for display (or reuse the existing
    public badge route).
  - `POST /api/kiosk/check-out` — check out by scanned `badge_code`.
- **Rate limiting:** every `/api/kiosk/*` route is per-IP rate-limited using the existing
  KV rate limiter (conservative limits to deter abuse of the public surface).
- **Attribution:** seed a system `kiosk` user; kiosk-created visits set
  `created_by = kiosk user id` and `check_in_source = 'kiosk'`.
- **Privacy guard:** the kiosk does **not** expose the existing visitor search/list
  (that would leak all visitor PII at a public terminal). The kiosk always uses the
  new-visitor path; de-duplication by phone happens silently server-side and is never
  surfaced to the kiosk client.

### B. Identity step — face + ID photos

- Generalize `PhotoCapture` to accept a `facingMode` prop (`'user'` for face,
  `'environment'` for the ID document) and an optional label/instruction.
- New kiosk **Identity** step order: **Face photo** (front cam) → **ID photo** (rear cam)
  → ID-type dropdown (optional) → ID-number (optional).
- Storage: new R2 key `photos/visitors/{id}-id.jpg`; new column `visitors.id_photo_url`;
  new upload endpoints (kiosk + a staff-side equivalent for the existing CheckInPage).
  Reuses the existing 500 KB limit and JPEG 0.85 capture pipeline.
- The staff `CheckInPage` identity section is updated in parallel so face+ID capture is
  consistent across kiosk and staff flows.

### C. Checkout via QR scan

- Add **`jsqr`** (small, pure-JS, canvas-frame decoder) to the web package.
- New `QrScanner` component: opens the rear camera (`facingMode: 'environment'`), scans
  frames on `requestAnimationFrame`, decodes the badge QR. The QR encodes the badge URL,
  so the component **parses the `SG-…` badge code out of the decoded URL** (tolerant of
  full-URL or bare-code payloads).
- Flow: **Check Out** → camera opens → QR found → fetch badge by code → display matched
  **name / photo / host / organisation** → **Confirm Check Out** → `POST /api/kiosk/check-out`
  (public, by `badge_code`) on the kiosk, or the existing authed checkout on staff side.
- **Fallbacks:**
  - Camera permission denied or unavailable → fall back to manual badge-code entry
    (preserves today's behavior).
  - QR unreadable after a timeout → "Couldn't read the code — try again or enter it
    manually."
  - Already checked out / unknown / cancelled code → clear, specific error message.

### D. Badge photo fix

- New public route `GET /api/badges/:code/photo`: resolve the visit by `badge_code`, look
  up the visitor's `photo_url` R2 key, and stream the JPEG (with the same
  `Cache-Control: public, max-age=3600`). Returns 404 for unknown/invalid codes. Only a
  valid, unguessable badge code (`SG-{timestamp}{random}`) yields a photo — no visitor-ID
  enumeration.
- Update the badge HTML template in `badges.ts` so `<img>` points at
  `/api/badges/:code/photo` instead of the auth-gated `/api/photos/visitors/:id`. Apply
  the same fix anywhere a public/badge view renders the photo.
- The auth-gated `GET /api/photos/visitors/:id` endpoint is left unchanged for staff use.

## Data model changes (one new migration)

`packages/api/src/db/migration-kiosk-visitor.sql` (name TBD at plan time):

- `ALTER TABLE visitors ADD COLUMN id_photo_url TEXT;`
- `ALTER TABLE visits ADD COLUMN check_in_source TEXT NOT NULL DEFAULT 'staff';`
  (values: `'staff'` | `'kiosk'`)
- Update the `users.role` CHECK constraint to include `'visitor'` (SQLite requires a
  table rebuild or a documented constraint-relaxation approach — handled in the
  migration; follow the pattern used by existing role-related migrations).
- Seed a system `kiosk` user (role `visitor`) for `visits.created_by` attribution.

## API contracts (new/changed)

- `POST /api/kiosk/visitors` → body: visitor fields (first/last name required, phone,
  email, organisation, id_type, id_number all optional). Returns `{ id, ... }`. Public,
  rate-limited.
- `POST /api/kiosk/visitors/:id/photo` and `.../id-photo` → raw JPEG body, ≤500 KB.
  Public, rate-limited. Stores to R2 and sets `photo_url` / `id_photo_url`.
- `POST /api/kiosk/check-in` → body: `visitor_id`, optional host/directorate/purpose.
  Creates the visit + badge, sets `check_in_source='kiosk'`, `created_by=kiosk`. Public,
  rate-limited, idempotency-key supported.
- `POST /api/kiosk/check-out` → body: `badge_code`. Validates visit is `checked_in`,
  sets `checked_out` + duration. Public, rate-limited.
- `GET /api/badges/:code/photo` → streams visitor photo for a valid badge code. Public,
  rate-limited, cached.

All bodies validated with Zod schemas in `packages/api/src/lib/validation.ts`. SQL uses
prepared/parameterized statements only.

## Error handling & security

- All `/api/kiosk/*` and `/api/badges/:code/photo` routes: Zod validation + per-IP rate
  limiting via the existing KV limiter; no list/search/enumeration exposure.
- Public read access is gated by the unguessable badge code, never by raw visitor ID.
- Camera failures degrade gracefully: manual badge-code entry (checkout), retake/skip
  guidance (capture).
- `prefers-reduced-motion` respected for any kiosk transitions/animations; touch targets
  ≥44px and AA contrast on the kiosk UI (lobby tablet, glance-and-tap usage).

## Testing

- **Unit:** badge-URL → `SG-…` code parsing; kiosk check-in and check-out endpoint logic
  (status transitions, idempotency, source attribution); badge-photo resolution by code
  (valid vs unknown). Confirm the repo's existing test runner/setup during planning and
  match it.
- **Manual (via `webapp-testing` skill):** kiosk happy path — fill form → face photo →
  ID photo → badge renders **with visible photo** → scan badge → confirm → checked out.
  Plus negative paths: camera denied, unreadable QR, already-checked-out code.

## Out of scope (YAGNI)

- Per-visitor login accounts / passwords (kiosk is anonymous + rate-limited).
- OCR / automatic data extraction from the ID photo.
- Visitor self-checkout from their personal phone (kiosk-only for now).
- Printing hardware integration (badge remains screen/QR; printing is the operator's
  choice via the browser).
