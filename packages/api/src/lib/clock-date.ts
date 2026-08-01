/**
 * Effective-date helpers for clock records (attendance integrity fixes,
 * plan 2026-08-01 Commit A).
 *
 * The staff PWA's offline queue can replay a clock submit a day or more after
 * it was captured. The client sends `captured_at`; when it validates, the
 * server persists the capture DATE as `device_info.capturedDate` (JSON) so the
 * record is attributed to the day it actually happened, not the replay day.
 */

// captured_at is accepted only within [now-48h, now+5min]; anything outside is
// treated as absent (untrusted client clock).
export const CAPTURED_AT_MAX_AGE_MS = 48 * 3600 * 1000;
export const CAPTURED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Validate a client-sent captured_at ISO string. Returns the capture date
 * (YYYY-MM-DD, UTC) when parseable and within the acceptance window, else null.
 */
export function parseCapturedDate(raw: string | undefined, nowMs = Date.now()): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  if (ms < nowMs - CAPTURED_AT_MAX_AGE_MS || ms > nowMs + CAPTURED_AT_MAX_FUTURE_MS) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * SQL expression for a clock row's effective attendance date: the persisted
 * capturedDate when present, else the server timestamp's date.
 *
 * The json_valid guard is required — SQLite's json_extract THROWS
 * "malformed JSON" on non-JSON text (verified on node:sqlite), it does not
 * return NULL. Legacy rows carry NULL (or theoretically junk) device_info.
 */
export function clockEffectiveDateSql(alias: string): string {
  return `DATE(COALESCE(CASE WHEN json_valid(${alias}.device_info) THEN json_extract(${alias}.device_info, '$.capturedDate') END, ${alias}.timestamp))`;
}
