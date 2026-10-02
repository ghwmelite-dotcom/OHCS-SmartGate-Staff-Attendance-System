-- Preserve server submission timestamp; NULL denotes the existing on-site path.
ALTER TABLE clock_records ADD COLUMN reported_departure_at TEXT;
