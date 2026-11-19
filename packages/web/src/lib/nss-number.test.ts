import { describe, expect, it } from 'vitest';
import { nssNumberSchema } from './nss-number';

describe('NSS identifiers', () => {
  it.each(['GUPS72599144826', 'NSSGUE8364724', 'GIOT726234454925', '00123456', 'NEW-2027/001', 'AB 123', 'A'.repeat(32)])('accepts issued identifier %s without a fixed format', value => {
    expect(nssNumberSchema.parse(value)).toBe(value);
  });
  it('normalises surrounding whitespace and case without losing leading zeros', () => {
    expect(nssNumberSchema.parse('  gups72599144826  ')).toBe('GUPS72599144826');
    expect(nssNumberSchema.parse(' 00123 ')).toBe('00123');
  });
  it.each(['', '   ', 'A'.repeat(33), 'AB\n123', 'AB\t123', 'AB\u0000123', 'AB\u007F123'])('rejects blank, oversized or control-character input %j', value => {
    expect(nssNumberSchema.safeParse(value).success).toBe(false);
  });
});
