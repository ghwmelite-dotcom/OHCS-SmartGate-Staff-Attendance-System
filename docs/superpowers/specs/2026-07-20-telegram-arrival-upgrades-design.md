# Telegram Arrival Message Upgrades — Design

Date: 2026-07-20 · Status: implementing (user-selected bundle)

Three upgrades to the check-in Telegram alerts, chosen from the 2026-07-20
options menu. No DB migration — state rides in KV.

## 1. Visitor photo in the arrival message (`sendPhoto`)

Hosts hear a name today; they should *see the face* — recognizability at the
lift and a spoof check. `visitors.photo_url` (R2 key, `env.STORAGE`) is fetched
by the arrival path and multipart-uploaded via Telegram `sendPhoto`
(`photo` binary field, `caption` = the existing HTML text ≤1024 chars,
`reply_markup` carries the action keyboard). Photo on host, fanout and
leadership messages; any failure (no photo, R2 miss, Telegram reject) falls
back to the plain `sendMessage` silently.

`sendTelegramMessage` keeps its `Promise<boolean>` signature (≈20 call sites
untouched); the arrival path uses a new `sendTelegramMessageWithId` /
`sendTelegramPhoto` returning `{ ok, messageId }` — the id is needed for §3.

## 2. Party line + host-status line

- **Party** (`visits.party_size` includes the lead; `party_names` is a JSON
  array of accompanying names): a line after the visitor name in all arrival
  formats — `With 2 others: Ama B, Kofi D` (names HTML-escaped; count-only when
  names are absent). `VisitNotifyData` gains `photo_url`, `party_size`,
  `party_names`; `SELECT_VISIT_WITH_JOINS` gains `vis.photo_url` (additive,
  shared SELECT, callers pick fields).
- **Fanout format fix + status line.** Directorate receivers currently get the
  host's "You have a visitor" wording. New `fanout` recipient format:
  header `👤 Visitor for {host name}`, plus — only when the host is not
  available — `Host status: In a meeting — you're receiving this as cover`
  (`officers.availability_status`, fetched once per check-in).

## 3. Visit-ended edit (close the thread)

- At send time the arrival path collects `{c: chatId, m: messageId, p: photo?}`
  for every successfully sent arrival message (host, fanout, leadership) into
  KV `tg-arrival:<visitId>`, TTL 36h.
- `checkOutById` (the shared checkout path — kiosk badge/PIN, reception, sweep)
  calls `closeArrivalThread(env, visit)` after a successful checkout: reads and
  deletes the KV record and rewrites each arrival message to
  `✅ Visit ended — {name} ({org}) · Checked out {time} · {duration}`,
  removing the keyboard. Fully best-effort, never blocks/fails a checkout.
- **Photo-message edit rule.** Telegram forbids `editMessageText` on media
  messages — captions need `editMessageCaption`. The KV record's `p` flag picks
  the method at checkout; the arrival-action callback handler
  (`routes/telegram.ts`) likewise switches on `callback_query.message.photo`
  and appends the decision to `msg.caption` (today it reads `msg.text`, which
  is undefined on photo messages — would have broken silently once §1 shipped).

## Out of scope (deferred from the menu)

15-min host nudge (not selected), ETA buttons, free-text reply to reception,
`/today` bot command.

## Files

- `services/telegram.ts` — `sendTelegramMessageWithId`, `sendTelegramPhoto`,
  `editMessageCaption`, `closeArrivalThread`; `sendTelegramMessage` delegates
  (signature unchanged).
- `services/notifier.ts` — `sendArrivalAlert` (photo-or-text, records outcome),
  party line, `fanout` format + host status, id collection + KV write.
- `services/check-in.ts` — pass `photo_url`/`party_size`/`party_names` through.
- `services/visit-queries.ts` — add `vis.photo_url` to the join.
- `services/check-out.ts` — `closeArrivalThread` after successful checkout.
- `routes/telegram.ts` — photo-aware callback edit.
- Tests: `telegram.test.ts` (photo sender, WithId sender, closeArrivalThread),
  `notifier` message-format tests (party/fanout/status lines).
