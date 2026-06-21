# Audit Remediation Plan (2026-06-21 re-audit)

Sequential fix of all findings, in 4 batches (one PR/deploy each, gated by CI test+smoke).

## Batch 1 — AuthZ & isolation (High)
- **#1** `routes/photos.ts` — scope visitor face/ID-photo GETs for `director` (verify a visit links the visitor to their directorate); `Cache-Control: private`.
- **#2** `lib/directorate-scope.ts` — return a non-matching sentinel (`__no_directorate__`) for a director with NULL directorate (fixes fail-open in visits/reports/analytics without touching callers).
- **#6** `routes/visits.ts` — scope `POST /:id/check-out` to the director's directorate.
- **#7** `routes/notifications-push.ts` — `ON CONFLICT(endpoint)` only updates when the row belongs to the same user (no cross-user hijack).
- **#14** `routes/visitors.ts` — explicit column lists (no `SELECT *`); keep id_number for roles that need it.

## Batch 2 — Auth/session hardening
- **#3** PIN brute-force — add per-account failed-attempt lockout (KV) on `pin-login` with cooldown; keep existing sliding limits. (Full KV atomicity via DO noted as future.)
- **#9/#10** `services/auth.ts` — narrow the `bumpSessionEpoch`/`getUserAuthState` catches to the missing-column case; rethrow real errors.
- **#11** `routes/auth.ts` OTP `/login` — uniform response (no user enumeration); only send OTP for valid+active.
- **#5** `routes/auth-webauthn.ts` — use shared `sessionCookieOptions` (Lax + Domain), not inline `SameSite=None`.
- change-PIN — bump epoch on self-service PIN change.

## Batch 3 — Secret/PII exposure & frontend
- **#4** `admin-settings.ts` + `SettingsModal.tsx` — return `has_override_pin` boolean, never the value; write-only PIN field (password + change/remove).
- **#8** `kiosk.ts` + `KioskPage.tsx` — drop `reception_officer_name` from the public directorates endpoint (+ remove the "received by X" hint).
- Dead `setToken`/bearer machinery — delete from web + staff `tokenStore`/`api`.
- `VisitorAvatar.tsx` — replace `innerHTML` fallback with React state / `textContent`.
- `BulkImportTab.tsx` — mask the `pin` column in the import preview.

## Batch 4 — Validation / abuse / reliability
- **#12** `admin-audit.ts` — Zod-validate query (cap `q`, clamp limit/cursor, ISO dates).
- **#13** `staff/src/lib/geofence.ts` — sync polygon to the server footprint.
- `badges.ts` — time-box / status-scope the public badge photo + JSON.
- `clock.ts` clear-test-records — route through `recordAudit`.
- photo uploads — `Content-Length` precheck before buffering.
- `admin-nss.ts` bulk-import — `name` max-length.
- `reminders.ts` — include NSS/intern (not just `staff_id IS NOT NULL`).
- `services/audit.ts` — run `summary` through redaction.

Deferred (noted, not in this pass): full rate-limiter atomicity via Durable Objects; audit-chain HMAC/external anchoring; liveness shadow-mode `fail` reconciliation (moot once enforce is on).
