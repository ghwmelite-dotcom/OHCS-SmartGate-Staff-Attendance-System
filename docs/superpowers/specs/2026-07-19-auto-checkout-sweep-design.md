# Auto-Checkout Sweep Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

## Problem

Visitors who leave without scanning out keep their badge "active" forever —
the visit log silently leaks across days, "In Building" counts drift, and the
evening security picture ("who is actually still here?") is unknowable. The
data already exists (`visits.check_out_at IS NULL`); what's missing is the
daily nudge and a one-tap way to close the day.

**Constraint:** the sweep **flags and notifies; humans check out**. No
automatic checkout — a visitor may legitimately be in a late meeting, and the
record should reflect a human decision.

---

## Section 1 — Sweep Job (API)

### `packages/api/src/services/checkout-sweep.ts` (new)

`runCheckoutSweep(env)`:
1. Skip when the office is closed (reuse `getOfficeStatus` — weekends/holidays
   need no sweep).
2. Query open visits: `SELECT id, visitor first/last, badge_code, host name,
   check_in_at FROM visits v JOIN visitors … WHERE v.check_out_at IS NULL
   ORDER BY check_in_at` (all open visits, not just today's — yesterday's
   stragglers are the whole point).
3. If zero: log `[SWEEP] clear` and exit (no notifications — silence means
   clean).
4. Otherwise notify on two channels:
   - **In-app + push** to users with role `receptionist`, `admin`, `superadmin`
     via `sendTypedNotification`, new type `checkout_sweep` — added to
     `PUSH_WHITELIST` in `notifier.ts` (one-line change; in-app notifications
     table already accepts arbitrary types).
   - **Telegram** to the admin chat (same `telegram-admin-chat-id` KV key the
     daily summary uses; reuse `sendTelegramMessage`, `escapeHtml` on all
     visitor fields per the security convention).
   Message: count + up to 10 name/badge lines + "Open the dashboard to check
   them out." Non-fatal per channel (log + continue), `recordNotifyOutcome`
   where the pattern applies.

### Cron wiring

- `wrangler.toml`: add `15 17 * * 1-5` (17:15 weekdays — after the 17:00
  default close; working hours are a settings concept, the sweep time is a
  fixed ops choice and needs no settings key).
- `index.ts` `scheduled()`: new `case '15 17 * * 1-5'` → `runCheckoutSweep`,
  wrapped in the established try/catch + `alertAdminError('cron:checkout-sweep')`
  pattern.

---

## Section 2 — One-Tap Bulk Checkout (API + web)

### `POST /api/visits/bulk-checkout` (in `packages/api/src/routes/visits.ts`)

- Guard: `requireRole(c, 'receptionist', 'admin', 'superadmin')` (mirrors the
  roles that can already check out).
- Body (zod): `{ ids?: string[] }` — when omitted, targets **all** currently
  open visits; when given, only those ids.
- Executes a single guarded UPDATE:
  `UPDATE visits SET check_out_at = <now ISO> WHERE check_out_at IS NULL
   [AND id IN (...)]`, returns `{ checked_out: <changes> }`.
- Deliberately does **not** fan out per-visit notifications (end-of-day
  cleanup should not spam hosts) and does not touch `checkout_pin` records.
- `recordAudit` — `visit.bulk_checkout`, summary with count + actor.

### Dashboard banner (web)

`packages/web/src/pages/DashboardPage.tsx`: when the "In Building" count is
non-zero **and** the local time is past office close (read from the existing
settings query used by AttendanceTab, or a simple 17:00 constant matching the
default — prefer the settings value when loaded), show an amber banner card
above Active Visits:

> **N visitor(s) still marked in building.** The office has closed — please
> verify and check them out. [ Check out all ]

Button calls `POST /visits/bulk-checkout`, invalidates the dashboard queries,
shows a success toast with the count. During office hours nothing renders —
active visits are normal then.

---

## Section 3 — Out of Scope

- No auto-checkout on a timer (human decision, always).
- No per-directorate breakdown in the alert (v1 keeps one list; the dashboard
  already filters by directorate).
- No visitor-facing "you forgot to check out" message (visitors have no app).

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/services/checkout-sweep.ts` | New |
| `packages/api/src/services/checkout-sweep.test.ts` | New — message builder + zero-case |
| `packages/api/src/services/notifier.ts` | `checkout_sweep` added to `PUSH_WHITELIST` |
| `packages/api/src/routes/visits.ts` | `POST /bulk-checkout` |
| `packages/api/src/index.ts` | Cron case |
| `packages/api/wrangler.toml` | Add `15 17 * * 1-5` cron |
| `packages/web/src/pages/DashboardPage.tsx` | Still-in-building banner + button |

## Verification

- `tsc --noEmit` + `vitest run` (api incl. sweep tests; web).
- Local: seed an open visit, run the sweep handler, confirm alert content;
  call bulk-checkout as receptionist, confirm count + row closed + audit row.
- Prod: verify the new cron appears in the Worker triggers after deploy; first
  weekday 17:15 run sends the alert.
