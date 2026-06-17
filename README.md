# OHCS SmartGate & Staff Attendance System

_A secure, offline-capable platform for the Office of the Head of the Civil Service, Ghana — combining visitor management with GPS-verified staff attendance._

[![Deploy to Cloudflare](https://github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System/actions/workflows/deploy.yml)
[![Tech — Cloudflare Workers](https://img.shields.io/badge/api-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Tech — D1](https://img.shields.io/badge/db-D1%20SQLite-003B57?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Tech — React 18](https://img.shields.io/badge/frontend-React%2018-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![PWA — Installable](https://img.shields.io/badge/PWA-installable-5A0FC8)](https://web.dev/progressive-web-apps/)
[![Status — Production](https://img.shields.io/badge/status-production-1A4D2E)]()

---

## Overview

OHCS SmartGate is a two-app system serving the Office of the Head of the Civil Service in Accra:

- **Staff Attendance** — officers clock in/out from an installable mobile PWA with GPS geofencing (75 m around OHCS HQ), camera verification, streak tracking, and an offline queue that sync-replays missed clock-ins when connectivity returns.
- **Visitor Management System (SmartGate)** — reception and directorate admins register visitors, issue digital badges, and route arrival notifications (Telegram + web push + in-app) to the host officer and directorate leadership in near-real-time.

Both apps run as independent Progressive Web Apps, share a single Cloudflare Workers API, and deploy globally on Cloudflare's edge network for sub-100ms latency across West Africa.

> **Production URLs** · Staff: [staff-attendance.pages.dev](https://staff-attendance.pages.dev) · VMS: [ohcs-smartgate.pages.dev](https://ohcs-smartgate.pages.dev) · API: [ohcs-smartgate-api.ghwmelite.workers.dev](https://ohcs-smartgate-api.ghwmelite.workers.dev)

---

## Highlights

### 📋 Visitor management

- Single-step check-in with visitor search, host routing, purpose classification, and printable badge codes.
- Automatic arrival alerts to the hosting officer (in-app + Telegram + web push) and directorate leadership.
- Per-directorate, per-category, date-range visit reporting with PDF export.
- Offline-capable check-in — reception can keep working through connectivity drops; queued check-ins replay on reconnect with idempotency guarantees.

### ⏱️ Staff attendance

- PIN-based login with enforced first-login PIN change.
- GPS-verified clock-in within a 75 m geofence of OHCS HQ (`5.55269, -0.19752`), with accuracy-aware tolerance — users with weak GPS near the boundary still get through, users clearly outside get rejected with a clear distance + accuracy message.
- Optional selfie capture for attendance verification.
- Streak tracking (consecutive working days) with "best-ever" recognition.
- Self-service absence notice flow (sick / family emergency / transport / other, with optional note and expected return date) that routes an immediate push to directorate directors and suppresses the morning clock-reminder.
- Daily attendance summary to leadership via Telegram at 9:00 AM with per-directorate breakdown.

### 🔔 Notifications

- **Web Push** (fully self-hosted — VAPID JWT signing + RFC 8291 aes128gcm encryption via Web Crypto API; no third-party push service).
- **Telegram** — daily/weekly/monthly attendance summaries to admin subscribers and directorate heads.
- **In-app bell** for both apps.

Whitelisted push types: `visitor_arrival`, `clock_reminder`, `late_clock_alert`, `monthly_report_ready`, `absence_notice`.

### 🔒 Security

- Session auth with dual-transport support (`session_id` cookie + `Authorization: Bearer` header) so installed mobile PWAs work even when iOS/Android blocks third-party cookies.
- Constant-time PIN comparison (byte-wise XOR).
- KV-backed rate limiting on `/auth/login`, `/auth/verify`, and `/auth/pin-login` (per email / IP / staff-ID).
- Role-based access control (`superadmin`, `admin`, `director`, `receptionist`, `it`, `staff`) with a central `requireRole` guard.
- Strict CORS allowlist (no wildcard subdomains).
- HTML escaping on all user-supplied fields sent to Telegram.
- Database migration tracking via an `applied_migrations` table and a superadmin-gated runner endpoint.
- Push delivery observability via `/api/admin/health/push` (7-day KV-backed counters).

### 📱 PWA installability

- Full installable PWA on Android (Chrome, Edge) and iOS 16.4+ (Safari) — manifest, service worker, maskable icons, offline fallback, `beforeinstallprompt` handling, iOS "Add to Home Screen" instructions.
- **Distinct home-screen icons per app**: staff = green badge with clock icon, VMS = gold badge with user-plus icon — instantly distinguishable when both are installed.
- Fixed bottom navigation on the staff app (Settings / PIN / Sign Out), safe-area-aware for notched devices.
- Offline banner + queued-mutation replay via IndexedDB + Background Sync (with a `flush-queue` message-based fallback for iOS).

### 🎨 Design

- Custom _Kente Executive_ visual identity — Ghanaian Kente geometric texture, gold deco hairlines, Playfair Display display serif + DM Sans body, rotating gold logo ring, letter-reveal greeting animations, magnetic-hover clock buttons with ripple press feedback, gold confetti burst on successful clock-in. Respects `prefers-reduced-motion`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Edge                              │
│                                                                      │
│   ┌───────────────────┐      ┌───────────────────────────────────┐  │
│   │ staff-attendance   │      │ ohcs-smartgate                    │  │
│   │  .pages.dev        │      │  .pages.dev                       │  │
│   │  (Staff PWA)       │      │  (VMS / Admin PWA)                │  │
│   └─────────┬──────────┘      └─────────┬─────────────────────────┘  │
│             │  HTTPS + Bearer/Cookie    │                            │
│             └──────────────┬────────────┘                            │
│                            │                                         │
│              ┌─────────────▼────────────────┐                        │
│              │ ohcs-smartgate-api           │                        │
│              │  (Cloudflare Workers + Hono) │                        │
│              │                              │                        │
│              │  • Hono routing + zod        │                        │
│              │  • Auth (SHA-256 PIN hash,   │                        │
│              │    constant-time compare)    │                        │
│              │  • Web Push (Web Crypto      │                        │
│              │    VAPID + aes128gcm)        │                        │
│              │  • Rate limiting (KV)        │                        │
│              │  • Telegram bot integration  │                        │
│              │  • 5 cron triggers           │                        │
│              └───┬─────────┬────────────┬───┘                        │
│                  │         │            │                            │
│              ┌───▼──┐  ┌──▼──┐  ┌──────▼──────┐                     │
│              │  D1  │  │  KV │  │      R2     │                     │
│              │ DB   │  │     │  │  Photo blobs│                     │
│              └──────┘  └─────┘  └─────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │ Telegram Bot   │ daily / weekly / monthly summaries
                   │ Web Push       │ visitor arrival, clock reminder,
                   │  (FCM / APNs)  │ late alert, absence notice
                   └────────────────┘
```

### Tech stack

- **API** — TypeScript, Cloudflare Workers, Hono, `@hono/zod-validator`, Web Crypto API
- **Storage** — Cloudflare D1 (SQLite), KV (sessions, rate limits, push counters, Telegram links), R2 (visitor & clock photos)
- **Frontend** — React 18, Vite, TypeScript strict mode, Tailwind 4, Zustand (state), TanStack Query (server state), Lucide icons, Playfair Display + DM Sans
- **PWA** — Hand-rolled service worker, IndexedDB offline queue, Background Sync API, Notification API
- **Scheduling** — Cloudflare Workers cron triggers (5 schedules: 08:30 weekdays, 09:00 weekdays, 16:00 Fridays, 09:00 1st of month, 09:00 Jan 1st)
- **Auth** — Session cookies + Bearer token fallback, email OTP, PIN + `staff_id`
- **Notifications** — Self-hosted Web Push (no FCM/OneSignal dep), Telegram Bot API, in-app DB-backed notification bell

---

## Repository structure

```
.
├── packages/
│   ├── api/                   ← Cloudflare Workers API (Hono + D1)
│   │   ├── src/
│   │   │   ├── routes/        ← 18 HTTP route groups
│   │   │   ├── services/      ← Business logic (auth, notifier, reminders, daily-summary, telegram)
│   │   │   ├── lib/           ← Helpers (webpush, html escape, rate-limit, require-role, log)
│   │   │   ├── middleware/    ← Auth middleware
│   │   │   ├── db/            ← SQL migrations + schema + migration runner
│   │   │   └── types.ts       ← Env + SessionData
│   │   └── wrangler.toml
│   │
│   ├── staff/                 ← Staff Attendance PWA
│   │   ├── src/
│   │   │   ├── pages/         ← Login, Clock
│   │   │   ├── components/    ← BottomNav, OfflineBanner, AbsenceNoticeModal, …
│   │   │   ├── hooks/         ← useOnlineStatus, usePinChange
│   │   │   ├── lib/           ← api client, tokenStore, offlineQueue, pushClient
│   │   │   └── stores/        ← Zustand (auth, install)
│   │   ├── public/            ← manifest, icons, SW, offline.html
│   │   └── scripts/
│   │       └── generate-icons.mjs   ← Badged PWA icon generator (sharp)
│   │
│   └── web/                   ← VMS / Admin PWA (mirrors staff structure)
│
├── docs/
│   ├── ops/
│   │   └── pwa-secrets.md     ← VAPID key generation + rotation guide
│   └── superpowers/
│       ├── specs/             ← Design documents for every major feature
│       └── plans/             ← Implementation plans executed during the build
│
└── package.json               ← npm workspace root
```

---

## Getting started (local development)

### Prerequisites

- Node.js ≥ 22
- Cloudflare account with Workers + Pages + D1 + KV + R2 enabled
- Wrangler CLI: `npm install -g wrangler` (or use via `npx wrangler`)

### Setup

```bash
git clone https://github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System.git
cd OHCS-SmartGate-Staff-Attendance-System
npm install
```

### Run locally

Start the API (Wrangler dev server):

```bash
npm run dev:api
```

Start the VMS admin frontend:

```bash
npm run dev:web
```

Start the staff attendance frontend:

```bash
cd packages/staff && npm run dev
```

### Database setup

```bash
cd packages/api
npx wrangler d1 execute smartgate-db --local --file=src/db/schema.sql
npx wrangler d1 execute smartgate-db --local --file=src/db/seed.sql
```

Subsequent schema changes use the migration runner — see `docs/superpowers/specs/2026-04-18-security-hardening-design.md` §Fix 8.

---

## Deployment

Pushing to `main` auto-deploys everything via GitHub Actions (`.github/workflows/deploy.yml`): it typechecks all three packages, builds both PWAs, deploys the API Worker, then deploys both Pages projects. It can also be run on demand from the **Actions** tab (`workflow_dispatch`).

To deploy manually with Wrangler (e.g. a hotfix outside CI):

```bash
# API Worker
cd packages/api && npx wrangler deploy

# Staff PWA
cd packages/staff && npm run build && \
  npx wrangler pages deploy dist --project-name=staff-attendance --branch=main

# VMS PWA
cd packages/web && npm run build && \
  npx wrangler pages deploy dist --project-name=ohcs-smartgate --branch=main
```

**One-time secrets setup** (VAPID keys for Web Push): see `docs/ops/pwa-secrets.md`.

**Lobby kiosk setup** (tablet + printable QR poster for `smartgate.ohcsghana.org/kiosk`): see `docs/ops/lobby-kiosk-setup.md`.

**Database migrations on remote D1** (after first install of the migration runner): superadmin `POST /api/admin/migrations/run` runs all pending migrations idempotently.

---

## Design documentation

The `docs/superpowers/` directory contains the full design history of this system — every significant feature was specified (`specs/`), planned (`plans/`), and then executed. Reading the specs is the fastest path to understanding _why_ the code looks the way it does. Notable specs:

- First-login enforced PIN change
- PWA completeness (offline queue, A2HS install, Web Push, offline indicator)
- Push notification triggers (clock reminder, late alert, monthly report)
- Absence notice (self-service sick / emergency flow)
- Security hardening (12 fixes spanning OTP logging, PIN timing, CORS, photo auth, RBAC, rate limiting, migration tracking, push observability)
- Bearer-token auth fallback (mobile PWA cross-origin cookie workaround)
- Kente Executive dashboard redesign
- Mobile bottom nav + logo badges

---

## Security

- All SQL uses D1 prepared statements with `.bind()`; no string interpolation.
- PINs are SHA-256 hashed; verification is constant-time.
- Sessions live in KV with configurable TTL (24 h default, 30 d with "remember me").
- Photo endpoints require an authenticated session.
- VAPID private key is a Worker secret (never shipped to the browser).
- All authenticated endpoints are guarded by a single middleware.
- OTP codes are logged only in non-production environments.
- Push delivery failures are tracked per HTTP status so breakage is surfaced early.

To report a security issue, contact the OHCS IT directorate directly rather than opening a public GitHub issue.

---

## Roadmap

Known deferred work, each to be tackled as its own project:

- **Automated tests** — adopt Vitest for API + lib layers (crypto, auth, offline queue, geofence).
- **Bundle optimization** — dynamic-import the admin reports and analytics modules in the VMS app to trim the initial bundle.
- **Component decomposition** — split `CheckInPage.tsx` (907 LOC) and `AdminPage.tsx` (492 LOC) into focused sub-components.
- **Shared workspace** — extract duplicated `offlineQueue`, `tokenStore`, `pushClient`, and a few React primitives into `packages/shared`.
- **iOS startup images** — generate `apple-touch-startup-image` per device class for a polished launch experience.
- **Manifest shortcuts** — long-press app icon quick actions (e.g., "Clock In Now", "New Visitor").

---

## License

© 2026 Office of the Head of the Civil Service, Ghana. All rights reserved.

This is a bespoke system built for a specific public-sector agency. The source is published for transparency and reference; it is not released under an open-source license. Re-use of the code, assets, or designs requires written permission from OHCS IT.

---

## Acknowledgments

Built with care on Cloudflare's edge platform. Design language inspired by Ghanaian Kente cloth, Art Deco civic typography, and the everyday reality of civil servants who just want to clock in and get on with their day.
