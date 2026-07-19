# Presence QR — Rotating Proof-of-Presence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Corroborate physical presence at clock-in with a rotating QR on a reception tablet: server-issued KV token (45s rotation / 90s TTL), public `GET /api/presence/current`, `presence_token` validation on `POST /api/clock`, additive `clock_records.presence_method`/`presence_token_window` columns, `presence_qr_mode` app setting (0 off / 1 shadow / 2 enforce), fullscreen public `/presence-display` page in `packages/web`, a scan step in the staff ClockPage (jsqr), admin badge + settings toggle, audit entries. Spec: `docs/superpowers/specs/2026-07-19-presence-qr-design.md`.

**Architecture:** Token rotation is **on-demand in KV** (no cron) — whoever asks for the current token rotates it when the window is stale. The token is **evidence, not a credential** (session auth, geofence, liveness, re-auth are unchanged), so the issue endpoint is public + per-IP rate-limited. Enforcement mirrors the existing liveness shadow→enforce pattern (`app_settings` flag, `resolveOverride` for the reception PIN escape valve, `recordAudit` for overrides and settings changes).

**Tech:** Hono + D1 + KV (`packages/api`), React + Vite (`packages/web` display page + admin, `packages/staff` scan step), `qrcode` (already in web), `jsqr` (already in web; added to staff), Zod, vitest.

**Toolchain (never `npm run`):** API (from `packages/api`) tc `node ../../node_modules/typescript/bin/tsc --noEmit`, tests `node ../../node_modules/vitest/vitest.mjs run`; Web/Staff (from each package) tc+build `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`, tests `node ../../node_modules/vitest/vitest.mjs run`; wrangler via `node "<repo>/node_modules/wrangler/bin/wrangler.js"` (D1 db name `smartgate-db`).

**Defaults locked:** rotation window 45s, KV TTL 90s (`presence:current` / `presence:previous`), endpoint rate limit 40 req/60s per IP (mirrors `kioskRateLimit`), `presence_qr_mode` default `0`, QR payload URL `https://staff-attendance.ohcsghana.org/clock?presence=<token>`.

**Dependencies between tasks:** T1 (DB + settings) ← T4, T5. T2 (token service) ← T3, T4. T3 (public endpoint) ← T6 (display page). T4 (clock validation) ← T7 (staff scan step). T5 and T6 are independent of each other. T8 (field guide) and T9 (verification) last. Deploy order in Rollout: T1→T3 + T6 first, then T4/T5/T7 with mode=1.

---

## Task 1: Data model + `presence_qr_mode` setting

**Files:** create `packages/api/src/db/migration-clock-presence.sql`; modify `packages/api/src/db/migrations-index.ts`, `packages/api/src/db/schema.sql`, `packages/api/src/services/settings.ts`, `packages/api/src/routes/admin-settings.ts`.

- [ ] **Step 1: Migration (additive ALTER — D1-safe, no rebuild).**
```sql
-- migration-clock-presence.sql
-- Rotating presence-QR proof-of-presence (spec: docs/superpowers/specs/2026-07-19-presence-qr-design.md).
-- Additive only: two nullable evidence columns on clock_records, one mode flag on
-- the app_settings singleton. NULLs on pre-existing rows read as "no presence data".
ALTER TABLE clock_records ADD COLUMN presence_method TEXT;        -- 'qr' | 'qr_pending' | 'none' | 'override'
ALTER TABLE clock_records ADD COLUMN presence_token_window TEXT;  -- 'current' | 'previous' | 'expired' at validation time
ALTER TABLE app_settings ADD COLUMN presence_qr_mode INTEGER;     -- 0 = off, 1 = shadow (record-only), 2 = enforce

UPDATE app_settings SET presence_qr_mode = COALESCE(presence_qr_mode, 0) WHERE id = 1;
```
Register as the LAST entry in `migrations-index.ts` (import + array append, after `migration-appointments-repair.sql`). In `schema.sql` add the two columns to the `clock_records` CREATE TABLE and `presence_qr_mode INTEGER` to `app_settings` (mirror how `clockin_reauth_enforce` etc. appear there).

