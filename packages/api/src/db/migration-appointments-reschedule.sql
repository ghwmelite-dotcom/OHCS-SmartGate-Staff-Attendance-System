-- Appointment reschedule proposals (spec 2026-08-03-appointment-reschedule-telegram-design).
-- Adds the proposed date/slot columns AND the 'reschedule_proposed' status.
-- SQLite cannot ALTER a CHECK constraint, and the appointments status CHECK
-- pre-dates this status — a plain ADD COLUMN alone would leave every UPDATE to
-- 'reschedule_proposed' rejected. The table is therefore rebuilt once with the
-- widened CHECK. This is safe here because appointments is a LEAF table: no
-- other table declares REFERENCES appointments(...), so no inbound FKs break
-- during the swap; the table's own outbound FKs (officers/users/visits) are
-- re-declared identically. Index names are database-global, so the indexes are
-- recreated (with their original names) only after the old table is dropped.

CREATE TABLE appointments_new (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    officer_id        TEXT NOT NULL REFERENCES officers(id),
    visitor_name      TEXT NOT NULL,
    visitor_phone     TEXT NOT NULL,
    visitor_email     TEXT,
    organisation      TEXT,
    purpose           TEXT NOT NULL,
    appointment_date  TEXT NOT NULL,
    time_slot         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','confirmed','declined','cancelled','completed','reschedule_proposed')),
    reference_code    TEXT NOT NULL UNIQUE,
    approved_by       TEXT REFERENCES users(id),
    approved_at       TEXT,
    decline_reason    TEXT,
    approver_notes    TEXT,
    visit_id          TEXT REFERENCES visits(id),
    proposed_date     TEXT,
    proposed_time_slot TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO appointments_new (
    id, officer_id, visitor_name, visitor_phone, visitor_email, organisation,
    purpose, appointment_date, time_slot, status, reference_code,
    approved_by, approved_at, decline_reason, approver_notes, visit_id,
    created_at, updated_at
)
SELECT
    id, officer_id, visitor_name, visitor_phone, visitor_email, organisation,
    purpose, appointment_date, time_slot, status, reference_code,
    approved_by, approved_at, decline_reason, approver_notes, visit_id,
    created_at, updated_at
FROM appointments;

DROP TABLE appointments;

ALTER TABLE appointments_new RENAME TO appointments;

CREATE INDEX IF NOT EXISTS idx_appointments_officer_date ON appointments(officer_id, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_reference    ON appointments(reference_code);

CREATE INDEX IF NOT EXISTS idx_appointments_date_status  ON appointments(appointment_date, status);
