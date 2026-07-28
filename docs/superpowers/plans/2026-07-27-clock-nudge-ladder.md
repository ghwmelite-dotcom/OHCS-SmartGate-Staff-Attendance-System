# Clock Nudge Ladder — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-27-clock-nudge-ladder-design.md` · **Date:** 2026-07-27

## Steps

1. **`packages/api/src/services/reminders.ts`** — rework `sendClockReminders`:
   - Slot model: `slot = floor(nowMin/30)*30`; morning active slots 480–660 inclusive.
   - Audience query: add `pin_acknowledged = 1`, select `current_streak`; drop the old
     global KV dedupe and threshold self-gate.
   - Holiday suppression via `getOfficeStatus(env, now)` (skip when `reason` is
     `holiday` or `weekend`).
   - Per-user-per-slot KV dedupe `reminder:in:<userId>:<date>:<slot>` (TTL 86400).
   - Message ladder via exported pure builder `buildClockInMessage(slot, thresholdMin,
     firstName, streak)` (threshold from `settings.late_threshold_time`).
   - Export pure helpers `morningSlot(nowMin)`, `eveningSlot(nowMin)` for tests.
   - New `sendClockOutReminders(env)`: slots 1020/1050; query activated users with a
     clock_in and no clock_out today (+ absence suppression); dedupe
     `reminder:out:<userId>:<date>:<slot>`; type `clock_out_reminder`; message builder
     `buildClockOutMessage(slot, firstName)`.
2. **`packages/api/src/index.ts`** — scheduled switch: replace case
   `'*/15 7-9 * * 1-5'` with `'*/15 8-10 * * 1-5'` and `'0 11 * * 1-5'` (both →
   `sendClockReminders`); add case `'*/15 17-18 * * 1-5'` → `sendClockOutReminders`
   with its own try/catch + `alertAdminError('cron:clock-out-reminders', err)`.
3. **`packages/api/wrangler.toml`** — crons: swap `"*/15 7-9 * * 1-5"` →
   `"*/15 8-10 * * 1-5"`, add `"0 11 * * 1-5"` and `"*/15 17-18 * * 1-5"`.
4. **Tests — `packages/api/src/services/reminders.test.ts`**:
   - Pure: `morningSlot`/`eveningSlot` gating (boundaries 07:59/08:00/11:00/11:15,
     16:59/17:00/17:30/17:45/18:00).
   - Pure: `buildClockInMessage` tone transitions (before/after threshold, streak vs no
     streak, final slot); `buildClockOutMessage` per slot.
   - Audience SQL via node:sqlite (pattern from `admin-nss-export.test.ts`): eligible
     user included; clocked-in, inactive, unactivated (`pin_acknowledged=0`),
     identifier-less, and absence-notice users excluded. Export the query as
     `buildClockInNudgeQuery()` / `buildClockOutNudgeQuery()` as single source of truth.
5. **Docs page** — update the attendance/reminders feature card in
   `packages/web/src/docs/content.ts` to describe the nudge ladder.
6. **Verify** — `tsc --noEmit` + `vitest run` in `packages/api` and `packages/web`.
7. **Commit + push** — `feat(attendance): clock nudge ladder…`; watch CI to green.
   Confirm the three new/updated cron triggers registered after deploy (Cloudflare
   dashboard or `wrangler deployments list` output in CI logs).

## Notes / risks

- Cron trigger changes apply on Worker deploy — no migration, no hard gate.
- The old global dedupe key `reminder-sent:<date>` disappears; new keys are per-user.
- Ghana = UTC year-round, so `getUTCHours()` is local time (same assumption as the
  existing reminder + `getOfficeStatus`).
