# Waiting-Time SLA + Evacuation Roll Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

Two "who needs attention / who is inside" surfaces for reception and security.

---

## Feature A — Waiting-Time SLA

### Problem

A checked-in visitor with no host response is invisible until someone
complains. The `host_response` column (shipped today) gives the signal:
**waiting = `status='checked_in'` AND `host_response` IS NULL.**

### Dashboard (this workstream owns `DashboardPage.tsx`)

- Active-visits list shows each row's wait (mm since check-in) and colors it:
  default < 15 min, amber ≥ 15, red ≥ 30. Sort: longest wait first (waiting
  rows above answered rows).
- Pure client-side from fields already returned.

### Escalation cron

- `wrangler.toml` + `index.ts scheduled()`: `*/15 8-17 * * 1-5` →
  `runSlaEscalation(env)` (new `services/sla-escalation.ts`, same
  try/catch + `alertAdminError('cron:sla-escalation')` pattern).
- Job: open visits waiting ≥ 30 min, grouped by directorate → one
  `sla_breach` notification per directorate to its `directorate_receivers`
  officers' user accounts (in-app + push; whitelist seeded) AND Telegram admin
  chat summary. Per-visit dedupe in KV (`sla-alerted:<visit_id>`, 24h TTL) so a
  visit alerts once. Zero breaches → log only.
- `escapeHtml` everywhere; pure `buildSlaMessage` factored out for tests.

---

## Feature B — Evacuation Roll

### Problem

Fire drill or real evacuation: nobody can answer "who is in the building
right now" without digging through two apps.

### API

`GET /api/reports/evacuation` (in `routes/reports.ts`; roles
`receptionist`, `admin`, `superadmin`, `it` — security desk uses `it`):

```json
{ "data": {
    "generated_at": "...",
    "visitors": [{ "name", "badge_code", "host_name", "directorate", "since", "party_size" }],
    "staff":    [{ "name", "staff_id", "directorate", "since" }],
    "counts":   { "visitors": 12, "staff": 40, "total": 52 }
} }
```

- visitors: `status='checked_in'` (includes party_size — a delegation counts
  as its size in `counts.visitors` via `SUM(COALESCE(party_size,1))`).
- staff: today's `clock_records` latest-per-user with no later clock-out
  (same "who is clocked in" logic the attendance overview uses — read that
  query and mirror it; NSS/interns included).

### Web

Dashboard header gets an **"Evacuation Roll"** button (reception+ roles) →
modal/page section rendering the two lists with counts, a generated-at stamp,
and a **Print** action (dedicated print stylesheet: plain table, no app
chrome — `@media print` hiding everything but the roll). Optional
"Send to Telegram admin chat" button → `POST /api/reports/evacuation/notify`
(same guard) which Telegrams the counts + lists.

---

## Out of Scope

- No SLA for "answered but not collected" (waiting-area limbo v2).
- No geofence-based staff presence for the roll (clock records are the source
  of truth, documented on the printout footer).
- No SMS (provider-gated separately).

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/services/sla-escalation.ts` + test | New |
| `packages/api/src/index.ts` + `wrangler.toml` | `*/15 8-17 * * 1-5` cron case |
| `packages/api/src/routes/reports.ts` | `GET /evacuation` + `POST /evacuation/notify` |
| `packages/web/src/pages/DashboardPage.tsx` | wait-time colors/sort; Evacuation Roll modal + print CSS |

## Verification

- `tsc --noEmit` + `vitest run` (sla message tests; evacuation query shape via
  node:sqlite pattern if feasible).
- Prod: cron trigger visible after deploy; force a 30-min test visit to watch
  the escalation (or temporarily lower the threshold locally).
