-- Officer who receives kiosk visitors routed to this directorate. Auto-set as the
-- visit host (host_officer_id) and notified on arrival. Nullable: unconfigured
-- directorates fall back to manual handling (no notification). Never blocks check-in.
ALTER TABLE directorates ADD COLUMN reception_officer_id TEXT REFERENCES officers(id);
