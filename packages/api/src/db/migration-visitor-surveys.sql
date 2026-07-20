-- Visitor satisfaction survey — companion spec: 2026-07-20-visitor-satisfaction-survey-design.md
-- One row per visit, written only via a single-use survey token minted at kiosk
-- checkout. wait_minutes/directorate_id/host_officer_id are denormalized at
-- submit time so Feedback queries never join through visits on the hot path.

CREATE TABLE IF NOT EXISTS visitor_surveys (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  visit_id        TEXT NOT NULL REFERENCES visits(id),
  badge_code      TEXT,
  rating          INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment         TEXT,
  wait_minutes    INTEGER,
  directorate_id  TEXT,
  host_officer_id TEXT,
  source          TEXT NOT NULL DEFAULT 'kiosk',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_surveys_visit ON visitor_surveys(visit_id);

CREATE INDEX IF NOT EXISTS idx_visitor_surveys_created ON visitor_surveys(created_at);

CREATE INDEX IF NOT EXISTS idx_visitor_surveys_dir ON visitor_surveys(directorate_id, created_at);
