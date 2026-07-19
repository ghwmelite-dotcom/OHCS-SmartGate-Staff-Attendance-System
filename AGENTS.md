# OHCS SmartGate & Staff Attendance — Agent Memory

Two-app Cloudflare system for the Office of the Head of the Civil Service, Ghana:
**Staff Attendance** (GPS-geofenced clock-in/out with passive liveness) and
**SmartGate VMS** (visitor management, kiosk, appointments, admin). npm workspaces
monorepo; shared Hono Workers API; both PWAs on Cloudflare Pages.

Prod: `staff-attendance.ohcsghana.org` · `smartgate.ohcsghana.org` · API Worker
`ohcs-smartgate-api.ohcsghana-main.workers.dev`. Both PWAs hard-redirect away from
`*.pages.dev` to the branded domains (first-party cookie requirement).

## Commands

```bash
# Per-package typecheck / tests (run from the package dir)
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/vitest/vitest.mjs run

# Local dev
npm run dev:api          # wrangler dev :8787 — needs --local here (remote AI binding fails to start)
npm run dev:web          # vite :5173
cd packages/staff && npm run dev   # vite :5174
```

Invoke tools via `node ../../node_modules/...` — the repo path contains spaces and
`&`, which breaks bare `npx` invocations.

## Conventions

- **Specs & plans first.** Every significant feature gets a design spec in
  `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` and an implementation plan in
  `docs/superpowers/plans/YYYY-MM-DD-<name>.md`, then code. Keep docs in sync when
  shipped behavior diverges.
- **Migrations: additive only.** D1 enforces FKs; no table rebuilds of referenced
  tables. `ALTER TABLE ADD COLUMN` style files, registered LAST in
  `packages/api/src/db/migrations-index.ts`, `schema.sql` updated to match
  (fresh-init end state must equal migrated end state). Applied on prod via
  superadmin `POST /api/admin/migrations/run` (tracked in `applied_migrations` by
  filename + SHA-256).
- **Settings flags graduate:** new enforcement features ship as `app_settings`
  integer modes `0` off / `1` shadow (record-only) / `2` enforce, exposed via
  `admin-settings.ts` + a three-way toggle in `SettingsModal.tsx`. Never ship a new
  enforcement straight to enforce.
- **Commits:** conventional, lowercase, scoped (`feat(presence): …`, `fix(appointments): …`).
  Push to `main` = production deploy via `.github/workflows/deploy.yml`
  (typecheck + tests → Worker + both Pages → smoke check).
- **Client apps never store tokens.** HttpOnly session cookie is primary; the API
  also accepts `Authorization: Bearer <sessionId>` server-side. `tokenStore.ts`
  in both apps is deliberately inert.
- **Offline queues** (IndexedDB + SW replay): `clock-queue` (staff), `visit-queue`
  (web); mutations carry `crypto.randomUUID()` idempotency keys; server dedupes via
  partial unique indexes.

## Operational gotchas (learned the hard way)

- **Migration-before-deploy sequencing.** When `app_settings` (or any table read by
  hot code) gains columns, the API deploy will 500 until the migration runs — the
  2026-07-19 smoke-check incident. Order: deploy → immediately run migrations.
  If the Settings UI itself is broken (its query reads the new columns), run the
  runner from a superadmin browser console instead:
  `fetch('/api/admin/migrations/run', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:'{}'}).then(r=>r.json()).then(console.log)`
- **Local wrangler OAuth account ≠ prod account.** Local login is
  `ea2e…8538`; prod resources live in `f4f2…8113`. Local `wrangler d1 … --remote`
  fails with 7403 — prod DB changes go through the app (migration runner) or a
  re-authenticated wrangler.
- **Local D1 drift.** Fresh local DBs may miss later columns; apply the repo's own
  migration files with `wrangler d1 execute smartgate-db --local --file=…`.
- **CI smoke check** curls the workers.dev host (bot protection 403s the branded
  domain from CI). `/api/kiosk/status` is the payload-shape canary.
- **Playwright visual verification** works via `channel: 'chrome'` (system Chrome);
  browser binaries are not installed.

## Feature state (as of 2026-07-19)

| Feature | State | Next step |
|---|---|---|
| Presence QR (rotating proof-of-presence) | **Shipped dark** (`presence_qr_mode=0`); display at `/presence-display`; scan-first clock flow; deep-link prefill; enforce-on-clock-in / flag-on-clock-out | Mount reception tablet (`docs/ops/presence-display-setup.md`) → mode 1 (shadow) → real-device test → mode 2 after ~2 wks |
| Attendance risk fusion | **Shipped dark** (`risk_fusion_mode=0`); scoring persists on every clock event; distribution + disposition endpoints live | Set mode 1 anytime (free calibration data); tune `WEIGHTS` in `risk-score.ts` after 2 wks; block band via separate `risk_fusion_block_enabled` |
| Face-match (enrolled reference) | **Design-only** — specs from 2026-04 exist, no implementation | Its own project; risk-fusion input stays optional until then |
| Comms (announcements/feedback/chat) | Plans exist in `docs/superpowers/plans/2026-04-28-*`, not built | Chat plan has policy prerequisites flagged |

## Key architecture map

- API entry `packages/api/src/index.ts`; ~30 route groups under `src/routes/`;
  services under `src/services/`; KV for sessions/rate-limits/presence tokens/
  push counters/device novelty; R2 for photos + backups; Workers AI for liveness,
  ID-check, assistant.
- Crons: clock reminders, daily/weekly/monthly/yearly summaries, NSS end-of-service,
  nightly maintenance (photo purge + backup).
- Staff clock flow: tap → presence scan (GPS warms in parallel) → geofence →
  liveness prompt → MediaPipe challenge burst → WebAuthn/PIN re-auth → submit.
- Audit: append-only hash-chained `audit_log`; `recordAudit` on sensitive mutations.

## Session log — 2026-07-19

Specs/plans: `2026-07-19-presence-qr-design.md`, `2026-07-19-attendance-risk-fusion-design.md`
+ matching plans. Commits: `618b26a` (both features), `d96c4da` (display sizing fix),
`bda44da` (premium display redesign), `7ed4d6e` (scan-first + deep-link + enforce-on-in).
Prod incident: settings-column deploy raced the migration → 500s; fixed via
superadmin migration runner (see gotcha above).
