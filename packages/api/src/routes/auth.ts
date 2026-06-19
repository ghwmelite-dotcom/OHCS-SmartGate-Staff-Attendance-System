import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionData } from '../types';
import { LoginSchema, VerifyOtpSchema } from '../lib/validation';
import { createOtp, verifyOtp, verifyPin, hashPin, createSession, deleteSession, getSession, readSessionId } from '../services/auth';
import { success, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { z } from 'zod';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

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
    .first();

  if (!user || !user.is_active) {
    return error(c, 'USER_NOT_FOUND', 'No active account found with this email', 404);
  }

  await createOtp(email, c.env);

  return success(c, { message: 'OTP sent to your email' });
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

  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: c.env.ENVIRONMENT === 'production' ? 'None' : 'Lax',
    path: '/',
    maxAge: ttl,
  });

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
    return error(c, 'INVALID_CREDENTIALS', 'Invalid credentials', 401);
  }

  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: c.env.ENVIRONMENT === 'production' ? 'None' : 'Lax',
    path: '/',
    maxAge: ttl,
  });

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

authRoutes.post('/logout', async (c) => {
  const sessionId = readSessionId(c);
  if (sessionId) {
    await deleteSession(sessionId, c.env);
  }
  deleteCookie(c, 'session_id', { path: '/' });
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
    'SELECT name, email, role, pin_acknowledged, is_active FROM users WHERE id = ?'
  )
    .bind(session.userId)
    .first<{ name: string; email: string; role: string; pin_acknowledged: number; is_active: number }>();

  if (!row || row.is_active !== 1) {
    return error(c, 'UNAUTHORIZED', 'Account disabled or deleted', 401);
  }

  return success(c, {
    user: {
      id: session.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      pin_acknowledged: row.pin_acknowledged === 1,
    },
  });
});
