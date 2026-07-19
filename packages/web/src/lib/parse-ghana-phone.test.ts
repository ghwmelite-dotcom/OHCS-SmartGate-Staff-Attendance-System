import { describe, it, expect } from 'vitest';
import { parseGhanaPhone } from './parse-ghana-phone';

describe('parseGhanaPhone', () => {
  it('returns the local form unchanged', () => {
    expect(parseGhanaPhone('0241234567')).toBe('0241234567');
  });

  it('converts the +233 form to the canonical local form', () => {
    expect(parseGhanaPhone('+233241234567')).toBe('0241234567');
  });

  it('tolerates spaces, dashes and parens', () => {
    expect(parseGhanaPhone('024 123 4567')).toBe('0241234567');
    expect(parseGhanaPhone('024-123-4567')).toBe('0241234567');
    expect(parseGhanaPhone('(024) 123 4567')).toBe('0241234567');
    expect(parseGhanaPhone('+233 24 123 4567')).toBe('0241234567');
    expect(parseGhanaPhone('  0241234567 ')).toBe('0241234567');
  });

  it('accepts every Ghana prefix shape the kiosk registration regex does', () => {
    expect(parseGhanaPhone('0201234567')).toBe('0201234567');
    expect(parseGhanaPhone('+233501234567')).toBe('0501234567');
    expect(parseGhanaPhone('0551234567')).toBe('0551234567');
  });

  it('returns null for anything that is not a Ghana number', () => {
    expect(parseGhanaPhone('')).toBeNull();
    expect(parseGhanaPhone('12345')).toBeNull();          // too short
    expect(parseGhanaPhone('02412345678')).toBeNull();    // too long
    expect(parseGhanaPhone('233241234567')).toBeNull();   // missing + or 0 prefix
    expect(parseGhanaPhone('+14155552671')).toBeNull();   // non-Ghana
    expect(parseGhanaPhone('not-a-number')).toBeNull();
  });
});
