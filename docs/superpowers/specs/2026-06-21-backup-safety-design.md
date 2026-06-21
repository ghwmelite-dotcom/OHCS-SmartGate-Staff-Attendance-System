# Backup Safety — Restore, Encryption & Integrity Verification

**Date:** 2026-06-21  **Status:** Approved (build A→B→C)

> **Decision (2026-06-21):** add `webauthn_credentials` AND `visit_categories` to
> the backup allowlist so passkey enrolments and visit-category config survive a
> restore (a wiped passkey + enforced re-auth would lock all staff out of clocking
> in). Only `notifications` + `push_subscriptions` remain unbacked (transient).

## Goal

Make the existing D1→R2 backups a real recovery tool, not just dead files:
1. **Restore** a chosen snapshot (disaster recovery / undo a mistaken go-live reset).
2. **Encrypt** backups so an R2 credential leak isn't a full PII dump.
3. **Verify** the latest backup is actually restorable, and surface it.

Builds on [[go-live-reset]] (shares the FK-safe ordering discipline) and the
existing `services/backup.ts` (`backups/<date>/<table>.json`, 12-table allowlist).

---

## Part A — Backup encryption (build first; safe, additive)

**Threat:** the backup JSON holds staff + visitor PII in cleartext. R2 encrypts
at rest, but a leaked R2 read credential = full data dump.

**Design — app-level AES-GCM envelope:**
- New optional secret `BACKUP_ENCRYPTION_KEY` (base64, 32 bytes).
- On write: AES-GCM encrypt each table's JSON with a fresh 12-byte IV; store an
  envelope `{ v: 1, iv, data }` (base64). On read: decrypt.
- **Backward compatible:** legacy objects parse as a JSON *array* → treated as
  plaintext. Envelopes are `{v,iv,data}` objects → decrypted. So old backups
  still restore.
- **Deploy-safe:** if `BACKUP_ENCRYPTION_KEY` is unset, fall back to plaintext
  (with a one-line warning log). Setting the secret makes *new* backups encrypted;
  nothing breaks if it's absent. Key rotation is out of scope (documented).
- Add `crypto` helpers to a small `services/backup-crypto.ts` (encryptJson /
  decryptToJson), unit-tested round-trip + legacy-plaintext passthrough.

## Part B — Integrity verification (build second; safe, additive)

**Principle:** "a backup you can't restore isn't a backup."

- `verifyLatestBackup(env)`: find the newest `backups/<date>/`, read + decrypt +
  `JSON.parse` each expected table, assert it's an array, sum rows. Return
  `{ date, ok, tables: [{name, rows, ok}], missing: [] }`.
- Wire into the daily 02:00 cron **after** `exportBackupToR2` (verify what we just
  wrote); `alertAdminError` if `!ok`.
- `GET /api/admin/maintenance/backup-status` (superadmin, read-only): returns the
  latest backup's per-table counts + verified flag. Surface in the Settings modal
  ("Last backup: <date> · verified ✓ · N rows").

## Part C — Restore (build last; DESTRUCTIVE — the reason for this spec)

`POST /api/admin/maintenance/restore` (superadmin), body `{ confirm: "RESTORE", pin, date }`.

1. requireSuperadmin → verify typed phrase `RESTORE` + re-enter PIN (as in reset).
2. Validate `date` exists under `backups/<date>/` (404 if not).
3. **Back up the CURRENT state first** (`exportBackupToR2`) so the restore is
   itself reversible; abort if that backup fails.
4. Load + decrypt every table JSON for that date.
5. **Single atomic `DB.batch`** (all-or-nothing — a half-restore must be
   impossible):
   - **Wipe** (child→parent, circular/self refs nulled first): notifications,
     push_subscriptions, webauthn_credentials, clock_records, leave_requests,
     absence_notices, visits, visitors, directorate_receivers; null
     `directorates.reception_officer_id/head_officer_id` + `users.supervisor_user_id`;
     officers; users; app_settings; holidays; audit_log; visit_categories; directorates.
   - **Re-insert** (parents→children, deferred refs):
     directorates (officer refs NULL) → visit_categories → officers →
     `UPDATE directorates` set officer refs → users (supervisor NULL) →
     `UPDATE users` set supervisor → visitors → visits → clock_records /
     leave_requests / absence_notices / directorate_receivers → app_settings →
     holidays → audit_log.
6. Record `system.restore` audit entry (the restored chain's max seq + 1 → valid tip).

**Tables NOT in backups (lost on restore — documented):** only `notifications`
and `push_subscriptions` (transient — re-generated / push re-subscribes).
`visit_categories` and `webauthn_credentials` are ADDED to the backup allowlist
(decision above) so config + passkey enrolments survive a restore.

**Dynamic INSERTs:** columns come from each row's own keys (our own SELECT *
data — same trust model as backup's table-name interpolation). Defensive:
intersect each row's columns with the live schema (`PRAGMA table_info`) and drop
unknown columns, so a backup taken under an older/newer schema still restores
(added columns take their defaults; removed columns are ignored).

**Atomicity vs size:** one `DB.batch` is atomic but bounded by D1's per-batch
limits. Fine at this office's scale (a restore is a rare DR action on
pre/early-go-live data). If a future dataset is too large, chunk per-table and
drop strict cross-table atomicity — explicitly out of scope now, and `log()`-ed
if row counts approach the limit.

**UI:** in the Settings Danger Zone, a "Restore from backup" control: pick a date
(from `backup-status`/a list), type `RESTORE`, re-enter PIN. Strong warning that
it replaces ALL current data with the snapshot and that notifications/push/
biometric enrolments are not restored.

---

## Test plan
- **A:** round-trip encrypt→decrypt; legacy plaintext array passes through; missing
  key → plaintext fallback.
- **B:** `verifyLatestBackup` on a seeded R2 mock — ok path, a corrupt/missing
  table → `ok:false`.
- **C:** integration test mirroring `go-live-reset.test.ts` — seed → backup-shaped
  JSON → run the exported wipe+insert statement plan against in-memory SQLite with
  `PRAGMA foreign_keys = ON`; assert no FK violation and the DB matches the
  snapshot (row counts + spot-checked circular/self refs reconnected).

## Build order
A (encryption) → B (integrity) → C (restore). A and B are safe/additive and can
ship independently; C is gated on this spec's approval.
