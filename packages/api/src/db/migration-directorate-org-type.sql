-- Expanded org-entity classification.
-- directorates.type has a CHECK(type IN ('directorate','secretariat','unit'))
-- that D1 cannot alter or drop (the table is referenced by FK children, so a
-- rebuild is blocked). So we add an UNCONSTRAINED org_type column as the real
-- classification. The app writes the true (expanded) value to org_type and a
-- CHECK-safe value to the legacy `type` column, and reads COALESCE(org_type,type)
-- — existing rows need no backfill. Adding new types later is an app-only change.
ALTER TABLE directorates ADD COLUMN org_type TEXT;
