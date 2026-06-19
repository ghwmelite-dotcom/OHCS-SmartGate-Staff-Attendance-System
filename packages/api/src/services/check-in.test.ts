import { describe, it, expect } from 'vitest';
import { generateBadgeCode } from './check-in';

describe('generateBadgeCode', () => {
  it('formats OHCS-<base36 time><base36 suffix> in uppercase', () => {
    const code = generateBadgeCode(1718600000000, new Uint8Array([10, 200, 30, 40, 50]));
    expect(code).toMatch(/^OHCS-[0-9A-Z]+$/);
    expect(code.startsWith('OHCS-')).toBe(true);
  });

  it('produces a fixed-width 8-char uppercase base36 suffix', () => {
    // Small random value still zero-pads to 8 chars (no lossy slice truncation).
    const code = generateBadgeCode(1718600000000, new Uint8Array([0, 0, 0, 0, 1]));
    const suffix = code.slice(`OHCS-${(1718600000000).toString(36).toUpperCase()}`.length);
    expect(suffix).toHaveLength(8);
    expect(suffix).toMatch(/^[0-9A-Z]{8}$/);
  });

  it('produces different codes for different random bytes', () => {
    const a = generateBadgeCode(1718600000000, new Uint8Array([1, 2, 3, 4, 5]));
    const b = generateBadgeCode(1718600000000, new Uint8Array([5, 4, 3, 2, 1]));
    expect(a).not.toBe(b);
  });
});
