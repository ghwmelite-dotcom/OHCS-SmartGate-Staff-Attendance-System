/**
 * parseCapturedAt — the full-timestamp sibling of parseCapturedDate, added for
 * the VMS offline visit queue (plan 2026-08-01-vms-audit-fixes.md, Commit D):
 * a queued check-in/check-out replays with the client's original capture time
 * and the server records THAT time — but only inside the same acceptance
 * window the staff clock uses ([now-48h, now+5min]; anything else is an
 * untrusted client clock and is ignored).
 */
import { describe, it, expect } from 'vitest';
import { parseCapturedAt, CAPTURED_AT_MAX_AGE_MS, CAPTURED_AT_MAX_FUTURE_MS } from './clock-date';

describe('parseCapturedAt', () => {
  it('returns null for missing or unparseable input', () => {
    expect(parseCapturedAt(undefined)).toBeNull();
    expect(parseCapturedAt('')).toBeNull();
    expect(parseCapturedAt('not-a-date')).toBeNull();
  });

  it('accepts a timestamp inside the window and normalises to the DB second format', () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 3600_000);
    const out = parseCapturedAt(oneHourAgo.toISOString(), now);
    // Milliseconds stripped — matches strftime('%Y-%m-%dT%H:%M:%SZ') rows.
    expect(out).toBe(oneHourAgo.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects captures older than 48h', () => {
    const now = Date.now();
    const old = new Date(now - CAPTURED_AT_MAX_AGE_MS - 60_000).toISOString();
    expect(parseCapturedAt(old, now)).toBeNull();
  });

  it('rejects captures more than 5 minutes in the future', () => {
    const now = Date.now();
    const future = new Date(now + CAPTURED_AT_MAX_FUTURE_MS + 60_000).toISOString();
    expect(parseCapturedAt(future, now)).toBeNull();
    // Just inside the future allowance is fine (client clock skew).
    const slightSkew = new Date(now + 60_000).toISOString();
    expect(parseCapturedAt(slightSkew, now)).not.toBeNull();
  });
});
