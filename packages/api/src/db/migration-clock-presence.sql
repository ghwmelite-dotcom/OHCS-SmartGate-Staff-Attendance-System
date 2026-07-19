-- Rotating presence-QR proof-of-presence (spec: docs/superpowers/specs/2026-07-19-presence-qr-design.md).
-- Additive only: two nullable evidence columns on clock_records, one mode flag on
-- the app_settings singleton. NULLs on pre-existing rows read as "no presence data".
ALTER TABLE clock_records ADD COLUMN presence_method TEXT;        -- 'qr' | 'qr_pending' | 'none' | 'override'
ALTER TABLE clock_records ADD COLUMN presence_token_window TEXT;  -- 'current' | 'previous' | 'expired' at validation time
ALTER TABLE app_settings ADD COLUMN presence_qr_mode INTEGER;     -- 0 = off, 1 = shadow (record-only), 2 = enforce

UPDATE app_settings SET presence_qr_mode = COALESCE(presence_qr_mode, 0) WHERE id = 1;
