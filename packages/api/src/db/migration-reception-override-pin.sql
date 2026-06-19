-- migration-reception-override-pin.sql
-- Superadmin-set PIN a receptionist enters at the kiosk to approve a check-in the
-- ID-photo AI gate flagged. NULL/empty = overrides disabled. Additive — no rebuild.
ALTER TABLE app_settings ADD COLUMN reception_override_pin TEXT;
