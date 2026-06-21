/**
 * At-rest encryption for D1→R2 backups (AES-GCM envelope).
 *
 * R2 encrypts objects at rest server-side, but a leaked R2 *read* credential
 * would expose every backup's PII in cleartext. App-level encryption with a key
 * held only in Worker secrets closes that: without BACKUP_ENCRYPTION_KEY the
 * ciphertext is useless.
 *
 * Format on disk (one object per table):
 *   - Encrypted:  JSON `{ "v": 1, "iv": <base64>, "data": <base64 ciphertext> }`
 *   - Legacy:     a bare JSON array (what older, pre-encryption backups wrote)
 *
 * `decryptToText` auto-detects: a parsed envelope object is decrypted; a JSON
 * array is returned as-is (legacy passthrough), so old backups stay restorable.
 *
 * Deploy-safe: if no key is configured, `encryptText` returns the plaintext
 * unchanged and the caller writes a plaintext backup (with a warning logged by
 * the caller). Nothing breaks when the secret is absent.
 */

const ENVELOPE_VERSION = 1;

interface Envelope {
  v: number;
  iv: string;
  data: string;
}

function isEnvelope(x: unknown): x is Envelope {
  return (
    typeof x === 'object' && x !== null && !Array.isArray(x) &&
    typeof (x as Envelope).iv === 'string' && typeof (x as Envelope).data === 'string'
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== 32) {
    throw new Error(`BACKUP_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt `plaintext` into a serialized envelope string. If `keyB64` is empty/
 * undefined, returns `plaintext` unchanged (caller writes a plaintext backup).
 */
export async function encryptText(plaintext: string, keyB64: string | undefined): Promise<string> {
  if (!keyB64) return plaintext;
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  const env: Envelope = {
    v: ENVELOPE_VERSION,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(env);
}

/**
 * Inverse of `encryptText`. Auto-detects format:
 *   - envelope object → decrypts (requires the key; throws if key missing/wrong)
 *   - JSON array (legacy plaintext) → returned unchanged
 * Returns the plaintext JSON text (caller `JSON.parse`s it).
 */
export async function decryptToText(stored: string, keyB64: string | undefined): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // Not JSON at all — return as-is and let the caller fail loudly on parse.
    return stored;
  }

  if (Array.isArray(parsed)) return stored; // legacy plaintext backup
  if (!isEnvelope(parsed)) return stored;    // unknown object shape — passthrough

  if (!keyB64) {
    throw new Error('Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set — cannot decrypt.');
  }
  const key = await importKey(keyB64);
  const iv = base64ToBytes(parsed.iv);
  const ct = base64ToBytes(parsed.data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
}
