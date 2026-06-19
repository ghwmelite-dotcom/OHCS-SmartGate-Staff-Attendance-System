-- Enforce idempotency at the DB level (was a plain index + read-then-insert race).
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_idem_unique ON visits(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clock_user_idem_unique ON clock_records(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
