-- Move Rhoda Okine and Anita Oteng to the Chief Director's Secretariat.
UPDATE officers SET directorate_id = 'dir_cdsec' WHERE id IN ('off_1330177', 'off_1409117');

-- Purge the duplicate Counseling Unit (abbr COUNSELING; the canonical one is COUNS).
-- Reassign any officers and visits that landed on the duplicate to the real unit.
UPDATE officers
  SET directorate_id = 'dir_couns'
  WHERE directorate_id IN (
    SELECT id FROM directorates WHERE abbreviation = 'COUNSELING' AND id != 'dir_couns'
  );
UPDATE visits
  SET directorate_id = 'dir_couns'
  WHERE directorate_id IN (
    SELECT id FROM directorates WHERE abbreviation = 'COUNSELING' AND id != 'dir_couns'
  );
UPDATE directorates
  SET reception_officer_id = NULL, head_officer_id = NULL
  WHERE abbreviation = 'COUNSELING' AND id != 'dir_couns';
DELETE FROM directorate_receivers
  WHERE directorate_id IN (
    SELECT id FROM directorates WHERE abbreviation = 'COUNSELING' AND id != 'dir_couns'
  );
DELETE FROM directorates WHERE abbreviation = 'COUNSELING' AND id != 'dir_couns';
