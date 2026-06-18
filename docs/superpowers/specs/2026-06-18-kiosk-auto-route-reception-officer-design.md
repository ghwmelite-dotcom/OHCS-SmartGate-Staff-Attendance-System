# Kiosk Auto-Route to Directorate Reception Officer — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)

## Summary

The VMS staff check-in connects a visitor to a **host officer**, and `performCheckIn` notifies
that officer ("your visitor has arrived") via Telegram/push. The kiosk self-check-in **lost this**:
it records a free-text host name only, so `host_officer_id` is null and **no officer is ever
notified of a kiosk arrival**. This restores the connection without exposing a browsable staff
directory: each directorate gets an admin-designated **reception officer**, and a kiosk visitor who
selects a directorate is **auto-routed** to that officer — who is set as the visit's host and
notified. The visitor never browses officers; the server derives the officer from the directorate.

## Context

- Kiosk check-in (`packages/api/src/routes/kiosk.ts` `/check-in` → `performCheckIn`) passes
  `host_name_manual` (free text) and no `host_officer_id`. `performCheckIn`
  (`services/check-in.ts`) only fires `notifyOnCheckIn(...)` **when `host_officer_id` is set** — so
  kiosk arrivals notify nobody.
- The VMS form (`CheckInPage`) routes purpose→directorate (`suggestDirectorate` keyword hint, already
  shared) and the receptionist picks the host officer via a searchable picker. We deliberately
  excluded that picker from the public kiosk (PII). This design keeps that exclusion — admins
  pre-designate one reception officer per directorate; the visitor never sees a directory.
- `directorates.head_officer_id` exists but is **dormant** (nothing reads/writes it). We add a
  purpose-built field rather than overload "head" (OHCS routing treats the head as a fallback, not
  the default receiver).
- `officers` have `telegram_chat_id` + push subscriptions; `notifyOnCheckIn` already targets them.
- The kiosk public directorate list (`GET /api/kiosk/directorates`) currently returns
  `id, name, abbreviation` only.

## Decisions (resolved during brainstorming)

1. **New `directorates.reception_officer_id`** (admin-set), not `head_officer_id` reuse, not an
   officer-level flag.
2. The kiosk **shows** the visitor "You'll be received by <name>" after they pick a directorate
   (exposes only the single designated reception contact's name — not a browsable list).
3. The reception officer is recorded as the visit's **host** (`host_officer_id`) and notified; any
   typed "specific person" name is kept as `host_name_manual` (context note).
4. **Server-derived** routing — the kiosk never sends an officer id; the server resolves it from the
   submitted `directorate_id`. Never blocks check-in.

## Changes

### A. DB migration — `directorates.reception_officer_id`

`packages/api/src/db/migration-reception-officer.sql`:
```sql
-- Officer who receives kiosk visitors routed to this directorate (auto-set as the
-- visit host + notified). Nullable: unconfigured directorates fall back to manual handling.
ALTER TABLE directorates ADD COLUMN reception_officer_id TEXT REFERENCES officers(id);
```
Add the column to `schema.sql` (`directorates` table) and register the migration in
`db/migrations-index.ts`. Apply local; remote at deploy (confirmed).

### B. Admin setup — designate the reception officer

- **API** (`routes/admin-directorates.ts`): extend the directorate update handler to accept
  `reception_officer_id: string | null` (validated: when non-null, the officer must exist **and
  belong to that directorate**; null clears it). Reject an officer from a different directorate with
  a 400.
- **Web** (the directorate admin editor): add a **Reception Officer** `<select>` populated with that
  directorate's own officers (plus a "— none —" option). Wire it to the update call. (The directorate
  admin screen already lists/edits directorates + officers; this adds one field.)

### C. Kiosk public directorate list — include the receiver's display name

`GET /api/kiosk/directorates` returns an added **`reception_officer_name: string | null`** (a single
display name via `LEFT JOIN officers`), e.g.:
```sql
SELECT d.id, d.name, d.abbreviation, o.name AS reception_officer_name
FROM directorates d
LEFT JOIN officers o ON d.reception_officer_id = o.id
WHERE d.is_active = 1 ORDER BY d.name;
```
No officer id, contact, or any other officer is exposed — only the one receiver's name.

### D. Kiosk form (`KioskPage.tsx` + `kioskApi.ts`)

- `KioskDirectorate` type gains `reception_officer_name: string | null`.
- The **"Who are you visiting?"** field becomes **optional** (drop from the required schema). Relabel
  to e.g. "Who are you visiting? (optional)".
- After a directorate is selected, render **"You'll be received by <reception_officer_name>"** when
  present (a small confirmation line near the directorate field); show nothing if the directorate has
  no configured receiver.

### E. Kiosk check-in — server resolves + routes (`routes/kiosk.ts`, `services/check-in.ts`)

- In the kiosk `/check-in` handler, after validating the body, look up the directorate's receiver:
  `SELECT reception_officer_id FROM directorates WHERE id = ?` (bind `body.directorate_id`).
- Pass `host_officer_id = <resolved reception_officer_id or null>` into `performCheckIn` alongside the
  existing `host_name_manual` (the typed note) and `id_photo_check`. `performCheckIn` already INSERTs
  `host_officer_id` and fires `notifyOnCheckIn` when it's set — **no change to the notify logic**.
- The visit's displayed host resolves to the officer (existing `COALESCE(o.name, host_name_manual)`),
  with the typed name retained in `host_name_manual`.

### F. Validation (`lib/validation.ts`)

- `KioskCheckInSchema`: make `host_name_manual` **optional** (keep `visitor_id`, `directorate_id`,
  `purpose_raw` required). `host_officer_id` is NOT accepted from the client (server-derived).

## Error handling & fallback

- **No receiver configured** → `host_officer_id` null → no officer notification, visit still
  completes (today's behaviour). Never blocks.
- **Admin picks a cross-directorate officer** → 400 (validation).
- **Receiver later deactivated/deleted** → `notifyOnCheckIn` simply finds no Telegram/push target and
  no-ops; check-in still succeeds.
- The kiosk check-in remains server-authoritative; the client cannot set the host officer.

## Testing

- **Unit:** a pure resolver/validation helper for "officer belongs to directorate" (admin guard).
- **API:** kiosk check-in routes to the configured reception officer (host_officer_id set) vs a
  directorate with none (host_officer_id null); admin update sets/clears/validates
  `reception_officer_id`; `/api/kiosk/directorates` includes `reception_officer_name`.
- **Static:** api + web type-check; web build; migration applies local + remote.
- **Manual (on-device):** pick a directorate → see "You'll be received by …" → check in → confirm the
  reception officer receives the arrival notification.

## Out of scope (YAGNI)

- Purpose→officer routing finer than directorate-level (still purpose→directorate via the existing
  hint, then directorate→its one receiver).
- A searchable officer picker / public officer directory at the kiosk (still excluded — PII).
- Multiple receivers / round-robin per directorate (single designated receiver; revisit later).
- Changing the staff (`CheckInPage`) host-officer flow — unchanged.
- Re-notifying or backfilling past kiosk visits.
