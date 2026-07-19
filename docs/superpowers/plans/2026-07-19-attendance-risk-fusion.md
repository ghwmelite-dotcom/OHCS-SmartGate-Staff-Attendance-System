# Attendance Risk Fusion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Combine the independent clock-in signals (geofence margin, GPS accuracy, liveness, re-auth method, travel plausibility, device novelty — and later face-match + presence) into a single server-side **risk score (0–100)** persisted on each `clock_records` row, with graduated bands (clear → review-flag → step-up/block) behind a shadow-first rollout. Spec: `docs/superpowers/specs/2026-07-19-attendance-risk-fusion-design.md`.

**Architecture:** A pure, no-I/O scoring function `packages/api/src/services/risk-score.ts` (all weights in one `WEIGHTS` constant) is called from the existing clock submit path (`routes/clock.ts`) after re-auth/liveness verdicts and geofence math exist, before the `clock_records` INSERT. Two additive `ALTER` columns hold `risk_score` + `risk_factors` (JSON, explainability). `app_settings.risk_fusion_mode` (0 off / 1 shadow / 2 enforce) mirrors the existing enforce-flag pattern; a second flag `risk_fusion_block_enabled` (0/1) implements the spec's "enforce flags-only first, enable the ≥60 block band a month later" rollout step **without a redeploy**. The staff PWA sends a persistent IndexedDB-stored `device_id`; the server tracks first-seen devices per user in KV (`device:<user_id>`, hashed, no PII). Admin surfaces: risk badge + filter chips in `AttendanceTab`, a three-way mode toggle in `SettingsModal`, and a read-only `risk-distribution` endpoint for calibration.

**Tech:** Hono + D1 + KV (`packages/api`), React + Vite (`packages/staff`, `packages/web`), Zod, vitest.

**Toolchain (never `npm run`):** API (from `packages/api`) tc `node ../../node_modules/typescript/bin/tsc --noEmit`, tests `node ../../node_modules/vitest/vitest.mjs run`; Staff + Web (from each package) tc + `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`, tests `node ../../node_modules/vitest/vitest.mjs run`; wrangler db `smartgate-db` via `node "<repo>/node_modules/wrangler/bin/wrangler.js"`.

**Defaults locked:** bands `REVIEW_THRESHOLD = 30`, `BLOCK_THRESHOLD = 60`; score clamped [0, 100]; proportionality guardrail — a hard block additionally requires a `liveness=fail` **or** `face_match=match_fail` factor; presence factor ships inert (all weights 0).