- [ ] **Step 2: `services/settings.ts`.** Add to `AppSettings`: `presence_qr_mode: number; // 0 = off, 1 = shadow, 2 = enforce (added by migration-clock-presence.sql)`. Add `presence_qr_mode: 0` to `DEFAULTS` and `presence_qr_mode` to the SELECT column list in `getAppSettings`.

- [ ] **Step 3: `routes/admin-settings.ts` (mirror the enforce-flag pattern).**
  - `AUDITED_SETTINGS_FIELDS`: append `'presence_qr_mode'` (diff is recorded under `settings.update`; the audit redactor's `/pin|password|secret|token|hash/` rule does not touch this field name).
  - `SETTINGS_COLUMNS`: append `presence_qr_mode` so GET returns it.
  - `settingsSchema`: add `presence_qr_mode: z.number().int().min(0).max(2).optional()`.
  - PUT handler: add `presence_qr_mode` to the `before` SELECT; keep-when-omitted: `const presenceQrMode = body.presence_qr_mode ?? (before?.presence_qr_mode ?? 0);` add `presence_qr_mode = ?` to the UPDATE and bind `presenceQrMode`. Keep superadmin gating.

- [ ] **Step 4: Apply locally + verify; commit.** `wrangler d1 execute smartgate-db --local --file=src/db/migration-clock-presence.sql`, then confirm via `wrangler d1 execute smartgate-db --local --command "SELECT sql FROM sqlite_master WHERE name IN ('clock_records','app_settings')"` that all three columns exist. API tc + tests green. Commit: "feat(presence): clock presence columns + presence_qr_mode setting".

---

## Task 2: Presence token service + unit tests (TDD)

**Files:** create `packages/api/src/services/presence.ts`, `packages/api/src/services/presence.test.ts`. Depends on: nothing (KV only).

**KV design (locked):**

| Key | Value (JSON) | TTL |
|-----|--------------|-----|
| `presence:current` | `{ token: uuid, window_start: unix_ms }` | 90s |
| `presence:previous` | same shape — last rotated-out window (grace for in-flight scans) | 90s |

Rotation is on-demand: a reader rotates when the current window is ≥45s old. The `previous` grace means a scan at second 44 submitted at second 70 still validates. Concurrent isolates may double-rotate — last write wins, and a displaced token still validates as `previous` for up to 90s; acceptable because the token is evidence, not a credential.

- [ ] **Step 1: Write `services/presence.test.ts` first.** Copy the `mockKv` helper pattern from `packages/api/src/services/liveness/review-counter.test.ts` (Map-backed `get`/`put`/`delete` cast to `KVNamespace`). The service takes an injectable `now` (mirrors `getOfficeStatus(env, now)`), so tests pass fixed timestamps — no fake timers needed. Cases:
  1. empty KV → creates a window, returns `expiresIn = 45`, writes `presence:current` with `expirationTtl: 90`;
  2. second call 30s later → same token, `expiresIn = 15`, no write;
  3. call at +46s → new token; old window moved to `presence:previous` (TTL 90);
  4. `validatePresenceToken`: matches current → `'current'`; matches previous → `'previous'`; unknown UUID / empty string → `'invalid'`;
  5. corrupt JSON under `presence:current` → treated as missing (rotates fresh, no throw).

- [ ] **Step 2: Implement `services/presence.ts`.**
```ts
import type { Env } from '../types';

export interface PresenceWindow { token: string; window_start: number } // unix ms
export const PRESENCE_ROTATE_MS = 45_000;
export const PRESENCE_KV_TTL_SECONDS = 90;
const CURRENT_KEY = 'presence:current';
const PREVIOUS_KEY = 'presence:previous';

export type PresenceTokenWindow = 'current' | 'previous' | 'invalid';

async function readWindow(env: Env, key: string): Promise<PresenceWindow | null> {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as PresenceWindow; } catch { return null; }
}

/** Current display token, rotating on-demand when the window is >= 45s old. */
export async function getCurrentPresenceToken(
  env: Env, now: number = Date.now(),
): Promise<{ token: string; expiresIn: number }> {
  const current = await readWindow(env, CURRENT_KEY);
  if (current && now - current.window_start < PRESENCE_ROTATE_MS) {
    const expiresIn = Math.max(0, Math.ceil((PRESENCE_ROTATE_MS - (now - current.window_start)) / 1000));
    return { token: current.token, expiresIn };
  }
  if (current) {
    await env.KV.put(PREVIOUS_KEY, JSON.stringify(current), { expirationTtl: PRESENCE_KV_TTL_SECONDS });
  }
  const next: PresenceWindow = { token: crypto.randomUUID(), window_start: now };
  await env.KV.put(CURRENT_KEY, JSON.stringify(next), { expirationTtl: PRESENCE_KV_TTL_SECONDS });
  return { token: next.token, expiresIn: PRESENCE_ROTATE_MS / 1000 };
}

/** Validate a scanned token against the live + grace windows. */
export async function validatePresenceToken(env: Env, token: string): Promise<PresenceTokenWindow> {
  if (!token) return 'invalid';
  const current = await readWindow(env, CURRENT_KEY);
  if (current?.token === token) return 'current';
  const previous = await readWindow(env, PREVIOUS_KEY);
  if (previous?.token === token) return 'previous';
  return 'invalid';
}
```

- [ ] **Step 3: Run `node ../../node_modules/vitest/vitest.mjs run presence` → PASS; API tc. Commit:** "feat(presence): KV presence-token rotation + validation service".

---

## Task 3: Public endpoint `GET /api/presence/current`

**Files:** create `packages/api/src/routes/presence.ts`; modify `packages/api/src/index.ts`. Depends on: T2.

- [ ] **Step 1: `routes/presence.ts`.** Public + per-IP rate-limited 40/60s (mirrors `kioskRateLimit` in `routes/kiosk.ts` — same `rateLimit(c.env, key, 40, 60)` helper and `cf-connecting-ip` source):
```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { success, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { getCurrentPresenceToken } from '../services/presence';
import { getOfficeStatus } from '../services/office-hours';

export const presenceRoutes = new Hono<{ Bindings: Env }>();

// Public: the token is evidence, not a credential — useless without session auth.
presenceRoutes.get('/current', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `presence-ip:${ip}`, 40, 60);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }
  const [{ token, expiresIn }, office] = await Promise.all([
    getCurrentPresenceToken(c.env),
    getOfficeStatus(c.env),
  ]);
  return success(c, { token, expires_in: expiresIn, office_open: office.open });
});
```
Response shape (standard wrapper): `{ "data": { "token": "<uuid>", "expires_in": 45, "office_open": true }, "error": null }`; 429 → `{ "data": null, "error": { "code": "RATE_LIMITED", ... } }` + `Retry-After`. No request params/body.

- [ ] **Step 2: Mount in `index.ts`.** `import { presenceRoutes } from './routes/presence';` and add `app.route('/api/presence', presenceRoutes);` to the **public routes block** (after `app.route('/api/kiosk', kioskRoutes);`, BEFORE `app.use('/api/*', authMiddleware)`). CORS is already global; both `smartgate.ohcsghana.org` (display page) and `staff-attendance.ohcsghana.org` are in `PROD_ORIGINS`. No `wrangler.toml` change — reuses the existing `KV` binding.

- [ ] **Step 3: Verify; commit.** API tc + tests. Local smoke: `wrangler dev` (from `packages/api`: `node ../../node_modules/wrangler/bin/wrangler.js dev --env dev`), then `curl -s http://localhost:8787/api/presence/current` twice within 45s → same `token`, decreasing `expires_in`; after 45s → new token. Commit: "feat(presence): public GET /api/presence/current (rate-limited)".

---

## Task 4: Clock-submit validation + enforce gate + reception override

**Files:** modify `packages/api/src/routes/clock.ts`. Depends on: T1 (columns + setting), T2 (`validatePresenceToken`). Reuses: `services/override.ts resolveOverride`, `services/audit.ts recordAudit`, `lib/rate-limit.ts`.

**Offline-replay semantics (explicit, per spec):** queued clock events replay hours later holding an expired token; both KV windows have rotated out, so "was it valid at capture time" is unanswerable from KV. The faithful degradation: a token that matches neither window is classified `expired` (never a forgery verdict), recorded as `presence_method='qr_pending'`; **shadow mode** records it silently; **enforce mode** lets the insert through as `qr_pending` for HR adjudication (the manual-review escape valve, same as liveness) — never silent-accept as `qr`, never hard-reject a replay. The client sends an optional `captured_at` (ISO, set at scan time; the offline queue serialises the body at capture time so replays carry the original value). `captured_at` is **untrusted client data** — used only for a `devLog` line distinguishing fresh-submit token misses from replays (`Date.now() - Date.parse(captured_at) > 3 min` ⇒ replay), never for timestamp/geofence/gating decisions.

- [ ] **Step 1: Extend `clockSchema` (`routes/clock.ts`).**
```ts
presence_token: z.string().uuid().optional(),
presence_override_pin: z.string().min(4).max(12).optional(),
captured_at: z.string().max(40).optional(), // client clock, untrusted — log/diagnostics only
```
Both the JSON and multipart paths parse through this schema, so no further plumbing.

- [ ] **Step 2: Presence gate block.** Insert after the re-auth gate (settings already loaded as `settings`), before the liveness gate — cheap KV reads, keeps rejection fast:
```ts
// ---- PRESENCE QR GATE (0 = off, 1 = shadow/record-only, 2 = enforce) ----
const presenceMode = settings.presence_qr_mode ?? 0; // ?? for pre-migration rows
let presenceMethod: 'qr' | 'qr_pending' | 'none' | 'override' | null = null;
let presenceWindow: 'current' | 'previous' | 'expired' | null = null;

if (presenceMode > 0) {
  if (body.presence_token) {
    const verdict = await validatePresenceToken(c.env, body.presence_token);
    if (verdict === 'invalid') {
      // Rotated out of KV: offline replay (or a very slow submit). Evidence
      // only — classify as expired/pending, never as forgery.
      const capturedMs = body.captured_at ? Date.parse(body.captured_at) : NaN;
      const replay = Number.isFinite(capturedMs) && Date.now() - capturedMs > 3 * 60_000;
      devLog(c.env, `[PRESENCE] token miss user=${session.userId} replay=${replay}`);
      presenceWindow = 'expired';
      presenceMethod = 'qr_pending';
    } else {
      presenceWindow = verdict;
      presenceMethod = 'qr';
    }
  }
  presenceMethod ??= 'none';

  if (presenceMode === 2 && presenceMethod === 'none') {
    // Reception override escape valve (per-officer PINs first, shared PIN
    // fallback — same resolveOverride the kiosk uses). Per-user cap bounds
    // PIN brute-force from an authenticated session.
    if (body.presence_override_pin) {
      const rl = await rateLimit(c.env, `presence-override:${session.userId}`, 10, 300);
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.retryAfter));
        return error(c, 'RATE_LIMITED', 'Too many override attempts. Try again shortly.', 429);
      }
      const override = await resolveOverride(c.env, body.presence_override_pin);
      if (override.ok) {
        presenceMethod = 'override';
        await recordAudit(c.env, auditActorFromContext(c), {
          action: 'clock.presence_missing', entityType: 'user', entityId: session.userId,
          summary: `Presence-QR requirement overridden by ${override.label}`,
        });
      }
    }
    if (presenceMethod === 'none') {
      return error(c, 'PRESENCE_REQUIRED',
        'Please scan the QR code on the reception display to clock in. If it is unavailable, ask reception for the override PIN.', 400);
    }
  }
  // mode 2 + qr_pending: insert proceeds, flagged for HR review (manual-review
  // escape valve). Never silent-accept as 'qr', never reject a replay.
}
```
Notes: (a) `presence_override_pin` matching the `/pin|token/` audit-redaction rule means it must never appear in audit `changes`/`summary` — the call above only records the override `label`; (b) the idempotency short-circuit above this block means replayed duplicates never re-run the gate; (c) add `presence=${presenceMethod ?? 'off'}` to the final `[CLOCK]` devLog line.

- [ ] **Step 3: Persist.** Add `presence_method, presence_token_window` to the `INSERT INTO clock_records` column list and bind `presenceMethod, presenceWindow` (NULL when mode 0 — off means record nothing).

- [ ] **Step 4: API tc + tests green; commit.** No new unit tests here (repo convention: route gates are verified at runtime/smoke — see Task 9); the pure logic lives in the T2-tested service. Commit: "feat(presence): validate presence_token on POST /api/clock + enforce gate + override".

---

## Task 5: Admin visibility — AttendanceTab badge + settings toggle

**Files:** modify `packages/api/src/routes/attendance.ts`, `packages/web/src/components/admin/AttendanceTab.tsx`, `packages/web/src/components/admin/SettingsModal.tsx`. Depends on: T1; meaningful data needs T4.

- [ ] **Step 1: `attendance.ts` `/records`.** In the records SELECT (after `ci.liveness_signature as liveness_signature,`) add:
```sql
ci.presence_method as presence_method,
ci.presence_token_window as presence_token_window,
```

- [ ] **Step 2: `AttendanceTab.tsx` Presence column.** Extend `AttendanceRecord` with `presence_method: 'qr' | 'qr_pending' | 'none' | 'override' | null; presence_token_window: 'current' | 'previous' | 'expired' | null;`. Add a `<th>Presence</th>` between **Liveness** and **Verified**, and a `<td>` rendering a new `PresencePill`:
  - `'qr'` → emerald pill `QR` (title attr shows `window` — current/previous);
  - `'qr_pending'` → amber pill `Pending`;
  - `'override'` → sky/blue pill `Override`;
  - `'none'` or `null` → zinc/grey pill `None` when the row has a `clock_in_time`, plain `—` when absent.
  Style it on the existing `LivenessPill` (same pill classes). Bump the expanded-row `colSpan` (10 → 11, and the superadmin 11 → 12) for the new column.

- [ ] **Step 3: `SettingsModal.tsx` three-way toggle.** `AppSettings` interface += `presence_qr_mode?: number`. Add state `presenceQrMode` initialised from `current.presence_qr_mode ?? 0` (and in the `useEffect` reset). In the **Clock-in security** section, under the two enforce checkboxes, add a "Presence QR" segmented control (three buttons: **Off** / **Shadow** / **Enforce**, styled on the `SegmentToggle` pill pattern) with helper text: "Shadow records presence without blocking; Enforce rejects clock-ins that skip the reception-display scan (reception override PIN still works)." When set to Enforce, show the same amber warning callout style as the other enforce flags ("Enforcing can block legitimate clock-ins…"). Add `presence_qr_mode: number` to the mutation body type and include `presence_qr_mode: presenceQrMode` in `handleSave`. The settings diff is audited automatically (T1 added the field to `AUDITED_SETTINGS_FIELDS`).

- [ ] **Step 4: Verify; commit.** API tc; web tc + build. Commit: "feat(presence): admin presence badge column + qr-mode settings toggle".

---

## Task 6: Presence display page (`/presence-display`)

**Files:** create `packages/web/src/pages/PresenceDisplayPage.tsx`; modify `packages/web/src/App.tsx`. Depends on: T3.

- [ ] **Step 1: `PresenceDisplayPage.tsx`.** Fullscreen, no auth, dark Kente palette (reuse the App.tsx splash gradient: `linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)`, gold `#D4A017`, Ghana-flag bar at the bottom). Behaviour:
  - Poll `GET /api/presence/current` on mount and every 20s (plain `fetch` + `setInterval`; the page sits outside `AppLayout` but inside `QueryClientProvider`, so `useQuery({ refetchInterval: 20_000 })` is also fine — pick one, keep it simple). Re-render the QR **only when the token changes**.
  - QR via the existing pattern (`KioskPage.tsx:802`): `QRCode.toCanvas(canvasRef.current, payloadUrl, { width: 480, margin: 2, color: { dark: '#0F2E1B', light: '#FFFFFF' } })` where `payloadUrl` is `https://staff-attendance.ohcsghana.org/clock?presence=${token}`.
  - Large current time (HH:MM:SS, `en-GB`, 1s ticker) + date line; `office_open` status line ("Office open" / "Office closed").
  - Countdown ring around/beside the QR: SVG circle whose `strokeDashoffset` animates from `expires_in` over 45s.
  - **Burn-in jitter:** on each rotation pick a random `translate(±2%, ±2%)` for the QR wrapper.
  - **Failure state:** any fetch error or non-OK → replace the QR entirely with "QR UNAVAILABLE — see reception" (danger colour), keep retrying every 20s. Never show a stale QR.
  - `document.title = 'OHCS Presence Display'`; no nav, no links.

- [ ] **Step 2: Register the public route in `App.tsx`.** Next to `/kiosk` (outside `ProtectedRoute`): `<Route path="/presence-display" element={<PresenceDisplayPage />} />`.

- [ ] **Step 3: Verify; commit.** Web tc + build. Local: `vite dev` (port 5173, proxies `/api` → 8787) with `wrangler dev` running → open `http://localhost:5173/presence-display`, watch a rotation at the 45s boundary, kill the API → "QR UNAVAILABLE" appears. Commit: "feat(presence): fullscreen /presence-display page".

---

## Task 7: Staff app scan step

**Files:** modify `packages/staff/package.json`, `packages/staff/src/pages/ClockPage.tsx`, `packages/staff/src/lib/api.ts`; create `packages/staff/src/lib/presence.ts`, `packages/staff/src/lib/presence.test.ts`, `packages/staff/src/components/PresenceScanner.tsx`. Depends on: T4 (server accepts/validates); T6 gives a real QR to scan in smoke tests.

**UX decision (locked):** the scan step always renders after the geofence pre-check and is **skippable** ("Skip for now") — the client does not know `presence_qr_mode`. In enforce mode a skipped/invalid scan is rejected by the server with `PRESENCE_REQUIRED`, which the mutation's `onError` maps back to the scan step (mirrors how `REAUTH_REQUIRED` opens the PIN modal — no public settings endpoint needed). Order becomes: GPS fix → geofence pre-check → **scan** → liveness prompt/burst → re-auth → submit (spec §4).

- [ ] **Step 1: Dependency.** Add `"jsqr": "^1.4.0"` to `packages/staff/package.json` dependencies (same version as `packages/web`), then `npm install` at repo root (npm workspaces updates `package-lock.json`).

- [ ] **Step 2: `lib/presence.ts` + test (TDD).**
```ts
/** Extract a presence token from a scanned QR payload — accepts a raw UUID or
 *  the display URL (...?presence=<uuid>); anything else → null (keep scanning). */
export function parsePresenceToken(data: string): string | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const t = data.trim();
  if (UUID.test(t)) return t.toLowerCase();
  try {
    const p = new URL(t).searchParams.get('presence');
    return p && UUID.test(p) ? p.toLowerCase() : null;
  } catch { return null; }
}
```
`lib/presence.test.ts`: raw UUID (any case) → normalised lowercase; `https://staff-attendance.ohcsghana.org/clock?presence=<uuid>` → token; foreign URL without param / badge URL / garbage → `null`. Run vitest → PASS.

- [ ] **Step 3: `components/PresenceScanner.tsx`.** Copy the structure of `packages/web/src/components/QrScanner.tsx` (getUserMedia `facingMode: 'environment'`, rAF loop, canvas + `jsQR`, cleanup on unmount). Changes: decode via `parsePresenceToken(result.data)` instead of `parseBadgeCode`; props `{ onScan: (token: string) => void; onSkip: () => void }`; copy "Scan the QR code on the reception display"; camera-error fallback shows "Camera unavailable — skip and ask reception if clock-in is rejected"; a visible **Skip for now** button (wired to `onSkip`) plus the existing Cancel/X affordance collapsed into it (skip == cancel here).

- [ ] **Step 4: `ClockPage.tsx` integration.**
  - `type Phase` += `'scan'`. Add `presenceTokenRef = useRef<string | null>(null)` and `capturedAtRef = useRef<string | null>(null)`; clear both in `startClock` and `resetState`.
  - In `startClock`'s `finish()`, after `setLocation(pos)`: replace the prompt-fetch + `setPhase('photo')` tail with `setPhase('scan')`, and extract that tail into `async function proceedToLiveness()` (fetch `fetchClockPrompt()` best-effort, then `setPhase('photo')`).
  - Render the scan phase: `<PresenceScanner onScan={(t) => { presenceTokenRef.current = t; capturedAtRef.current = new Date().toISOString(); void proceedToLiveness(); }} onSkip={() => { capturedAtRef.current = new Date().toISOString(); void proceedToLiveness(); }} />`.
  - `submitClock()` and `handlePinSubmit()` mutation args += `presenceToken: presenceTokenRef.current ?? undefined, capturedAt: capturedAtRef.current ?? undefined` (and `presenceOverridePin` when the override modal supplied one).
  - `onError`: `if (code === 'PRESENCE_REQUIRED') { setErrorMsg(msg); setPhase('scan'); return; }` — above the generic error fallthrough. In the scan phase, when `errorMsg` is set from a `PRESENCE_REQUIRED`, additionally show a **Reception override PIN** control: numeric input (4–8 digits) + Submit that re-runs `submitClock({ presenceOverridePin })`; a wrong PIN returns `PRESENCE_REQUIRED` again → inline "Incorrect PIN — please ask reception" (same loop shape as the kiosk reception-assist flow; model the markup on `ReauthModal`'s numeric input).

- [ ] **Step 5: `lib/api.ts`.** `ClockSubmission` += `presenceToken?: string; presenceOverridePin?: string; capturedAt?: string;`. In `submitClock`'s payload add `presence_token: input.presenceToken, presence_override_pin: input.presenceOverridePin, captured_at: input.capturedAt` (undefined keys drop out of `JSON.stringify`; flows through both the multipart `payload` field and the JSON path). In `ClockPage`'s offline-queue path (`clockData` passed to `apiOrQueue`) add the same snake-case keys — the queue serialises the body at capture time, so replays carry the original token + `captured_at` (the replay semantics in T4).

- [ ] **Step 6: Verify; commit.** Staff tc + build + vitest; web/api unaffected. Commit: "feat(presence): staff clock flow scan step + presence_token submit".

---

## Task 8: Tablet field guide — reconcile with the shipped page

**Files:** modify `docs/ops/presence-display-setup.md`. Depends on: T6 (page exists).

- [ ] **Step 1:** This guide **already exists** (shipped alongside the spec) — do not rewrite it. Reconcile it against the implemented page: it claims "the page dims itself slightly between rotations", while the spec/T6 implement a ±2% position jitter — fix that line to describe what the page actually does, and confirm the documented verify steps (rotation, countdown ring, "QR unavailable — see reception" state, override-PIN fallback) match the shipped behaviour. Any other drift found during the T9 smoke test gets corrected here.

---

## Task 9: Verification

**Files:** none. Depends on: T1–T8.

- [ ] **Step 1: Static.** From `packages/api`: tc + `node ../../node_modules/vitest/vitest.mjs run` (presence + full suite green). From `packages/web`: tc + build + `node ../../node_modules/vitest/vitest.mjs run`. From `packages/staff`: tc + build + `node ../../node_modules/vitest/vitest.mjs run`.

- [ ] **Step 2: Local smoke checklist** (three terminals):
  1. `packages/api`: `node ../../node_modules/wrangler/bin/wrangler.js dev --env dev` (API on :8787, local D1/KV). Apply the migration locally first (T1.4).
  2. `packages/web`: `node ../../node_modules/vite/bin/vite.js` (:5173, proxies `/api`). Open `/presence-display`: QR renders, rotates at the 45s boundary, countdown ring drains, office-open line matches settings; stop wrangler → "QR UNAVAILABLE — see reception"; restart → recovers.
  3. `packages/staff`: `node ../../node_modules/vite/bin/vite.js` (:5174). Log in, Clock In: GPS fix → scan step appears → scan the display page's QR (or point the camera at a screenshot) → liveness → re-auth → success. Repeat with **Skip** → still succeeds (mode 1 shadow).
  4. SQL check (local D1): scanned clock-in has `presence_method='qr'`, `presence_token_window IN ('current','previous')`; skipped one has `'none'`/NULL window.
  5. Offline replay: with mode=1, go offline (DevTools) **before** the prompt fetch so the submission takes the JSON queue path (multipart burst submissions can't be queued — see `ClockPage`), scan beforehand while still online, then clock in offline (queued), wait >2 min, go online → queued replay lands as `presence_method='qr_pending'`, `presence_token_window='expired'`.
  6. Enforce: flip `presence_qr_mode=2` via the Settings modal → skip-scan clock-in is rejected with `PRESENCE_REQUIRED` → scan-step re-shows → wrong override PIN rejected → correct reception PIN succeeds with `presence_method='override'` and a `clock.presence_missing` audit row (check `/api/admin/audit` or D1).
  7. Admin: AttendanceTab shows green `QR` / grey `None` / amber `Pending` / blue `Override` pills; SettingsModal toggle persists and audits (`settings.update` diff contains `presence_qr_mode`).
  8. Rate limit: `for i in $(seq 1 45); do curl -s -o /dev/null http://localhost:8787/api/presence/current; done` → last calls return 429.

- [ ] **Step 3: Migration to prod (gated on user confirm).** Additive `ALTER ADD COLUMN` only (D1-safe, zero data risk). Apply via the admin Settings → "Run pending migrations" (MigrationRunner → `POST /api/admin/migrations/run`) or `wrangler d1 execute smartgate-db --remote --file=src/db/migration-clock-presence.sql`; verify the three columns; confirm the row landed in `applied_migrations`.

- [ ] **Step 4: Deploy** — merge → `deploy.yml` green.

- [ ] **Step 5: Runtime on prod.** Load `https://smartgate.ohcsghana.org/presence-display` on the reception tablet (pin per `docs/ops/presence-display-setup.md`): rotation, office-open line, failure state. One real shadow-mode clock-in with scan → badge `QR` in AttendanceTab. Honest verdict + screenshots.

---

## Rollout (shadow → calibrate → enforce)

1. **Deploy display + endpoint + migration first** (T1–T3, T6) with `presence_qr_mode=0`; tablet live in reception; verify rotation for a full morning.
2. **Shadow:** ship clock validation + staff scan step + admin badge (T4, T5, T7), flip to `1` via Settings. Collect **2 weeks** of data — no rejections happen in this mode.
3. **Calibrate:** in AttendanceTab, review the Presence column: what share of clock-ins are `qr` vs `none` vs `qr_pending`? Investigate false negatives (camera-shy users, scan-skip habit, `qr_pending` spikes = offline-replay share). Adjust copy/placement; only touch rotation/TTL if evidence demands it.
4. **Enforce:** once the shadow cohort is clean and the reception override path has been exercised for real, flip to `2`. Every flip is a settings change (audited via `settings.update`), no deploy needed.

## Rollback

- **Instant:** Settings modal → Presence QR → **Off** (`presence_qr_mode=0`; the PUT invalidates the settings KV cache). Server stops validating/recording tokens; the staff scan step remains but is skippable and its token is ignored; the display page can stay up harmlessly. SQL fallback: `UPDATE app_settings SET presence_qr_mode = 0 WHERE id = 1;` (cache expires within 5 min).
- **Partial:** mode `2` → `1` if enforce produces false rejects (reception override keeps working meanwhile).
- **Full:** revert the merge; the additive columns and KV keys are inert leftovers — no data migration needed to roll back (nullable columns, no backfill).

## Self-Review

- **Spec coverage:** KV token service + rotation/grace (T2), public rate-limited endpoint with `office_open` (T3), `presence_token` validation + replay semantics (T4, explicit: `expired`→`qr_pending`, enforce→manual review, never silent-accept), migration + `presence_qr_mode` (T1), display page with countdown/jitter/failure state (T6), staff scan step with degraded paths + override modal (T7), admin badge + toggle + audit (T1/T4/T5), rollout + tablet guide (Rollout/T8). ✓
- **Type consistency:** `PresenceTokenWindow` flows service → clock route → D1 TEXT columns → `AttendanceRecord` union types; `presence_qr_mode` typed in `AppSettings`, the Zod settings schema, and the web `AppSettings` interface. ✓
- **No DB rebuild:** additive `ALTER ADD COLUMN` only. ✓
- **Repo conventions:** pure unit tests only (token service, token parser); route gates + UI verified at runtime/smoke; audit redaction respected (no token/PIN values in audit rows); rate-limit helper reused per existing patterns. ✓
- **Explicit deviation notes:** `captured_at` does not exist in the codebase today — added as an optional, untrusted diagnostics field (T4/T7); KV cannot answer "valid at capture time" after rotation, so invalid-at-submit degrades to `qr_pending` per the spec's own fallback. Client learns enforce-ness from `PRESENCE_REQUIRED` (mirrors `REAUTH_REQUIRED`) rather than a new public settings endpoint. ✓
