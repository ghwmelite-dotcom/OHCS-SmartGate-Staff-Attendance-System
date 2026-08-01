import { describe, it, expect } from 'vitest';
import {
  classifyReplayOutcome,
  isReplayPending,
  MAX_REPLAY_ATTEMPTS,
  MAX_QUEUE_AGE_MS,
} from './replayOutcome';

// The SW replay loop must never silently drop a queued clock event. These
// tests pin the outcome classification: delivered / retry-later / terminal
// failure (with a human reason the clock-page banner can show).
// NOTE: sw.js carries a verbatim copy of this logic (plain script, no imports)
// — keep them in sync.

describe('classifyReplayOutcome', () => {
  it('delivers on any 2xx', () => {
    expect(classifyReplayOutcome({ status: 200, errorCode: null }, 0, 0)).toEqual({ action: 'delivered' });
    expect(classifyReplayOutcome({ status: 201, errorCode: null }, 0, 0)).toEqual({ action: 'delivered' });
  });

  it('delivers on ALREADY_CLOCKED even though it is a 4xx (record exists server-side)', () => {
    expect(classifyReplayOutcome({ status: 409, errorCode: 'ALREADY_CLOCKED' }, 0, 0)).toEqual({ action: 'delivered' });
    expect(classifyReplayOutcome({ status: 400, errorCode: 'ALREADY_CLOCKED' }, 0, 0)).toEqual({ action: 'delivered' });
  });

  it('fails terminally on 410 PROMPT_EXPIRED with a human reason', () => {
    expect(classifyReplayOutcome({ status: 410, errorCode: 'PROMPT_EXPIRED' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Clock session expired' });
    expect(classifyReplayOutcome({ status: 410, errorCode: 'PROMPT_NOT_FOUND' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Clock session expired' });
  });

  it('fails terminally on 400s with reasons derived from the error code', () => {
    expect(classifyReplayOutcome({ status: 400, errorCode: 'OUTSIDE_GEOFENCE' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Outside office zone at replay' });
    expect(classifyReplayOutcome({ status: 400, errorCode: 'GPS_TOO_IMPRECISE' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'GPS signal too weak at replay' });
    expect(classifyReplayOutcome({ status: 400, errorCode: 'PRESENCE_REQUIRED' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Presence scan missing at replay' });
    expect(classifyReplayOutcome({ status: 401, errorCode: 'REAUTH_REQUIRED' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Sign-in verification expired' });
  });

  it('falls back to a generic reason for an unknown 4xx code', () => {
    const out = classifyReplayOutcome({ status: 422, errorCode: 'SOMETHING_NEW' }, 0, 0);
    expect(out.action).toBe('failed');
    if (out.action === 'failed') expect(out.reason.length).toBeGreaterThan(0);
  });

  it('retries on 5xx and keeps the entry', () => {
    expect(classifyReplayOutcome({ status: 500, errorCode: null }, 0, 0)).toEqual({ action: 'retry' });
    expect(classifyReplayOutcome({ status: 503, errorCode: null }, 3, 0)).toEqual({ action: 'retry' });
  });

  it('retries on 429 (rate limited — includes LIVENESS_REVIEW_CAP)', () => {
    expect(classifyReplayOutcome({ status: 429, errorCode: 'RATE_LIMITED' }, 0, 0)).toEqual({ action: 'retry' });
    expect(classifyReplayOutcome({ status: 429, errorCode: 'LIVENESS_REVIEW_CAP' }, 0, 0)).toEqual({ action: 'retry' });
  });

  it('retries on network failure', () => {
    expect(classifyReplayOutcome({ networkError: true }, 0, 0)).toEqual({ action: 'retry' });
    expect(classifyReplayOutcome({ networkError: true }, MAX_REPLAY_ATTEMPTS - 2, 0)).toEqual({ action: 'retry' });
  });

  it('fails after the attempts cap is reached', () => {
    const out = classifyReplayOutcome({ networkError: true }, MAX_REPLAY_ATTEMPTS - 1, 0);
    expect(out.action).toBe('failed');
    const out5xx = classifyReplayOutcome({ status: 500, errorCode: null }, MAX_REPLAY_ATTEMPTS - 1, 0);
    expect(out5xx.action).toBe('failed');
  });

  it('fails entries older than 24h regardless of anything else', () => {
    const old = MAX_QUEUE_AGE_MS + 1;
    expect(classifyReplayOutcome(null, 0, old).action).toBe('failed');
    expect(classifyReplayOutcome({ status: 500, errorCode: null }, 0, old).action).toBe('failed');
  });

  it('still replays entries just under the age limit', () => {
    expect(classifyReplayOutcome({ status: 200, errorCode: null }, 0, MAX_QUEUE_AGE_MS - 1))
      .toEqual({ action: 'delivered' });
  });
});

describe('isReplayPending', () => {
  it('treats missing status (legacy records) as pending', () => {
    expect(isReplayPending({})).toBe(true);
    expect(isReplayPending({ status: 'pending' })).toBe(true);
  });

  it('excludes failed entries from future replay attempts', () => {
    expect(isReplayPending({ status: 'failed' })).toBe(false);
  });
});
