-- Visitor checkout PIN: a 6-digit numeric code generated at check-in so visitors
-- without a smartphone can check out at the kiosk by typing the PIN instead of
-- scanning the badge QR. Unique per active visit; NULL for visits created before
-- this migration.
ALTER TABLE visits ADD COLUMN checkout_pin TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_checkout_pin
  ON visits (checkout_pin) WHERE checkout_pin IS NOT NULL;
