-- Public holidays the kiosk treats as "office closed" days.
-- Admin-managed (superadmin CRUD); seeded with Ghana 2026 statutory dates.
-- VERIFY against the official Ministry of the Interior gazette and adjust as needed —
-- the President can gazette additional/moved holidays during the year.
CREATE TABLE IF NOT EXISTS holidays (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    date       TEXT NOT NULL UNIQUE,                 -- 'YYYY-MM-DD' (Ghana local = UTC)
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Seed: Ghana public holidays remaining in 2026 (re-runnable via INSERT OR IGNORE).
INSERT OR IGNORE INTO holidays (id, date, name) VALUES
    (lower(hex(randomblob(16))), '2026-07-01', 'Republic Day'),
    (lower(hex(randomblob(16))), '2026-08-04', 'Founders'' Day'),
    (lower(hex(randomblob(16))), '2026-09-21', 'Kwame Nkrumah Memorial Day'),
    (lower(hex(randomblob(16))), '2026-12-04', 'Farmers'' Day'),
    (lower(hex(randomblob(16))), '2026-12-25', 'Christmas Day'),
    (lower(hex(randomblob(16))), '2026-12-26', 'Boxing Day'),
    (lower(hex(randomblob(16))), '2026-12-28', 'Boxing Day (observed)');
