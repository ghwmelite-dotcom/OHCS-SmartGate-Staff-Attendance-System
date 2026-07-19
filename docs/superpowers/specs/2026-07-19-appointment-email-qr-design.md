# Appointment Confirmation Email QR + Kiosk Scan Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

## Problem

A confirmed visitor arrives holding the confirmation email, then types a
6-character reference code into the kiosk by hand — slow, error-prone, and a
queue former at reception. The email should carry a scannable QR; the kiosk
should scan it off the visitor's phone screen and go straight to the confirm
screen. Zero typing.

**Constraints:** the QR must render in real email clients (Outlook/Gmail block
SVG and external images by default); QR generation must run inside the
Cloudflare Worker (no canvas); no schema changes; no new public endpoints.

---

## Section 1 — Email-Safe QR (API)

### `packages/api/src/services/qr-html.ts` (new)

Email clients reliably render HTML tables. A QR code is a grid of modules —
render it as a borderless `<table>` of 2×2 px cells, black/white, inline
styles only. This works in Outlook, Gmail, Apple Mail, and phone clients with
images disabled (it isn't an image).

- Uses `QRCode.create(payload, { errorCorrectionLevel: 'M' })` from the
  `qrcode` package (pure JS matrix — runs in Workers; only the canvas renderers
  need a browser). Add `qrcode` to `packages/api` dependencies (same version as
  `packages/web`, `^1.5.x` — check and match).
- Export `qrTableHtml(payload: string, modulePx = 3): string` — returns the
  table HTML. Cells: `width:${px}px;height:${px}px;background:#111` or `#fff`;
  include the built-in quiet zone (matrix margin 2 modules).
- Unit test: deterministic payload → table has `size` rows/cols, contains both
  cell colors, and never includes `http` URLs or image tags.

### Payload

The QR encodes the **bare reference code** (6 chars, `REF_CHARSET`). Rationale:
the kiosk scanner is the only intended reader; a bare code keeps the parser
trivial and the QR matrix small (better print/email rendering). A visitor who
scans it with their own camera sees the code as text — still useful.

### `packages/api/src/services/email.ts`

`appointmentConfirmedHtml` gains, directly under the reference-code table, a
centered QR block:

- `qrTableHtml(i.referenceCode)` wrapped in a white padded card (border +
  radius matching the existing card language)
- Caption under it: "Show this code at the reception kiosk — no typing needed."
- `appointmentConfirmedText` unchanged (plain text can't carry a QR; it already
  has the ref code).

Declined email untouched.

---

## Section 2 — Kiosk Scan Mode (web)

`packages/web/src/pages/KioskPage.tsx`, `mode === 'appointment'` screen
(`KioskPage.tsx:572`): add a **"Scan QR instead"** button beside the typed
lookup. Tapping opens the existing `QrScanner` component
(`packages/web/src/components/QrScanner.tsx` — already used for badge checkout
on this page's `checkout-scan` mode).

New tiny helper `parseAppointmentRef(raw: string): string | null`:
- bare 6-char code from `REF_CHARSET` → uppercase, return
- URL containing `ref=<code>` query param → extract (forward-compatible if the
  payload ever becomes a URL)
- anything else → null (show "Not an appointment QR — try typing the code")

On a successful decode: `setApptRef(code)` and immediately run the existing
lookup path (same fetch to `/api/appointments/public/ref/<code>` →
`appointment-confirm`). No API changes — scan and type converge on the same
flow. Unit test for `parseAppointmentRef` (jsdom, alongside existing web tests).

Camera note: the kiosk tablet already grants camera permission for face/ID
capture (`docs/ops/lobby-kiosk-setup.md`), so no new device setup.

---

## Files Touched

| File | Change |
|------|--------|
| `packages/api/package.json` | Add `qrcode` dependency (match web version) |
| `packages/api/src/services/qr-html.ts` | New — email-safe table QR |
| `packages/api/src/services/qr-html.test.ts` | New |
| `packages/api/src/services/email.ts` | QR block in confirmed-appointment email |
| `packages/web/src/pages/KioskPage.tsx` | "Scan QR instead" path in appointment mode |
| `packages/web/src/lib/parse-appointment-ref.ts` + test | New — payload parser |

## Verification

- `tsc --noEmit` + `vitest run` in both packages.
- Manual: confirm an appointment with a real email, open on phone, scan at
  kiosk → lands on `appointment-confirm` with details prefilled.
