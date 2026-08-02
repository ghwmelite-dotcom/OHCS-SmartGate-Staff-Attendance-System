import { describe, it, expect } from 'vitest';
import {
  classifyReplayOutcome,
  isReplayPending,
  MAX_REPLAY_ATTEMPTS,
  MAX_QUEUE_AGE_MS,
} from './replayOutcome';

// The SW replay loop must never silently drop a queued visit mutation. These
// tests pin the outcome classification: delivered / retry-later / terminal
// failure (with a human reason the reception banner can show).
// NOTE: public/sw.js carries a verbatim copy of this logic (plain script, no
// imports) — keep them in sync. Ported from packages/staff (clock queue);
// codes adapted to the visits API.

describe('classifyReplayOutcome', () => {
  it('delivers on any 2xx (a duplicate check-in replay dedupes server-side into a 201)', () => {
    expect(classifyReplayOutcome({ status: 200, errorCode: null }, 0, 0)).toEqual({ action: 'delivered' });
    expect(classifyReplayOutcome({ status: 201, errorCode: null }, 0, 0)).toEqual({ action: 'delivered' });
  });

  it('delivers on ALREADY_CHECKED_OUT even though it is a 4xx (the queued checkout already landed)', () => {
    expect(classifyReplayOutcome({ status: 400, errorCode: 'ALREADY_CHECKED_OUT' }, 0, 0)).toEqual({ action: 'delivered' });
  });

  it('fails terminally on 401 with a session-expired reason', () => {
    expect(classifyReplayOutcome({ status: 401, errorCode: 'UNAUTHORIZED' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Session expired — sign in again' });
  });

  it('fails terminally on 404 (visitor or visit deleted between queue and replay)', () => {
    expect(classifyReplayOutcome({ status: 404, errorCode: 'NOT_FOUND' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Visitor or visit no longer exists' });
  });

  it('fails terminally on 423 OFFICE_CLOSED', () => {
    expect(classifyReplayOutcome({ status: 423, errorCode: 'OFFICE_CLOSED' }, 0, 0))
      .toEqual({ action: 'failed', reason: 'Office was closed at replay' });
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

  it('retries on 429 (rate limited)', () => {
    expect(classifyReplayOutcome({ status: 429, errorCode: 'RATE_LIMITED' }, 0, 0)).toEqual({ action: 'retry' });
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
