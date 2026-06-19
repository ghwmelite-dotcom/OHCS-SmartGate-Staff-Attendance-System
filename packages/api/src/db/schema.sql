-- OHCS Schema — Single-init
--
-- Dual-purpose:
--   * Loaded as a single-shot bootstrap for fresh dev D1 databases — running
--     this file alone produces the same end-state as applying every registered
--     migration in order.
--   * Migrations in `migration-*.sql` (registered via `migrations-index.ts`)
--     remain the canonical deltas applied to existing/production databases;
--     do NOT drop or rewrite migration files when updating this schema.
--
-- All statements are idempotent (CREATE ... IF NOT EXISTS, INSERT OR IGNORE)
-- so re-running this file is a no-op.

-- ---------------------------------------------------------------------------
-- Users (staff + NSS personnel)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    staff_id         TEXT UNIQUE,
    pin_hash         TEXT,
    pin_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(pin_acknowledged IN (0, 1)),
    role             TEXT NOT NULL DEFAULT 'staff',
    grade            TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    last_login_at    TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    -- Attendance / streak tracking (added by migration-attendance.sql)
    current_streak   INTEGER NOT NULL DEFAULT 0,
    longest_streak   INTEGER NOT NULL DEFAULT 0,
    directorate_id   TEXT REFERENCES directorates(id),
    -- NSS foundation (added by migration-nss-foundation.sql)
    user_type        TEXT NOT NULL DEFAULT 'staff' CHECK(user_type IN ('staff','nss')),
    nss_number       TEXT,
    nss_start_date   TEXT,   -- reused as the posting/placement window start for interns too
    nss_end_date     TEXT,   -- reused as the posting/placement window end for interns too
    -- Intern foundation (added by migration-intern-foundation.sql)
    intern_code         TEXT,
    institution         TEXT,
    programme           TEXT,
    supervisor_user_id  TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nss_number_unique ON users(nss_number) WHERE nss_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_nss_active ON users(user_type, nss_end_date) WHERE user_type = 'nss';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intern_code_unique ON users(intern_code) WHERE intern_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_intern_active ON users(user_type, nss_end_date) WHERE intern_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Directorates & officers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directorates (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name            TEXT NOT NULL,
    abbreviation    TEXT NOT NULL UNIQUE,
    type            TEXT NOT NULL DEFAULT 'directorate' CHECK(type IN ('directorate','secretariat','unit')),
    floor           TEXT,
    wing            TEXT,
    rooms           TEXT,
    head_officer_id TEXT,
    reception_officer_id TEXT REFERENCES officers(id),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS officers (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name             TEXT NOT NULL,
    title            TEXT,
    directorate_id   TEXT NOT NULL REFERENCES directorates(id),
    email            TEXT,
    phone            TEXT,
    office_number    TEXT,
    is_available     INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0, 1)),
    -- Telegram linking (added by migration-phase2.sql)
    telegram_chat_id TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_officers_directorate ON officers(directorate_id);

