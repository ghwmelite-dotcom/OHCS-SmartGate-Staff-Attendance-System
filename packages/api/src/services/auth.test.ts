import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, needsRehash } from './auth';

// Precomputed legacy hash = unsalted single-round SHA-256("1234") as lowercase
// hex. This is exactly what the old hashPin produced; embedding it as a literal
// proves back-compat verification without re-using production code to make it.
const LEGACY_SHA256_1234 = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

describe('hashPin', () => {
  it('produces a self-describing pbkdf2 string', async () => {
    const h = await hashPin('1234');
    expect(h).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('uses a fresh salt each call (same pin → different hash)', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a).not.toBe(b);
  });
});

describe('verifyPin (pbkdf2)', () => {
  it('verifies the matching pin', async () => {
    const h = await hashPin('4321');
    expect(await verifyPin('4321', h)).toBe(true);
  });

  it('rejects a wrong pin', async () => {
    const h = await hashPin('4321');
    expect(await verifyPin('0000', h)).toBe(false);
  });

  it('rejects a malformed pbkdf2 string', async () => {
    expect(await verifyPin('1234', 'pbkdf2$nope')).toBe(false);
  });
});

describe('verifyPin (legacy SHA-256 back-compat)', () => {
  it('verifies a precomputed legacy hash', async () => {
    expect(await verifyPin('1234', LEGACY_SHA256_1234)).toBe(true);
  });

  it('rejects a wrong pin against a legacy hash', async () => {
    expect(await verifyPin('9999', LEGACY_SHA256_1234)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('is true for a legacy hash', () => {
    expect(needsRehash(LEGACY_SHA256_1234)).toBe(true);
  });

  it('is false for a new pbkdf2 hash', async () => {
    const h = await hashPin('1234');
    expect(needsRehash(h)).toBe(false);
  });
});
