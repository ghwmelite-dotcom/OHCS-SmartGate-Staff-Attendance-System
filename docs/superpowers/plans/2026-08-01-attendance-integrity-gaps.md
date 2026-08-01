# Attendance integrity gap fixes — 2026-08-01

From the three-way audit (capture → API reads → portal rendering). Executed as
sequential, independently-revertable commits. No behavior change for the
working online clock path.

## Commit A — API hardening (`packages/api`)
1. `clock.ts`: post-INSERT steps (R2 photo put + photo UPDATE, prompt KV
   delete, streak UPDATEs) become best-effort — the record is already
   persisted, so they must never turn into a 5xx.
2. `clock.ts`: persist the client-sent `captured_at` (validated: within
   [now−48h, now+5min], else ignored) into the record via `device_info` JSON
   (investigate current format + all readers first; non-JSON legacy rows must
   be unaffected — `json_extract` returns NULL → COALESCE fallback).
3. Effective date = validated capture date ?? today; use it in the
   `ALREADY_CLOCKED` check (fixes cross-midnight replay misattribution).
4. `attendance.ts` `/records`: for past dates, include deactivated users who
   have a clock record that day (`u.is_active = 1 OR ci.id IS NOT NULL`);
   today keeps `is_active = 1`.
5. `attendance.ts` `/today`: accept optional `?date=YYYY-MM-DD` (default
   today); align population/count semantics with `/records`.
6. `/records` date attribution via `COALESCE(json_extract(device_info,'$.capturedDate'), timestamp)` if (2) lands.

## Commit B — portal (`packages/web`)
7. AttendanceTab: pass `selectedDate` to `/attendance/today` → stat cards and
   PDF/CSV summary match the table's date.
8. CSV/PDF export the unfiltered `records`; when search/risk filters are
   active, stamp a "Filters active" marker into the export.
9. Persist the segment pill (staff/nss/intern/all) in localStorage.
10. NssTab: pass `limit=500` on list + activeAll queries; note truncation if
    the payload says more exist.
11. `liveness_signature` JSON.parse → try/catch.
12. web `api.ts`: non-JSON response guard (mirror staff `readJsonEnvelope`).

## Commit C — staff PWA offline queue (`packages/staff`)
13. `sw.js` replay: `ALREADY_CLOCKED`/dedupe ⇒ delivered; network/5xx ⇒ keep
    + retry with backoff (capped); other 4xx and >24h age ⇒ mark entry
    **failed**, never silently delete.
14. `offlineQueue.ts` + ClockPage: surface failed entries — amber banner with
    per-entry reason, dismiss, "clock manually" hint.

## Commit D — GATED (prod DB mutation; needs explicit user confirmation)
15. `CREATE UNIQUE INDEX` on `clock_records(user_id, type, DATE(timestamp))`
    after checking for existing dupes. Ships only after confirmation; code
    does not depend on it.

## Out of scope (noted, not fixed)
- Queued clock bodies hold the user's PIN in IndexedDB (pre-existing design).
- `migration-clock-idempotency.sql` re-adds `idempotency_key` — no runtime
  impact; left alone.
