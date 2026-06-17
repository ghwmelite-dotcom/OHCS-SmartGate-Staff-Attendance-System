import { describe, it, expect } from 'vitest';
import { generateBadgeCode } from './check-in';

describe('generateBadgeCode', () => {
  it('formats SG-<base36 time><base36 suffix> in uppercase', () => {
    const code = generateBadgeCode(1718600000000, new Uint8Array([10, 200]));
    expect(code).toMatch(/^SG-[0-9A-Z]+$/);
    expect(code.startsWith('SG-')).toBe(true);
  });

  it('produces different codes for different random bytes', () => {
    const a = generateBadgeCode(1718600000000, new Uint8Array([1, 2]));
    const b = generateBadgeCode(1718600000000, new Uint8Array([3, 4]));
    expect(a).not.toBe(b);
  });
});
