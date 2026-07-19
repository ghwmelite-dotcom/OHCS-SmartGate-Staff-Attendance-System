# Presence QR — Rotating Proof-of-Presence Design
**Date:** 2026-07-19
**Status:** Draft

## Problem

The geofence is the only physical-presence signal at clock-in, and it is the weakest: Android mock-location apps spoof GPS trivially, and a browser PWA cannot query `isMockLocationOn()` (native-only API). Liveness and face-match prove *who* is clocking in; nothing corroborates *where* beyond a spoofable coordinate.

**Constraint:** The fix must work inside the existing PWA architecture — no native app, no new hardware platform beyond a commodity Android tablet.

---

## Solution Overview

A dedicated tablet in the reception area runs a fullscreen "presence display" page showing a QR code that rotates every ~45s. The QR encodes a short-lived, server-issued token. The staff app's clock flow gains a scan step; the scanned token is submitted with the clock event and validated server-side against KV.

The token is **evidence, not a credential** — it proves "this device was looking at that screen within the last minute." Session auth, geofence, liveness, and re-auth are unchanged. A leaked token is therefore useless on its own, which lets the token endpoint stay public (rate-limited).

**Residual risk (accepted):** a real-time photo relay from an on-site accomplice is possible within one window. This requires a co-conspirator physically present every day and collapses under audit scrutiny; risk fusion (see `2026-07-19-attendance-risk-fusion-design.md`) flags the correlating anomalies. Sufficient for the threat model.

---

## Section 1 — Token Service (API)

**New file:** `packages/api/src/services/presence.ts`

Token lifecycle in KV (no cron needed — rotation is on-demand):

| Key | Contents | TTL |
|-----|----------|-----|
| `presence:current` | `{ token, window_start }` | 90s |
| `presence:previous` | previous token (grace window for in-flight scans) | 90s |

`getCurrentPresenceToken(env)`:
1. Read `presence:current`. If it exists and is younger than 45s, return it.
2. Otherwise: shift current → `presence:previous`, generate `crypto.randomUUID()`, write as new current with 90s TTL, return it.

The previous-token grace means a staff member who scans at second 44 and submits at second 70 is not rejected by rotation.

### Endpoint: `GET /api/presence/current`

Public, rate-limited 40/60s per IP (mirrors kiosk limits in `src/lib/rate-limit.ts`). Returns:

```json
{ "token": "...", "expires_in": 45, "office_open": true }
```

`office_open` comes from the existing `getOfficeStatus` service so the display can render state without a second call.

### Clock-submit validation

`POST /api/clock` accepts an optional `presence_token` field. `validatePresenceToken(env, token)` returns `'current' | 'previous' | 'invalid'`.

**Offline-replay interaction (explicit):** queued clock events replayed hours later will hold an expired token. Validation must therefore compare the token against the event's `captured_at` timestamp — a token is valid for a replayed event if it was current or previous *at capture time*. Since both window keys may have rotated out of KV by replay time, shadow/flag modes treat expired-token replays as `presence_method='qr_pending'`; enforce mode routes them to manual review (same escape valve as liveness), never silent-accepts.

---

## Section 2 — Data Model

### `migration-clock-presence.sql`

```sql
ALTER TABLE clock_records ADD COLUMN presence_method TEXT;   -- 'qr' | 'qr_pending' | 'none' | 'override'
ALTER TABLE clock_records ADD COLUMN presence_token_window TEXT; -- current|previous|expired at validation time
```

Additive `ALTER ADD COLUMN` only, per D1-FK-safe discipline. Registered in `migrations-index.ts`.

### `app_settings`

New key: `presence_qr_mode` — `0` off (default), `1` shadow (record-only), `2` enforce (reject clock-in with `presence_method='none'`, unless a valid reception override PIN is supplied — reuses the existing `resolveOverride` service). Exposed via `admin-settings.ts` alongside the existing liveness/re-auth enforcement flags.

---

## Section 3 — Presence Display Page

**New public route:** `/presence-display` in `packages/web` (served from `smartgate.ohcsghana.org`; the tablet loads it directly). No auth.

