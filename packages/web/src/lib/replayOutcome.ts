// Replay-outcome classification for the offline visit queue.
//
// Ported from packages/staff/src/lib/replayOutcome.ts (clock queue) — same
// rules, error codes adapted to the visits API. The service worker
// (`public/sw.js`) is a plain script and cannot import this module, so it
// carries a VERBATIM copy of this logic — keep the two in sync (the SW copy
// points back here).
//
// Rules (the happy path — 2xx — is unchanged from the original replay):
// - delivered: any 2xx (a duplicate check-in replay dedupes server-side by
//   idempotency_key into a 201), OR a 4xx whose error code is
//   ALREADY_CHECKED_OUT (a queued check-out replaying after the visit already
//   ended — the record exists server-side; equivalent to a deduped success).
// - retry: network failure, 5xx, or 429 — transient; the entry stays queued
//   and its attempts counter climbs until MAX_REPLAY_ATTEMPTS, then it fails.
// - failed: any other 4xx, or age > 24h — terminal. The entry is MARKED
//   failed (never silently deleted) and surfaced to reception until dismissed.

export const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_REPLAY_ATTEMPTS = 10;

export type ReplayFetchResult =
  | { networkError: true }
  | { networkError?: false; status: number; errorCode: string | null };

export type ReplayOutcome =
  | { action: 'delivered' }
  | { action: 'retry' }
  | { action: 'failed'; reason: string };

// Short human strings for the reception banner, keyed by server error code.
const FAIL_REASONS: Record<string, string> = {
  UNAUTHORIZED: 'Session expired — sign in again',
  FORBIDDEN: 'Not permitted at replay',
  NOT_FOUND: 'Visitor or visit no longer exists',
  OFFICE_CLOSED: 'Office was closed at replay',
};

export function classifyReplayOutcome(
  res: ReplayFetchResult | null,
  attempts: number,
  ageMs: number,
): ReplayOutcome {
  if (ageMs > MAX_QUEUE_AGE_MS) {
    return { action: 'failed', reason: 'Queued for over 24 hours' };
  }
  const retryOrCap = (): ReplayOutcome =>
    attempts + 1 >= MAX_REPLAY_ATTEMPTS
      ? { action: 'failed', reason: `Server unreachable after ${MAX_REPLAY_ATTEMPTS} tries` }
      : { action: 'retry' };

  if (!res || res.networkError) return retryOrCap();
  const { status, errorCode } = res;
  if (status >= 200 && status < 300) return { action: 'delivered' };
  if (errorCode === 'ALREADY_CHECKED_OUT') return { action: 'delivered' };
  if (status === 429 || status >= 500) return retryOrCap();
  if (status >= 400 && status < 500) {
    return { action: 'failed', reason: FAIL_REASONS[errorCode ?? ''] ?? 'Rejected by the server at replay' };
  }
  // Unexpected 1xx/3xx from a fetch() POST — treat as transient.
  return retryOrCap();
}

// Failed entries are retained for user dismissal but excluded from future
// replay passes. Missing status (records queued before this shipped) = pending.
export function isReplayPending(rec: { status?: string }): boolean {
  return rec.status !== 'failed';
}
