-- Additional OHCS org entities (Annex block + main building).
-- Upsert by abbreviation: safe on fresh installs (INSERT) and prod (UPDATE type/floor).
INSERT INTO directorates (id, name, abbreviation, type, org_type, floor) VALUES
  ('dir_couns',  'Counseling Unit',                  'COUNS',   'unit', NULL,              'ANNEX 1st Floor'),
  ('dir_ilo',    'International Labor Organization', 'ILO',     'unit', 'partner_org',     'ANNEX 1st Floor'),
  ('dir_jds',    'JDS Project Office',               'JDS',     'unit', 'project_office',  'ANNEX Block'),
  ('dir_proc',   'OHCS Procurement',                 'PROC',    'unit', NULL,              'ANNEX Room 6, 1st Floor'),
  ('dir_preg',   '"P" Registry',                     'P-REG',   'unit', NULL,              'Room 44, Main Building Ground Floor'),
  ('dir_prochq', 'Procurement HQ',                   'PROC-HQ', 'unit', NULL,              'ANNEX Block, 3rd Floor'),
  ('dir_rec',    'Records Unit',                      'REC',     'unit', NULL,              'Room 49, Main Building Ground Floor'),
  ('dir_stores', 'OHCS Stores',                      'STORES',  'unit', NULL,              'ANNEX Ground Floor')
ON CONFLICT(abbreviation) DO UPDATE SET
  name     = excluded.name,
  type     = excluded.type,
  org_type = excluded.org_type,
  floor    = excluded.floor;
