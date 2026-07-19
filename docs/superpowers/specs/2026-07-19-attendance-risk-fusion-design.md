# Attendance Risk Fusion Design
**Date:** 2026-07-19
**Status:** Draft

## Problem

Geofence, liveness, face-match, and re-auth run as **independent binary gates**. Each emits a signal; nothing combines them. Consequences:

- A `match_weak` face + boundary-line GPS + first-seen device passes three separate "pass" checks and attracts zero scrutiny, while each factor individually screamed for a second look.
- Enforcement is all-or-nothing per gate, so borderline cases either sail through or hard-fail into the manual-review queue with no prioritization.
- Signals that are currently free (GPS accuracy, re-auth method, travel plausibility, presence-token validity) are recorded but never used to make a decision.

**Constraint:** scoring must be **assistive, not punitive** — it prioritizes human review and tightens step-up auth; it does not auto-discipline staff. Shadow-first rollout, same discipline as the liveness and presence-QR launches.

---

## Solution Overview

A server-side pure function computes a **risk score** (0–100) from the signals already present at clock time. The score and its contributing factors are persisted on the `clock_records` row. Score bands drive graduated responses: fast path → review flag → step-up auth → (enforce mode only) block.

Runs in `src/services/clock-reauth.ts`/clock submit path, after liveness and face-match verdicts exist.

---

## Section 1 — Risk Factors & Weights

**New file:** `packages/api/src/services/risk-score.ts`

`computeRiskScore(input: RiskInput): { score: number; factors: RiskFactor[] }` — pure, unit-testable, no I/O. Callers assemble `RiskInput`; each factor records `{ name, weight, detail }` for explainability.

| Factor | Condition | Weight |
|--------|-----------|--------|
| `face_match` | `match_strong` | −20 |
| | `no_reference` | +15 |
| | `match_weak` | +25 |
| | `match_fail` / `match_error` | +50 |
| `liveness` | pass | 0 |
| | manual review submitted | +20 |
| | fail | +50 |
| `reauth_method` | WebAuthn assertion | 0 |
| | PIN fallback | +10 |
| `geofence_margin` | >25m inside polygon edge | 0 |
| | within buffer zone | +10 |
| | outside polygon, accepted via accuracy buffer | +20 |
| `gps_accuracy` | ≤15m | 0 |
| | 15–30m | +10 |
| | reported 0.0m (spoofer tell) | +25 |
| `presence` (once presence QR is live) | valid token | −15 |
| | none / pending | +10 |
| | reception override | +20 |
| `travel_plausibility` | >500m from previous clock event <10 min ago | +40 |
| `device_novelty` | first clock from this `device_id` for this user | +10 |

Score is clamped to [0, 100]. Negative weights let strong signals actively clear borderline ones — a `match_strong` + valid presence token offsets a weak-GPS day.

**Tuning path:** all weights live in a single `WEIGHTS` constant at the top of the file. Shadow-mode data (Section 4) drives any adjustment before enforcement.

---

## Section 2 — Data Model

### `migration-clock-risk.sql`

```sql
ALTER TABLE clock_records ADD COLUMN risk_score INTEGER;
ALTER TABLE clock_records ADD COLUMN risk_factors TEXT;  -- JSON array of {name, weight, detail}
```

Additive only, per D1-FK-safe discipline. Registered in `migrations-index.ts`.

### Device novelty

Client generates a persistent random `device_id` (UUID in IndexedDB; survives SW updates) and sends it with each clock submit. Server tracks first-seen per user in KV (`device:<user_id>` — set of hashes, no PII). No new table.

### `app_settings`

New key: `risk_fusion_mode` — `0` off (default), `1` shadow (compute + persist + log only), `2` enforce (bands below take effect). Exposed via `admin-settings.ts`.

---

## Section 3 — Decision Bands

| Score | Band | Effect (enforce mode) |
|-------|------|----------------------|
| 0–29 | Clear | Normal flow |
| 30–59 | Review flag | Clock succeeds; row flagged; surfaces in AttendanceTab filter + manual-review queue |
| ≥60 | Step-up / block | Clock refused with "please verify at reception" unless liveness + WebAuthn both passed cleanly (no PIN fallback accepted); otherwise routes to manual review |

In **shadow mode** (`1`): all clock-ins succeed; score + factors are persisted and a structured `devLog`-style line is emitted. This builds the calibration dataset.

Hard blocks in enforce mode additionally require `liveness=fail` **or** `face_match=match_fail` among the factors — a high score from weak-but-innocent signals alone (new device + bad GPS day) can never block, only flag. This is the proportionality guardrail.

---

## Section 4 — Calibration & Admin UI

### Shadow-phase analysis (before enforce)

After 2 weeks of shadow data, the superadmin reviews:
- Score distribution per directorate (`GET /api/admin/attendance/risk-distribution` — new lightweight read endpoint)
- Top contributing factors by frequency
- Flagged-row sample audit: were ≥30 scores genuinely suspicious?

Weights and band thresholds are adjusted once, from evidence, before `risk_fusion_mode=2`.

### AttendanceTab changes

- **Risk badge** per record: green (<30), amber (30–59), red (≥60); tooltip lists contributing factors
- **Filter chips**: All / Flagged / High-risk
- Manual-review queue (existing liveness review UI) gains risk-flagged rows as a second source

### Audit

`recordAudit` on: enforce-mode blocks (`clock.risk_block`), mode changes, and manual-review dispositions of flagged rows.

---

## Section 5 — Interaction with Presence QR

The `presence` factor is inert (weight 0, recorded as `not_deployed`) until `presence_qr_mode ≥ 1` (see `2026-07-19-presence-qr-design.md`). When the QR launches in shadow mode, risk fusion consumes its verdicts read-only; when either feature is enforce-mode, the other is unaffected. The two rollouts are independent but share the shadow → calibrate → enforce discipline.

---

## Rollout

1. Migration + `risk-score.ts` + persist on every clock (`risk_fusion_mode=1`)
2. Two weeks of shadow data → distribution review → weight/threshold calibration
3. AttendanceTab badges + filters ship (read-only value even in shadow)
4. `risk_fusion_mode=2`, starting with review-flag band only; enable the ≥60 block band one month later if flag precision holds

---

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/services/risk-score.ts` | New — pure scoring function + WEIGHTS |
| `packages/api/src/services/risk-score.test.ts` | New — unit tests per factor + band edges |
| `packages/api/src/routes/clock.ts` | Assemble RiskInput, score, persist, enforce bands |
| `packages/api/src/db/migration-clock-risk.sql` | New — additive columns |
| `packages/api/src/db/migrations-index.ts` | Register migration |
| `packages/api/src/db/schema.sql` | Add risk columns to `clock_records` CREATE TABLE |
| `packages/api/src/services/settings.ts` | `risk_fusion_mode` key |
| `packages/api/src/routes/admin-settings.ts` | Expose mode toggle |
| `packages/api/src/routes/attendance.ts` | Risk fields in records SELECT; risk-distribution endpoint |
| `packages/staff/src/lib/api.ts` | Send persistent `device_id` with clock submit |
| `packages/staff/src/lib/deviceId.ts` | New — IndexedDB-persisted UUID |
| `packages/web/src/components/admin/AttendanceTab.tsx` | Risk badge, tooltip, filter chips |
| `packages/web/src/components/admin/SettingsModal.tsx` | Mode toggle |
