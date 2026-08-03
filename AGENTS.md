# OHCS SmartGate & Staff Attendance — Agent Memory

Two-app Cloudflare system for the Office of the Head of the Civil Service, Ghana:
**Staff Attendance** (GPS-geofenced clock-in/out with passive liveness) and
**SmartGate VMS** (visitor management, kiosk, appointments, admin). npm workspaces
monorepo; shared Hono Workers API; both PWAs on Cloudflare Pages.

Prod: `staff-attendance.ohcsghana.org` · `smartgate.ohcsghana.org` · API Worker
`ohcs-smartgate-api.ohcsghana-main.workers.dev`. Both PWAs hard-redirect away from
`*.pages.dev` to the branded domains (first-party cookie requirement).

## gstack

The gstack skill pack (Garry Tan's AI engineering team, MIT) is installed at
user level on this machine (`~/.claude/skills/gstack`, mirrored into
`~/.agents/skills/gstack-*`). Useful skills for this repo: `/office-hours`
(product framing), `/plan-eng-review` (architecture), `/review` (pre-landing
bugs), `/cso` (OWASP/STRIDE security audit), `/qa` / `/qa-only` (real-browser
testing), `/investigate` (root-cause debugging), `/ship` + `/land-and-deploy`
(release flow), `/retro` (weekly retro), `/document-release` (docs sync).
Upgrade: `cd ~/.claude/skills/gstack && git pull && ./setup`, then
`bash ~/.agents/sync-gstack-skills.sh` (Windows copy mode, no symlinks).

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

## Workflow — the Loop (standing operating mode, set 2026-07-19)

Pre-authorized default workflow. Do NOT pause for approval between stages.

1. **Shape** — state the interpretation and approach in one short message. Only
   stop for input when requirements are genuinely ambiguous or approaches differ
   materially.
2. **Spec** — write/update `docs/superpowers/specs/YYYY-MM-DD-*-design.md`.
3. **Plan** — for non-trivial work, write `docs/superpowers/plans/YYYY-MM-DD-*.md`.
4. **Implement** — code + tests per the conventions below.
5. **Verify** — `tsc --noEmit` + `vitest run` per touched package; Playwright
   screenshots (system Chrome) for UI changes.
6. **Commit + push** — conventional message, straight to `main`.
7. **Watch deploy** — CI to green; on failure diagnose and fix forward
   autonomously; then report concisely.

**Async review:** the user reviews artifacts after the fact and says "revise X" —
corrections are fixed forward, never block the loop.

**Hard gates — always stop for explicit confirmation first:**
- Production database mutations (migrations, manual SQL of any kind)
- Destructive/irreversible operations (deleting files/branches/data, force-push,
  history rewrites)
- New paid external services or credentials (e.g. an SMS provider signup)
- Actions on shared state beyond this repo (PR/issue comments, external messages,
  third-party uploads)

Everything else — specs, plans, code, tests, commits, pushes, CI deploys, doc
updates — proceeds without asking.

**New projects:** seed with `bash ~/.agents/new-project.sh <path>` (gstack is
the primary stack machine-wide — global conventions in `~/.agents/AGENTS.md`);
the script writes a gstack-primary AGENTS.md. The user says "work the loop" to
activate the Loop in that project.

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
- **Docs stay current.** The superadmin documentation page (`/docs`, content in
  `packages/web/src/docs/content.ts`) is a maintained artifact: every shipped
  feature adds or updates its entry there in the same commit, with the correct
  status badge (`live` / `shadow` / `design`). That page is the user-facing
  mirror of the feature-state table below — keep all three in sync.

## Operational gotchas (learned the hard way)

- **Hono strict routing: `/api/x/` ≠ `/api/x`.** A trailing-slash request 404s
  with Hono's default plain-text `404 Not Found` body — and any client that
  blindly calls `res.json()` on it shows V8's raw "Unexpected non-whitespace
  character after JSON at position 4". Client fetches must match mounted paths
  exactly; staff `api.ts` `readJsonEnvelope` converts non-JSON bodies into a
  clear `BAD_RESPONSE` error (2026-07-27 incident).

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
- **Migration SQL: whole-line comments only.** The runner strips whole-line
  comments and splits statements on `;\s*\n`; an inline trailing comment
  (`... TEXT;  -- note`) fuses statements into one mega-statement. Keep every
  comment on its own line and one statement per blank-line-separated block.
- **Local D1 drift.** Fresh local DBs may miss later columns; apply the repo's own
  migration files with `wrangler d1 execute smartgate-db --local --file=…`.
- **CI smoke check** curls the workers.dev host (bot protection 403s the branded
  domain from CI). `/api/kiosk/status` is the payload-shape canary.
- **Cloudflare cron weekdays are Quartz-style: 1=SUN, 2=MON … 6=FRI, 7=SAT** —
  NOT the Unix `0=SUN`. `1-5` means Sunday–Thursday. Every weekday cron here is
  `2-6`; the weekly summary is `0 16 * * 6` (Friday). The `scheduled()` switch
  case labels in `index.ts` must match `wrangler.toml` strings byte-for-byte —
  change them together (2026-08-02 incident: Sunday daily summary + silently
  uncovered Fridays + weekly summary firing as a Thursday daily). Code-level
  guards (`getOfficeStatus`) are the second line — keep them in every
  day-gated job.
- **`wrangler kv key list` lies on this KV namespace.** `smartgate-kv` has
  `supports_url_encoding: true` and wrangler's list (bare or `--prefix`)
  returns `[]` for a namespace full of keys — writes via wrangler appear, the
  Worker's don't. Diagnosed a "missing" Telegram link for an hour over this
  (2026-08-01). Use the REST API instead:
  `curl -H "Authorization: Bearer $OAUTH" "https://api.cloudflare.com/client/v4/accounts/f4f236a6…/storage/kv/namespaces/95f4d6f1…/keys?prefix=<p>"`
  (OAuth token in `%APPDATA%/xdg.config/.wrangler/config/default.toml`).
- **Playwright visual verification** is a root devDependency; drive the system
  Chrome via `channel: 'chrome'` (no browser binaries installed). Serve
  `packages/web/dist` statically and mock `/api/*` routes (auth shape:
  `{data:{user}}`) to screenshot authenticated pages.

## Feature state (as of 2026-07-19)

| Feature | State | Next step |
|---|---|---|
| Presence QR (rotating proof-of-presence) | **Shipped dark** (`presence_qr_mode=0`); display at `/presence-display`; scan-first clock flow; deep-link prefill; enforce-on-clock-in / flag-on-clock-out; **2026-07-21:** shared-device paths — 6-digit code (`presence_method='code'`, per-user rate-limited, derived from the same token) + "Clock in on this device" deep-link button on the display | Mount reception tablet (`docs/ops/presence-display-setup.md` incl. staff-PWA install + sign-out rule) → mode 1 (shadow) → real-device test → mode 2 after ~2 wks |
| Attendance risk fusion | **Shipped dark** (`risk_fusion_mode=0`); scoring persists on every clock event; distribution + disposition endpoints live | Set mode 1 anytime (free calibration data); tune `WEIGHTS` in `risk-score.ts` after 2 wks; block band via separate `risk_fusion_block_enabled` |
| Telegram arrival actions | **Shipped live** (no flag — additive UX); host alerts carry Coming down / Waiting area / Reschedule buttons; first response wins; chips in dashboard + visit log; **2026-07-20 upgrades:** photo arrivals (sendPhoto + text fallback), party + host-status lines, visit-ended thread close via KV-tracked message ids (`tg-arrival:<visitId>`, caption-edit on photo messages) | Migration applied (54/54); watch first photo arrival + thread close on real checkout |
| Appointment email QR + kiosk scan | **Shipped live**; confirmed-appointment email carries an email-safe HTML-table QR of the ref code; kiosk appointment mode has "Scan QR instead" converging on the same lookup | Manual: real confirmation email → phone → kiosk scan |
| Auto-checkout sweep | **Shipped live**; cron `15 17 * * 1-5` (skips weekends/holidays) alerts reception via in-app/push (`checkout_sweep` type) + Telegram admin chat; `POST /visits/bulk-checkout` + amber dashboard banner after close | Confirm new cron trigger registered after deploy; watch first weekday 17:15 run |
| Host availability status | **Shipped live**; `officers.availability_status` (available/in_meeting/out_of_office, NULL⇒available); bot commands `/available` `/meeting` `/out`; profile control; dots+warnings in combobox + kiosk | Run migration after deploy + `POST /api/admin/telegram/sync-commands` to publish new bot commands |
| Delegation mode | **Shipped live** (reception check-in); `visits.party_size/party_names`; +N chips on badge/visit log/visitor detail | Run migration after deploy |
| Watchlist (VIP/banned) | **Shipped live**; `visitors.flag`; superadmin manage on VisitorDetail; VIP→leadership+admin chat, banned→silent reception alert (poker-face UI) | Run migration after deploy |
| Waiting-time SLA | **Shipped live**; cron `*/15 8-17 * * 1-5` escalates unanswered visits ≥30 min to directorate receivers (`sla_breach`, KV-deduped); dashboard wait colors + waiting-first sort | Cron registers on deploy |
| Evacuation roll | **Shipped live**; `GET /reports/evacuation` + `/notify`; dashboard modal with print stylesheet | — |
| Returning-visitor fast lane | **Shipped live**; kiosk `GET /kiosk/visitor-by-phone` (no-oracle 404, rate-limited) + "Been here before?" flow with locked identity; face step reuses the stored photo (Update/Continue) instead of a forced retake that would overwrite the reference | Manual kiosk test with a known returning visitor |
| System docs page (`/docs`) | **Shipped live** (superadmin only); 10 sections / 49 feature cards rendered from `packages/web/src/docs/content.ts`; status badges live/shadow/design; search + scroll-spy pill nav; update rule in conventions + page footer | Keep `content.ts` in sync on every ship (conventions rule) |
| Client Service role (display tier) | **Shipped live**; `users.display_role` rides on `role='receptionist'` (reception parity — prod `users.role` CHECK blocks a 7th DB role value); violet badge in admin users table + header + profile; `roleLabel()` in `web/lib/roles.ts` | Migration applied on prod 2026-07-20 |
| Visitor satisfaction survey | **Shipped live**; kiosk post-checkout 5-star survey (single-use KV `survey_token`, 10-min TTL) → optional comment → thanks; `visitor_surveys` table; Feedback page (stats/distribution/filters/CSV) gated reception-tier; ≤2★ fires `survey_low_rating` in-app + push | Run migration after deploy; watch response rate + first low-rating alert |
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

## Session log — 2026-07-27

Clock nudge ladder shipped (spec + plan `2026-07-27-clock-nudge-ladder*`):
clock-in nudges every 30 min 08:00–11:00 and clock-out nudges 17:00/17:30,
weekday + holiday/absence aware, **activated accounts only**
(`pin_acknowledged=1`), per-user-per-slot KV dedupe; every tick re-queries
clock status so the ladder stops the moment the officer complies. Crons:
`*/15 7-9` replaced by `*/15 8-10` + `0 11`, added `*/15 17-18` (all Mon–Fri).
New `clock_out_reminder` type added to the push whitelist. `PushNudgeBanner`
in the staff PWA offers one-tap push opt-in post-login (14-day snooze) so
nudges reach phones with the app closed. Tests: slot/message logic + audience
SQL via node:sqlite (`reminders.test.ts`). Docs card updated.

RSIMD pilot prep. Fix: liveness (multipart) clock submits posted to
`/api/clock/` — Hono strict routing 404s the trailing slash with plain-text
"404 Not Found", which staff saw as "Unexpected non-whitespace character after
JSON at position 4" (hit every Android user who completed liveness; iOS
escaped via its burst-less fallback). Now posts to `/api/clock`; non-JSON
responses become a clear `BAD_RESPONSE` error with console diagnostics
(`readJsonEnvelope` in staff `api.ts`). Geofence loosened for the pilot:
accuracy cap 30→35m, wall buffer 8→10m (client `geofence.ts` + server
`clock.ts` in sync; worst-case buffer 45m stays short of the ~46m neighbour
ministries). Regression tests: `api.test.ts` (submit URL + non-JSON guard),
`geofence.test.ts` (tolerance bands). NSS registration (NSS type only):
`NSS_NUMBER_REGEX` now also accepts the newer NSSA format — 4-letter
institution code + 12 digits (e.g. GIOT726234454925) — alongside the legacy
NSS + 3 + 7 format, in `admin-nss.ts`, `bulk-import.ts` and
`NssRegistrationModal.tsx` (kept in sync); values normalised to uppercase
server-side. Email fields on NSS/Intern forms accept any provider (validation
was always provider-agnostic; placeholders/examples updated to reflect it).
No migration needed.

