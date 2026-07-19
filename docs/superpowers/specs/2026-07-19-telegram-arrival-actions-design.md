# Telegram Actionable Arrival Notifications Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

## Problem

Visitor arrival alerts to the host officer are fire-and-forget: the host gets a
Telegram message, then either walks down or doesn't. Reception has no signal
back, so visitors sit in the lobby while "the host never saw the message."
Telegram inline keyboards + the existing webhook let the alert become a
workflow: the host taps a button, the response is recorded on the visit, and
reception sees it.

**Constraint:** buttons go on **host** messages only. Directorate-receiver and
leadership fan-out messages stay FYI — no keyboards, no behavior change.

---

## Section 1 — The Buttons

Every host arrival Telegram gains an inline keyboard (one row):

| Button | `callback_data` | Meaning recorded on the visit |
|--------|-----------------|-------------------------------|
| ⬇️ Coming down | `va:<visit_id>:coming_down` | Host is on their way to reception |
| 🪑 Waiting area | `va:<visit_id>:waiting_area` | Visitor should wait; host will collect them |
| 📅 Reschedule | `va:<visit_id>:reschedule` | Host can't meet today — reception to rebook |

`callback_data` ≤ 64 bytes (Telegram limit) — `va:` prefix keeps it short.

On tap, the host gets a toast (`answerCallbackQuery`): "Noted — visitor told
you're coming down." The original message's keyboard is removed and a status
line is appended (`editMessageText`), so the chat itself shows the decision:
`✅ Coming down — 09:42`.

**First response wins.** Later taps (either button, any device) get a toast:
"Already responded: Coming down." The visit keeps the original response.

---

## Section 2 — Data Model

### `migration-visits-host-response.sql`

```sql
ALTER TABLE visits ADD COLUMN host_response TEXT;      -- coming_down | waiting_area | reschedule
ALTER TABLE visits ADD COLUMN host_response_at TEXT;   -- ISO timestamp
ALTER TABLE visits ADD COLUMN host_response_by TEXT;   -- telegram chat id that responded (audit trail)
```

Additive only, registered LAST in `migrations-index.ts`, `schema.sql` updated.

No `app_settings` flag — the keyboard is additive UX with no enforcement
semantics; it ships live. (No graduated mode needed per the flags convention,
which exists for enforcement features.)

---

## Section 3 — Telegram Service Changes

### `packages/api/src/services/telegram.ts`

- `SendMessageParams` gains optional `replyMarkup` (typed as Telegram's
  `InlineKeyboardMarkup`); `sendTelegramMessage` includes it as `reply_markup`
  when present. Existing callers unaffected.
- New `answerCallbackQuery({ token, callbackQueryId, text })` — best-effort,
  same error shape as `sendTelegramMessage`.
- New `editMessageText({ token, chatId, messageId, text })` — used to append the
  status line and drop the keyboard.
- New `buildArrivalKeyboard(visitId)` returning the three-button markup.
- New `parseArrivalCallback(data)` → `{ visitId, action } | null` (validates
  `va:` prefix + the three known actions).

### `packages/api/src/services/notifier.ts`

`notifyOfficerOfVisit` gains a `withKeyboard: boolean` — true only when
`officerId === data.host_officer_id`. Both host Telegram sends
(`officers.telegram_chat_id` and the KV-linked user chat) pass
`replyMarkup: buildArrivalKeyboard(data.visit_id)` when true. Receivers and
leadership calls pass nothing. The message ID isn't needed at send time — the
callback carries `message_id` in the update.

---

## Section 4 — Webhook Changes

### `packages/api/src/routes/telegram.ts`

`telegramWebhook` currently handles only `message` updates. Add a
`callback_query` branch **before** the message branch:

```ts
const cb = body.callback_query;
if (cb?.data && cb.message) {
  await handleArrivalCallback(c, cb);
  return c.json({ ok: true });
}
```

`handleArrivalCallback`:
1. `parseArrivalCallback(cb.data)` — ignore anything else (return 200; other
   keyboards may exist later).
2. Load the visit + host officer: `SELECT v.id, v.host_officer_id, v.host_response, o.telegram_chat_id FROM visits v JOIN officers o ON o.id = v.host_officer_id WHERE v.id = ?`.
3. **Authorization:** the clicking chat must be the host's linked chat —
   `String(cb.from.id) === officer.telegram_chat_id`, or equal to the KV-linked
   chat (`telegram-user:<user.id>`) for the host's user account. Otherwise
   answer "This alert isn't for you." and stop. (Telegram only delivers the
   keyboard to chats the bot sent it to, but `callback_query.from` is still
   verified — forwarded messages keep working keyboards.)
4. **First response wins:** if `visits.host_response` is set, answer with the
   existing response and stop.
5. Record: `UPDATE visits SET host_response = ?, host_response_at = ?, host_response_by = ? WHERE id = ?`.
6. UX: `answerCallbackQuery` toast + `editMessageText` appending the
   `✅ <Action> — <time>` line (original text preserved, keyboard removed).
7. `recordAudit` — `visit.host_response` with visit id, action, chat id.
8. All failures are non-fatal: the callback always gets an answer (Telegram
   retries otherwise), errors only logged.

Webhook secret verification (existing) guards the whole route — unchanged.

---

## Section 5 — Reception Visibility

Small, read-only surfacing of the response:

- `GET /api/visits/active` (and `/api/visits`) SELECTs gain the three columns.
- Web `DashboardPage` active-visits list and `VisitLogPage` row: a small chip
  next to the host name — `⬇️ Coming down` (green), `🪑 Waiting area` (amber),
  `📅 Reschedule` (red) — shown only when `host_response` is set. Matches the
  existing pill visual language; no new pages.

This is what lets reception act: "reschedule" responses get rebooked,
"waiting area" means the visitor stays put.

---

## Section 6 — Out of Scope (deliberately)

- No buttons on receiver/leadership messages (FYI only).
- No reschedule automation (rebooking stays a human reception action).
- No push/in-app action buttons (Telegram-only v1; in-app bell unchanged).
- No response editing / second-chance flow (first response wins; a wrong tap
  is corrected by talking to reception, as today).

---

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/db/migration-visits-host-response.sql` | New — additive columns |
| `packages/api/src/db/migrations-index.ts` | Register migration (last) |
| `packages/api/src/db/schema.sql` | Add columns to visits CREATE TABLE |
| `packages/api/src/services/telegram.ts` | replyMarkup param, answer/edit helpers, keyboard builder, callback parser |
| `packages/api/src/services/telegram.test.ts` (or existing test file) | New — parser + keyboard builder tests |
| `packages/api/src/services/notifier.ts` | `withKeyboard` on the host path only |
| `packages/api/src/routes/telegram.ts` | `callback_query` branch + `handleArrivalCallback` |
| `packages/api/src/routes/visits.ts` | Active/list SELECTs gain the three columns |
| `packages/web/src/pages/DashboardPage.tsx` | Host-response chip on active visits |
| `packages/web/src/pages/VisitLogPage.tsx` | Host-response chip on rows |

## Verification

- `tsc --noEmit` + `vitest run` in `packages/api` and `packages/web`.
- Unit tests: callback parser (valid/invalid/oversized), keyboard builder shape,
  first-response-wins predicate if factored pure.
- Prod after deploy: superadmin runs the migration runner (hard gate — user
  action), then a real test check-in to a Telegram-linked officer.
