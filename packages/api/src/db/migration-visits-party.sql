-- Delegation mode — companion spec: 2026-07-19-delegation-and-watchlist-design.md
-- One lead checks in a whole party; members ride on the lead's badge.
-- party_size: total headcount including the lead (NULL ⇒ solo visit, reads as 1)
-- party_names: JSON array of accompanying member names, lead excluded
-- NOTE: whole-line comments only in migration SQL — inline trailing comments
-- defeat the runner's statement splitter.

ALTER TABLE visits ADD COLUMN party_size INTEGER;

ALTER TABLE visits ADD COLUMN party_names TEXT;
