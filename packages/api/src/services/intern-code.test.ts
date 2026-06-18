import { describe, it, expect } from 'vitest';
import { formatInternCode, nextInternSeqFrom } from './intern-code';

describe('formatInternCode', () => {
  it('zero-pads the sequence to 3 digits', () => {
    expect(formatInternCode(2026, 1)).toBe('OHCS-INT-2026-001');
    expect(formatInternCode(2026, 42)).toBe('OHCS-INT-2026-042');
    expect(formatInternCode(2026, 999)).toBe('OHCS-INT-2026-999');
  });
});

describe('nextInternSeqFrom', () => {
  it('starts at 1 when there is no prior code for the year', () => {
    expect(nextInternSeqFrom(null, 2026)).toBe(1);
  });
  it('increments the sequence of the latest code for the year', () => {
    expect(nextInternSeqFrom('OHCS-INT-2026-007', 2026)).toBe(8);
  });
  it('restarts at 1 when the latest code is from a different year', () => {
    expect(nextInternSeqFrom('OHCS-INT-2025-050', 2026)).toBe(1);
  });
  it('ignores a malformed tail', () => {
    expect(nextInternSeqFrom('OHCS-INT-2026-xyz', 2026)).toBe(1);
  });
});
