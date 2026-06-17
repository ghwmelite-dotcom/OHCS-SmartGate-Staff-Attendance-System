import { describe, it, expect } from 'vitest';
import { parseBadgeCode } from './badgeCode';

describe('parseBadgeCode', () => {
  it('extracts the code from a full badge URL', () => {
    expect(parseBadgeCode('https://smartgate.ohcsghana.org/badge/SG-ABC123')).toBe('SG-ABC123');
  });

  it('extracts the code from a localhost badge URL with a trailing slash', () => {
    expect(parseBadgeCode('http://localhost:8787/badge/SG-XYZ789/')).toBe('SG-XYZ789');
  });

  it('returns a bare code unchanged', () => {
    expect(parseBadgeCode('SG-ABC123')).toBe('SG-ABC123');
  });

  it('is case-insensitive on the SG prefix and uppercases the result', () => {
    expect(parseBadgeCode('sg-abc123')).toBe('SG-ABC123');
  });

  it('returns null when there is no SG code present', () => {
    expect(parseBadgeCode('https://example.com/not-a-badge')).toBeNull();
    expect(parseBadgeCode('')).toBeNull();
  });
});
