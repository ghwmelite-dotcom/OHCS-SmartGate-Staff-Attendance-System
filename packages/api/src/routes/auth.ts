import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionData } from '../types';
import { LoginSchema, VerifyOtpSchema } from '../lib/validation';
import { createOtp, verifyOtp, verifyPin, hashPin, needsRehash, createSession, deleteSession, getSession, readSessionId, getUserAuthState, bumpSessionEpoch, getPinLock, recordPinFailure, clearPinLock, sessionCookieOptions, sessionCookieDeleteOptions } from '../services/auth';
import { success, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { z } from 'zod';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// (session-cookie option helpers moved to services/auth.ts so the WebAuthn login
// path shares the exact same cookie attributes.)

// Email OTP login (request code)
authRoutes.post('/login', zValidator('json', LoginSchema), async (c) => {
  const { email } = c.req.valid('json');
  const rl = await rateLimit(c.env, `login:${email}`, 5, 600);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  }

  const user = await c.env.DB.prepare('SELECT id, name, email, role, is_active FROM users WHERE email = ?')
    .bind(email)
    .first<{ is_active: number }>();

  // Only actually issue an OTP for a valid, active account — but ALWAYS return the
  // same response so this endpoint can't be used to enumerate registered admins.
  if (user && user.is_active) {
    await createOtp(email, c.env);
  }

  return success(c, { message: 'If an account exists for that email, an OTP has been sent.' });
});

// Email OTP verify
const verifySchema = VerifyOtpSchema.extend({
  remember: z.boolean().optional(),
});

authRoutes.post('/verify', zValidator('json', verifySchema), async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `verify-ip:${ip}`, 10, 300);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  }
  const { email, code, remember } = c.req.valid('json');

  const valid = await verifyOtp(email, code, c.env);
  if (!valid) {
    return error(c, 'INVALID_OTP', 'Invalid or expired OTP', 401);
  }

  const user = await c.env.DB.prepare('SELECT id, name, email, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; name: string; email: string; role: string }>();

  if (!user) {
    return error(c, 'USER_NOT_FOUND', 'User not found', 404);
  }

  const epoch = (await getUserAuthState(c.env, user.id))?.session_epoch ?? 0;
  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember, epoch);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, sessionCookieOptions(c.env, ttl));

  return success(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      session_token: sessionId,
    },
  });
});

// PIN-based login — accepts either staff_id (career staff) or nss_number (NSS personnel),
// exactly one. PIN is 4–6 digits to accommodate the temporary 6-digit PIN F&A hands NSS staff.
const pinLoginSchema = z
  .object({
    staff_id: z.string().min(1).max(20).trim().optional(),
    nss_number: z.string().min(1).max(32).trim().optional(),
    intern_code: z.string().min(1).max(64).trim().optional(),
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits'),
    remember: z.boolean().optional(),
  })
  .refine(
    (v) => (v.staff_id ? 1 : 0) + (v.nss_number ? 1 : 0) + (v.intern_code ? 1 : 0) === 1,
    { message: 'Provide exactly one of staff_id, nss_number or intern_code' },
  );

