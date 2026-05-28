# Asset Manifest — Aggregate Index

This file is the **single source of truth** for every screenshot, metric, quote, and miscellaneous asset needed across all 13 decks. De-duplicated: each asset listed once with a `Used by:` tag showing which decks consume it.

When you finish capturing/supplying an asset, tick it here AND in every per-deck manifest that consumes it.

---

## Screenshots needed

| ID | Asset | Used by decks | Where to capture | Status |
|----|-------|---------------|------------------|--------|
| S01 | Reception check-in form, blank | 01, 02, 09 | ohcs-smartgate.pages.dev → /reception/checkin | ☐ |
| S02 | Reception check-in form, mid-fill (visitor + host selected) | 02, 09 | same | ☐ |
| S03 | Visitor badge — printable view | 01, 02, 09 | same → after submit | ☐ |
| S04 | Host officer — incoming arrival in-app bell | 02, 11 | ohcs-smartgate.pages.dev (logged in as host) | ☐ |
| S05 | Telegram visitor-arrival notification (mobile) | 02, 06, 11 | Telegram app on phone | ☐ |
| S06 | Director directorate visit report (date range) | 02, 11 | ohcs-smartgate.pages.dev → /admin/reports | ☐ |
| S07 | PDF export of visit report | 02, 11 | downloaded PDF, screenshot first page | ☐ |
| S08 | Clock-in screen — GPS acquired, inside fence | 01, 03, 07, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S09 | Clock-in screen — weak GPS at boundary, accepted | 03, 07 | same, accuracy ~40m, ~70m from center | ☐ |
| S10 | Clock-in rejection — clear distance + accuracy | 03, 07 | same, 200m+ outside fence | ☐ |
| S11 | First-login enforced PIN-change modal | 03, 04, 10 | staff-attendance.pages.dev (new user) | ☐ |
| S12 | Streak banner with "best-ever" badge | 03, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S13 | Absence notice flow — modal open | 03, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S14 | Daily summary Telegram message (mobile, 9:00 AM) | 01, 06, 11 | Telegram app on phone | ☐ |
| S15 | Director late-clock-alert push | 06, 11 | iOS/Android notification screen | ☐ |
| S16 | OHCS HQ location, Google Maps with 75m circle drawn | 01, 07 | maps.google.com, OHCS HQ pinned | ☐ |
| S17 | Geofence precision retrace — commit diff (59b564a) | 07, 12 | github.com, commit page | ☐ |
| S18 | Self-hosted Web Push code excerpt — VAPID + aes128gcm | 04, 12 | VS Code, packages/api/src/lib/webpush.ts | ☐ |
| S19 | Security fixes list (rendered spec) | 04, 12 | docs/superpowers/specs/2026-04-18-security-hardening-design.md | ☐ |
| S20 | RBAC require-role middleware code excerpt | 04, 12 | VS Code, requireRole helper | ☐ |
| S21 | Offline banner showing on staff PWA | 03, 05, 10 | staff-attendance.pages.dev, airplane mode | ☐ |
| S22 | Queued mutations replay (IndexedDB inspector + reconnect log) | 05, 12 | Chrome DevTools, Application → IndexedDB | ☐ |
| S23 | iOS Add-to-Home-Screen instructions screen | 05 | iOS Safari, Share menu | ☐ |
| S24 | Distinct home-screen icons — staff (green) + VMS (gold) | 01, 05, 08, 10 | phone home screen with both installed | ☐ |
| S25 | Kente Executive — full clock page hero | 08, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S26 | Confetti burst on successful clock-in | 08, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S27 | Type pair — Playfair + DM Sans specimen sheet | 08 | designed in-deck (no capture needed) | n/a |
| S28 | docs/superpowers tree screenshot | 12 | VS Code file tree | ☐ |
| S29 | One spec file (rendered) — pick a representative one | 12 | GitHub or VS Code preview | ☐ |
| S30 | One plan file (rendered) — pick a representative one | 12 | GitHub or VS Code preview | ☐ |
| S31 | wrangler.toml cron triggers section | 06 | VS Code, packages/api/wrangler.toml | ☐ |
| S32 | Telegram bot daily summary HTML message preview | 06 | code or rendered | ☐ |
| S33 | KV rate-limit hit response (devtools network tab) | 04 | Chrome DevTools | ☐ |
| S34 | applied_migrations table view | 04, 12 | D1 console | ☐ |
| S35 | Push health endpoint response JSON | 04, 06 | /api/admin/health/push | ☐ |
| S36 | eBadge — staff digital badge view | 03, 10 | per spec 2026-04-28-staff-ebadge | ☐ |

