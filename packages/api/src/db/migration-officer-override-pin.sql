-- Per-officer kiosk override PIN (PBKDF2-hashed). Lets a reception override be
-- attributed to a specific officer instead of the anonymous shared PIN. NULL =
-- that officer has no override PIN. The shared app_settings.reception_override_pin
-- remains as a fallback.
ALTER TABLE officers ADD COLUMN override_pin_hash TEXT;
