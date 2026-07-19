-- Telegram actionable arrival notifications — companion spec: 2026-07-19-telegram-arrival-actions-design.md
-- Host's inline-keyboard response to a visitor-arrival alert. First response wins;
-- NULLs on pre-existing rows read as "no response yet".
-- host_response: coming_down | waiting_area | reschedule
-- host_response_at: ISO timestamp
-- host_response_by: telegram chat id that responded (audit trail)
-- NOTE: whole-line comments only in migration SQL — inline trailing comments
-- defeat the runner's statement splitter.

ALTER TABLE visits ADD COLUMN host_response TEXT;

ALTER TABLE visits ADD COLUMN host_response_at TEXT;

ALTER TABLE visits ADD COLUMN host_response_by TEXT;
