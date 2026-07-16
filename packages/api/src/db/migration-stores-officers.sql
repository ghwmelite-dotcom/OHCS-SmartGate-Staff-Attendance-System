-- Reassign four procurement officers to OHCS Stores (dir_stores).
UPDATE officers SET directorate_id = 'dir_stores' WHERE id IN (
  'off_911327',  -- Collins Attah Ogoe
  'off_839482',  -- Harry Lomotey
  'off_1621208', -- Harrison Elikplim Agbenyo
  'off_1614833'  -- Saada Inusah
);
