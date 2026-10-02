# Implementation plan

1. Add nullable reported_departure_at to schema and append migration registration. Test migration against existing rows.
2. Add a separate authenticated clock-out endpoint with strict input, mandatory reauthentication, date bounds, idempotency and atomic duplicate guards. Keep on-site geofence behavior intact.
3. Add a compact accessible staff form supporting current/earlier departure and PIN/passkey. Refresh status only after acknowledgement; preserve retry identity.
4. Update status, attendance queries, admin tables, CSV/PDF and monthly reporting to distinguish departure from submission.
5. Update evening reminder copy and regression-test audience exclusion without changing time slots.
6. Update maintained documentation. Run affected package typechecks and test suites, then browser verification with mocked API.
7. Review diff, commit scoped files. Request approval for production migration before push/deploy; preserve unrelated local changes.

## Verification and rollout handoff

- Implemented the separate route and UI; normal location checks and reminder slot constants/crons are unchanged.
- API, staff and web TypeScript checks passed. Full suites passed: API 572 tests, staff 77, web 116. A subsequent replay-evidence regression also passed (clock route suite now 32 tests).
- Real SQLite route tests exercise PIN verification, invalid/expired prompts, time bounds, idempotency, competing normal/self-reported requests, truthful replay evidence and additive migration preservation.
- Attendance record/monthly/range tests verify early-departure classification uses the reported time. CSV and PDF tests verify self-report labels and retained submission timestamps. Reminder audience test verifies exclusion after self-report.
- Python Playwright with system Chrome passed at 390×844 against intercepted synthetic API data: no location/camera payload, Ghana-time submission, acknowledged completion, refreshed status, no horizontal overflow or page errors. Screenshot review led to using existing readable surface/muted color tokens.
- This is local proof, not production delivery or real-iPhone/passkey proof. Real-device authentication and the next reminder tick remain post-release checks.

Production gate: obtain explicit approval for the additive column before pushing main. Verify the production account/database and migration state first. Apply only migration-clock-self-reported.sql and record its exact filename/SHA-256 in applied_migrations (or stage a migration-only runner release, inspect pending migrations, then run the approved migration). Never invoke the broad runner blindly. Once the column is confirmed, mark the docs card and AGENTS feature row live, push, watch CI/deploy, and smoke-test authenticated status/report endpoints. A code rollback can leave the unused nullable column in place; do not drop it or erase declarations.
