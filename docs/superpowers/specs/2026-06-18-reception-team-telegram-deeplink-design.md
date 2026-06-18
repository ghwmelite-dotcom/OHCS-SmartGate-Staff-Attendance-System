# Reception Team + Telegram Deep-Link Alerts — Design (Spec B)

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Builds on:** PR #9 (`directorates.reception_officer_id` single primary) and PR #10 (notification
hardening — `recordNotifyOutcome`, non-throwing send paths).

## Summary

A kiosk visitor is routed to a directorate, but today only a **single** primary officer is notified,
and that officer is only reachable on Telegram if they happen to be a system user with a Staff ID
(the `/link <StaffID>` bot flow requires a `users` row). This makes the directorate's **reception
team** (one *or more* officers) reachable on Telegram via a **one-time deep link** (works for any
officer, no account needed), and **fans out the visitor-arrival alert privately** to the whole team
on kiosk check-ins. Alerts stay **private DMs** — never a group (rejected for PII/targeting, and
Telegram bots can't DM a user who hasn't started the bot anyway).

## Decisions (resolved during brainstorming)

1. **Private DMs to receivers** — no group broadcast.
2. **Multiple receivers per directorate**, **primary + team** model: `reception_officer_id` stays the
   *primary* (host of record + "You'll be received by X"); a `directorate_receivers` join table is
   the team. The primary is always a member of the team.
3. **Linking via a one-time per-officer Telegram deep link** (`t.me/<bot>?start=<token>`), generated
   by an admin; works for officers with no user account.
4. **Team fan-out on kiosk self-check-ins ONLY.** Staff check-ins are unchanged (the receptionist
   hand-picks a host; no team spam).
5. Builds on the Spec-A hardened, non-throwing send paths; never blocks check-in.

## Context (verified)

