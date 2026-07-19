-- Visitor watchlist (VIP/banned) — companion spec: 2026-07-19-delegation-and-watchlist-design.md
-- flag: 'vip' | 'banned' (NULL ⇒ not flagged)
-- flag_note: free-text reason, staff-only
-- flag_updated_at / flag_updated_by: who set or cleared the flag last
-- NOTE: whole-line comments only in migration SQL — inline trailing comments
-- defeat the runner's statement splitter.

ALTER TABLE visitors ADD COLUMN flag TEXT;

ALTER TABLE visitors ADD COLUMN flag_note TEXT;

ALTER TABLE visitors ADD COLUMN flag_updated_at TEXT;

ALTER TABLE visitors ADD COLUMN flag_updated_by TEXT;
