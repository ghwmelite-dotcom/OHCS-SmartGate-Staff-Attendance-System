# Telegram Bot Commands — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Builds on:** the bot webhook (`routes/telegram.ts`) + deep-link linking (PR #11) + `TELEGRAM_BOT_USERNAME` (PR #12).

## Summary

The bot handles `/start`, `/start <token>` (deep-link), `/link <StaffID>`, `/admin`, `/stop` as an
ad-hoc `if`-chain, and none of them are registered in Telegram's command **menu** (so users can't
discover them). This adds a polished **self-service command set** (`/help`, `/status`, `/unlink`
plus refined `/start`), registers the command menu via `setMyCommands` from a code-defined list, and
replaces the `if`-chain with a small, testable command dispatcher. No live-data/stats commands and
no role-gating (deferred by decision).

## Decisions (resolved during brainstorming)

1. **Polished self-service set** — `/start`, `/help`, `/link`, `/status`, `/unlink`, `/admin`, `/stop`.
2. **`/unlink` (stop visitor alerts) and `/stop` (stop daily summaries) stay distinct**, explained in `/help`.
3. **Command menu registered via a superadmin endpoint** (`POST /api/admin/telegram/sync-commands`)
   that pushes a code-defined `BOT_COMMANDS` list to `setMyCommands` — versioned + re-runnable, not
   hand-pasted into BotFather.
4. **Light dispatcher refactor**: a pure `parseCommand` + a `switch`, each command a small handler;
   existing behaviour preserved; unrecognised `/command` gets a friendly "try /help".

## Components

### A. `parseCommand` (pure, testable) — `services/telegram.ts`
```
parseCommand(text): { command: string; args: string } | null
```
- Trims; returns `null` if it doesn't start with `/`.
- Splits the first token (the command) from the rest (args). Strips a `@BotName` suffix
  (`/start@ohcs_smartgate_bot` → `start`) for group-chat robustness. Lowercases the command.
- Examples: `/link 123` → `{ command: 'link', args: '123' }`; `/start tok` → `{ start, 'tok' }`;
  `/help` → `{ help, '' }`; `hello` → `null`.
- **Replaces `parseStartToken`** (PR #11): the `/start` handler uses `parsed.args` as the deep-link
  token. `parseStartToken` and its tests are removed/migrated to `parseCommand`.

### B. `BOT_COMMANDS` + `setBotCommands` — `services/telegram.ts`
```ts
export const BOT_COMMANDS = [
  { command: 'start',  description: 'What this bot does' },
  { command: 'help',   description: 'Show all commands' },
  { command: 'link',   description: 'Link your Staff ID to receive alerts' },
  { command: 'status', description: 'Check your link & alert status' },
  { command: 'unlink', description: 'Stop receiving visitor alerts' },
  { command: 'admin',  description: 'Get daily attendance summaries' },
  { command: 'stop',   description: 'Stop daily summaries' },
];
```
`setBotCommands(env): Promise<boolean>` → `POST https://api.telegram.org/bot<token>/setMyCommands`
with `{ commands: BOT_COMMANDS }`; returns `res.ok`. (Telegram persists this globally — set once,
re-push whenever the list changes.)

### C. Webhook dispatch — `routes/telegram.ts`
Replace the `if`-chain with `const parsed = parseCommand(text)` + `switch (parsed?.command)`:
- `start` → if `parsed.args` is a token, run the existing deep-link link flow; else the **refined
  greeting** (what the bot does + "send /help to see everything").
- `help` → formatted HTML list of all commands (mirrors `BOT_COMMANDS` with the `/unlink` vs `/stop`
  distinction spelled out).
- `link` → existing `/link <StaffID>` behaviour (args = the Staff ID).
- `status` → see D.
- `unlink` → see E.
- `admin` → existing (enable daily summaries; sets KV `telegram-admin-chat-id`).
- `stop` → existing (disable daily summaries; deletes that KV key).
- `default` (a `/something` we don't know) → "I don't recognise that command — send /help." Plain
  non-command text (`parsed === null`) is ignored (bot stays quiet, not chatty).

### D. `/status`
Resolve the current chat's state and reply:
- Visitor alerts: `SELECT o.name, d.abbreviation AS dir FROM officers o LEFT JOIN directorates d ON
  o.directorate_id = d.id WHERE o.telegram_chat_id = ?` (bind the chat id). If a row exists →
  "Linked as **<name>** (**<dir>**) — visitor alerts **ON**."; else "Not linked — send
  `/link <StaffID>`, or ask reception for your link."
- Daily summaries: `ON` iff KV `telegram-admin-chat-id` === this chat id.
- Reply combines both lines.

### E. `/unlink` (stop visitor alerts — and stop them *completely*)
A naive "clear the officer column" is **insufficient**: the notifier also DMs via the KV
`telegram-user:<userId>` mapping that `/link` writes, and that path would still fire. So `/unlink`:
1. Find the officer(s) where `telegram_chat_id = <chat>`.
2. For each, resolve the linked user (by email/name, as the notifier does) and, if KV
   `telegram-user:<userId>` equals this chat id, **delete** that KV key.
3. `UPDATE officers SET telegram_chat_id = NULL WHERE telegram_chat_id = <chat>`.
4. Reply: "Done — you'll no longer receive visitor alerts. Re-link any time with `/link` or a fresh
   link from reception." (Leaves daily-summary subscription alone — that's `/stop`.)
If no officer is linked to this chat → "You aren't linked, so there's nothing to unlink."

### F. Menu registration endpoint — `POST /api/admin/telegram/sync-commands`
Superadmin-gated; calls `setBotCommands(c.env)`; returns `{ ok }`. Mounted under the authenticated
`/api/admin/...` space (e.g. a small `adminTelegramRoutes` or alongside existing admin routes). The
superadmin hits it once after deploy (and whenever `BOT_COMMANDS` changes) to publish the menu.

## Error handling & privacy

- All Telegram sends reuse `sendTelegramMessage` (Spec-A logging applies). No visitor PII in any
  command reply beyond the user's own linkage (their officer name + directorate — to the user
  themselves, in a DM).
- `setBotCommands` returns ok/false; the sync endpoint surfaces that. A failed push doesn't affect
  the running bot (commands still work; only the discoverable menu lags).
- `parseCommand` never throws; unknown commands degrade to the help hint; non-commands are ignored.
- Webhook auth (`TELEGRAM_WEBHOOK_SECRET`, if set) and the existing public-route behaviour are
  unchanged.

## Testing

- **Unit (vitest):** `parseCommand` — command+args split, `@BotName` stripping, bare command,
  non-command → null, leading/trailing space; `BOT_COMMANDS` shape (each has `command` 1–32 chars
  lowercased + a non-empty description). Migrate the old `parseStartToken` cases into `parseCommand`.
- **Static:** api type-check; existing suite green.
- **Manual (on-device):** run `sync-commands`, confirm the `/` menu shows the seven commands with
  descriptions; send each — `/help` lists them, `/status` reflects linked/unlinked + summary state,
  `/unlink` stops alerts (verify a subsequent kiosk check-in no longer DMs that chat), `/start`
  greets, `/start <token>` still links.

## Out of scope (YAGNI)

- Live-data commands (`/today` stats) and role-gated commands (deferred).
- Inline keyboards / buttons / conversational flows.
- Per-language command menus (single default set).
- An admin UI button for sync-commands (the endpoint suffices; a button can come later).