Fullscreen page, dark Kente gradient with a gold hairline deco frame. Two-panel layout on landscape tablets (brand + clock + office status left, QR badge right), stacked on portrait, showing:
- Brand row: OHCS logo in a gold-ringed frame, "OHCS Presence Display", and the scan instruction line
- Large Playfair clock (gold seconds) + date, and an office open/closed status pill
- The QR badge: a white rounded card with a hairline-framed QR inset (`qrcode` package already in `packages/web`) encoding `https://staff-attendance.ohcsghana.org/clock?presence=<token>`, an ambient gold halo, and an in-card countdown hairline + "refreshes in Ns" caption
- QR card is sized in vh units only (never % of flex height) so it can never crowd the clock or the flag bar; canvas is absolutely positioned so its intrinsic bitmap size can't distort the card
- On fetch failure: explicit "QR UNAVAILABLE — see reception" state (never a stale QR)
- ±2% position jitter per rotation to mitigate OLED burn-in; Ghana flag bar with gold glow at the bottom edge

Polls `GET /api/presence/current` every 20s; re-renders only when the token changes.

### Tablet deployment (decided: Option A — dedicated tablet in reception)

- **Decision:** a dedicated Android tablet in the reception area, separate from the visitor kiosk tablet. Reusing the lobby kiosk tablet was rejected — the two functions would compete for the screen at the morning rush.
- **Placement:** secure desk stand on the reception counter (or wall mount beside it), angled toward staff as they pass reception on entry; permanent power; auto-boot on power restore
- **Lockdown:** pinned-app kiosk mode / Guided Access, per `docs/ops/presence-display-setup.md`
- **Bonus of the reception location:** the same reception desk already handles the override-PIN and manual-review paths, so staff with a dead phone camera or a QR failure get helped at the same spot

---

## Section 4 — Staff App Clock Flow

`packages/staff/src/pages/ClockPage.tsx` gains a scan step between geofence pre-check and liveness prompt:

1. GPS fix → client geofence pre-check (unchanged)
2. **Scan presence QR** — in-app scanner using `jsqr` (add dependency; pattern copied from `packages/web/src/components/QrScanner.tsx`). Parses `presence` param from the scanned URL.
3. Liveness prompt + burst + re-auth (unchanged)
4. `submitClock` includes `presence_token`

**Degraded paths:**
- `presence_qr_mode=1` (shadow): scan step is skippable; unsubmitted tokens record `presence_method='none'`
- `presence_qr_mode=2` (enforce): scan required; "QR unavailable" → reception override PIN modal (existing component pattern from kiosk)
- Camera broken / accessibility: reception override path, same as today

---

## Section 5 — Admin Visibility

- `AttendanceTab` records table gains a **Presence** badge column: green `QR`, amber `Pending`, grey `None`, blue `Override`
- `AdminPage` settings section gains the `presence_qr_mode` three-way toggle (Off / Shadow / Enforce) next to the existing liveness and re-auth toggles
- `recordAudit` entries: `clock.presence_missing` (enforce-mode overrides), settings changes to `presence_qr_mode`

---

## Rollout

1. Deploy display page + token endpoint + migration; verify the tablet page rotates
2. Ship staff-app scan step with `presence_qr_mode=1` (shadow) — collect 2 weeks of data
3. Review: what share of clock-ins have valid tokens? Where are the false negatives?
4. Flip to `2` (enforce) once the shadow cohort is clean and the override path is proven

---

## Files Touched

| File | Change |
|------|--------|
| `packages/api/src/services/presence.ts` | New — token rotation + validation |
| `packages/api/src/routes/clock.ts` | Accept + validate `presence_token` |
| `packages/api/src/index.ts` | Mount `GET /api/presence/current` (public, rate-limited) |
| `packages/api/src/db/migration-clock-presence.sql` | New — additive columns |
| `packages/api/src/db/migrations-index.ts` | Register migration |
| `packages/api/src/db/schema.sql` | Add presence columns to `clock_records` CREATE TABLE |
| `packages/api/src/services/settings.ts` | `presence_qr_mode` key |
| `packages/api/src/routes/admin-settings.ts` | Expose mode toggle |
| `packages/web/src/pages/PresenceDisplayPage.tsx` | New — fullscreen QR display |
| `packages/web/src/App.tsx` | Register public `/presence-display` route |
| `packages/staff/src/pages/ClockPage.tsx` | Insert scan step |
| `packages/staff/src/components/PresenceScanner.tsx` | New — jsQR scanner (pattern from web `QrScanner`) |
| `packages/staff/src/lib/api.ts` | `submitClock` carries `presence_token` |
| `packages/staff/package.json` | Add `jsqr` dependency |
| `packages/web/src/components/admin/AttendanceTab.tsx` | Presence badge column |
| `packages/web/src/components/admin/SettingsModal.tsx` | Mode toggle |
| `docs/ops/presence-display-setup.md` | New — tablet mount/kiosk-mode field guide |
