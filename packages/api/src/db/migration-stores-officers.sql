-- Ensure OHCS Stores exists before assigning officers to it.
-- Safe if already present (INSERT OR IGNORE is a no-op on conflict).
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, org_type, floor)
VALUES ('dir_stores', 'OHCS Stores', 'STORES', 'unit', NULL, 'ANNEX Ground Floor');

-- Reassign four procurement officers to OHCS Stores (dir_stores).
UPDATE officers SET directorate_id = 'dir_stores' WHERE id IN (
  'off_911327',  -- Collins Attah Ogoe
  'off_839482',  -- Harry Lomotey
  'off_1621208', -- Harrison Elikplim Agbenyo
  'off_1614833'  -- Saada Inusah
);
