import { describe, it, expect, beforeEach } from 'vitest';
import {
  parsePresenceToken,
  stashPresenceDeeplink,
  readPresenceDeeplink,
  clearPresenceDeeplink,
  consumePresenceDeeplink,
  PRESENCE_DEEPLINK_MAX_AGE_MS,
} from './presence';

const TOKEN = '3f6c2a1e-9b7d-4e5f-a1c2-8d0e6f4b2a91';

describe('parsePresenceToken', () => {
  it('accepts a raw UUID and normalises it to lowercase', () => {
    expect(parsePresenceToken(TOKEN)).toBe(TOKEN);
    expect(parsePresenceToken(TOKEN.toUpperCase())).toBe(TOKEN);
  });

  it('accepts a raw UUID with surrounding whitespace', () => {
    expect(parsePresenceToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('extracts the presence param from the display URL', () => {
    expect(parsePresenceToken(`https://staff-attendance.ohcsghana.org/clock?presence=${TOKEN}`)).toBe(TOKEN);
  });

  it('returns null for a foreign URL without a presence param', () => {
    expect(parsePresenceToken('https://example.com/clock?foo=bar')).toBeNull();
  });

  it('returns null for a badge URL', () => {
    expect(parsePresenceToken('https://smartgate.ohcsghana.org/badge/SG-1234')).toBeNull();
  });

  it('returns null for a presence param that is not a UUID', () => {
    expect(parsePresenceToken('https://staff-attendance.ohcsghana.org/clock?presence=not-a-uuid')).toBeNull();
  });

  it('returns null for garbage and empty input', () => {
    expect(parsePresenceToken('hello world')).toBeNull();
    expect(parsePresenceToken('')).toBeNull();
  });
});

describe('presence deeplink stash', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a stashed token with its capture time', () => {
    const at = Date.now();
    stashPresenceDeeplink(TOKEN, at);
    expect(readPresenceDeeplink(at)).toEqual({ token: TOKEN, at });
  });

  it('normalises the token on read', () => {
    const at = Date.now();
    stashPresenceDeeplink(TOKEN.toUpperCase(), at);
    expect(readPresenceDeeplink(at)?.token).toBe(TOKEN);
  });

  it('returns null when nothing is stashed', () => {
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    sessionStorage.setItem('ohcs.presence.deeplink', '{not json');
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('returns null for a wrong-shaped stash', () => {
    sessionStorage.setItem('ohcs.presence.deeplink', JSON.stringify({ token: TOKEN }));
    expect(readPresenceDeeplink()).toBeNull();
    sessionStorage.setItem('ohcs.presence.deeplink', JSON.stringify({ token: 42, at: Date.now() }));
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('returns null for a non-UUID token', () => {
    stashPresenceDeeplink('not-a-uuid');
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('returns null for an expired stash', () => {
    const at = Date.now() - PRESENCE_DEEPLINK_MAX_AGE_MS - 1;
    stashPresenceDeeplink(TOKEN, at);
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('returns null for a far-future timestamp (clock skew)', () => {
    stashPresenceDeeplink(TOKEN, Date.now() + 10 * 60_000);
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('clear removes the stash', () => {
    stashPresenceDeeplink(TOKEN);
    clearPresenceDeeplink();
    expect(readPresenceDeeplink()).toBeNull();
  });

  it('consume returns the stash once and clears it', () => {
    const at = Date.now();
    stashPresenceDeeplink(TOKEN, at);
    expect(consumePresenceDeeplink(null, at)).toEqual({ token: TOKEN, at });
    expect(readPresenceDeeplink(at)).toBeNull();
  });

  it('consume prefers a fresh in-app scan over the stash and still clears it', () => {
    const FRESH = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
    const at = Date.now();
    stashPresenceDeeplink(TOKEN, at);
    expect(consumePresenceDeeplink(FRESH, at)).toEqual({ token: FRESH, at });
    expect(readPresenceDeeplink(at)).toBeNull();
  });

  it('consume returns null when there is neither scan nor stash', () => {
    expect(consumePresenceDeeplink(null)).toBeNull();
  });
});
