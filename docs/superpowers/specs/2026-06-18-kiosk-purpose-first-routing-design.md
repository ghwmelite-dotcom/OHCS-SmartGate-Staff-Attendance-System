# Kiosk Purpose-First Auto-Routing — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Builds on:** kiosk VMS form parity (PR #7), reception-officer routing (PR #9/#11). Frontend-only.

## Summary

The kiosk check-in form lists **Purpose of Visit last** and treats Directorate as a manual dropdown
picked first; a purpose→directorate **hint** exists but sits under the (last) Purpose field and only
*suggests* (tap-to-Accept). That's backwards from the VMS staff form, where stating the purpose
**drives** the routing. This reorders the kiosk to **purpose-first** and makes typing the purpose
**auto-select the Directorate** (via the existing keyword matcher), which in turn auto-fills the
"You'll be received by `<officer>`" reception officer and the check-in routing — no extra tap. The
Directorate dropdown stays visible/editable as confirm-or-override and as the fallback when the
wording matches no keyword. Frontend-only; no API, schema, or routing-logic change.

## Decisions (resolved during brainstorming)

1. **Keyword auto-fill** (the existing `suggestDirectorate` map) — instant, no AI call. (AI-assisted
   routing considered and deferred.)
2. **Purpose-first ordering**, with Directorate directly below it.
3. **Don't clobber a manual choice**: auto-fill the Directorate only when it's currently empty —
   identical to the VMS guard.
4. Directorate + Purpose both stay **required**; the dropdown stays editable.

## Context (verified — `packages/web/src/pages/KioskPage.tsx`)

Current `form` mode order: First/Last name → Phone → Organisation → **Directorate** `<select>`
(`form.register('directorate_id')`) → "You'll be received by …" line (from
`directorates.find(...).reception_officer_name`) → **Who are you visiting? (optional)** (`host_name`)
→ `SmartIdFields` → **Purpose of Visit** textarea (`form.register('purpose_raw')`, last) →
`PurposeRoutingHint` (already imported; `onAccept={(id) => form.setValue('directorate_id', id)}`).
`suggestDirectorate(purpose, directorates)` is exported from `packages/web/src/lib/directorate-routing.ts`
but is **not** currently called in `KioskPage` (only `PurposeRoutingHint` is imported). The VMS
`CheckInPage` already does the target behaviour: its purpose textarea `onChange` runs
`suggestDirectorate` and `setValue('directorate_id', suggestion.id)` when the directorate is empty,
plus renders `PurposeRoutingHint`.

## Changes (one file: `KioskPage.tsx`)

### A. Reorder the `form` mode fields
New order inside the form card:
1. First Name / Last Name (2-col grid) — unchanged.
2. Phone — unchanged.
3. Organisation (optional) — unchanged.
4. **Purpose of Visit** (moved up) + **`PurposeRoutingHint`** directly beneath it.
5. **Directorate** `<select>` + the **"You'll be received by …"** line directly beneath it.
6. **Who are you visiting? (optional)** (`host_name`).
7. **ID Type** (`SmartIdFields`).

(So the only moves are: Purpose block + its hint relocate to position 4; Directorate + received-by
line stay as a unit at position 5. Host and ID follow.)

### B. Auto-select the directorate as the purpose is typed
Change the Purpose textarea registration to add an `onChange` that mirrors the VMS:
```tsx
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
```
- Import `suggestDirectorate` from `@/lib/directorate-routing` (alongside the existing
  `PurposeRoutingHint` import).
- `directorates` is the already-fetched `KioskDirectorate[]` state. `suggestDirectorate` reads only
  `id`/`name`/`abbreviation`, which `KioskDirectorate` has (it's a `DirectorateOption`).
- The **guard `!form.getValues('directorate_id')`** means auto-fill fires only when the visitor
  hasn't chosen/auto-gotten a directorate yet — it never overwrites a manual selection or thrashes
  on every keystroke once set. (To re-route after an auto-fill, the visitor uses the dropdown or the
  hint's "Accept".)

### C. Unchanged
- `PurposeRoutingHint` keeps its `onAccept={(id) => form.setValue('directorate_id', id)}` (lets the
  visitor switch to a freshly-suggested directorate even after one is set).
- The "received by `<reception_officer_name>`" line is unchanged — it reacts to `directorate_id`, so
  it lights up automatically when the auto-fill sets the directorate.
- `visitorSchema` (Purpose + Directorate required), `finishCheckIn`, the photo/checkout flow, and all
  API calls are untouched. No `directorate_id` is sent that wasn't already.

## Error handling & edge cases

- **No keyword match** → directorate stays empty → the visitor picks it from the (required) dropdown.
  Graceful; nothing breaks.
- **Manual pick then typing** → guard prevents overwrite.
- **Directorates still loading** (`directorates` empty) → `suggestDirectorate` returns null → no-op;
  fills once the list arrives and the visitor edits the purpose, or the visitor picks manually.
- **Empty/short purpose** → `suggestDirectorate` returns null for <3 chars (existing behaviour).

## Testing

- `suggestDirectorate` is already unit-tested (`lib/directorate-routing.test.ts`) — no new pure logic.
- **Static:** web type-check + production build.
- **Headless render (verify skill):** load the live/preview kiosk, type a purpose that matches a
  keyword (e.g. "salary enquiry" → RSIMD, or "submit documents" → REGISTRY), assert the Directorate
  `<select>` auto-selects and "You'll be received by …" appears; confirm field order
  (Purpose above Directorate); confirm a manual directorate pick isn't overwritten by subsequent
  typing.

## Out of scope (YAGNI)

- AI-assisted free-text routing (deferred; keyword map only).
- Changing the keyword map (`ROUTING_KEYWORDS`) — separate concern.
- Any change to the VMS staff form (it already behaves this way) or the API.
- Auto-selecting a specific officer beyond the directorate's configured primary (routing is
  directorate → its reception team, unchanged).
