# Returning-Visitor Fast Lane (Kiosk) Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

## Problem

Most daily volume is repeat traffic — couriers, suppliers, regulars. Each one
re-types name/phone/org at the kiosk. The kiosk should recognize a returning
visitor by phone number and prefill everything, cutting check-in from ~2
minutes to ~30 seconds.

**Privacy constraint (explicit):** a public phone→visitor lookup is an
enumeration vector. Mitigations: rate-limited like every kiosk endpoint
(40/60s per IP), returns only the fields the kiosk needs (no phone echo, no
visit history, no notes), and only for visitors with **≥1 completed prior
visit** (a raw name/phone pair that never checked in reveals nothing).

---

## Section 1 — Lookup Endpoint (API)

`GET /api/kiosk/visitor-by-phone?phone=<digits>` in `routes/kiosk.ts`:
- Same per-IP rate limit as the other kiosk routes.
- Normalize the input (strip spaces/dashes; accept +233/local forms — mirror
  the Ghana phone handling used at kiosk registration) and match against
  `visitors.phone` with the same normalization (`REPLACE` chain or normalized
  column if one exists — read the schema first).
- Found: `{ data: { id, first_name, last_name, organisation, photo_url } }`
  where the visitor has ≥1 visit with `status='checked_out'`; otherwise 404
  with the generic "not found" shape (same response whether the number is
  unknown or has no completed visit — no oracle).
- No audit entry (public read), but a devLog for abuse watching.

## Section 2 — Kiosk Flow (`KioskPage.tsx` — this workstream owns the page)

Welcome screen gains a third path: **"Been here before?"** → phone entry
screen (numeric pad style consistent with checkout-pin) → lookup:

- **Hit:** "Welcome back, <First name>" card (photo shown if `photo_url`),
  confirm "Is this you?" → proceeds to the EXISTING purpose → host → face
  photo → submit path, with identity fields locked to the matched visitor
  (no re-typing; the visitor id is submitted instead of creating a new
  visitor row — reuse the existing kiosk check-in endpoint's returning-
  visitor parameter if it has one, otherwise extend it minimally).
- **Miss:** "No record found — let's register you" → drops into the existing
  full form with the entered phone prefilled.
- All copy matches the kiosk's tone; no new dependencies.

## Section 3 — Host Availability in Kiosk (contract consumption)

The kiosk officer/directorate pickers now receive `availability_status`
(see `2026-07-19-host-availability-design.md`; values
`'available' | 'in_meeting' | 'out_of_office'`, NULL ⇒ available):

- Officer option rows show the green/amber/grey dot (same language as the
  reception combobox).
- Picking a non-available officer shows the kiosk's inline warning ("…is in a
  meeting — notify anyway?") — warn, never block.

If the availability workstream hasn't landed the column yet, code defensively
(field may be undefined ⇒ treat as available).

---

## Out of Scope

- OTP verification of the phone number (the kiosk is a physical lobby device;
  photo + ID gate stay as the identity proof).
- Fast lane at the reception CheckInPage (search already exists there).
- Delegation in the fast lane (reception-only for now).

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/routes/kiosk.ts` | `GET /visitor-by-phone` |
| `packages/web/src/pages/KioskPage.tsx` | fast-lane flow; availability dots/warning |
| `packages/web/src/lib/kioskApi.ts` | lookup call |
| `packages/web/src/lib/parse-…` (test) | phone normalization helper tests (web side) |

## Verification

- `tsc --noEmit` + `vitest run`; normalization + not-found-oracle tests.
- Prod: kiosk lookup on a known returning visitor → prefilled fast lane.
