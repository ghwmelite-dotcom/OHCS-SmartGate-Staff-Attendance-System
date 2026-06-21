import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, SessionData } from '../types';

const OTP_TTL = 600;
const SESSION_TTL_DEFAULT = 86400;       // 24 hours
const SESSION_TTL_REMEMBER = 2592000;    // 30 days

export function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0]! % 1000000).padStart(6, '0');
}

export async function createOtp(email: string, env: Env): Promise<string> {
  const code = generateOtp();
  await env.KV.put(`otp:${email}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL });
  if (env.ENVIRONMENT !== 'production') {
    console.log(`[DEV OTP] ${email}: ${code}`);
  }
  return code;
}

export async function verifyOtp(email: string, code: string, env: Env): Promise<boolean> {
  const raw = await env.KV.get(`otp:${email}`);
  if (!raw) return false;

  const data = JSON.parse(raw) as { code: string; attempts: number };

  if (data.attempts >= 5) {
    await env.KV.delete(`otp:${email}`);
    return false;
  }

  if (data.code !== code) {
    data.attempts++;
    await env.KV.put(`otp:${email}`, JSON.stringify(data), { expirationTtl: OTP_TTL });
    return false;
  }

  await env.KV.delete(`otp:${email}`);
  return true;
}

// ---- PIN hashing (PBKDF2 over WebCrypto) ----
//
// New format is self-describing:  pbkdf2$<iterations>$<saltB64>$<hashB64>
// with a 16-byte random salt and a 256-bit derived key. Legacy hashes are
// bare lowercase-hex single-round SHA-256 strings (no `$`); they still verify
// via verifyPin and are upgraded lazily by callers (see needsRehash).

// Cloudflare Workers' Web Crypto caps PBKDF2 at 100,000 iterations — requesting
// more throws NotSupportedError ("iteration counts above 100000 are not supported").
// 100k is therefore the platform maximum; combined with a per-PIN random salt it's
// the strongest work factor available here. (verifyPin reads the iteration count
// embedded in each stored hash, so lowering this only affects newly-created hashes.)
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BITS = 256;
const PBKDF2_PREFIX = 'pbkdf2$';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const pinBytes = new TextEncoder().encode(pin);
  const key = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEY_BITS
  );
  return new Uint8Array(bits);
}

/** Legacy (pre-upgrade) hash: unsalted single-round SHA-256 as lowercase hex. */
async function legacySha256Hex(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two byte arrays. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Constant-time comparison of two equal-purpose strings (legacy hex path). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hash a PIN with PBKDF2 and a fresh per-call random salt. */
export async function hashPin(pin: string): Promise<string> {
  const salt: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(PBKDF2_SALT_BYTES));
  crypto.getRandomValues(salt);
  const derived = await deriveBits(pin, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
}

/**
 * True when `stored` is NOT in the current PBKDF2 format and should be
 * re-hashed (lazy upgrade) after a successful verify.
 */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(PBKDF2_PREFIX);
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parts = stored.split('$');
    // ['pbkdf2', '<iterations>', '<saltB64>', '<hashB64>']
    if (parts.length !== 4) return false;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) return false;
    let salt: Uint8Array<ArrayBuffer>;
    let expected: Uint8Array;
    try {
      salt = base64ToBytes(parts[2]!);
      expected = base64ToBytes(parts[3]!);
    } catch {
      return false;
    }
    const derived = await deriveBits(pin, salt, iterations);
    return timingSafeEqualBytes(derived, expected);
  }

  // Legacy bare SHA-256 hex.
  const inputHash = await legacySha256Hex(pin);
  return timingSafeEqualStrings(inputHash, stored);
}

export async function createSession(
  userId: string,
  email: string,
  role: string,
  name: string,
  env: Env,
  remember = false,
  epoch = 0,
): Promise<{ sessionId: string; ttl: number }> {
  const sessionId = crypto.randomUUID();
  const ttl = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT;
  const session: SessionData = { userId, email, role, name, epoch };
  await env.KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: ttl });
  return { sessionId, ttl };
}

// --- Session revocation: per-user auth state, short-cached --------------------
// authMiddleware re-checks the user on each request (is the account still active,
// is the session epoch current, what's the current role). Cached per-isolate for
// AUTH_STATE_TTL_MS so it adds negligible DB load; staleness is bounded by the TTL.
export interface UserAuthState { is_active: number; role: string; session_epoch: number }

const AUTH_STATE_TTL_MS = 30_000;
const authStateMemo = new Map<string, { state: UserAuthState | null; ts: number }>();

// Only the pre-migration "session_epoch column doesn't exist" case should be
// tolerated; any other DB error must propagate (don't mask a transient failure
// as "no epoch" or as "user gone").
function isMissingColumnError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /no such column|has no column named/i.test(m);
}

export async function getUserAuthState(env: Env, userId: string): Promise<UserAuthState | null> {
  const now = Date.now();
  const cached = authStateMemo.get(userId);
  if (cached && now - cached.ts < AUTH_STATE_TTL_MS) return cached.state;

  let row: UserAuthState | null = null;
  try {
    row = await env.DB.prepare(
      'SELECT is_active, role, session_epoch FROM users WHERE id = ?'
    ).bind(userId).first<UserAuthState>();
  } catch (err) {
    // Deploy-safety: tolerate ONLY the missing session_epoch column (pre-migration).
    // Any other error propagates so a transient DB blip can't masquerade as
    // "user gone" (which would delete the session) or silently disable epoch checks.
    if (!isMissingColumnError(err)) throw err;
    const fallback = await env.DB.prepare('SELECT is_active, role FROM users WHERE id = ?')
      .bind(userId).first<{ is_active: number; role: string }>();
    row = fallback ? { is_active: fallback.is_active, role: fallback.role, session_epoch: 0 } : null;
  }
  authStateMemo.set(userId, { state: row, ts: now });
  return row;
}

export function invalidateUserAuthState(userId: string): void {
  authStateMemo.delete(userId);
}

/** Revoke a user's sessions by bumping their epoch. Invalidates the local cache
 *  immediately; other isolates refresh within AUTH_STATE_TTL_MS. Non-fatal if the
 *  column doesn't exist yet (pre-migration) — the mutation must not fail. */
export async function bumpSessionEpoch(env: Env, userId: string): Promise<void> {
  try {
    await env.DB.prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?').bind(userId).run();
  } catch (err) {
    // Tolerate ONLY the pre-migration missing column; a real failure must surface
    // so the caller knows revocation didn't happen (don't report a false success).
    if (!isMissingColumnError(err)) throw err;
  } finally {
    invalidateUserAuthState(userId);
  }
}

// Shared session-cookie options so every set/delete site stays consistent.
// Prod: first-party cookie scoped to the parent domain (shared across the
// smartgate. + staff-attendance. subdomains), SameSite=Lax, Secure. Dev: host-only.
export function sessionCookieOptions(env: Env, maxAge: number) {
  const isProd = env.ENVIRONMENT === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
    ...(isProd ? { domain: 'ohcsghana.org' } : {}),
  };
}

// Delete must mirror domain + path exactly or the cookie isn't cleared.
export function sessionCookieDeleteOptions(env: Env) {
  const isProd = env.ENVIRONMENT === 'production';
  return {
    path: '/',
    ...(isProd ? { domain: 'ohcsghana.org' } : {}),
  };
}

// --- PIN-login lockout -------------------------------------------------------
// Hard, escalating lockout per identifier on top of the sliding rate limit. After
// PIN_LOCK_THRESHOLD consecutive failures the account locks for an escalating
// cooldown (5m → 10m → 20m … capped 1h), defeating slow online brute-force of the
// small PIN keyspace. Best-effort KV (not atomic) — paired with the per-id/per-IP
// rate limits it bounds throughput hard. Cleared on a successful login.
const PIN_LOCK_THRESHOLD = 5;
const PIN_LOCK_BASE_SECONDS = 300;
const PIN_LOCK_MAX_SECONDS = 3600;
interface PinLock { fails: number; until: number }

export async function getPinLock(env: Env, id: string): Promise<{ locked: boolean; retryAfter: number }> {
  const raw = await env.KV.get(`pin-lock:${id}`);
  if (!raw) return { locked: false, retryAfter: 0 };
  let lock: PinLock;
  try { lock = JSON.parse(raw) as PinLock; } catch { return { locked: false, retryAfter: 0 }; }
  const now = Date.now();
  return lock.until > now ? { locked: true, retryAfter: Math.ceil((lock.until - now) / 1000) } : { locked: false, retryAfter: 0 };
}

export async function recordPinFailure(env: Env, id: string): Promise<void> {
  const raw = await env.KV.get(`pin-lock:${id}`);
  let prev: PinLock = { fails: 0, until: 0 };
  if (raw) { try { prev = JSON.parse(raw) as PinLock; } catch { /* reset */ } }
  const fails = prev.fails + 1;
  let until = 0;
  if (fails >= PIN_LOCK_THRESHOLD) {
    const seconds = Math.min(PIN_LOCK_BASE_SECONDS * 2 ** (fails - PIN_LOCK_THRESHOLD), PIN_LOCK_MAX_SECONDS);
    until = Date.now() + seconds * 1000;
  }
  await env.KV.put(`pin-lock:${id}`, JSON.stringify({ fails, until }), { expirationTtl: 86400 });
}

export async function clearPinLock(env: Env, id: string): Promise<void> {
  await env.KV.delete(`pin-lock:${id}`);
}

export async function getSession(sessionId: string, env: Env): Promise<SessionData | null> {
  const raw = await env.KV.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(sessionId: string, env: Env): Promise<void> {
  await env.KV.delete(`session:${sessionId}`);
}

/**
 * Read a session ID from either the `session_id` cookie or an
 * `Authorization: Bearer <id>` header. Cookie wins when both are
 * present (backward-compatible).
 */
export function readSessionId(c: Context): string | null {
  const cookie = getCookie(c, 'session_id');
  if (cookie) return cookie;
  const auth = c.req.header('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}