- `directorates.reception_officer_id` exists (PR #9, nullable). Kiosk `/check-in` resolves it →
  `host_officer_id`; `performCheckIn` (`services/check-in.ts`) sets the host + fires
  `notifyOnCheckIn` (via `ctx.waitUntil`). `check_in_source` ('staff'|'kiosk') is on `CheckInParams`.
- `services/notifier.ts` `notifyOnCheckIn(data, env)` → `notifyHostStaff` (Telegram + in-app to the
  host) + optional `notifyDirectorateLeadership`. `recordNotifyOutcome` (Spec A) wraps send outcomes;
  `createInAppNotification` writes the in-app row only when the officer maps to a `users` row.
- `services/telegram.ts` `telegramWebhook` handles bare `/start` (greeting), `/link <StaffID>`,
  `/admin`, `/stop`. `generateLinkCode`/`consumeLinkCode` are a separate KV code helper (web-auth
  flow) — not reused here. **No bot username is configured anywhere** (`TELEGRAM_BOT_TOKEN` /
  `TELEGRAM_WEBHOOK_SECRET?` are the only Telegram env vars).
- `routes/admin-directorates.ts` (superadmin) manages directorates + officers; `routes/officers.ts`
  `GET /` lists officers (used by the admin `DirectoratesTab.tsx`). The admin tab currently has a
  single "Reception" primary picker (PR #9).

## Changes

### A. DB migration — `directorate_receivers`

`packages/api/src/db/migration-directorate-receivers.sql`:
```sql
-- The team of officers alerted (private DM + in-app) when a visitor self-routes to
-- this directorate at the kiosk. The directorate's reception_officer_id (primary) is
-- always also a row here. Nullable membership: a directorate may have zero receivers.
CREATE TABLE IF NOT EXISTS directorate_receivers (
    directorate_id TEXT NOT NULL REFERENCES directorates(id),
    officer_id     TEXT NOT NULL REFERENCES officers(id),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (directorate_id, officer_id)
);
```
Add the `CREATE TABLE` to `schema.sql` and register the migration in `db/migrations-index.ts`. Apply
local; remote at deploy (confirmed). **Backfill:** the migration also seeds existing primaries —
`INSERT OR IGNORE INTO directorate_receivers (directorate_id, officer_id) SELECT id,
reception_officer_id FROM directorates WHERE reception_officer_id IS NOT NULL;` — so today's
primaries are already on their teams.

### B. Config — bot username

Add **`TELEGRAM_BOT_USERNAME`** to `wrangler.toml [vars]` (non-secret; the bot's public @username,
without the `@`) and to the `Env` type (`types.ts`). Used only to build the deep-link URL.

### C. Deep-link linking

- **`services/telegram.ts`** — extend `telegramWebhook`'s `/start` handling: if the text is
  `/start <token>` (a payload after `/start`), look up KV `officer-link:<token>`; if it resolves to
  an `officer_id`, set `officers.telegram_chat_id = <chatId>`, delete the KV key (single-use), and
  reply with a success message naming the officer's directorate. If the token is missing/expired/
  invalid, fall through to the existing bare-`/start` greeting (no error leak). Bare `/start` and
  `/link`/`/admin`/`/stop` are unchanged.
- **`routes/admin-directorates.ts`** — new superadmin endpoint
  `POST /officers/:id/link-token`: verify the officer exists; generate a token
  (`crypto.randomUUID().replace(/-/g,'')`), store KV `officer-link:<token>` = officer_id with a
  **7-day TTL**; return `{ url: "https://t.me/<TELEGRAM_BOT_USERNAME>?start=<token>", token }`.
- **`routes/admin-directorates.ts`** — new superadmin endpoint
  `DELETE /officers/:id/telegram` (or a PATCH flag): set `officers.telegram_chat_id = NULL` (revoke).

### D. Receiver management (admin API)

In `routes/admin-directorates.ts` (superadmin), add receiver CRUD scoped to a directorate:
- `GET /:id/receivers` → the directorate's receivers joined to officer name + a `linked` boolean
  (`telegram_chat_id IS NOT NULL`) + whether each is the `primary` (matches `reception_officer_id`).
- `POST /:id/receivers` `{ officer_id }` → validate the officer **belongs to that directorate**
  (400 otherwise), `INSERT OR IGNORE` into `directorate_receivers`.
- `DELETE /:id/receivers/:officerId` → remove from the team. If the removed officer was the
  primary, also clear `directorates.reception_officer_id` (NULL).
- The existing primary setter (`PUT /:id` with `reception_officer_id`) is tightened: the chosen
  primary must already be a receiver (else 400 — "add them to the team first"), keeping the
  "primary is always on the team" invariant.

### E. Notification fan-out (kiosk only) — `services/notifier.ts` + `services/check-in.ts`

- Thread `check_in_source` into the notify data: `performCheckIn` passes `check_in_source` to
  `notifyOnCheckIn` (add it to `VisitNotifyData`).
- In `notifyOnCheckIn`, after `notifyHostStaff`, when `data.check_in_source === 'kiosk'` and
  `data.directorate_id`: load the directorate's receivers, and for **each receiver except the
  primary/host** (`officer_id !== data.host_officer_id`), send the same private alert as the host
  gets — Telegram to `officers.telegram_chat_id` (recorded via `recordNotifyOutcome`) + in-app when
  the officer maps to a user. Factor the per-officer notify into a shared helper reused by both the
  host path and the receiver fan-out (DRY). Skips duplicates; never throws (Spec A path).
- Staff check-ins (`check_in_source === 'staff'`) skip the fan-out entirely — unchanged behaviour.

### F. Admin UI — team manager (`components/admin/DirectoratesTab.tsx`)

Replace the single "Reception" primary `<select>` with a **team manager** per directorate row (or an
expandable panel):
- List the directorate's receivers (name + Telegram **linked ✓ / not linked** badge + **Primary**
  marker).
- **Add receiver:** a picker of that directorate's own officers (not already on the team).
- **Remove receiver.**
- **Set primary:** mark one listed receiver as primary (calls the tightened `PUT /:id`).
- **Generate link:** per receiver, a button → calls `POST /officers/:id/link-token` → shows the
  deep-link URL to **copy** (and a hint to send it to that officer). Re-generates on demand.
- Officers are sourced from the already-loaded `/officers` list (filtered by directorate); the new
  `GET /:id/receivers` provides membership + linked/primary state.

### G. Kiosk display — unchanged

The kiosk still shows "You'll be received by `<primary>`" via the existing
`reception_officer_name` on `GET /api/kiosk/directorates`. The team is internal (who is alerted),
not shown to the visitor. No kiosk change.

## Error handling & privacy

- Deep-link token: single-use + 7-day TTL; invalid/expired → friendly greeting, no error/info leak.
- Cross-directorate officer as receiver/primary → 400.
- Removing the primary clears `reception_officer_id` (no dangling primary pointer).
- Fan-out is best-effort, non-blocking, reuses Spec A's non-throwing send + outcome logging; a
  receiver unreachable on every channel is logged (Spec A), never silently dropped.
- Alerts are **private DMs only**; no visitor PII in logs (Spec A guardrail).
- The `/start <token>` handler trusts only the server-issued KV token; the chat id is taken from the
  Telegram update (the user who tapped the link), so a user can only link the chat they control.

## Testing

- **Unit (vitest):** the `/start` payload parser (extract token from `/start <token>`); the
  "primary must be a receiver" validation helper; the fan-out recipient selection (excludes the
  primary/host, dedupes). The token round-trip (generate → KV → resolve) with a mocked KV.
- **API static:** type-check; existing suite green (no staff-flow regression — staff check-ins skip
  fan-out).
- **Migration:** applies clean local + remote; backfill populates existing primaries into
  `directorate_receivers`.
- **Manual (on-device):** admin adds two receivers to a directorate + marks a primary; taps
  "Generate link" and links one officer via the deep link on their phone; a kiosk check-in to that
  directorate delivers a private DM to every linked receiver; a staff check-in to the same
  directorate does NOT fan out.

## Out of scope (YAGNI)

- Group/broadcast delivery (explicitly rejected).
- Retries/queues (deferred — Spec A note).
- Round-robin / on-call rotation among receivers (all listed receivers are alerted).
- Team fan-out on staff check-ins (kiosk-only by decision).
- Receiver management for non-kiosk notification types (clock/attendance) — those keep their current
  role/directorate targeting.
