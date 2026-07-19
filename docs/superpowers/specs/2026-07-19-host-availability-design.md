# Host Availability Status Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

## Problem

A visitor (or the kiosk) picks a host who is in a meeting or out of office.
The arrival alert fires into the void, the visitor waits. Officers need a
low-friction way to broadcast "not right now," and every host picker should
surface it *before* the check-in completes.

**Contract (shared with the kiosk workstream):** `officers.availability_status`
values `'available' | 'in_meeting' | 'out_of_office'`; NULL reads as
`'available'`. Officer list endpoints return it additively.

---

## Section 1 — Data Model

`migration-officers-availability.sql` (whole-line comments only):

```sql
ALTER TABLE officers ADD COLUMN availability_status TEXT;
ALTER TABLE officers ADD COLUMN availability_updated_at TEXT;
```

Additive; registered LAST in `migrations-index.ts` (registration done by the
coordinator, not the implementing agent); `schema.sql` updated to match.
Separate from the existing `is_available` boolean (that one means "appears in
appointment booking lists" — different concept; do not merge).

---

## Section 2 — Setting the Status

Two channels, same write path:

**Telegram (primary — officers live there).** New bot commands in
`routes/telegram.ts`:
- `/available`, `/meeting`, `/out` — set the caller's status (resolve the
  officer by `telegram_chat_id`; unknown chat → "link your account first" hint).
- `/status` reply gains the current availability line.
`BOT_COMMANDS` updated; `POST /api/admin/telegram/sync-commands` re-publishes
the menu (existing endpoint — note in the deploy notes).

**Web profile.** `packages/web/src/pages/ProfilePage.tsx`: a three-option
segmented control (Available / In a meeting / Out of office) for users whose
account maps to an officer row. Writes a new authenticated endpoint:

`PUT /api/officers/me/availability` (in `routes/officers.ts`) — body
`{ status: 'available' | 'in_meeting' | 'out_of_office' }` (zod enum). Resolves
the caller's officer row via the session user's officer linkage (same lookup
pattern used elsewhere — email, then name); updates both columns; audit
(`officer.availability`). 404 when the user has no officer row (UI hides the
control in that case — `GET /auth/me` or the officers list response tells the
frontend).

---

## Section 3 — Surfacing in Host Pickers

- **Officer list responses** (`routes/officers.ts`, kiosk officers endpoint):
  SELECT gains `availability_status` (additive; old clients ignore it).
- **Reception check-in** — `packages/web/src/components/OfficerCombobox.tsx`
  (this workstream owns this component; do not touch `CheckInPage.tsx`):
  - Option rows show a small dot: green available / amber in meeting / grey out.
  - Selecting a non-available officer opens the component's own inline confirm
    ("Mr. Mensah is in a meeting — notify anyway?") with Notify anyway / Pick
    another. No page changes needed if the confirm lives inside the combobox.
- **Kiosk** consumption (badges + warning) is owned by the fast-lane
  workstream; this one only guarantees the field is in the kiosk officer list.

---

## Section 4 — Out of Scope

- No automatic reset timer (officers set/clear manually; a stale status is a
  social problem, not a software one). Revisit after usage data.
- No per-visit blocking — availability always warns, never blocks.

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/db/migration-officers-availability.sql` | New (registration: coordinator) |
| `packages/api/src/routes/telegram.ts` + `services/telegram.ts` | `/available`, `/meeting`, `/out`, status line, BOT_COMMANDS |
| `packages/api/src/routes/officers.ts` | `PUT /me/availability`; availability in list SELECTs |
| `packages/web/src/pages/ProfilePage.tsx` | Status segmented control |
| `packages/web/src/components/OfficerCombobox.tsx` | Status dots + inline confirm |

## Verification

- `tsc --noEmit` + `vitest run` both packages; new endpoint + command parsing
  covered by tests where the repo has patterns.
- Prod: coordinator applies the migration; officer sends `/meeting` to the bot,
  reception sees the amber dot in the host picker.