Attendance-photo investigation (RSIMD report: clock-ins registered but no
photo_url / blank PDF photo cell): attendance registration itself is complete
— `/attendance/records` LEFT JOINs all active users, nothing filters on QR or
photo, and the PDF always renders the row (photo cell just embeds
`clock_in_photo` when present). `photo_url` is set ONLY from the liveness
burst's canonical frame (sync enforce path or shadow-mode waitUntil path);
burst-less submits (camera error, prompt-fetch failure, manual review, iOS
fallback) and `skipped` decisions legitimately have no photo — QR-skip is
unrelated to frames. Morning clock-ins predated the trailing-slash fix
(deployed ~13:00 UTC), so affected staff got through via burst-less paths.
Hardening: the shadow-mode background liveness verification's catch now fires
`alertAdminError` ('clock:liveness-background') — previously a systemic
Workers AI failure silently stripped photos with no signal.

Product decision (initial PINs): NSS/intern initial PINs are random 6-digit
(`generateInitialPin`), shown once to the admin at registration / in the bulk
credential download, and forced-reset on first login. Using the last 4 digits
of the NSS number as the default PIN was raised and **rejected** — predictable
(anyone who knows a colleague's NSS number can guess it) and off-length (PINs
are 6-digit everywhere). Distribution path = the bulk-import credential CSV.

