# Delegation Mode + Visitor Watchlist (VIP/Banned) Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

Two reception-flow upgrades sharing the check-in surface.

---

## Feature A — Delegation Mode

### Problem

A 6-person delegation currently means six full check-in flows at reception.
Reality: one lead, one badge, one host — the members are accompanying.

### Data model

`migration-visits-party.sql` (whole-line comments only):

```sql
ALTER TABLE visits ADD COLUMN party_size INTEGER;
ALTER TABLE visits ADD COLUMN party_names TEXT;   -- JSON array of member names, lead excluded
```

NULL ⇒ solo visit (`party_size` reads as 1). Registered LAST by coordinator;
`schema.sql` updated.

### Reception check-in (`CheckInPage.tsx` — this workstream owns the page)

In the check-in form step, a "Delegation" optional block: party size stepper
(2–20) + a name input per additional member (lead name comes from the visitor
record). Submit sends `party_size`, `party_names` through `POST /visits/check-in`
(zod: `party_size` int 1–20 default 1; `party_names` string[] max 19, each
≤80 chars, trimmed, empty strings dropped).

### Surfacing

- Badge JSON + `/badge/:code` HTML page: "Ama Serwaa **+5**" line under the
  visitor name (badge page reads the visit row).
- Visit log / dashboard active visits / visitor detail: `+N` chip next to the
  visitor name; tooltip/expand lists member names.
- Check-out unchanged (one badge covers the party).

---

## Feature B — Watchlist (VIP / Banned)

### Problem

Reception needs a way to mark "never allow this person again" and "this person
gets instant director attention" — discreetly.

### Data model

`migration-visitors-flag.sql` (whole-line comments only):

```sql
ALTER TABLE visitors ADD COLUMN flag TEXT;            -- 'vip' | 'banned'
ALTER TABLE visitors ADD COLUMN flag_note TEXT;
ALTER TABLE visitors ADD COLUMN flag_updated_at TEXT;
ALTER TABLE visitors ADD COLUMN flag_updated_by TEXT;
```

Registered LAST by coordinator; `schema.sql` updated.

### Admin management

- `PUT /api/visitors/:id/flag` — superadmin only (`requireRole('superadmin')`),
  zod `{ flag: 'vip' | 'banned' | null, note?: string }`; sets/clears with
  updated_at/by; `recordAudit` (`visitor.flag`).
- Web `VisitorDetailPage.tsx`: superadmin-only flag section (badge + set/clear
  with note). Matches existing admin styling.

### Check-in behavior (`CheckInPage.tsx` + `visits.ts`/`check-in.ts`)

- **VIP:** on visitor select, the form shows a gold "VIP" ribbon (reception
  knows to expedite). After check-in completes, the notifier ALSO sends an
  immediate Telegram + in-app alert (type `watchlist_alert`) to the
  directorate's leadership (reuse the leadership query in notifier) and the
  Telegram admin chat: "VIP <name> has arrived for <host>".
- **Banned:** the reception UI stays poker-faced — the check-in proceeds
  normally on screen (no alert styling visible to the visitor). Immediately
  after the visit row is created, send a silent `watchlist_alert`: Telegram
  admin chat + in-app to `receptionist`/`admin`/`superadmin` users:
  "⚠️ Flagged visitor <name> (banned) just checked in — assess discreetly."
  Never block the flow from the visitor's perspective; security handles it
  in person.
- `performCheckIn` returns the flag so the route can trigger the alert; alerts
  live in a small helper `notifyWatchlist(env, visitor, visit)` in notifier.ts
  (whitelist type already seeded).

---

## Out of Scope

- Kiosk delegation (reception-only v1 — delegations are handled by humans).
- Banned-visitor hard block (deliberately discreet instead).
- Flag history/audit trail beyond the standard audit log.

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/db/migration-visits-party.sql` | New (registration: coordinator) |
| `packages/api/src/db/migration-visitors-flag.sql` | New (registration: coordinator) |
| `packages/api/src/routes/visits.ts` + `services/check-in.ts` | party fields in check-in; flag passthrough |
| `packages/api/src/routes/visitors.ts` | `PUT /:id/flag` (superadmin); flag in visitor SELECTs |
| `packages/api/src/routes/badges.ts` | party display in badge JSON/HTML |
| `packages/api/src/services/notifier.ts` | `notifyWatchlist` helper (no whitelist change — seeded) |
| `packages/web/src/pages/CheckInPage.tsx` | delegation block; VIP ribbon; (banned stays invisible) |
| `packages/web/src/pages/VisitorDetailPage.tsx` | flag management (superadmin) |
| `packages/web/src/pages/VisitLogPage.tsx` / `DashboardPage.tsx` | `+N` party chip, VIP chip |

## Verification

- `tsc --noEmit` + `vitest run`; party zod cases + flag endpoint guard tests.
- Prod: coordinator applies migrations; reception checks in a 3-person party;
  superadmin flags a test visitor VIP → leadership alert fires.
