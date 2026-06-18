-- migration-intern-foundation.sql
-- Adds 'intern' to users.user_type and the intern-specific columns.
--
-- APPLIED OUT-OF-BAND ONLY:
--   node "<repo>/node_modules/wrangler/bin/wrangler.js" d1 execute <db> \
--        --file=src/db/migration-intern-foundation.sql            (local)
--   …add --remote for production (after a backup + confirmation).
--
-- This file is intentionally NOT in the MIGRATIONS array in migrations-index.ts:
-- the per-statement app runner (routes/admin-migrations.ts) cannot run a table
-- rebuild safely (no transaction). SQLite cannot ALTER a column CHECK, so the
-- users table must be rebuilt. defer_foreign_keys defers FK validation to COMMIT;
-- all row ids are preserved through the copy, so the 8 child FKs stay valid.
PRAGMA defer_foreign_keys=on;
BEGIN TRANSACTION;

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
    user_type        TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss','intern')),
    nss_number       TEXT,
    nss_start_date   TEXT,   -- reused as the posting/placement window start for interns too
    nss_end_date     TEXT,   -- reused as the posting/placement window end for interns too
    intern_code         TEXT,
    institution         TEXT,
    programme           TEXT,
    supervisor_user_id  TEXT REFERENCES users(id)
);

INSERT INTO users_new
  (id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active,
   last_login_at, created_at, updated_at, current_streak, longest_streak,
   directorate_id, user_type, nss_number, nss_start_date, nss_end_date)
SELECT
   id, name, email, staff_id, pin_hash, pin_acknowledged, role, grade, is_active,
   last_login_at, created_at, updated_at, current_streak, longest_streak,
   directorate_id, user_type, nss_number, nss_start_date, nss_end_date
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE user_type = 'intern';

COMMIT;
