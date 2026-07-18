-- Appointment booking: bookable officers, their approvers, and appointment records.

CREATE TABLE IF NOT EXISTS bookable_officers (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    officer_id          TEXT NOT NULL UNIQUE REFERENCES officers(id),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    slot_duration_mins  INTEGER NOT NULL DEFAULT 30,
    slot_start_time     TEXT NOT NULL DEFAULT '09:00',
    slot_end_time       TEXT NOT NULL DEFAULT '17:00',
    advance_days_min    INTEGER NOT NULL DEFAULT 1,
    advance_days_max    INTEGER NOT NULL DEFAULT 30,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS appointment_approvers (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    officer_id  TEXT NOT NULL REFERENCES officers(id),
    user_id     TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(officer_id, user_id)
);

CREATE TABLE IF NOT EXISTS appointments (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    officer_id       TEXT NOT NULL REFERENCES officers(id),
    visitor_name     TEXT NOT NULL,
    visitor_phone    TEXT NOT NULL,
    visitor_email    TEXT,
    organisation     TEXT,
    purpose          TEXT NOT NULL,
    appointment_date TEXT NOT NULL,
    time_slot        TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','confirmed','declined','cancelled','completed')),
    reference_code   TEXT NOT NULL UNIQUE,
    approved_by      TEXT REFERENCES users(id),
    approved_at      TEXT,
    decline_reason   TEXT,
    approver_notes   TEXT,
    visit_id         TEXT REFERENCES visits(id),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_officer_date ON appointments(officer_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_reference    ON appointments(reference_code);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status  ON appointments(appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_appt_approvers_user       ON appointment_approvers(user_id);
