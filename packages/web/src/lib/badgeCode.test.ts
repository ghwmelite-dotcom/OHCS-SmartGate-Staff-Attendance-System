import { describe, it, expect } from 'vitest';
import { parseBadgeCode } from './badgeCode';

describe('parseBadgeCode', () => {
  it('extracts an OHCS code from a full badge URL', () => {
    expect(parseBadgeCode('https://smartgate.ohcsghana.org/badge/OHCS-ABC123')).toBe('OHCS-ABC123');
  });

  it('extracts the code from a localhost badge URL with a trailing slash', () => {
    expect(parseBadgeCode('http://localhost:8787/badge/OHCS-XYZ789/')).toBe('OHCS-XYZ789');
  });

  it('returns a bare OHCS code unchanged', () => {
    expect(parseBadgeCode('OHCS-ABC123')).toBe('OHCS-ABC123');
  });

  it('is case-insensitive and uppercases the result', () => {
    expect(parseBadgeCode('ohcs-abc123')).toBe('OHCS-ABC123');
    expect(parseBadgeCode('sg-abc123')).toBe('SG-ABC123');
  });

  it('still accepts legacy SG- badges (issued before the rename)', () => {
    expect(parseBadgeCode('https://smartgate.ohcsghana.org/badge/SG-ABC123')).toBe('SG-ABC123');
    expect(parseBadgeCode('SG-XYZ789')).toBe('SG-XYZ789');
  });

  it('returns null when there is no badge code present', () => {
    expect(parseBadgeCode('https://example.com/not-a-badge')).toBeNull();
    expect(parseBadgeCode('')).toBeNull();
  });
});
