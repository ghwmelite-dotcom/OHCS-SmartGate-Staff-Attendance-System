-- Host availability status — companion spec: 2026-07-19-host-availability-design.md
-- Officer's self-reported availability, surfaced in host pickers before check-in.
-- availability_status: available | in_meeting | out_of_office
-- NULL reads as 'available' (pre-existing rows).
-- Separate from is_available, which governs appearance in appointment booking lists.
-- NOTE: whole-line comments only in migration SQL — inline trailing comments
-- defeat the runner's statement splitter.

ALTER TABLE officers ADD COLUMN availability_status TEXT;

ALTER TABLE officers ADD COLUMN availability_updated_at TEXT;
