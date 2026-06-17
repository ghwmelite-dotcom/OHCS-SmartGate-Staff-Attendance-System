-- Seed: OHCS Org Entities (from real OHCS structure + ohcs.gov.gh)
-- Directorates (Deputy Dir on 1st Floor, Director on 2nd Floor)
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, floor, rooms) VALUES
('dir_cmd', 'Career Management Directorate', 'CMD', 'directorate', 'Deputy: Room 34 (1st Floor), Director: Room 3 (2nd Floor)', '3, 33, 34'),
('dir_fa', 'Finance & Administration', 'F&A', 'directorate', 'Deputy: Room 35 (1st Floor), Director: Room 10 (2nd Floor)', '2, 3, 4, 10, 35, 38, 39, 49, 51, 52, 54'),
('dir_pbmed', 'Planning, Budgeting, Monitoring & Evaluation Directorate', 'PBMED', 'directorate', 'Deputy: Room 31 (1st Floor), Director: Room 5 (2nd Floor)', '5, 31, 32'),
('dir_rtdd', 'Recruitment, Training & Development Directorate', 'RTDD', 'directorate', 'Deputy: Room 9 (2nd Floor), Director: Room 11 (2nd Floor)', '9, 11, 12, 48'),
('dir_rsimd', 'Research, Statistics & Information Management Directorate', 'RSIMD', 'directorate', 'Deputy: Room 19 (1st Floor), Director: Room 7 (2nd Floor)', '7, 19, 21');

-- Secretariats
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, floor, rooms) VALUES
('dir_cdsec', 'Chief Director''s Secretariat', 'CD-SEC', 'secretariat', '2nd Floor', '24, 44');

-- Units
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, floor, rooms) VALUES
('dir_accounts', 'Accounts', 'ACCOUNTS', 'unit', NULL, NULL),
('dir_csc', 'Civil Service Council Secretariat', 'CSC', 'unit', NULL, '24, 44'),
('dir_estate', 'Estate', 'ESTATE', 'unit', NULL, NULL),
('dir_iau', 'Internal Audit Unit', 'IAU', 'unit', NULL, NULL),
('dir_rcu', 'Reform Coordinating Unit', 'RCU', 'unit', NULL, NULL),
('dir_registry', 'Confidential Registry', 'REGISTRY', 'unit', 'Room 4 (2nd Floor)', '4');

-- Seed: Visit Categories (directorate hints based on OHCS functions)
INSERT OR IGNORE INTO visit_categories (id, name, slug, directorate_hint_id) VALUES
('cat_meeting', 'Official Meeting', 'official_meeting', NULL),
('cat_docsub', 'Document Submission', 'document_submission', 'dir_registry'),
('cat_job', 'Job Inquiry / Application', 'job_inquiry', 'dir_rtdd'),
('cat_complaint', 'Complaint / Petition', 'complaint', 'dir_csc'),
('cat_personal', 'Personal Visit', 'personal_visit', NULL),
('cat_delivery', 'Delivery / Collection', 'delivery', 'dir_fa'),
('cat_appt', 'Scheduled Appointment', 'scheduled_appointment', NULL),
('cat_consult', 'Consultation / Advisory', 'consultation', NULL),
('cat_inspect', 'Inspection / Audit', 'inspection', 'dir_iau'),
('cat_training', 'Training / Workshop', 'training', 'dir_rtdd'),
('cat_interview', 'Interview', 'interview', 'dir_rtdd'),
('cat_other', 'Other', 'other', NULL);

-- Seed: Default admin user (receptionist)
-- Superadmin: Staff ID 1334685, PIN 1118
INSERT OR IGNORE INTO users (id, name, email, staff_id, pin_hash, role) VALUES
('user_superadmin', 'System Administrator', 'admin@ohcs.gov.gh', '1334685', '63ecbfa3a1ad34a1fdd5e3dd3aeaec31456d1d676552c654d5ecf7dab0b2f4f8', 'superadmin');

-- Default receptionist: Staff ID OHCS-001, PIN 1234
INSERT OR IGNORE INTO users (id, name, email, staff_id, pin_hash, role) VALUES
('user_reception', 'OHCS Reception', 'reception@ohcs.gov.gh', 'OHCS-001', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'receptionist');

-- Self-service kiosk system user (attributes kiosk check-ins)
INSERT OR IGNORE INTO users (id, name, email, role) VALUES
('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'visitor');

-- Seed: Sample officers (mapped to real directorates)
INSERT OR IGNORE INTO officers (id, name, title, directorate_id, email, office_number) VALUES
('off_mensah', 'Mr. Kwabena Mensah', 'Director', 'dir_rsimd', 'k.mensah@ohcs.gov.gh', 'Room 19'),
('off_addo', 'Mrs. Abena Addo', 'Director', 'dir_rtdd', 'a.addo@ohcs.gov.gh', 'Room 09'),
('off_owusu', 'Mr. Yaw Owusu', 'Principal Officer', 'dir_fa', 'y.owusu@ohcs.gov.gh', 'Room 02'),
('off_boateng', 'Ms. Akosua Boateng', 'Senior Officer', 'dir_pbmed', 'a.boateng@ohcs.gov.gh', 'Room 31'),
('off_asante', 'Mr. Kofi Asante', 'Chief Director', 'dir_cdsec', 'k.asante@ohcs.gov.gh', 'Room 24');
