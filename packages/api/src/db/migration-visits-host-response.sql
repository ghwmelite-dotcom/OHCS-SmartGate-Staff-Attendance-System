-- Telegram actionable arrival notifications — companion spec: 2026-07-19-telegram-arrival-actions-design.md
-- Host's inline-keyboard response to a visitor-arrival alert. First response wins;
-- NULLs on pre-existing rows read as "no response yet".

ALTER TABLE visits ADD COLUMN host_response TEXT;      -- coming_down | waiting_area | reschedule
ALTER TABLE visits ADD COLUMN host_response_at TEXT;   -- ISO timestamp
ALTER TABLE visits ADD COLUMN host_response_by TEXT;   -- telegram chat id that responded (audit trail)
