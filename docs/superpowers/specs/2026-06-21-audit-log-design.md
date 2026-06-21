# Audit Log — Design Spec

**Date:** 2026-06-21
**Status:** Awaiting review

## Goal

Add a first-class, tamper-evident **audit log** that records every sensitive
mutation (who did what, to what, when, from where) so administrative and
authorization actions are durably accountable — closing the gaps found in the
audit-trail assessment (user/role/PIN changes, org-entity & holiday CRUD,
settings, override use, migrations were previously invisible after the fact).

## Decisions (locked)

1. **Coverage:** sensitive mutations only — writes that change people, access, or
   config. NOT reads, exports, or logins (kept out to stay signal-rich).
2. **Integrity:** append-only + **hash-chained** (each entry hashes its content +
   the previous entry's hash). Code never updates/deletes audit rows.
3. **Detail:** before→after field diffs as JSON, with secrets always redacted.

## Architecture

A single `audit_log` table, one append-only `recordAudit()` service, called
inline (awaited) from each sensitive mutation handler. Audit writes are
**non-fatal**: a failure is logged + admin-alerted but never fails the
underlying action (a failed write leaves a gap, not a broken chain — see below).

### Schema (`migration-audit-log.sql` + `schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS audit_log (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    seq           INTEGER NOT NULL,          -- monotonic; ordering + chain position
    at            TEXT NOT NULL,             -- ISO8601, set in JS (must match hashed value)
    actor_user_id TEXT,                      -- NULL for kiosk/system actors
    actor_role    TEXT,
    actor_label   TEXT,                      -- display name, or 'kiosk' / 'system'
    action        TEXT NOT NULL,             -- e.g. 'user.create', 'user.role_change'
    entity_type   TEXT,                      -- 'user'|'directorate'|'officer'|'holiday'|'settings'|'visit'|'migration'|'reception_team'
    entity_id     TEXT,
    summary       TEXT,                      -- short human-readable line
    changes       TEXT,                      -- JSON { field: { from, to } }, secrets redacted; NULL for create/delete
    ip            TEXT,
    prev_hash     TEXT NOT NULL,             -- previous entry's hash ('' for genesis)
    hash          TEXT NOT NULL              -- sha256(canonical(this) + prev_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_seq ON audit_log(seq);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
```

Registered in `db/migrations-index.ts` so the existing **Run pending migrations**
button applies it to prod. Added to `backup.ts` `BACKUP_TABLES`.

### Hash chain

- `canonical = JSON.stringify({seq, at, actor_user_id, actor_role, action, entity_type, entity_id, summary, changes})`
  using stable key order.
- `hash = sha256Hex(canonical + prev_hash)` (reuse `sha256Hex` from `migrations-index.ts`).
- Genesis entry: `prev_hash = ''`.
- **Concurrency:** seq + prev_hash come from the current last row, so two
  concurrent writes can collide. The `UNIQUE(seq)` index makes the loser's INSERT
  fail; `recordAudit` retries (re-read last row → recompute → re-insert) up to 5×.
  Admin write-concurrency is low, so retries are rare. A write that still fails
  after retries is swallowed (non-fatal) and admin-alerted.
- **Verification:** walk rows by `seq`; recompute each `hash` from its content +
  the prior `hash`; the chain is intact iff every recomputed hash matches and
  `prev_hash` equals the prior row's `hash`. A tampered/edited/deleted row breaks
  the recomputation at that point.

### Service — `services/audit.ts`

```ts
interface AuditActor { userId: string | null; role: string | null; label: string | null }
interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
}
// Reads actor from the Hono session + IP from cf-connecting-ip.
function auditActorFromContext(c): { actor: AuditActor; ip: string | null }
async function recordAudit(env, ctx: { actor; ip }, input): Promise<void>  // non-fatal, awaited
function diffRecords(before, after, fields?): Record<string,{from,to}>      // changed fields only
```

**Redaction:** any field whose name matches `/pin|password|secret|token|hash|api[_-]?key/i`
has its `from`/`to` replaced with `'[redacted]'`. PIN values/hashes are NEVER stored.

### Event catalog (wiring sites)

| Action | Site | Notes |
|---|---|---|
| `user.create` | users.ts POST | summary + non-secret fields |
| `user.update` / `user.role_change` | users.ts PUT | diff; emit `role_change` action when role differs |
| `user.deactivate` | users.ts DELETE | |
| `nss.create` / `intern.create` | admin-nss.ts / admin-interns.ts POST | |
| `directorate.create/update` | admin-directorates.ts | incl. is_active toggle |
| `officer.create/update` | admin-directorates.ts | |
| `reception_team.add/remove/set_primary` | admin-directorates.ts | |
| `officer.telegram_link_issued/revoked` | admin-directorates.ts | |
| `holiday.create/delete` | admin-holidays.ts | |
| `settings.update` | admin-settings.ts | diff of changed settings (override PIN redacted) |
| `override.use` | kiosk.ts | ID-gate AND office-closed gate; actor = shared reception PIN (no user — see Non-goals); records visit_id + gate + reason |
| `users.bulk_import` | bulk-import.ts | single summary entry (counts), not per-row |
| `migrations.run` | admin-migrations.ts | applied/skipped filenames |

### Endpoints (superadmin)

- `GET /api/admin/audit` — paginated (cursor on `seq` desc), filters:
  `entity_type`, `action`, `actor_user_id`, `from`/`to` date, `q` (summary search).
- `GET /api/admin/audit/verify` — recomputes the chain, returns
  `{ ok, checked, brokenAtSeq? }`.

### Admin UI

New superadmin **Audit Log** tab in `AdminPage.tsx`:
- Table: time, actor (name + role), action (badge), entity, summary; row expands
  to show the `changes` diff.
- Filters: entity type, action, date range, free-text.
- **"Verify integrity"** button → calls `/verify`, shows ✓ intact / ✗ broken at seq N.
- Cursor pagination ("load more").

## Non-goals (explicit)

- **Per-officer reception PINs.** The override PIN is shared, so `override.use`
  records the event but cannot attribute it to an individual. Tying overrides to a
  person needs per-officer PINs — a separate future feature; flagged in the entry.
- Logins, reads, exports (excluded per the coverage decision).
- No log-rotation/retention policy yet (append-only grows; revisit if volume warrants).

## Risks / tradeoffs

- **Added latency:** each audited mutation does one extra read + insert (awaited).
  Acceptable — these are low-frequency admin actions.
- **Gaps vs broken chain:** a non-fatal failed write loses an event but keeps the
  chain linkable. We accept event-loss over breaking core flows; failures are
  admin-alerted so they're visible.
- **Concurrency retries:** bounded (5×); pathological contention could still drop
  an entry (admin-alerted). Fine for admin-action volume.

## Test plan

- Unit: `diffRecords` (changed-only + redaction); hash chain (recompute matches;
  tampering a row fails verify).
- Runtime: perform each audited action as superadmin → entry appears with correct
  actor/action/diff; secrets show `[redacted]`; `/verify` returns ok; manually
  editing a row via D1 makes `/verify` report broken at that seq.
