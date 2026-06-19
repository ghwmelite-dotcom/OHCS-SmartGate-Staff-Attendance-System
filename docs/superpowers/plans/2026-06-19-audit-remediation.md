# Audit Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Fix every finding from the 2026-06-19 full audit of the OHCS SmartGate VMS + Staff Attendance systems, in risk order, as a sequence of focused batches (one branch + PR + deploy per batch), each verified before the next.

**Source:** the audit (auth, injection, DB, VMS, attendance, frontend dimensions). Severities: 6 High, 9 Medium, ~10 Low.

**Tech:** Hono + D1 (Cloudflare Workers, `packages/api`), React 18 + Vite (`packages/web` admin/VMS, `packages/staff` PWA), Zod, vitest.

**Toolchain (never `npm run`; repo path has space + `&`):**
- API: tc `node ../../node_modules/typescript/bin/tsc --noEmit` · test `node ../../node_modules/vitest/vitest.mjs run` (from `packages/api`)
- Web: tc + `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` (from `packages/web`)
- Staff: tc (from `packages/staff`)
- wrangler: `node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" …` (db name `smartgate-db`)

**Process:** each batch = its own branch off `main` → implement items → static gates green → PR → merge → deploy green → next batch. DB-affecting batches verify the migration locally; the one prod DB op (Batch 2 indexes) is gated on user confirmation + backup.

**Blocked / needs user input (NOT in any batch):**
- **Geofence polygon** (Medium) — the real fix needs the OHCS building's true GPS footprint coordinates, which we don't have. Deferred pending the user supplying coordinates; tracked separately.

---

## Batch 1 — Authorization & web hardening (HIGH, low-risk, high-value)

**Branch:** `fix/audit-1-authz-headers`. **Files:** API routes + Pages `_headers`.

