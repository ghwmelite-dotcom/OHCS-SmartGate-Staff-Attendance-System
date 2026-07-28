# Clock Nudge Ladder — Design

**Date:** 2026-07-27 · **Status:** approved (RSIMD pilot request) · **Replaces:** single-shot morning `clock_reminder`

## Problem

The existing morning reminder fires once per day at the late threshold (~08:30) with a
generic message, globally deduped — one nudge, easy to miss, no follow-up, and **no
clock-out reminder exists at all**. For the RSIMD pilot we want persistent but polite
prompting that stops the instant the officer complies.

## Goals

- Morning: periodic clock-in nudges **from 08:00 until 11:00**, stopping as soon as the
  officer clocks in.
- Evening: clock-out nudges **after 17:00** for anyone clocked in but not yet clocked out.
- Target **activated accounts only** (`pin_acknowledged = 1`) — never nag accounts that
  haven't completed first login.
- Zero nag on weekends, public holidays, or days covered by an absence notice.

## Non-goals

- Email/SMS escalation (push + in-app only; revisit after pilot data).
- Clock-out auto-completion (attendance stays deliberately manual).
- Per-user reminder preferences (fleet-wide cadence for the pilot).

## Design

### Cadence model

Cron ticks every 15 min; each tick maps to a **30-minute slot**
(`slot = floor(nowMinutes / 30) * 30`). A tick only acts when its slot is in the active
window, and a **per-user-per-slot KV key** (`reminder:<dir>:<userId>:<date>:<slot>`,
TTL 24h) guarantees one send per slot per user even though two cron ticks land in each
slot. Compliance stops the ladder naturally: every tick re-queries clock status, so a
user who clocked in at 08:20 never appears in the 08:30+ queries.

| Window | Cron trigger | Active slots | Direction |
|---|---|---|---|
| Morning | `*/15 8-10 * * 1-5` + `0 11 * * 1-5` | 08:00–11:00 inclusive (7 slots) | clock-in |
| Evening | `*/15 17-18 * * 1-5` | 17:00, 17:30 (2 slots) | clock-out |

The morning window replaces the old `*/15 7-9 * * 1-5` trigger (the service previously
self-gated on `late_threshold_time`; the slot model subsumes that — the threshold now
only shapes the message tone).

### Audience (both directions)

- `is_active = 1` AND `pin_acknowledged = 1` (activated) AND has an identifier
  (`staff_id`/`nss_number`/`intern_code`).
- Holiday/weekend suppression via `getOfficeStatus()` (resilient holiday lookup already
  used by the kiosk path).
- Absence-notice suppression (same `NOT EXISTS` clause as the current reminder).
- Morning adds: no `clock_in` record today. Evening adds: has `clock_in`, no `clock_out`.

### Message ladder (push + in-app, deep link `/`)

Tone escalates with the morning; copy is personalised (first name) and uses the live
streak as loss-aversion once past the late threshold:

- **Before late threshold** (08:00, 08:30): "Good morning, Ama ☀️" / "Ready to clock in?
  One tap and you're set for the day."
- **Past threshold** (09:00–10:30): "You haven't clocked in yet" / streak hook when
  `current_streak > 1`: "Don't break your N-day streak 🔥 — tap to clock in now.",
  otherwise "It's past 08:30 — tap to clock in now."
- **Final slot 11:00**: "Last nudge for today" / "You still haven't clocked in — tap to
  record your attendance."
- **17:00**: "Wrapping up, Ama?" / "Don't forget to clock out before you leave."
- **17:30**: "Still showing as in office" / "Tap to clock out and close your day."

### Failure & observability

- Per-user send failures are caught and logged (existing pattern), never abort the run.
- The whole job is wrapped by the cron handler's try/catch + `alertAdminError`.
- No new settings flags: additive UX on existing `clock_reminder` notification type
  (evening uses a new `clock_out_reminder` type so notification filtering can tell them
  apart; both are in the `PUSH_WHITELIST` so they deliver as real web push).
- **Reach when the app is closed:** delivery rides on web push, which requires a
  per-device subscription. A post-login `PushNudgeBanner` in the staff PWA offers
  one-tap enable when the browser hasn't been asked yet (snoozes 14 days on "Not now";
  the Settings toggle remains the manual path).

## Data / privacy

No schema changes. KV gains small per-user-per-slot dedupe keys (24h TTL). Message copy
carries first name + streak count only — same PII class as the existing reminder.
