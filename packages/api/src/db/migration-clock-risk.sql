-- Attendance risk fusion — companion spec: 2026-07-19-attendance-risk-fusion-design.md
-- Score + explainability on each clock event; mode flags on app_settings.

ALTER TABLE clock_records ADD COLUMN risk_score INTEGER;
ALTER TABLE clock_records ADD COLUMN risk_factors TEXT;  -- JSON array of {name, condition, weight, detail}
ALTER TABLE clock_records ADD COLUMN risk_disposition TEXT
  CHECK (risk_disposition IN ('dismissed','escalated') OR risk_disposition IS NULL);

-- Partial index serves the AttendanceTab flagged/high-risk filters and the
-- risk-distribution endpoint without scanning unscored rows.
CREATE INDEX IF NOT EXISTS idx_clock_records_risk_score
  ON clock_records(risk_score) WHERE risk_score >= 30;

ALTER TABLE app_settings ADD COLUMN risk_fusion_mode INTEGER;
ALTER TABLE app_settings ADD COLUMN risk_fusion_block_enabled INTEGER;

UPDATE app_settings
   SET risk_fusion_mode          = COALESCE(risk_fusion_mode, 0),
       risk_fusion_block_enabled = COALESCE(risk_fusion_block_enabled, 0)
 WHERE id = 1;
