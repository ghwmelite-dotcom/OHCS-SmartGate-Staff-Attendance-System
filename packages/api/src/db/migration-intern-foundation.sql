-- migration-intern-foundation.sql
-- Interns share the NSS user_type ('nss') and are distinguished by a non-null intern_code.
-- No CHECK change / no table rebuild — only additive ALTER ADD COLUMN, which D1 supports.
-- Posting/placement window reuses nss_start_date / nss_end_date for both NSS and interns.
ALTER TABLE users ADD COLUMN intern_code TEXT;
ALTER TABLE users ADD COLUMN institution TEXT;
ALTER TABLE users ADD COLUMN programme TEXT;
ALTER TABLE users ADD COLUMN supervisor_user_id TEXT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE intern_code IS NOT NULL;