-- ---------------------------------------------------------------------------
-- Visitors, visit categories, visits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitors (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    phone         TEXT,
    email         TEXT,
    organisation  TEXT,
    id_type       TEXT CHECK(id_type IN ('ghana_card','passport','drivers_license','staff_id','other')),
    id_number     TEXT,
    photo_url     TEXT,
    id_photo_url  TEXT,
    total_visits  INTEGER NOT NULL DEFAULT 0,
    last_visit_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visitors_name ON visitors(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_visitors_phone ON visitors(phone);

CREATE TABLE IF NOT EXISTS visit_categories (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    directorate_hint_id TEXT REFERENCES directorates(id),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS visits (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    visitor_id       TEXT NOT NULL REFERENCES visitors(id),
    host_officer_id  TEXT REFERENCES officers(id),
    host_name_manual TEXT,
    directorate_id   TEXT REFERENCES directorates(id),
    purpose_raw      TEXT,
    purpose_category TEXT,
    check_in_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    check_out_at     TEXT,
    duration_minutes INTEGER,
    badge_code       TEXT UNIQUE,
    status           TEXT NOT NULL DEFAULT 'checked_in' CHECK(status IN ('checked_in','checked_out','cancelled')),
    check_in_source  TEXT NOT NULL DEFAULT 'staff',
    notes            TEXT,
    id_photo_check   TEXT,
    created_by       TEXT REFERENCES users(id),
    idempotency_key  TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_host ON visits(host_officer_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_idem ON visits(idempotency_key);

-- ---------------------------------------------------------------------------
-- Staff attendance: clock records, leave requests, absence notices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clock_records (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id         TEXT NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL CHECK(type IN ('clock_in', 'clock_out')),
    timestamp       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    latitude        REAL,
    longitude       REAL,
    within_geofence INTEGER NOT NULL DEFAULT 0 CHECK(within_geofence IN (0, 1)),
    photo_url       TEXT,
    device_info     TEXT,
    idempotency_key TEXT,
    prompt_value    TEXT,
    reauth_method   TEXT CHECK (reauth_method IN ('webauthn','pin') OR reauth_method IS NULL),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_clock_user_date ON clock_records(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clock_date ON clock_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clock_records_user_idem ON clock_records(user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS leave_requests (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL CHECK(type IN ('annual', 'sick', 'permission', 'compassionate', 'maternity', 'study')),
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    approved_by TEXT REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id, start_date DESC);

CREATE TABLE IF NOT EXISTS absence_notices (
    id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id              TEXT NOT NULL REFERENCES users(id),
    reason               TEXT NOT NULL CHECK(reason IN ('sick','family_emergency','transport','other')),
    note                 TEXT,
    notice_date          TEXT NOT NULL,
    expected_return_date TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_absence_notices_user_date ON absence_notices(user_id, notice_date);

-- ---------------------------------------------------------------------------
-- Notifications + push subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id    TEXT NOT NULL REFERENCES users(id),
    type       TEXT NOT NULL DEFAULT 'visitor_arrival',
    title      TEXT NOT NULL,
    body       TEXT,
    visit_id   TEXT REFERENCES visits(id),
    is_read    INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_date ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id    TEXT NOT NULL REFERENCES users(id),
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- ---------------------------------------------------------------------------
-- WebAuthn / biometric credentials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id           TEXT PRIMARY KEY,                  -- credential ID (base64url)
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key   TEXT NOT NULL,                     -- COSE-encoded public key (base64url)
    counter      INTEGER NOT NULL DEFAULT 0,        -- WebAuthn signCount
    transports   TEXT,                              -- JSON array, e.g. ["internal","hybrid"]
    device_label TEXT,                              -- user-supplied or UA-derived label
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);

-- ---------------------------------------------------------------------------
-- App settings (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    work_start_time             TEXT NOT NULL,
    late_threshold_time         TEXT NOT NULL,
    work_end_time               TEXT NOT NULL,
    updated_by                  TEXT,
    updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    clockin_reauth_enforce      INTEGER NOT NULL DEFAULT 0 CHECK(clockin_reauth_enforce IN (0,1)),
    clockin_pin_attempt_cap     INTEGER NOT NULL DEFAULT 5,
    clockin_prompt_ttl_seconds  INTEGER NOT NULL DEFAULT 90
);

INSERT OR IGNORE INTO app_settings (id, work_start_time, late_threshold_time, work_end_time)
VALUES (1, '08:00', '08:30', '17:00');

-- ---------------------------------------------------------------------------
-- Directorate reception team (join table)
-- ---------------------------------------------------------------------------
-- Officers alerted (private DM + in-app) when a visitor self-routes to this
-- directorate at the kiosk. directorates.reception_officer_id (the primary) is
-- always also a row here — enforced at write time.
CREATE TABLE IF NOT EXISTS directorate_receivers (
    directorate_id TEXT NOT NULL REFERENCES directorates(id),
    officer_id     TEXT NOT NULL REFERENCES officers(id),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (directorate_id, officer_id)
);

-- ---------------------------------------------------------------------------
-- Migration bookkeeping (kept last)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applied_migrations (
    filename   TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
