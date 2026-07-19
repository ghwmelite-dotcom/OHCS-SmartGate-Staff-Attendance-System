import { describe, it, expect } from 'vitest';
import { parsePresenceToken } from './presence';

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
