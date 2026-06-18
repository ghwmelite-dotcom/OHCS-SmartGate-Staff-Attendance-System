-- Drop the legacy users.role CHECK constraint (prod drifted from schema.sql) via
-- a table rebuild. Companion spec: 2026-06-17-users-role-check-drop-design.md
-- Rebuilds users WITHOUT the role CHECK, preserving all columns / other CHECKs /
-- defaults / indexes / FKs, then re-seeds the kiosk system user (role 'visitor',
-- which the old CHECK rejected). Harmless on already-CHECK-free DBs.
-- Remote D1 ENFORCES foreign keys, so DROP TABLE users (referenced by
-- visits.created_by / clock_records.user_id / etc.) would fail. Defer FK checks
-- to the transaction commit, by which point users (renamed from users_new) holds
-- the same ids and all child references remain valid.
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users_new (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    staff_id         TEXT UNIQUE,
    pin_hash         TEXT,
    pin_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(pin_acknowledged IN (0, 1)),
    role             TEXT NOT NULL DEFAULT 'staff',
    grade            TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    last_login_at    TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    current_streak   INTEGER NOT NULL DEFAULT 0,
    longest_streak   INTEGER NOT NULL DEFAULT 0,
    directorate_id   TEXT REFERENCES directorates(id),
    user_type        TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss')),
    nss_number       TEXT,
    nss_start_date   TEXT,
    nss_end_date     TEXT
);
INSERT INTO users_new (id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active, last_login_at, created_at, updated_at, current_streak, longest_streak, directorate_id, user_type, nss_number, nss_start_date, nss_end_date)
SELECT id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active, last_login_at, created_at, updated_at, current_streak, longest_streak, directorate_id, user_type, nss_number, nss_start_date, nss_end_date
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_staff_id ON users(staff_id);
CREATE UNIQUE INDEX idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;
CREATE INDEX idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';
INSERT OR IGNORE INTO users (id, name, email, role) VALUES ('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'visitor');