- [ ] **1.1 Role guards on visit mutations.** `routes/visits.ts`: add `const blocked = requireRole(c,'superadmin','admin','receptionist'); if (blocked) return blocked;` at the top of `POST /` (check-in, ~line 104) and `POST /:id/check-out` (~124). (Match the role set used by the file's GET handlers, minus `it`/`director` unless they already appear there — read the file and mirror the existing reception-capable set; include `director` only if the GETs do.)
- [ ] **1.2 Role guards on visitor mutations.** `routes/visitors.ts`: same guard on `POST /` (~71) and `PUT /:id` (~84) — roles `superadmin,admin,receptionist`.
- [ ] **1.3 Photo authorization.** `routes/photos.ts`: gate `GET /visitors/:id` + `/visitors/:id/id` reads and the `POST` upload routes to `superadmin,admin,receptionist` (+`director,it` for reads to match visitor-list roles); `GET /api/photos/clock/:id` (mounted in `index.ts:79`) → restrict to `superadmin,admin` OR the owning `user_id` (look up the clock_record's user_id and compare to `session.userId`).
- [ ] **1.4 Officers list info-leak.** `routes/officers.ts`: add a role guard (`superadmin,admin` — confirm who legitimately needs it) AND stop selecting `telegram_chat_id` (project only columns the UI uses) in `GET /` and `GET /:id`.
- [ ] **1.5 Telegram webhook + escaping.** `routes/telegram.ts`: (a) when `ENVIRONMENT==='production'` and `TELEGRAM_WEBHOOK_SECRET` is unset, reject with 401 (don't silently allow unauthenticated updates); (b) wrap `staffId` at ~line 105 in `escapeHtml(...)` (import from `lib/html`).
- [ ] **1.6 Directorate isolation.** FIRST verify the prod role model: `wrangler d1 execute smartgate-db --remote --command "SELECT role, directorate_id FROM users WHERE role='director';"` — confirm directors carry a `directorate_id`. If yes: in `routes/reports.ts`, `routes/analytics.ts`, `routes/visits.ts`, when `session.role==='director'`, force `directorate_id = session.directorate_id` server-side (override any query param) AND apply it inside the report summary sub-query (`reports.ts:49-52`). If directors have NO directorate_id in prod, STOP and report (scope this item out — can't isolate without the link).
- [ ] **1.7 Security headers.** Create `packages/web/public/_headers` and update `packages/staff/public/_headers` with a `/*` block:
  ```
  /*
    X-Frame-Options: DENY
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Strict-Transport-Security: max-age=31536000; includeSubDomains
    Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://ohcs-smartgate-api.ohcsghana-main.workers.dev; frame-ancestors 'none'
  ```
  (Read each app's actual external origins — fonts, the API host, any CDN — and tune `connect-src`/`style-src`/`font-src`/`img-src` so nothing breaks; verify against the built `dist/index.html`. Keep the existing Cache-Control rules in the staff `_headers`.) Also set the same headers on the badge HTML response in `routes/badges.ts` (before `c.html(...)`, via `c.header(...)`), with a CSP that permits its `cdn.jsdelivr.net` + Google Fonts usage.
- [ ] **1.8 Verify + commit + PR + deploy.** API tc + full test suite green; web tc + build; staff tc. Confirm `_headers` present in `dist`. Manual sanity: the guards return 403 for a staff session (reason through the code). Commit per logical unit, one PR, merge, deploy green.

---

## Batch 2 — Data integrity (HIGH/Medium)

**Branch:** `fix/audit-2-data-integrity`. **Files:** new migration + `check-in.ts`, `clock.ts`, `schema.sql`, `migrations-index.ts`, `admin-migrations.ts`.

- [ ] **2.1 Idempotency UNIQUE indexes (migration).** New `migration-idempotency-unique.sql`:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_idem_unique ON visits(idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_clock_user_idem_unique ON clock_records(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  ```
  Register in `migrations-index.ts`. Add the same two indexes to `schema.sql` (and remove/keep the old plain `idx_visits_idem` per whether it's now redundant — keep if used for lookups). **Pre-apply check:** before relying on UNIQUE, query prod for existing duplicate keys (`SELECT idempotency_key, COUNT(*) FROM visits WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1`; same for clock_records) — if any exist, the index creation fails; dedupe first. Apply local; prod apply is gated (Batch-2 deploy step, user-confirmed + backup).
- [ ] **2.2 Catch-and-return-existing.** `services/check-in.ts performCheckIn` and `routes/clock.ts`: wrap the INSERT so a UNIQUE-violation on the idempotency index is caught and the existing row is re-read and returned (same shape as the dedup hit), instead of a 500.
- [ ] **2.3 schema.sql drift.** Add to `schema.sql`: `clock_records.liveness_challenge/liveness_decision/liveness_signature` (+ CHECKs, matching `migration-passive-liveness.sql`) and `app_settings.clockin_passive_liveness_enforce/clockin_liveness_review_cap_per_week/clockin_liveness_model_version`. Align the `pin_acknowledged` CHECK note (document that prod lacks it; do NOT rebuild to add it).
- [ ] **2.4 Migration runner atomicity.** `routes/admin-migrations.ts`: run each migration's statements via `c.env.DB.batch(stmts.map(s => c.env.DB.prepare(s)))` so a file applies atomically (D1 batch = implicit transaction); keep the per-file applied_migrations recording after the batch succeeds. (Verify `batch` semantics don't choke on `CREATE INDEX`/`ALTER` — they're supported.)
- [ ] **2.5 Badge code entropy + retry.** `services/check-in.ts`: widen `generateBadgeCode` randomness to ≥5 bytes hex/base32 (no truncation that drops entropy), keep the `OHCS-` prefix; in `performCheckIn`, retry once on a `badge_code` UNIQUE violation with a fresh code. Update `check-in.test.ts` (still `^OHCS-[0-9A-Z]+$`).
- [ ] **2.6 Verify + commit + PR. Prod migration GATED:** before deploy, with user confirmation, back up + dedupe-check + apply `migration-idempotency-unique.sql --remote`, record in applied_migrations. Then merge + deploy.

---

## Batch 3 — Attendance correctness (High/Medium)

**Branch:** `fix/audit-3-attendance`. **Files:** `routes/admin-nss.ts`, `routes/attendance.ts`, `services/liveness/*`, `routes/clock.ts`.

- [ ] **3.1 Export window clamp.** `routes/admin-nss.ts` `/export`: clamp the per-user `clock_ins`/`late_count` aggregation to the same `[effectiveStart, effectiveEnd]` window used for the denominator (filter `nss_clock_in_days` by each user's posting window), so `present + absent == working_days` holds. Add/adjust the working-day reasoning; keep UTC.
- [ ] **3.2 Liveness anti-spoof.** `services/liveness/index.ts` + `motion.ts` + `ai.ts`: in enforce mode require face landmarks present AND `face_score >= min` in ALL frames before `pass`; treat "no face in any frame" as `fail` (never `pass`); implement a real `sharpness` signal (replace the hardcoded `0`) and use it as a gate. Keep shadow-mode observe-only. (Scope: tighten the decision logic + sharpness; full screen-artifact ML is out — document the residual.)
- [ ] **3.3 Leave/absence state guards.** `routes/attendance.ts` `/leave/:id/approve` + `/reject` (and absence equivalents): `UPDATE ... WHERE id=? AND status='pending'`, check `meta.changes` → 409 if not pending; block self-approval (`approver != requester`); stamp `decided_at`/`approved_by`.
- [ ] **3.4 Manual-review photo + dead column.** `routes/clock.ts` + `routes/attendance.ts`: persist the canonical frame for `manual_review` decisions (so HR has an image to review); drop the always-NULL `prompt_value` from the records query.
- [ ] **3.5 Verify + commit + PR + deploy.** API tc + tests; if any liveness unit tests exist, update; deploy green.

---

## Batch 4 — Auth hardening (High, heavier)

**Branch:** `fix/audit-4-auth-hardening`. **Files:** `services/auth.ts`, both `tokenStore.ts` + auth stores + API cookie handling.

- [ ] **4.1 PIN KDF migration.** `services/auth.ts`: replace `hashPin` with PBKDF2-HMAC-SHA256 via WebCrypto (`crypto.subtle`), per-user random salt, ≥100k iterations, stored as a self-describing string `pbkdf2$<iters>$<saltb64>$<hashb64>`. Make `verifyPin` detect format: legacy bare-hex SHA-256 → verify the old way AND on success transparently rehash to PBKDF2 and UPDATE `pin_hash` (needs the user id in scope at verify sites — pin-login + change-pin + clock-reauth; thread it through or rehash in the caller). Unit-test: hash→verify roundtrip; legacy hash verifies + upgrades; wrong PIN fails. No data migration needed (lazy upgrade on login).
- [ ] **4.2 Token storage.** Move the PWAs off the localStorage bearer: the API already sets an HttpOnly `session_id` cookie (SameSite=None+Secure in prod) and `fetch` uses `credentials:'include'`. Stop persisting the returned `session_token` to localStorage (`staff` + `web` `tokenStore.ts`/auth stores); rely on the cookie. VERIFY cross-origin: the PWAs (Pages origins) → API (workers.dev) must send the cookie — confirm CORS `credentials:true` + the cookie `SameSite=None; Secure` actually round-trips (test login→authed request in a built preview against the live API, or reason carefully). If the cookie can't be relied on cross-origin in this topology, keep the bearer but hold it in memory only (not localStorage) as the fallback. Document the decision.
- [ ] **4.3 Verify + commit + PR + deploy.** Static gates; runtime smoke (login still works on both PWAs); deploy green. This batch is auth-critical — verify login end-to-end before merging.

---

## Batch 5 — Frontend a11y & resilience (Low)

**Branch:** `fix/audit-5-frontend`. **Files:** `packages/web` + `packages/staff` components/styles; a few API low items.

- [ ] **5.1 Error boundaries.** Add an `<ErrorBoundary>` (class component with `componentDidCatch` + a "Something went wrong — reload" fallback) wrapping the route tree in both `packages/web/src/App.tsx` and `packages/staff/src/App.tsx`.
- [ ] **5.2 prefers-reduced-motion (web/kiosk).** Add the reduced-motion media rule (mirror staff `App.tsx:133-135`) to `packages/web` — ideally globally in `styles/tokens.css` — so the splash + kiosk backdrop/login animations respect it.
- [ ] **5.3 Kiosk form label association.** `components/checkin/FieldWrapper.tsx`: give the `<label>` an `htmlFor` tied to the input's `id` (or wrap children in the label) so screen readers announce each field.
- [ ] **5.4 Icon-button a11y.** `components/layout/Header.tsx` theme toggles: add `aria-label`, bump to ≥44px touch target.
- [ ] **5.5 Misc API lows.** Image magic-byte sniff (`FF D8 FF`) before R2 `put` in upload routes; `id_photo` AI verdict passed through the check-in body (not solely KV TTL); 200-row cap + `.max(255)` on `bulk-import` directorates/officers.
- [ ] **5.6 Verify + commit + PR + deploy.** Static gates; a headless render of kiosk + staff login to confirm no visual/a11y regression; deploy green.

---

## Self-Review
- **Coverage:** every audit finding maps to a batch item except the geofence polygon (blocked on real coordinates — explicitly deferred + tracked). Verified High×6 (1.1–1.3, 1.7, 2.1/2.2, 3.2, 4.1), Medium×9 (1.4–1.6, 2.3, 2.4, 2.5, 3.1, 3.3, 4.2), Low (Batch 5 + 1.4/1.5 parts) all present.
- **Ordering:** risk-first and dependency-aware — authz/headers (cheap, blocks the worst exposure) → data integrity (needs gated prod index) → attendance correctness → auth hardening (riskiest to login, isolated) → frontend polish. Each batch ships independently.
- **Gated prod ops:** only Batch 2's two indexes touch prod data — gated on confirmation + backup + duplicate-precheck. PIN KDF is lazy (no data migration). No table rebuilds.
