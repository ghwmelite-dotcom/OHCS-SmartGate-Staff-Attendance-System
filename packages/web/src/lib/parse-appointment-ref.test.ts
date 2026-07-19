import { describe, it, expect } from 'vitest';
import { parseAppointmentRef } from './parse-appointment-ref';

describe('parseAppointmentRef', () => {
  it('returns a bare 6-char code unchanged', () => {
    expect(parseAppointmentRef('KM7P2X')).toBe('KM7P2X');
  });

  it('uppercases a lowercase bare code', () => {
    expect(parseAppointmentRef('km7p2x')).toBe('KM7P2X');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseAppointmentRef('  KM7P2X\n')).toBe('KM7P2X');
  });

  it('extracts the code from a URL with a ref= param', () => {
    expect(parseAppointmentRef('https://smartgate.ohcsghana.org/kiosk?ref=KM7P2X')).toBe('KM7P2X');
  });

  it('handles ref= among other query params, and lowercases values', () => {
    expect(parseAppointmentRef('https://x.test/a?foo=1&ref=km7p2x&bar=2')).toBe('KM7P2X');
  });

  it('rejects codes using glyphs outside the reference charset (I, L, O, 0, 1)', () => {
    expect(parseAppointmentRef('AB12IL')).toBeNull();
    expect(parseAppointmentRef('AB12OD')).toBeNull();
    expect(parseAppointmentRef('AB1201')).toBeNull();
    expect(parseAppointmentRef('https://x.test/?ref=AB12IL')).toBeNull();
  });

  it('returns null for anything else', () => {
    expect(parseAppointmentRef('')).toBeNull();
    expect(parseAppointmentRef('ABCDE')).toBeNull();      // too short
    expect(parseAppointmentRef('ABCDEFG')).toBeNull();    // too long
    expect(parseAppointmentRef('OHCS-ABC123')).toBeNull();// badge code, not an appointment ref
    expect(parseAppointmentRef('https://example.com/not-an-appointment')).toBeNull();
    expect(parseAppointmentRef('https://x.test/?ref=ABC12')).toBeNull(); // short ref param
  });
});