authRoutes.post('/pin-login', zValidator('json', pinLoginSchema), async (c) => {
  const { staff_id, nss_number, intern_code, pin, remember } = c.req.valid('json');
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';

  // Normalize the supplied identifier and choose the lookup column. Disjoint queries —
  // never OR them so a malicious caller can't cross identifier types.
  const rawId = (staff_id ?? nss_number ?? intern_code ?? '').toUpperCase();
  const lookupColumn = staff_id ? 'staff_id' : nss_number ? 'nss_number' : 'intern_code';

  const rlId = await rateLimit(c.env, `pin:${rawId}`, 10, 300);
  const rlIp = await rateLimit(c.env, `pin-ip:${ip}`, 30, 300);
  if (!rlId.allowed || !rlIp.allowed) {
    c.header('Retry-After', String(Math.max(rlId.retryAfter, rlIp.retryAfter)));
    return error(c, 'RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  }

  // Hard escalating lockout per identifier (defeats slow brute-force of the small
  // PIN keyspace beyond the sliding rate limit).
  const lock = await getPinLock(c.env, rawId);
  if (lock.locked) {
    c.header('Retry-After', String(lock.retryAfter));
    return error(c, 'ACCOUNT_LOCKED', 'Too many failed attempts. This account is temporarily locked.', 429);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, name, email, role, pin_hash, is_active, pin_acknowledged FROM users WHERE ${lookupColumn} = ?`
  ).bind(rawId).first<{
    id: string; name: string; email: string; role: string;
    pin_hash: string | null; is_active: number; pin_acknowledged: number;
  }>();

  if (!user || !user.is_active) {
    return error(c, 'INVALID_CREDENTIALS', 'Invalid credentials', 401);
  }

  if (!user.pin_hash) {
    return error(c, 'PIN_NOT_SET', 'PIN not configured for this account. Contact your administrator.', 401);
  }

  const valid = await verifyPin(pin, user.pin_hash);
  if (!valid) {
    await recordPinFailure(c.env, rawId);
    return error(c, 'INVALID_CREDENTIALS', 'Invalid credentials', 401);
  }
  await clearPinLock(c.env, rawId);

  // Lazy upgrade: transparently re-hash legacy SHA-256 PINs to PBKDF2 on a
  // successful verify. Off the response path via waitUntil so it adds no latency.
  if (needsRehash(user.pin_hash)) {
    const userId = user.id;
    c.executionCtx.waitUntil(
      hashPin(pin).then((upgraded) =>
        c.env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').bind(upgraded, userId).run()
      )
    );
  }

  const epoch = (await getUserAuthState(c.env, user.id))?.session_epoch ?? 0;
  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember, epoch);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, sessionCookieOptions(c.env, ttl));

  return success(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      pin_acknowledged: user.pin_acknowledged === 1,
      session_token: sessionId,
    },
  });
});

const profileUpdateSchema = z
  .object({
    phone: z.string().max(20).trim().optional().or(z.literal('')),
    email: z.string().email().max(255).toLowerCase().trim().optional(),
    current_pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .refine(
    (v) => !v.email || !!v.current_pin,
    { message: 'current_pin is required when changing email', path: ['current_pin'] }
  );

authRoutes.patch('/profile', zValidator('json', profileUpdateSchema), async (c) => {
  const sessionId = readSessionId(c);
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const session = await getSession(sessionId, c.env);
  if (!session) return error(c, 'UNAUTHORIZED', 'Session expired', 401);

  const body = c.req.valid('json');
  const userId = session.userId;

  if (body.email !== undefined) {
    const lock = await getPinLock(c.env, userId);
    if (lock.locked) {
      c.header('Retry-After', String(lock.retryAfter));
      return error(c, 'ACCOUNT_LOCKED', 'Too many failed attempts. Temporarily locked.', 429);
    }
    const user = await c.env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
      .bind(userId).first<{ pin_hash: string | null }>();
    if (!user?.pin_hash) return error(c, 'NO_PIN', 'No PIN set for this account', 400);
    const valid = await verifyPin(body.current_pin!, user.pin_hash);
    if (!valid) {
      await recordPinFailure(c.env, userId);
      return error(c, 'WRONG_PIN', 'Current PIN is incorrect', 401);
    }
    await clearPinLock(c.env, userId);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.phone !== undefined) {
    fields.push('phone = ?');
    values.push(body.phone || null);
  }
  if (body.email !== undefined) {
    const clash = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .bind(body.email, userId).first();
    if (clash) return error(c, 'DUPLICATE', 'That email is already in use', 409);
    fields.push('email = ?');
    values.push(body.email);
  }

  if (fields.length === 0) return error(c, 'NO_CHANGES', 'Nothing to update', 400);

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  values.push(userId);
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  if (body.email !== undefined) {
    await bumpSessionEpoch(c.env, userId);
    await deleteSession(sessionId, c.env);
    const row = await c.env.DB.prepare('SELECT session_epoch FROM users WHERE id = ?')
      .bind(userId).first<{ session_epoch: number }>();
    const epoch = row?.session_epoch ?? 0;
    const { sessionId: newSid, ttl } = await createSession(userId, body.email, session.role, session.name, c.env, false, epoch);
    setCookie(c, 'session_id', newSid, sessionCookieOptions(c.env, ttl));
  }

  const updated = await c.env.DB.prepare(
    'SELECT id, name, email, staff_id, phone, role, pin_acknowledged FROM users WHERE id = ?'
  ).bind(userId).first();

  return success(c, { user: updated });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = readSessionId(c);
  if (sessionId) {
    await deleteSession(sessionId, c.env);
  }
  deleteCookie(c, 'session_id', sessionCookieDeleteOptions(c.env));
  return success(c, { message: 'Logged out' });
});

// Change PIN — current_pin allows 4–6 digits so NSS personnel can swap their
// 6-digit F&A-issued PIN for a 4-digit one on first login. New PIN is always
// 4 digits to match the staff PWA's keypad UX.
const changePinSchema = z.object({
  current_pin: z.string().regex(/^\d{4,6}$/, 'Current PIN must be 4–6 digits'),
  new_pin: z.string().length(4).regex(/^\d{4}$/, 'New PIN must be 4 digits'),
});

authRoutes.post('/change-pin', zValidator('json', changePinSchema), async (c) => {
  const sessionId = readSessionId(c);
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const session = await getSession(sessionId, c.env);
  if (!session) return error(c, 'UNAUTHORIZED', 'Session expired', 401);

  const { current_pin, new_pin } = c.req.valid('json');

  const user = await c.env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
    .bind(session.userId).first<{ pin_hash: string | null }>();

  if (!user?.pin_hash) return error(c, 'NO_PIN', 'No PIN set for this account', 400);

  const valid = await verifyPin(current_pin, user.pin_hash);
  if (!valid) return error(c, 'WRONG_PIN', 'Current PIN is incorrect', 401);

  const newHash = await hashPin(new_pin);
  await c.env.DB.prepare('UPDATE users SET pin_hash = ?, pin_acknowledged = 1 WHERE id = ?')
    .bind(newHash, session.userId).run();

  // Revoke any OTHER sessions (the old PIN may be compromised), then re-issue
  // THIS browser's session with the new epoch so the user isn't logged out here.
  await bumpSessionEpoch(c.env, session.userId);
  await deleteSession(sessionId, c.env);
  const epoch = (await getUserAuthState(c.env, session.userId))?.session_epoch ?? 0;
  const { sessionId: newSid, ttl } = await createSession(session.userId, session.email, session.role, session.name, c.env, false, epoch);
  setCookie(c, 'session_id', newSid, sessionCookieOptions(c.env, ttl));

  return success(c, { message: 'PIN changed successfully' });
});

authRoutes.get('/me', async (c) => {
  const sessionId = readSessionId(c);
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
  const session = await getSession(sessionId, c.env);
  if (!session) {
    return error(c, 'UNAUTHORIZED', 'Session expired', 401);
  }

  // Read name/email/role fresh from DB so edits made in the admin portal
  // propagate without requiring the user to log out and back in.
  const row = await c.env.DB.prepare(
    'SELECT name, email, staff_id, phone, role, pin_acknowledged, is_active FROM users WHERE id = ?'
  )
    .bind(session.userId)
    .first<{ name: string; email: string; staff_id: string | null; phone: string | null; role: string; pin_acknowledged: number; is_active: number }>();

  if (!row || row.is_active !== 1) {
    return error(c, 'UNAUTHORIZED', 'Account disabled or deleted', 401);
  }

  return success(c, {
    user: {
      id: session.userId,
      name: row.name,
      email: row.email,
      staff_id: row.staff_id,
      phone: row.phone,
      role: row.role,
      pin_acknowledged: row.pin_acknowledged === 1,
    },
  });
});
