-- Remove the five placeholder officers that shipped with the initial seed.
-- Real staff are imported by migration-staff-officers.sql.
-- The NULL-out of FK references runs first to avoid FK constraint failures.
UPDATE directorates SET reception_officer_id = NULL
  WHERE reception_officer_id IN ('off_mensah','off_addo','off_owusu','off_boateng','off_asante');
UPDATE directorates SET head_officer_id = NULL
  WHERE head_officer_id IN ('off_mensah','off_addo','off_owusu','off_boateng','off_asante');
DELETE FROM directorate_receivers
  WHERE officer_id IN ('off_mensah','off_addo','off_owusu','off_boateng','off_asante');
DELETE FROM officers
  WHERE id IN ('off_mensah','off_addo','off_owusu','off_boateng','off_asante');
