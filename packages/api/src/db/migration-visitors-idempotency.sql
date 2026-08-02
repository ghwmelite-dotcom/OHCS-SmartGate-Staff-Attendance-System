-- Kiosk visitor-registration idempotency (plan 2026-08-01-vms-audit-fixes.md, Commit D)
-- The kiosk mints one idempotency key per visitor flow and reuses it across
-- retries; the partial UNIQUE index enforces dedupe at the DB level and serves
-- the equality pre-check (mirrors visits.idempotency_key).
-- NOTE: whole-line comments only in migration SQL — inline trailing comments
-- defeat the runner's statement splitter.

ALTER TABLE visitors ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_idem_unique ON visitors(idempotency_key) WHERE idempotency_key IS NOT NULL;
