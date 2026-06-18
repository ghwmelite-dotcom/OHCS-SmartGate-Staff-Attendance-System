-- Visitor self-service kiosk — companion spec: 2026-06-17-visitor-self-service-kiosk-design.md
-- Adds:
--   * visitors.id_photo_url  — R2 path of the captured ID-document photo
--   * visits.check_in_source — 'staff' (default) or 'kiosk'
--   * a seeded system "kiosk" user for attributing self-service check-ins
--
-- NOTE: the kiosk system user is seeded with role 'staff' — an allowed role (the
-- production users.role CHECK permits only superadmin/admin/receptionist/it/
-- director/staff). It never logs in; the role is only the created_by FK target.

ALTER TABLE visitors ADD COLUMN id_photo_url TEXT;

-- D1/SQLite ALTER TABLE ADD COLUMN cannot use a non-constant default; a string
-- literal default IS constant and is allowed here.
ALTER TABLE visits ADD COLUMN check_in_source TEXT NOT NULL DEFAULT 'staff';

INSERT OR IGNORE INTO users (id, name, email, role)
VALUES ('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'staff');