**Grounding notes (read-code findings that shape the plan):**
- **Face-match is not implemented in code** — it exists only as `docs/superpowers/specs/2026-04-29-clockin-face-match-design.md` (verdict enum `not_enforced|no_reference|match_strong|match_weak|match_fail|match_error`, column `clock_records.match_status`). `RiskInput.faceMatchStatus` is therefore optional and the clock route passes `null` today; the factor is absent until that feature ships. The type union uses the 2026-04-29 enum so wiring later is one line.
- **Presence QR is design-only too** (`docs/superpowers/specs/2026-07-19-presence-qr-design.md`; the program references a plan at `docs/superpowers/plans/2026-07-19-presence-qr.md`, not present at time of writing). Its `presence_method` column (`'qr'|'qr_pending'|'none'|'override'`) does not exist yet. This plan does **not** duplicate any presence-QR work — the `presence` factor ships weight-0 with a marked wiring point.
- **Offline replay:** the staff offline queue (`packages/staff/src/lib/offlineQueue.ts`) replays JSON clock submissions with **no** `prompt_id`/frames → server sees `reauthMethod=null`, `livenessDecision=null`. Those inputs simply contribute no factors; geofence/GPS/device/travel still score. `device_id` rides inside the queued body, so replays keep it.
- **Liveness shadow mode defers verification** (`deferLivenessVerification`, `clock.ts:455-489`) — the row is inserted with NULL liveness fields and UPDATEd in a `waitUntil`. Risk scoring follows the same pattern: score at INSERT with liveness `'pending'`, recompute in the same background closure when the verdict lands.
- **Admin settings UI is `SettingsModal.tsx`** (the spec's file table says `SettingsSection.tsx` — that file does not exist). The "manual-review queue" the spec references is the AttendanceTab liveness surface (`LivenessPill` + `LivenessEvidenceCard`); there is no separate queue page and no existing disposition endpoint, so a minimal risk-disposition endpoint is included (spec §4 requires auditing dispositions).
- **Endpoint mount deviation:** spec says `GET /api/admin/attendance/risk-distribution`; all attendance admin reads live under `/api/attendance/*` with an in-handler `requireAdmin` guard (`attendance.ts:11-14`), so the endpoint is `GET /api/attendance/risk-distribution` — same guard, repo-consistent mount.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/api/src/db/migration-clock-risk.sql` | Create | Additive columns + backfill |
| `packages/api/src/db/migrations-index.ts` | Modify | Register migration (last entry) |
| `packages/api/src/db/schema.sql` | Modify | Risk columns in `clock_records` + `app_settings` CREATE TABLEs |
| `packages/api/src/services/risk-score.ts` | Create | Pure `computeRiskScore`, `WEIGHTS`, band + guardrail helpers |
| `packages/api/src/services/risk-score.test.ts` | Create | Unit tests per factor + band edges + guardrail |
| `packages/api/src/services/settings.ts` | Modify | `risk_fusion_mode` + `risk_fusion_block_enabled` keys |
| `packages/api/src/routes/admin-settings.ts` | Modify | Expose both keys (GET/PUT, audited) |
| `packages/api/src/routes/clock.ts` | Modify | Assemble `RiskInput`, score, persist, band enforcement, device KV, travel query, deferred recompute |
| `packages/api/src/routes/attendance.ts` | Modify | Risk fields in `/records`; `risk-distribution`; `risk-disposition` |
| `packages/staff/src/lib/deviceId.ts` | Create | IndexedDB-persisted UUID |
| `packages/staff/src/lib/api.ts` | Modify | `deviceId` on `ClockSubmission` |
| `packages/staff/src/pages/ClockPage.tsx` | Modify | Send `device_id` on both submit paths |
| `packages/web/src/components/admin/AttendanceTab.tsx` | Modify | Risk badge + tooltip, filter chips, disposition action |
| `packages/web/src/components/admin/SettingsModal.tsx` | Modify | Mode toggle + block-band checkbox |

---

## Task 1: Data model + settings

**Files:** create `packages/api/src/db/migration-clock-risk.sql`; modify `db/migrations-index.ts`, `db/schema.sql`, `services/settings.ts`, `routes/admin-settings.ts`.

- [ ] **Step 1: Migration (additive ALTER — D1-safe, no rebuild).** Mirror the style of `migration-passive-liveness.sql` (nullable columns + `UPDATE ... COALESCE` backfill, since D1 `ADD COLUMN` can't take non-constant defaults):
```sql
-- Attendance risk fusion — companion spec: 2026-07-19-attendance-risk-fusion-design.md
-- Score + explainability on each clock event; mode flags on app_settings.

ALTER TABLE clock_records ADD COLUMN risk_score INTEGER;
ALTER TABLE clock_records ADD COLUMN risk_factors TEXT;  -- JSON array of {name, condition, weight, detail}
ALTER TABLE clock_records ADD COLUMN risk_disposition TEXT
  CHECK (risk_disposition IN ('dismissed','escalated') OR risk_disposition IS NULL);

-- Partial index serves the AttendanceTab flagged/high-risk filters and the
-- risk-distribution endpoint without scanning unscored rows.
CREATE INDEX IF NOT EXISTS idx_clock_records_risk_score
  ON clock_records(risk_score) WHERE risk_score >= 30;

ALTER TABLE app_settings ADD COLUMN risk_fusion_mode INTEGER;
ALTER TABLE app_settings ADD COLUMN risk_fusion_block_enabled INTEGER;

UPDATE app_settings
   SET risk_fusion_mode          = COALESCE(risk_fusion_mode, 0),
       risk_fusion_block_enabled = COALESCE(risk_fusion_block_enabled, 0)
 WHERE id = 1;
```
Register as the LAST entry in `migrations-index.ts` (import + array). Add all five columns to the `clock_records` (`schema.sql:162-182`) and `app_settings` CREATE TABLEs in `schema.sql`.

- [ ] **Step 2: `services/settings.ts`.** Add to `AppSettings`: `risk_fusion_mode: number; // 0 = off, 1 = shadow (persist+log only), 2 = enforce` and `risk_fusion_block_enabled: number; // 0 = ≥60 band flags only, 1 = ≥60 may block (guardrail still applies)`. DEFAULTS both `0`. Add both columns to the SELECT in `getAppSettings` (`settings.ts:56-61`).

- [ ] **Step 3: `routes/admin-settings.ts` (superadmin PUT, admin GET).** Mirror the existing enforce-flag pattern exactly:
  - `SETTINGS_COLUMNS` += `risk_fusion_mode, risk_fusion_block_enabled`
  - `settingsSchema` += `risk_fusion_mode: z.number().int().min(0).max(2).optional(), risk_fusion_block_enabled: z.number().int().min(0).max(1).optional()`
  - `before` SELECT += both columns; keep-when-omitted fallback like `reauthEnforce`/`livenessEnforce` (`admin-settings.ts:61-62`); UPDATE SET += both columns, bound in order.
  - `AUDITED_SETTINGS_FIELDS` += both — mode changes are then audited via the existing `settings.update` + `diffRecords` path (satisfies spec §4 "mode changes" audit with zero new code).

- [ ] **Step 4: Apply locally + verify.** Re-init local D1 (`wrangler d1 execute smartgate-db --local --file=src/db/schema.sql`) or run the migration file directly; confirm columns via `SELECT sql FROM sqlite_master WHERE name='clock_records'`. API tc green. Commit: "feat(risk): clock_records risk columns + risk_fusion_mode/block settings (DB + admin settings)".

---

## Task 2: Pure scoring function + unit tests (TDD)

**Files:** create `packages/api/src/services/risk-score.ts`, `packages/api/src/services/risk-score.test.ts`.

- [ ] **Step 1: Write the failing test file first** (cases below), then implement.

- [ ] **Step 2: `risk-score.ts`.** Single `WEIGHTS` constant at the top — the only tuning surface; presence weights are **0 with the spec's intended values in comments** (inert until presence-QR ships; flipping them is the entire presence-side "launch"):
```ts
// Attendance risk fusion — spec: docs/superpowers/specs/2026-07-19-attendance-risk-fusion-design.md
// Pure scoring: no I/O, no Date.now() except via injected `now`. Callers assemble RiskInput.

export const WEIGHTS = {
  faceMatch:   { match_strong: -20, no_reference: 15, match_weak: 25, match_fail: 50, match_error: 50 },
  liveness:    { pass: 0, manual_review: 20, fail: 50, skipped: 0 },
  reauth:      { webauthn: 0, pin: 10 },
  geofence:    { inside_deep: 0, inside_near_edge: 0, wall_buffer: 10, accuracy_buffer: 20 },
  gpsAccuracy: { good: 0, medium: 10, zero_spoof_tell: 25 },
  // INERT until presence-QR ships (2026-07-19-presence-qr-design.md). Intended: valid -15, none_or_pending +10, override +20.
  presence:    { valid: 0, none_or_pending: 0, override: 0, not_deployed: 0 },
  travel:      { impossible: 40 },
  device:      { first_seen: 10 },
} as const;

export const REVIEW_THRESHOLD = 30;   // 30–59 → review flag
export const BLOCK_THRESHOLD = 60;    // ≥60  → step-up / block (guardrail-gated)
```

Types — `condition` is the WEIGHTS key that fired (makes the guardrail robust against weight retuning); `detail` is the human-readable explainability string. Spec's `{name, weight, detail}` triple plus `condition`:
```ts
export type FaceMatchStatus = 'not_enforced' | 'no_reference' | 'match_strong' | 'match_weak' | 'match_fail' | 'match_error';
export type RiskBand = 'clear' | 'review' | 'high';
export interface RiskFactor { name: string; condition: string; weight: number; detail: string }
export interface RiskInput {
  faceMatchStatus?: FaceMatchStatus | null;   // null today — face-match not yet shipped (2026-04-29 spec)
  livenessDecision?: 'pass' | 'fail' | 'manual_review' | 'skipped' | null;
  reauthMethod?: 'webauthn' | 'pin' | null;
  geofence: { inside: boolean; edgeMarginMeters: number | null;  // distance to polygon edge (inside) — null if not computed
              outsideDistanceMeters: number; wallBufferMeters: number }; // accepted-beyond-wall-buffer ⇒ accuracy buffer
  gpsAccuracyMeters?: number;                 // undefined = not reported
  presence?: 'valid' | 'none_or_pending' | 'override' | 'not_deployed';
  previousEvent?: { distanceMeters: number; minutesAgo: number } | null;
  deviceFirstSeen?: boolean;
}
export function computeRiskScore(input: RiskInput): { score: number; factors: RiskFactor[] }
export function riskBand(score: number): RiskBand
/** Proportionality guardrail: weak-but-innocent signals alone can never block. */
export function isBlockable(factors: RiskFactor[]): boolean {
  return factors.some(f =>
    (f.name === 'liveness' && f.condition === 'fail') ||
    (f.name === 'face_match' && f.condition === 'match_fail'));
}
```

Factor rules (each records a factor even at weight 0 when its signal was evaluated — explainability; absent inputs record nothing):
- `face_match`: only when `faceMatchStatus` is set and not `not_enforced`; weight per WEIGHTS.faceMatch.
- `liveness`: only when `livenessDecision` set; `skipped` → weight 0, detail `'ai_unavailable'` (infra failure is never punitive — same discipline as the kiosk id-check).
- `reauth_method`: only when set (offline replays have none → no factor, no penalty).
- `geofence_margin`: `!inside && outsideDistance > wallBuffer` → `accuracy_buffer` +20; `!inside` else → `wall_buffer` +10; `inside && edgeMargin > 25` → `inside_deep` 0; `inside && edgeMargin ≤ 25` → `inside_near_edge` 0. **Spec-gap note:** the spec table weights only three of these four conditions; inside-near-edge is unlisted, so it scores 0 with the condition recorded — calibration (Task 8) may assign a weight from evidence.
- `gps_accuracy`: `=== 0` → `zero_spoof_tell` +25; `≤15` → 0; `15 < a ≤ 30` → +10. (`>30` never reaches scoring — rejected upstream by `MAX_GPS_ACCURACY_METERS`, `clock.ts:337-344`.)
- `presence`: record the condition with weight from WEIGHTS.presence (all 0 — inert).
- `travel_plausibility`: `previousEvent && distanceMeters > 500 && minutesAgo < 10` → +40.
- `device_novelty`: `deviceFirstSeen === true` → +10.
- Sum, clamp to [0, 100]. Negative weights (match_strong, later presence valid) actively clear borderline positives.

- [ ] **Step 3: Tests** (`vitest run risk-score` → PASS). Cover:
  - Each `face_match` condition incl. `match_strong` −20; `null`/`not_enforced` → no factor.
  - Liveness: pass 0, manual_review +20, fail +50, skipped 0 recorded, null → absent.
  - Re-auth: webauthn 0, pin +10, null → absent.
  - Geofence: all four conditions (boundaries: edge margin exactly 25 → near_edge; outside distance exactly == wallBuffer → wall_buffer).
  - GPS: 15 → 0; 16 → +10; 30 → +10; 0.0 → +25.
  - Presence: every condition present-but-weight-0 (locks the inert contract).
  - Travel: 600m/5min → +40; 600m/10min → none; 400m/5min → none; null previous → none.
  - Device: first-seen +10; known/absent → none.
  - Clamp: many positives → exactly 100; `match_strong` (−20) + pin (+10) → floor 0 behavior; offset case (`match_strong` −20 + wall_buffer +10 + gps medium +10 → 0).
  - Band edges: craft inputs summing to exactly 29 → `clear`, 30 → `review` (e.g. manual_review 20 + pin 10), 59 → `review`, 60 → `high`.
  - Guardrail: `liveness fail` → true; `match_fail` → true; **`match_error` → false** (fail-only per spec); stacked innocent signals reaching 85 (device 10 + zero-GPS 25 + wall_buffer 10 + travel 40) → `isBlockable` false.

- [ ] **Step 4: API tc + `vitest run risk-score` green. Commit:** "feat(risk): pure computeRiskScore + WEIGHTS + band/guardrail helpers with unit tests".

---

## Task 3: Staff app — persistent `device_id`

**Files:** create `packages/staff/src/lib/deviceId.ts`; modify `packages/staff/src/lib/api.ts`, `packages/staff/src/pages/ClockPage.tsx`.

- [ ] **Step 1: `deviceId.ts`.** Own tiny IndexedDB database (`ohcs-device`, store `meta`) — deliberately **not** a version bump of `offlineQueue.ts`'s `ohcs-queue` DB (avoids coordinating `onupgradeneeded` across two openers). Survives SW updates (IDB is untouched by SW lifecycle); localStorage fallback if IDB is unavailable:
```ts
let memo: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (memo) return memo;
  try {
    const db = await open();                       // indexedDB.open('ohcs-device', 1), store 'meta'
    const existing = await idbGet(db, 'device_id');
    if (existing) return (memo = existing);
    const id = crypto.randomUUID();
    await idbPut(db, 'device_id', id);
    return (memo = id);
  } catch {
    const ls = localStorage.getItem('device_id');
    if (ls) return (memo = ls);
    const id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
    return (memo = id);
  }
}
```
No PII: random UUID, never tied to user identity client-side.

- [ ] **Step 2: `api.ts`.** `ClockSubmission` += `deviceId?: string`; the `payload` in `submitClock` (`api.ts:98-107`) += `device_id: input.deviceId`.

- [ ] **Step 3: `ClockPage.tsx`.** In the mutation (`ClockPage.tsx:91-122`): `const deviceId = await getDeviceId();` — pass into `apiSubmitClock({ ..., deviceId })` (multipart path) AND into the offline-queue body `clockData` (`{ ...rest, device_id: deviceId, ... }`) so queued replays carry the original device.

- [ ] **Step 4: Staff tc + build + tests green. Commit:** "feat(risk): persistent device_id sent with clock submit (staff PWA)".

---

## Task 4: Clock route — score, persist, enforce

**Files:** modify `packages/api/src/routes/clock.ts`.

- [ ] **Step 1: Schema.** `clockSchema` (`clock.ts:133-144`) += `device_id: z.string().uuid().optional()`.

- [ ] **Step 2: Scoring block — placement.** Insert AFTER the already-clocked / NOT_CLOCKED_IN checks (`clock.ts:371-389`), BEFORE `const id = ...` (:391): at this point `reauthMethod` (:233), `livenessDecision` (:284), `inside`, `distance`, `acc` (:353-357) all exist, and a block can still prevent the INSERT. Gate everything on `settings.risk_fusion_mode > 0` so mode 0 costs zero extra queries:
```ts
let riskScore: number | null = null;
let riskFactors: RiskFactor[] | null = null;
let deviceFirstSeen = false;

if (settings.risk_fusion_mode > 0) {
  // Device novelty — KV set of sha256(device_id) hashes per user, no PII.
  // Read-modify-write race is benign (worst case: novelty double-fires, +10).
  if (body.device_id) {
    const hash = await sha256Hex(body.device_id);   // from '../db/migrations-index' (audit.ts already imports it)
    const key = `device:${session.userId}`;
    const set: string[] = JSON.parse((await c.env.KV.get(key)) ?? '[]');
    if (!set.includes(hash)) {
      deviceFirstSeen = true;
      set.push(hash);
      await c.env.KV.put(key, JSON.stringify(set.slice(-20)), { expirationTtl: 180 * 86400 }); // sliding, self-cleaning
    }
  }

  // Impossible travel — previous clock event for this user.
  const prev = await c.env.DB.prepare(
    'SELECT latitude, longitude, timestamp FROM clock_records WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1'
  ).bind(session.userId).first<{ latitude: number | null; longitude: number | null; timestamp: string }>();

  const input: RiskInput = {
    faceMatchStatus: null, // face-match not shipped (2026-04-29 spec); wire match_status here when it lands
    livenessDecision,      // null in liveness-shadow mode — recomputed in the waitUntil below
    reauthMethod,
    geofence: {
      inside,
      edgeMarginMeters: inside ? distanceToNearestPolygonMeters(latitude, longitude) : null,
      outsideDistanceMeters: distance,
      wallBufferMeters: WALL_BUFFER_METERS,
    },
    gpsAccuracyMeters: accuracy,
    presence: 'not_deployed', // presence-QR wiring point — pass presence_method here when it ships
    previousEvent: prev?.latitude != null && prev?.longitude != null
      ? { distanceMeters: haversineMeters(prev.latitude, prev.longitude, latitude, longitude),
          minutesAgo: (Date.now() - new Date(prev.timestamp).getTime()) / 60000 }
      : null,
    deviceFirstSeen,
  };
  const r = computeRiskScore(input);
  riskScore = r.score; riskFactors = r.factors;
}
```
Add a small `haversineMeters` helper near the other geo math (the existing `distanceToSegmentMeters` projection style is fine at this scale — match file convention).

- [ ] **Step 3: Band enforcement (mode 2 only), immediately after scoring.** Shadow (`1`) never reaches this:
```ts
if (settings.risk_fusion_mode === 2 && riskScore !== null && riskScore >= BLOCK_THRESHOLD) {
  const stepUpClean = livenessDecision === 'pass' && reauthMethod === 'webauthn'; // PIN fallback not accepted
  if (!stepUpClean) {
    if (settings.risk_fusion_block_enabled === 1 && isBlockable(riskFactors!)) {
      await recordAudit(c.env, auditActorFromContext(c), {
        action: 'clock.risk_block', entityType: 'user', entityId: session.userId,
        summary: `Clock ${type} blocked: risk ${riskScore} (${riskFactors!.map(f => `${f.name}:${f.condition}`).join(', ')})`,
      });
      return error(c, 'RISK_BLOCK', 'This clock-in needs verification. Please see reception to complete it.', 422);
    }
    // Guardrail or flags-only stage: allow, flag, and let the High-risk filter route it to review.
    devLog(c.env, `[CLOCK_RISK] high score ${riskScore} allowed (guardrail/flags-only) user=${session.userId}`);
  }
}
```
Note: with liveness in shadow mode the verdict is `pending` at this point, so `isBlockable` is false → **no block is possible while liveness is unenforced**. That is the intended proportionality, not a bug; block-band go-live (Task 8) therefore also requires liveness enforce on.

- [ ] **Step 4: Persist.** Extend the INSERT (`clock.ts:394-411`) with `risk_score, risk_factors` bound to `riskScore` / `riskFactors ? JSON.stringify(riskFactors) : null` (NULL when mode 0). The dedup early-returns (:206-224, :418-436) are untouched — a deduplicated row keeps its original score.

- [ ] **Step 5: Deferred-liveness recompute.** In the `waitUntil` closure (:455-489), after the liveness UPDATE, when `settings.risk_fusion_mode > 0`: recompute with the same captured inputs plus the fresh `verification.decision`, then `UPDATE clock_records SET risk_score = ?, risk_factors = ? WHERE id = ?`. (Capture `riskScore`'s input pieces in the closure — mirror how `challenge`/`capturedFrames` are captured at :456-458.) Band enforcement is NOT re-run in the background — a pass/fail arriving late can only lower the score or, on fail, raise it for review; blocking after the fact is impossible and undesired.

- [ ] **Step 6: Shadow log.** After a successful insert, mode ≥ 1: `devLog(c.env, `[CLOCK_RISK] ${id} score=${riskScore} band=${riskBand(riskScore!)} factors=${...}`)` — dev/staging only (`devLog` is suppressed in production, `lib/log.ts:3-5`); the persisted columns are the production calibration dataset.

- [ ] **Step 7: API tc + full test suite green. Commit:** "feat(risk): score + persist + band enforcement on clock submit (shadow-capable, guardrail block)".

---

## Task 5: Read surface — records fields, distribution, disposition

**Files:** modify `packages/api/src/routes/attendance.ts`.

- [ ] **Step 1: `/records` SELECT** (`attendance.ts:124-139`) += `ci.risk_score as risk_score, ci.risk_factors as risk_factors, ci.risk_disposition as risk_disposition,`.

- [ ] **Step 2: `GET /attendance/risk-distribution`** (admin-guarded via existing `requireAdmin`; aggregate-in-JS pattern mirrors `/clock/admin/liveness-metrics`, `clock.ts:644-692`). Query `?days` default 14, clamp 1–30:
```ts
const rows = await c.env.DB.prepare(
  `SELECT cr.risk_score, cr.risk_factors, d.abbreviation
   FROM clock_records cr
   JOIN users u ON u.id = cr.user_id
   LEFT JOIN directorates d ON d.id = u.directorate_id
   WHERE cr.risk_score IS NOT NULL AND cr.timestamp >= ?`
).bind(since).all<{ risk_score: number; risk_factors: string | null; abbreviation: string | null }>();
```
Response shape:
```json
{ "days": 14, "since": "…", "total_scored": 812,
  "bands": { "clear": 700, "review": 98, "high": 14 },
  "histogram": [ { "min": 0, "max": 9, "count": 650 }, … 10 buckets ],
  "per_directorate": [ { "abbreviation": "IAU", "scored": 40, "avg_score": 12.5, "clear": 36, "review": 4, "high": 0 } ],
  "top_factors": [ { "name": "gps_accuracy", "condition": "medium", "count": 210, "total_weight": 2100 } ] }
```
`top_factors` from parsing `risk_factors` JSON in JS (ignore parse errors, like liveness-metrics does); sort by count desc, cap 10. This is the calibration instrument for spec §4 (distribution per directorate + top factors by frequency); flagged-row sampling uses the AttendanceTab chips (Task 6).

- [ ] **Step 3: `POST /attendance/records/:clockId/risk-disposition`** (admin). Body `z.object({ disposition: z.enum(['dismissed','escalated']) })`. Read the row first (404 if missing or `risk_score IS NULL`), `UPDATE clock_records SET risk_disposition = ? WHERE id = ?`, then `recordAudit` action `clock.risk_disposition` with `changes: diffRecords(before, after, ['risk_disposition'])` — satisfies spec §4 "manual-review dispositions of flagged rows" audit.

- [ ] **Step 4: API tc + tests green. Commit:** "feat(risk): risk fields in attendance records + risk-distribution + disposition endpoints".

---

## Task 6: Admin UI — badges, filters, settings toggle

**Files:** modify `packages/web/src/components/admin/AttendanceTab.tsx`, `packages/web/src/components/admin/SettingsModal.tsx`.

- [ ] **Step 1: `AttendanceTab.tsx` — data.** `AttendanceRecord` (:27-43) += `risk_score: number | null; risk_factors: string | null; risk_disposition: string | null;`.

- [ ] **Step 2: Risk badge.** A `RiskPill` next to the existing `LivenessPill` pattern (:541-549): green `<30`, amber `30–59`, red `≥60`, muted `—` when NULL (mode 0 / pre-migration rows); dismissed rows render the pill at reduced opacity with the disposition in the tooltip. Tooltip via `title` attr: parsed factors as `name +weight — detail` lines (guard `JSON.parse` in try/catch). New "Risk" column after "Liveness" in both `<th>` list (:399-412) and row cells; bump the expanded-row `colSpan` (:525) by one.

- [ ] **Step 3: Filter chips.** A small chip row beside the directorate select (:372-381): **All / Flagged / High-risk** → `useState<'all'|'flagged'|'high'>('all')`, folded into the `filteredRecords` memo (:151-159): flagged = `risk_score >= 30 && < 60`, high = `>= 60`. Client-side is correct here — the payload is a single day's rows.

- [ ] **Step 4: Disposition action.** On rows with `risk_score >= 30` and no disposition: compact Dismiss / Escalate buttons (admin + superadmin) calling Task 5 Step 3's endpoint via `useMutation`, `queryClient.invalidateQueries({ queryKey: ['attendance'] })` on success — mirror the existing `clearMutation` wiring (:71-90).

- [ ] **Step 5: `SettingsModal.tsx`.** Extend its `AppSettings` interface (:6-16) with `risk_fusion_mode?: number; risk_fusion_block_enabled?: number;`. In the "Clock-in security" section (:152-174) add:
  - "Risk fusion" three-way control (Off / Shadow / Enforce) — a `<select>` or three radio chips; helper text: "Shadow records scores without affecting clock-ins. Enforce flags risky clock-ins for review; blocking requires the block band below."
  - "Enable ≥60 block band" checkbox, disabled unless mode === 2; when checked show the existing warning-panel pattern (:168-172) with copy: "Blocks only fire when liveness or face-match independently failed — but staff can still be turned to reception. Keep off for the first month of enforce."
  - `handleSave` (:56-77) += both fields (always send; server keeps omitted values anyway).

- [ ] **Step 6: Web tc + tests + build green. Commit:** "feat(risk): attendance risk badges/filters/dispositions + risk-fusion settings toggle".

---

## Task 7: Verification

**Files:** none.

- [ ] **Step 1: Static.** API tc + full `vitest run`; staff tc + build + tests; web tc + tests + build. All green.
- [ ] **Step 2: Local smoke checklist** (wrangler dev + staff app on localhost, `risk_fusion_mode=1` via local settings):
  1. Clock in normally → D1 row has `risk_score` + `risk_factors` JSON; staff submit sent `device_id` (network tab); second clock from same browser → no `device_novelty` factor; devtools-cleared IDB (or another browser) → factor returns.
  2. `curl 'localhost:8787/api/attendance/risk-distribution?days=1'` with an admin session → shape matches Task 5; empty-state (no scored rows) returns zeros, not an error.
  3. Admin AttendanceTab → Risk column renders; Flagged/High-risk chips filter; Dismiss persists and audits.
  4. Settings modal → mode persists across reload; audit log shows `settings.update` with `risk_fusion_mode` diff.
  5. Offline replay: airplane-mode clock (no frames path) → queued body contains `device_id`; on flush, row scores without reauth/liveness factors.
  6. Enforce locally (`mode=2`, block on): a crafted ≥60 **without** liveness fail/match_fail → allowed + flagged (guardrail); block path itself is covered by unit tests + verified in shadow review before prod enable.
- [ ] **Step 3: Migration to prod (gated on user confirm).** Additive `ALTER ADD COLUMN` only (D1-safe, zero data risk). Apply `--remote --file=src/db/migration-clock-risk.sql` (or the in-app MigrationRunner), verify columns, ensure recorded in `applied_migrations`. Leave `risk_fusion_mode=0` until the deploy below is live.
- [ ] **Step 4: Deploy** — merge → `deploy.yml` green → set `risk_fusion_mode=1` (shadow) via Settings.

---

## Task 8: Calibration & enforce rollout (spec §4 + Rollout)

**Files:** none (ops/ops-review; one follow-up code change allowed).

- [ ] **Step 1: Shadow, 2 weeks.** `risk_fusion_mode=1`. No staff-visible change; AttendanceTab badges/filters already provide read-only value.
- [ ] **Step 2: Distribution review (superadmin).** Pull `/attendance/risk-distribution?days=14`: per-directorate bands, histogram, top factors. Sample ≥30 rows via the Flagged chip + disposition buttons: were they genuinely suspicious? Track dismissed-vs-escalated ratio.
- [ ] **Step 3: Tune once.** Adjust `WEIGHTS` / thresholds in a single commit from that evidence (e.g. if `zero_spoof_tell` fires on honest devices, reweight; if `inside_near_edge` should matter, assign it). Re-run `vitest run risk-score`. No iterative knob-fiddling — one calibration pass, then lock.
- [ ] **Step 4: Enforce flags-only.** `risk_fusion_mode=2`, `risk_fusion_block_enabled=0`. Flagged rows route to review; nobody is blocked. Watch the disposition ratio for a month.
- [ ] **Step 5: Enable block band.** Only if flag precision holds **and** liveness enforce is on (Step 4.3 note) — set `risk_fusion_block_enabled=1`. Monitor `clock.risk_block` audit entries daily for the first week; instant off-switch is the same checkbox.

---

## Presence-QR cross-dependency (no work duplicated here)

The `presence` factor is inert (all weights 0, condition recorded as `not_deployed`) until presence-QR ships per `docs/superpowers/specs/2026-07-19-presence-qr-design.md` (plan file `docs/superpowers/plans/2026-07-19-presence-qr.md` — not yet created at time of writing). When it lands: its `clock_records.presence_method` maps to `RiskInput.presence` (`'qr'` → `valid`, `'qr_pending'`/`'none'` → `none_or_pending`, `'override'` → `override`) at the marked wiring point in `clock.ts` (Task 4 Step 2), and the intended weights (−15 / +10 / +20) replace the zeros in `WEIGHTS.presence`. The two rollouts are independent; either can be in any mode without affecting the other.

## Rollback

- **Instant:** Settings → Risk fusion → Off (`risk_fusion_mode=0`). Zero deploy, zero data change; the scoring block in `clock.ts` short-circuits before any extra query. Mirrors the "flip back instantly" discipline of the liveness/re-auth flags.
- **Code:** full revert is safe — columns are additive and unused-by-default; old code ignores them; `device_id` is optional in `clockSchema`, so an old staff app and new server (or vice versa) interoperate.
- **Data:** `risk_score`/`risk_factors`/`risk_disposition` columns are inert on rollback — no cleanup required. KV `device:<user_id>` keys carry a 180-day sliding TTL (self-cleaning); explicit purge optional (`wrangler kv key list --prefix=device:` … delete), never required for correctness.
- **Block band:** `risk_fusion_block_enabled=0` alone restores flags-only enforce without touching mode.

## Self-Review

- **Spec coverage:** pure scoring fn + WEIGHTS + negative weights + clamp (T2); additive migration + settings 0/1/2 (T1); scoring after verdicts in submit path (T4.2); device_id client + KV first-seen, hashed no-PII (T3, T4.2); impossible travel from previous event (T4.2); bands + guardrail (T4.3, `isBlockable`); shadow persist+log (T4.4-4.6); risk-distribution endpoint (T5.2); badges/tooltips/chips (T6); audit on block/mode/disposition (T4.3, T1.3, T5.3); shadow→calibrate→enforce-flags→block rollout (T8); presence inert + cross-dep noted, not duplicated (T2, cross-dep section). ✓
- **Deviations from spec, all documented inline:** endpoint mounted at `/api/attendance/risk-distribution` (route convention); `SettingsModal.tsx` instead of nonexistent `SettingsSection.tsx`; added `risk_fusion_block_enabled` (mechanism for the spec's own "flags-only first" rollout step); `risk_disposition` column + endpoint (mechanism for the spec's required disposition audit); `RiskFactor` gains a `condition` key alongside spec's `{name, weight, detail}`; face-match input is null-pending since that feature is design-only.
- **Type consistency:** `RiskInput.livenessDecision` reuses `LivenessDecision` from `services/liveness/types.ts`; `FaceMatchStatus` matches the 2026-04-29 enum; `device_id` Zod-uuid both sides; settings keys typed in `AppSettings` + both Zod schemas + web `AppSettings` interface. ✓
- **No DB rebuild:** additive ALTER only, per D1-FK-safe discipline. ✓
- **Repo test convention:** pure unit tests only (scoring); route wiring, UI, and rollout verified via smoke checklist + shadow data — no DB/route harness exists in repo. ✓