## Session log — 2026-07-24

Specs/plans: `2026-07-24-self-service-bio-data-design.md` + plan.
Commits: `67256b8` (sidebar footer pinned — nav rail scrolls with a subtle
hover-reveal scrollbar when items overflow), self-service bio data:
`PATCH /auth/profile` gains PIN-gated `name` (+ `profile.update` audit entries
for name/email), VMS My Profile editable name field, staff PWA's first profile
surface (`ProfileModal` from a new BottomNav Profile button), `/auth/me` +
pin-login now return staff_id/nss_number/intern_code/phone. No migration needed.

## Session log — 2026-07-21

Specs: `2026-07-21-presence-code-shared-device-design.md` (+ `2026-07-20-superadmin-docs-section-design.md` shipped today).
Commits: `651a5d6` (fix: photo arrivals fetched by visitor-derived R2 key —
`visitors.photo_url` is a public URL, not an object key), `c57cdf5` (kiosk
returning-visitor face step reuses stored photo), `1e3e999` (superadmin /docs
page + AGENTS.md docs-update convention), `98ff775` (presence 6-digit code +
on-device deep link for shared-device clock-in). No prod migrations needed.

## Session log — 2026-07-20

Specs/plans: `2026-07-20-client-service-role-design.md` + plan,
`2026-07-20-visitor-satisfaction-survey-design.md` + plan.
Commits: `f76a622` (geofence full-accuracy buffer — indoor GPS drift rejected
insiders), `db005fb` (kiosk welcome relabel: New Visitor Check In / Visitor
Check Out), `8e81ac8` (Client Service display-tier role), `0f7f3dc` (switched
to reception parity per product decision), `5319cd4` (visitor satisfaction
survey), `562ac16` (Telegram arrival upgrades: photo/party/thread close).
Migration `migration-users-display-role.sql` applied on prod via the
superadmin runner; `migration-visitor-surveys.sql` applied same day.

## Session log — 2026-07-19

Specs/plans: `2026-07-19-presence-qr-design.md`, `2026-07-19-attendance-risk-fusion-design.md`
+ matching plans. Commits: `618b26a` (both features), `d96c4da` (display sizing fix),
`bda44da` (premium display redesign), `7ed4d6e` (scan-first + deep-link + enforce-on-in).
Prod incident: settings-column deploy raced the migration → 500s; fixed via
superadmin migration runner (see gotcha above).
