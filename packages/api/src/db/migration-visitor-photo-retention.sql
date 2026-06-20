-- migration-visitor-photo-retention.sql
-- Number of days after a visitor's last checkout before their ID-document + face
-- photos are auto-purged from R2 (the visit/visitor audit record is kept). Default
-- 30 days. Additive ADD COLUMN with a constant DEFAULT — D1-safe, no table rebuild.
ALTER TABLE app_settings ADD COLUMN visitor_photo_retention_days INTEGER NOT NULL DEFAULT 30;
