-- Head of Service Secretariat — separate from the Chief Director's Secretariat,
-- same floor (2nd), adjacent to CD-SEC. Room number TBC via admin Org Entities editor.
INSERT INTO directorates (id, name, abbreviation, type, floor)
VALUES ('dir_hossec', 'Head of Service Secretariat', 'HOS-SEC', 'secretariat', '2nd Floor')
ON CONFLICT(abbreviation) DO UPDATE SET
  name  = excluded.name,
  type  = excluded.type,
  floor = excluded.floor;
