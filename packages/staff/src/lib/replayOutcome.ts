// Replay-outcome classification for the offline clock queue.
//
// The service worker (`public/sw.js`) is a plain script and cannot import
// this module, so it carries a VERBATIM copy of this logic — keep the two in
// sync (the SW copy points back here).
//
// Rules (the happy path — 2xx — is unchanged from the original replay):
// - delivered: any 2xx, OR a 4xx whose error code is ALREADY_CLOCKED (the
//   record exists server-side; equivalent to the server's deduped success).
// - retry: network failure, 5xx, or 429 — transient; the entry stays queued
//   and its attempts counter climbs until MAX_REPLAY_ATTEMPTS, then it fails.
// - failed: any other 4xx, or age > 24h — terminal. The entry is MARKED
//   failed (never silently deleted) and surfaced to the user on the clock
//   page until dismissed.

export const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_REPLAY_ATTEMPTS = 10;

export type ReplayFetchResult =
  | { networkError: true }
  | { networkError?: false; status: number; errorCode: string | null };

export type ReplayOutcome =
  | { action: 'delivered' }
  | { action: 'retry' }
  | { action: 'failed'; reason: string };

// Short human strings for the clock-page banner, keyed by server error code.
const FAIL_REASONS: Record<string, string> = {
  PROMPT_NOT_FOUND: 'Clock session expired',
  PROMPT_EXPIRED: 'Clock session expired',
  REAUTH_REQUIRED: 'Sign-in verification expired',
  REAUTH_FAILED: 'Sign-in verification failed',
  PRESENCE_REQUIRED: 'Presence scan missing at replay',
  OUTSIDE_GEOFENCE: 'Outside office zone at replay',
  GPS_TOO_IMPRECISE: 'GPS signal too weak at replay',
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
  if (errorCode === 'ALREADY_CLOCKED') return { action: 'delivered' };
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
