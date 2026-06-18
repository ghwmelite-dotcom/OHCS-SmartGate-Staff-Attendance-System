// Web Push implementation for Cloudflare Workers using Web Crypto.
// - VAPID JWT (ES256) per RFC 8292
// - aes128gcm payload encryption per RFC 8291

import { recordNotifyOutcome } from './notify-metrics';

function b64urlToBytes(b64: string): Uint8Array {
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function importVapidPrivate(x: string, y: string, d: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function createVapidJwt(params: { audience: string; subject: string; x: string; y: string; d: string }): Promise<string> {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({ aud: params.audience, exp, sub: params.subject })));
  const input = `${header}.${payload}`;
  const key = await importVapidPrivate(params.x, params.y, params.d);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return `${input}.${bytesToB64url(new Uint8Array(sig))}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8);
  return new Uint8Array(bits);
}

// Encrypt payload for Web Push per RFC 8291 (aes128gcm content-encoding)
export async function encryptPayload(payload: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const recipientPublic = b64urlToBytes(p256dhB64);
  const auth = b64urlToBytes(authB64);

  // Generate ephemeral P-256 keypair
  const ephemPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const ephemPublicJwk = await crypto.subtle.exportKey('jwk', ephemPair.publicKey) as JsonWebKey;
  const ephemPublicRaw = concat(new Uint8Array([4]), b64urlToBytes(ephemPublicJwk.x!), b64urlToBytes(ephemPublicJwk.y!));

  // Import recipient public for ECDH
  const recipJwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(recipientPublic.slice(1, 33)),
    y: bytesToB64url(recipientPublic.slice(33, 65)),
    ext: true,
  };
  const recipKey = await crypto.subtle.importKey('jwk', recipJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Workers types require `$public` (TS keyword escape), but the runtime accepts standard `public`.
  // Pass both so both compiler and runtime are satisfied.
  const deriveAlgo = { name: 'ECDH', public: recipKey, $public: recipKey } as unknown as { name: 'ECDH'; $public: CryptoKey };
  const sharedBits = await crypto.subtle.deriveBits(deriveAlgo, ephemPair.privateKey, 256);
  const shared = new Uint8Array(sharedBits);

  // 16-byte random salt
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  // PRK_key = HKDF(auth, shared, "WebPush: info\0" || ua_public || as_public, 32)
  const infoKey = concat(new TextEncoder().encode('WebPush: info\0'), recipientPublic, ephemPublicRaw);
  const prkKey = await hkdf(auth, shared, infoKey, 32);

  // CEK = HKDF(salt, prkKey, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, prkKey, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  // NONCE = HKDF(salt, prkKey, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, prkKey, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Encrypt. Pad: 0x02 terminator for single-record payloads (RFC 8188 §2).
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, plaintext as BufferSource));

  // Header: salt(16) || rs(4 BE) || idlen(1) || keyid (ephemPublicRaw, 65 bytes)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const idlen = new Uint8Array([ephemPublicRaw.length]);
  return concat(salt, rs, idlen, ephemPublicRaw, ciphertext);
}

async function trackPushStatus(env: { KV: KVNamespace }, status: number): Promise<void> {
  await recordNotifyOutcome(env, 'push', status >= 200 && status < 300, String(status));
}

export interface WebPushEnv {
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
  KV: KVNamespace;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(target: PushTarget, payload: object, env: WebPushEnv): Promise<number> {
  if (!env.VAPID_PUBLIC_X || !env.VAPID_PRIVATE_D) {
    console.warn('[webpush] VAPID keys not set; skipping');
    await trackPushStatus(env, 0);
    return 0;
  }
  const url = new URL(target.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await createVapidJwt({ audience, subject: env.VAPID_SUBJECT, x: env.VAPID_PUBLIC_X, y: env.VAPID_PUBLIC_Y, d: env.VAPID_PRIVATE_D });
  const appServerKey = bytesToB64url(concat(new Uint8Array([4]), b64urlToBytes(env.VAPID_PUBLIC_X), b64urlToBytes(env.VAPID_PUBLIC_Y)));
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await encryptPayload(body, target.p256dh, target.auth);
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${appServerKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body: encrypted as BodyInit,
  });
  await trackPushStatus(env, res.status);
  return res.status;
}
