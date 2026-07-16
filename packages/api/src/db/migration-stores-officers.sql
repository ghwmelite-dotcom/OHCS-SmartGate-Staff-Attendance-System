-- Ensure OHCS Stores exists (no-op if already present under any id).
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, org_type, floor)
VALUES ('dir_stores', 'OHCS Stores', 'STORES', 'unit', NULL, 'ANNEX Ground Floor');

-- Reassign four officers to whichever row carries abbreviation='STORES'.
-- Subquery avoids assuming the row has id='dir_stores' (it may have been
-- created via the admin UI with a UUID before this migration ran).
UPDATE officers
SET directorate_id = (SELECT id FROM directorates WHERE abbreviation = 'STORES' LIMIT 1)
WHERE id IN (
  'off_911327',
  'off_839482',
  'off_1621208',
  'off_1614833'
);
