# Kiosk ⇄ VMS Form Parity — Design (Sub-project A)

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Sibling:** `2026-06-18-kiosk-id-photo-verification-design.md` (build this one first)

## Summary

The lobby kiosk self-check-in form (`packages/web/src/pages/KioskPage.tsx`) is a
single flat `max-w-md` card with plain labels and a native ID-type dropdown. The VMS
staff check-in form (`packages/web/src/pages/CheckInPage.tsx`) is a polished, multi-step
experience: `FieldWrapper` (icon + label), ID type as **pill buttons**, a **purpose →
directorate routing hint**, a step indicator, styled photo screens, and a richer success
screen. This sub-project makes the kiosk **adopt the VMS visual + interaction design
language** — by **extracting the VMS form's reusable building blocks into shared
components** that both pages consume, so they look like one family and cannot drift apart.

It is **frontend-only**: no API, schema, or DB change.

## Context

- Kiosk flow (modes in `KioskPage.tsx`): `welcome → form → face → id → submitting →
  success`, plus a `checkout-scan → checkout-confirm → checkout-done` branch. Required
  fields already enforced (phone, directorate, host_name, id_type, purpose, both photos
  non-skippable). Host is **free text**; directorate is a **dropdown**; there is **no
  visitor search** and **no officer picker** — these are deliberate public-kiosk PII
  decisions and stay.
- VMS `CheckInPage.tsx` defines, **locally**, the components we want to share:
  `FieldWrapper`, `SmartIdFields` (ID-type pill grid + conditional ID-number field with
  hint), `PurposeRoutingHint`, a step indicator, and uses a `suggestDirectorate(purpose,
  directorates)` keyword router. The kiosk currently duplicates none of these.
- Shared `PhotoCapture` (`packages/web/src/components/PhotoCapture.tsx`) already supports
  `required`, `facingMode`, `mirror`, `title` — both pages use it.

## Decisions (resolved during brainstorming)

1. **Visual/interaction parity, kiosk-safe data** — adopt the VMS look & feel, but keep
   the kiosk's safer rules: no visitor search, no officer picker (free-text host),
   required fields stay required.
2. **Share, don't duplicate** — lift the reusable VMS building blocks into
   `packages/web/src/components/checkin/` and a shared util; both `CheckInPage` and
   `KioskPage` import them. This is the mechanism that makes the forms genuinely match and
   prevents future drift.
3. **Keep kiosk touch ergonomics** — adopt the VMS visual language but keep larger touch
   targets on the kiosk (≈`h-12` inputs / `h-14` primary buttons) since it's a lobby
   tablet. Shared components are layout/structure; each page passes its own input sizing
   via `className`, so the VMS keeps its `h-10` density and the kiosk gets touch sizing.

## Architecture: shared check-in components

Extract from `CheckInPage.tsx` into new files (presentation-only, parameterised by props;
no business logic, no data fetching inside them):

- `packages/web/src/components/checkin/FieldWrapper.tsx`
  `({ icon?, label, error?, hint?, children })` → renders icon+label row, `children`
  (the caller's `<input>/<select>/<textarea>` with its own size class), optional hint,
  and error text. Layout only — no sizing opinion on the control itself.
- `packages/web/src/components/checkin/SmartIdFields.tsx`
  `({ idType, idNumber, onIdTypeChange, onIdNumberChange, idTypeError?, idNumberError? })`
  → the ID-type **pill-button grid** (`grid-cols-2 sm:grid-cols-3`, selected =
  `bg-primary/10 border-primary/30 text-primary`) plus the conditional ID-number input
  with per-type placeholder/hint. Pills use touch-comfortable height (`h-11`) that suits
  both pages.
- `packages/web/src/components/checkin/PurposeRoutingHint.tsx`
  `({ purpose, directorates, currentDirectorateId, onAccept })` → the "Suggested: ABBR —
  Name (room) [Accept]" / "Routing to ABBR" hint. Moved verbatim.
- `packages/web/src/components/checkin/StepIndicator.tsx`
  `({ steps: {key,label}[], currentIdx })` → the numbered/checkmark progress row.
- `packages/web/src/lib/directorate-routing.ts`
  Export `suggestDirectorate(purpose, directorates)` (move from its current location in
  `CheckInPage`/utils). Pure function; unit-testable.

`CheckInPage.tsx` is refactored to import these instead of defining them locally — **no
visual change to the VMS form** (same markup, now sourced from shared files). This is a
targeted refactor in service of the goal, not a rewrite.

## Kiosk form changes (`KioskPage.tsx`)

Keep the existing mode state machine, the `visitorSchema`, all required-field rules, the
checkout branch, `BADGE_BASE`/QR behaviour, and the create→photo→photo→check-in data flow.
Restyle only:

- **`form` mode** → VMS card system (`bg-surface rounded-xl border border-border
  shadow-sm`, section heading `h2 text-lg font-semibold` + muted subtext). Replace flat
  labels with `FieldWrapper` (icons: `User`, `Phone`, `Briefcase`, `Building2`).
- **ID type** → `SmartIdFields` pill buttons (replacing the native `<select>`), wired to
  the existing `id_type` / `id_number` form fields. Keep `id_number` optional.
- **Purpose** → textarea inside `FieldWrapper`; on change, run `suggestDirectorate` and
  render `PurposeRoutingHint` so a visitor can accept a directorate suggestion. Directorate
  `<select>` stays as the explicit control.
- **Step indicator** at the top of the check-in flow: `Details → Photo → ID → Done`
  (visitor-friendly labels), driven by the current mode.
- **`face` / `id` modes** → wrap `PhotoCapture` in the VMS `rounded-2xl border shadow-sm
  p-6` card with `h2` heading + subtext (e.g. "Take your photo", "Photograph your ID").
  `required` stays; no behaviour change.
- **`success` mode** → match the VMS success styling (success check circle, badge chip,
  `KioskBadgeQr`, Done button), kept within kiosk sizing.
- **Touch sizing**: kiosk keeps its larger control classes (define a kiosk `fieldCls` with
  `h-12`; primary buttons `h-14`). Passed via `className` into the shared components'
  `children`.

Unchanged: `welcome`, all three `checkout-*` modes (restyle optional/light only),
host = free-text input, directorate = dropdown, no search, no officer picker.

## Error handling

Inline field errors via `FieldWrapper`'s `error` slot (same pattern both pages).
Directorate-fetch failure on the kiosk stays graceful (empty list; reception assists),
as today.

## Testing

- **Unit:** `suggestDirectorate` keyword routing (move/keep its tests); `SmartIdFields`
  renders pills and toggles selection; `StepIndicator` marks the right current/done states.
- **Static:** web type-check; production build.
- **Regression:** `CheckInPage` renders identically after importing the shared components
  (manual visual check + existing VMS flow still works).
- **Kiosk render:** the `form` step shows pill ID type, purpose hint, step indicator, and
  the redesigned cards; required-field validation still blocks submit.

## Out of scope (YAGNI)

- Any API/DB/schema change (none needed).
- Visitor search or an officer picker on the kiosk (deliberately excluded — PII).
- Changing the kiosk's required-field rules or the checkout flow's logic.
- ID-photo verification — that is sub-project B.
