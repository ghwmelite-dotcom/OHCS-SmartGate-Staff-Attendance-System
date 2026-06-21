import { describe, it, expect } from 'vitest';
import { encryptText, decryptToText } from './backup-crypto';

// A deterministic 32-byte key, base64-encoded.
const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

const SAMPLE = JSON.stringify([{ id: 'u1', name: 'Ama', pin_hash: 'secret' }, { id: 'u2', name: 'Kofi' }]);

describe('backup-crypto', () => {
  it('round-trips: encrypt then decrypt returns the original text', async () => {
    const enc = await encryptText(SAMPLE, KEY);
    expect(enc).not.toBe(SAMPLE);            // actually transformed
    expect(enc).not.toContain('secret');     // PII not in ciphertext envelope
    const dec = await decryptToText(enc, KEY);
    expect(dec).toBe(SAMPLE);
  });

  it('produces a versioned envelope with iv + data', async () => {
    const enc = await encryptText(SAMPLE, KEY);
    const env = JSON.parse(enc);
    expect(env.v).toBe(1);
    expect(typeof env.iv).toBe('string');
    expect(typeof env.data).toBe('string');
  });

  it('uses a fresh IV each time (ciphertext differs for the same input)', async () => {
    const a = await encryptText(SAMPLE, KEY);
    const b = await encryptText(SAMPLE, KEY);
    expect(a).not.toBe(b);
    expect(await decryptToText(a, KEY)).toBe(SAMPLE);
    expect(await decryptToText(b, KEY)).toBe(SAMPLE);
  });

  it('no key → passthrough (plaintext in, plaintext out)', async () => {
    const enc = await encryptText(SAMPLE, undefined);
    expect(enc).toBe(SAMPLE);
  });

  it('legacy plaintext array decrypts as itself (backward compatible)', async () => {
    // An old backup object: a bare JSON array, no envelope.
    const dec = await decryptToText(SAMPLE, KEY);
    expect(dec).toBe(SAMPLE);
    // ...and even with no key configured.
    expect(await decryptToText(SAMPLE, undefined)).toBe(SAMPLE);
  });

  it('encrypted backup with a missing key throws (cannot silently lose data)', async () => {
    const enc = await encryptText(SAMPLE, KEY);
    await expect(decryptToText(enc, undefined)).rejects.toThrow(/not set/i);
  });

  it('rejects a key that is not 32 bytes', async () => {
    const shortKey = btoa('too-short');
    await expect(encryptText(SAMPLE, shortKey)).rejects.toThrow(/32 bytes/);
  });
});
