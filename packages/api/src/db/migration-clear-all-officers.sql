-- Wipe every officer row before importing the real OHCS staff list.
-- Runs immediately before migration-staff-officers.sql so nothing from
-- testing or manual data-entry survives into production.
UPDATE directorates SET reception_officer_id = NULL, head_officer_id = NULL;
UPDATE visits SET host_officer_id = NULL;
DELETE FROM directorate_receivers;
DELETE FROM officers;
