# Notification Hardening — Design (Spec A)

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)
**Sibling:** Spec B — "Reception team + Telegram deep-link alerts" (separate, built after this).

## Summary

The notification system delivers via Telegram + Web Push on top of an in-app `notifications`
table, but delivery is **effectively silent in production**: `sendTelegramMessage` returns a
boolean every caller ignores (and only *network exceptions* log — an HTTP 4xx/5xx like a revoked
token or bad chat ID logs nothing), Web Push errors log dev-only and the returned status is
ignored, and dead push subscriptions (`410 Gone`) are never cleaned up. This spec makes delivery
**observable** and stops **silent drops** — without changing who is notified or via what channel.

**Explicitly out of scope:** retries / queues (at-least-once delivery via Cloudflare Queues is a
later, separate effort). This spec makes delivery *observable and best-effort-clean*, not
*guaranteed*. And nothing here touches recipients, linking, or the multi-receiver model — that is
all Spec B.

## Context (verified)

- `services/telegram.ts` `sendTelegramMessage({chatId,text,token}): Promise<boolean>` — returns
  `res.ok`; `catch` does `console.error(...)` (always logs *thrown* errors) then returns false. A
  non-OK HTTP response returns `false` with **no log**. No `env` param.
- `services/notifier.ts` — `notifyHostStaff`, `notifyDirectorateLeadership`, and
  `sendTypedNotification` call `sendTelegramMessage` and **ignore the boolean**; push errors are
  caught with `devError` (dev-only). In-app rows are written via `createInAppNotification` only
  when an officer maps to a `users` row (the `notifications.user_id` FK requires a user).
- `lib/webpush.ts` `sendWebPush(target, payload, env): Promise<number>` — returns the HTTP status
  and already calls `trackPushStatus(env, status)` (a KV daily counter, best-effort). It does NOT
  act on `410`. Caller in `notifier.ts` maps over `push_subscriptions` rows and ignores the status.
- `routes/notifications-push.ts` — subscribe (UPSERT) / unsubscribe (DELETE by endpoint) on
  `push_subscriptions(endpoint UNIQUE, p256dh, auth, user_id, ...)`.
- All sends run in `ctx.waitUntil(...)` (best-effort background) — unchanged here.

## Decisions (resolved during brainstorming)

1. **Observability via logs + KV counters** (no new D1 audit table).
2. **Retries/queues deferred** to a later effort.
3. No behavioural change to recipients/channels.

## Changes

### A. Unified outcome recorder — `lib/notify-metrics.ts` (new)

A small helper that records each delivery outcome to **production logs + KV daily counters**:
```
recordNotifyOutcome(env, channel: 'telegram' | 'push', ok: boolean, detail?: string): Promise<void>
```
- Logs a single structured line in production (so it surfaces in `wrangler tail` / Logpush), e.g.
  `console.log(JSON.stringify({ kind: 'notify', channel, ok, detail }))`. (Use `console.warn` for
  failures.) Not gated on dev — this is the whole point.
- Increments KV counters keyed by day + channel + outcome, e.g.
  `notify-stat:<YYYY-MM-DD>:<channel>:<ok|fail>` with a ~35-day TTL, mirroring the existing
  `trackPushStatus` pattern. Wrapped in try/catch so counter failures never affect delivery.
- `trackPushStatus` in `lib/webpush.ts` is refactored to delegate to (or be replaced by) this
  helper so push and Telegram share one counter scheme. No double-counting.

### B. Telegram — log non-OK responses + count outcomes

- In `sendTelegramMessage`, before `return res.ok`, when `!res.ok` log a structured warning with the
  **status only** (never log the message body / visitor PII): `console.warn(...)`. Keep the existing
  `catch` `console.error`. (Still no `env` here — logging only.)
- At each Telegram call site in `notifier.ts` (`notifyHostStaff` x2 paths,
  `notifyDirectorateLeadership` x2 paths), capture the returned boolean and call
  `recordNotifyOutcome(env, 'telegram', ok)`. Failures are now counted + logged, not swallowed.

### C. Web Push — act on the status + count, and clean up 410

- `sendWebPush` already returns the status and counts it. Update the **caller** in `notifier.ts`
  (`sendTypedNotification`'s `push_subscriptions` loop) to inspect the returned status:
  - On `410` (Gone) or `404` (Not Found) → `DELETE FROM push_subscriptions WHERE endpoint = ?` for
    that endpoint (dead subscription cleanup). Log the cleanup.
  - On other failures → `recordNotifyOutcome(env, 'push', false, status)` (the existing
    `trackPushStatus`/recorder already counts; ensure failures are logged in prod, not dev-only).
  - On success → recorded ok.
- Remove the dev-only `devError` swallow on push send in favour of the recorder (which logs in prod).

### D. "Unreachable on every channel" is logged

In `notifyHostStaff` (and the leadership loop), when an intended recipient ends up with **no
Telegram** (`telegram_chat_id` null AND no KV `telegram-user:<id>`) **and no in-app** (no linked
user) — i.e. the notification reached nobody — emit a structured `console.warn` naming the
officer id + visit id (no PII beyond ids). This converts a silent drop into a visible signal.

## Error handling & privacy

- Counter/log writes are wrapped so they never throw into the delivery path (best-effort, like the
  existing `trackPushStatus`).
- **Logs carry IDs and statuses only** — never the visitor name, purpose, or message body — so
  observability doesn't leak visitor PII into logs.
- Delivery behaviour is otherwise unchanged: still `ctx.waitUntil`, still best-effort, no retries.

## Testing

- **Unit (vitest, mocked env):** `recordNotifyOutcome` increments the right KV key for ok/fail and
  never throws when KV fails. `sendTelegramMessage` returns false + logs on a non-OK fetch (mock
  `fetch`) and on a thrown fetch.
- **Unit:** the 410-cleanup branch issues a `DELETE ... WHERE endpoint = ?` when `sendWebPush`
  returns 410 (mock the DB + the push send).
- **Static:** api type-check; existing api test suite stays green (no behavioural regression to
  recipients/channels).
- **Manual (post-deploy):** trigger a check-in for an officer with a bad/stale chat ID → confirm a
  `notify` failure line appears in `wrangler tail`; confirm a 410 subscription is deleted.

## Out of scope (YAGNI)

- Retries, Cloudflare Queues, dead-letter (deferred).
- A queryable D1 delivery-audit table (chose logs + counters).
- Any change to recipients, linking, or the multi-receiver model (Spec B).
- A metrics dashboard UI (the KV counters are readable ad hoc; a UI can come later).
