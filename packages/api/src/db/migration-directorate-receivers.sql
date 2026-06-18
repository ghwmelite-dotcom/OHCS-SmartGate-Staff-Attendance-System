-- The team of officers alerted (private DM + in-app) when a visitor self-routes to
-- this directorate at the kiosk. directorates.reception_officer_id (the primary) is
-- always also a row here. The backfill seeds existing primaries onto their teams.
CREATE TABLE IF NOT EXISTS directorate_receivers (
    directorate_id TEXT NOT NULL REFERENCES directorates(id),
    officer_id     TEXT NOT NULL REFERENCES officers(id),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (directorate_id, officer_id)
);

INSERT OR IGNORE INTO directorate_receivers (directorate_id, officer_id)
SELECT id, reception_officer_id FROM directorates WHERE reception_officer_id IS NOT NULL;
