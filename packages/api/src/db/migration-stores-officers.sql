-- Move four officers to OHCS Stores.
-- STORES directorate is guaranteed by migration-annex-org-entities.sql which
-- ran earlier; look up by abbreviation so this is safe regardless of which
-- primary-key id the row carries in this database (admin-UI creates use UUIDs).
UPDATE officers
SET directorate_id = (SELECT id FROM directorates WHERE abbreviation = 'STORES' LIMIT 1)
WHERE id IN (
  'off_911327',
  'off_839482',
  'off_1621208',
  'off_1614833'
);