## Numbers needed

| ID | Metric | Used by decks | Source | Value | Status |
|----|--------|---------------|--------|-------|--------|
| N01 | Total visitors checked in to date | 01, 02, 09 | D1: `SELECT COUNT(*) FROM visits` | _____ | ☐ |
| N02 | Average daily visitors | 02, 09 | D1: rolling 30-day avg | _____ | ☐ |
| N03 | Total clock-ins to date | 01, 03, 10 | D1: `SELECT COUNT(*) FROM clock_records WHERE clock_in_at IS NOT NULL` | _____ | ☐ |
| N04 | % clock-ins successful on first GPS try | 03, 07 | D1 derived | _____% | ☐ |
| N05 | Average GPS accuracy at clock-in | 07 | D1: `clock_records.gps_accuracy` mean | _____ m | ☐ |
| N06 | Distinct staff accounts active | 01, 03, 10 | D1: `staff WHERE last_login >= 30d` | _____ | ☐ |
| N07 | Telegram daily summary subscribers (directorate heads) | 06, 11 | D1 telegram links | _____ | ☐ |
| N08 | Web Push subscriptions active | 04, 06 | D1 push subscriptions | _____ | ☐ |
| N09 | Push delivery success rate (last 7d) | 04, 06 | /api/admin/health/push | _____% | ☐ |
| N10 | Offline-queued clock-ins replayed successfully | 05 | D1 counter | _____ | ☐ |
| N11 | Avg p50 API latency (Cloudflare analytics) | 01 | CF dashboard | _____ ms | ☐ |
| N12 | Absence notices filed | 03 | D1 absence_notices | _____ | ☐ |
| N13 | Late-clock alerts sent | 06, 11 | D1 push log | _____ | ☐ |
| N14 | Total specs in docs/superpowers/specs/ | 12 | repo file count | _____ | ☐ |
| N15 | Lines of TypeScript across packages/ | 12 | git ls-files \| Select-String '.ts$' | _____ | ☐ |

## Quotes / sign-off needed

| ID | From | Used by decks | Purpose | Text | Status |
|----|------|---------------|---------|------|--------|
| Q01 | Head of Civil Service | 01 | Flagship closing endorsement | "_____" | ☐ |
| Q02 | IT Director | 04 | Security & Trust closing | "_____" | ☐ |
| Q03 | Reception lead | 02, 09 | Workflow improvement quote | "_____" | ☐ |
| Q04 | A directorate director | 11 | Visibility quote | "_____" | ☐ |
| Q05 | One staff member | 10 | Daily experience quote | "_____" | ☐ |
| Q06 | Designer / brand owner | 08 | Design language statement | "_____" | ☐ |

## Miscellaneous

| ID | Asset | Used by decks | Notes | Status |
|----|-------|---------------|-------|--------|
| M01 | OHCS official crest (high-res PNG, transparent bg) | all 13 | place at decks/_assets/ohcs-crest.png | ☐ |
| M02 | OHCS HQ exterior photograph | 01, 09 | Optional but warm; used on cover or divider | ☐ |
| M03 | Permission to display Google Maps screenshot publicly | 01, 07 | Google brand guidelines | ☐ |
| M04 | Permission to share metrics publicly | all | Internal governance check | ☐ |

---

**Delivery gate:** No deck moves from v0 to v1 until every asset that deck consumes is ✓ here.
