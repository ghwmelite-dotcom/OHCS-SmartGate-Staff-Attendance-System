# Implementation plan

1. Add nullable reported_departure_at to schema and append migration registration. Test migration against existing rows.
2. Add a separate authenticated clock-out endpoint with strict input, mandatory reauthentication, date bounds, idempotency and atomic duplicate guards. Keep on-site geofence behavior intact.
3. Add a compact accessible staff form supporting current/earlier departure and PIN/passkey. Refresh status only after acknowledgement; preserve retry identity.
4. Update status, attendance queries, admin tables, CSV/PDF and monthly reporting to distinguish departure from submission.
5. Update evening reminder copy and regression-test audience exclusion without changing time slots.
6. Update maintained documentation. Run affected package typechecks and test suites, then browser verification with mocked API.
7. Review diff, commit scoped files. Request approval for production migration before push/deploy; preserve unrelated local changes.

## Verification and rollout handoff

Corrective release (user-approved): match the 4–6-digit login PIN policy, add one-shot standard confirmation fanout for self-reports, persist completion from attendance status, and replace next-day assumptions with “Enjoy your time off.” Tests: API 578, staff 77, web 116 passed; mobile Chrome verifies 4-digit entry, visible confirmation after form removal and after reload. No new migration or reminder timing change. Device push receipt remains a real-phone check.

- Implemented the separate route and UI; normal location checks and reminder slot constants/crons are unchanged.
- API, staff and web TypeScript checks passed. Full suites passed: API 572 tests, staff 77, web 116. A subsequent replay-evidence regression also passed (clock route suite now 32 tests).
- Real SQLite route tests exercise PIN verification, invalid/expired prompts, time bounds, idempotency, competing normal/self-reported requests, truthful replay evidence and additive migration preservation.
- Attendance record/monthly/range tests verify early-departure classification uses the reported time. CSV and PDF tests verify self-report labels and retained submission timestamps. Reminder audience test verifies exclusion after self-report.
- Python Playwright with system Chrome passed at 390×844 against intercepted synthetic API data: no location/camera payload, Ghana-time submission, acknowledged completion, refreshed status, no horizontal overflow or page errors. Screenshot review led to using existing readable surface/muted color tokens.
- This is local proof, not production delivery or real-iPhone/passkey proof. Real-device authentication and the next reminder tick remain post-release checks.

Production gate approved by the user on 2026-10-02 ("run full deployment"). Local Wrangler cannot access the production account (7403). Deployment therefore uses the existing GitHub Cloudflare secret, never exporting it: `scripts/deploy-self-reported-migration.mjs` checks the exact account/database, allowlisted SQL, column type/nullability and migration hash. It applies only this approved column and records the filename/SHA-256 before Worker deployment. Interrupted ledger recording can be repaired on rerun only when schema is exact. Three SQLite guard tests pass and run in CI; CI now also runs staff tests. No broad migration runner is invoked. After push, watch CI/deploy and verify live health/assets/access boundaries. Authenticated device actions require the officer's session; do not fabricate attendance for a deployment test. A code rollback can leave the unused nullable column in place; do not drop it or erase declarations.
