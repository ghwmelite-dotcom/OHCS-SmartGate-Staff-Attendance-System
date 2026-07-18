-- Add staff_id to officers so VMS directory entries can link to Staff Attendance accounts.
ALTER TABLE officers ADD COLUMN staff_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_officers_staff_id ON officers(staff_id) WHERE staff_id IS NOT NULL;
