-- Tamper-evident, append-only audit log of sensitive mutations.
-- Each row hashes its own content + the previous row's hash (chain); code never
-- updates or deletes rows here. See docs/superpowers/specs/2026-06-21-audit-log-design.md.
CREATE TABLE IF NOT EXISTS audit_log (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    seq           INTEGER NOT NULL,          -- monotonic; ordering + chain position
    at            TEXT NOT NULL,             -- ISO8601, set in JS (must match the hashed value)
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
