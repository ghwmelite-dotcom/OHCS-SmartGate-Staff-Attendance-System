import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { resolveRp } from '../lib/webauthn-rp';
import { createSession, getUserAuthState, sessionCookieOptions } from '../services/auth';
import { rateLimit } from '../lib/rate-limit';

// Public login endpoints (mounted before authMiddleware)
export const authWebAuthnPublicRoutes = new Hono<{ Bindings: Env }>();

// Authenticated registration + credential management (mounted inside authMiddleware)
export const authWebAuthnAuthedRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: SessionData };
}>();

const REG_CHALLENGE_TTL = 300;
const AUTH_CHALLENGE_TTL = 300;

interface StoredCredential {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
}

// -------- Registration (authenticated) --------

authWebAuthnAuthedRoutes.post('/register/options', async (c) => {
  const session = c.get('session');
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);

  const rp = resolveRp(c);
  if (!rp) return error(c, 'BAD_ORIGIN', 'Origin not allowed', 400);

  const user = await c.env.DB.prepare(
    'SELECT id, name, email FROM users WHERE id = ? AND is_active = 1'
  ).bind(session.userId).first<{ id: string; name: string; email: string }>();
  if (!user) return error(c, 'NOT_FOUND', 'User not found', 404);

  const existing = await c.env.DB.prepare(
    'SELECT id, transports FROM webauthn_credentials WHERE user_id = ?'
  ).bind(session.userId).all<{ id: string; transports: string | null }>();

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userID: isoUint8Array.fromUTF8String(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    excludeCredentials: (existing.results ?? []).map(r => ({
      id: r.id,
      transports: r.transports ? (JSON.parse(r.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
  });

  await c.env.KV.put(
    `webauthn-reg:${session.userId}`,
    options.challenge,
    { expirationTtl: REG_CHALLENGE_TTL },
  );

  return success(c, options);
});

const registerVerifySchema = z.object({
  response: z.any(),
  device_label: z.string().max(100).optional(),
});

authWebAuthnAuthedRoutes.post('/register/verify', zValidator('json', registerVerifySchema), async (c) => {
  const session = c.get('session');
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);

  const rp = resolveRp(c);
  if (!rp) return error(c, 'BAD_ORIGIN', 'Origin not allowed', 400);

  const { response, device_label } = c.req.valid('json');
  const expectedChallenge = await c.env.KV.get(`webauthn-reg:${session.userId}`);
  if (!expectedChallenge) return error(c, 'CHALLENGE_EXPIRED', 'Registration challenge expired — restart enrollment', 400);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return error(c, 'VERIFICATION_FAILED', e instanceof Error ? e.message : 'Invalid registration', 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return error(c, 'VERIFICATION_FAILED', 'Registration response did not verify', 400);
  }

  const { credential } = verification.registrationInfo;
  const credentialId = credential.id;
  const publicKeyB64 = isoBase64URL.fromBuffer(credential.publicKey);
  const transports = (response as RegistrationResponseJSON).response?.transports;

  await c.env.DB.prepare(
    `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, device_label)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    credentialId,
    session.userId,
    publicKeyB64,
    credential.counter,
    transports ? JSON.stringify(transports) : null,
    device_label ?? null,
  ).run();

  await c.env.KV.delete(`webauthn-reg:${session.userId}`);

  return success(c, { id: credentialId, device_label: device_label ?? null });
});

// -------- Authentication (public) --------

// Both /login/options and /login/verify accept either staff_id (career staff)
// or nss_number (NSS personnel) — exactly one. Look-ups are disjoint per identifier
// type so a malicious caller cannot cross-match identifier kinds.
const identifierSchema = z
  .object({
    staff_id: z.string().min(1).max(20).trim().optional(),
    nss_number: z.string().min(1).max(32).trim().optional(),
    intern_code: z.string().min(1).max(64).trim().optional(),
  })
  .refine(
    (v) => (v.staff_id ? 1 : 0) + (v.nss_number ? 1 : 0) + (v.intern_code ? 1 : 0) === 1,
    { message: 'Provide exactly one of staff_id, nss_number or intern_code' },
  );

const loginOptionsSchema = identifierSchema;

/** Returns the column to look up by ('staff_id' | 'nss_number' | 'intern_code') and the normalized value. */
function resolveIdentifier(input: { staff_id?: string; nss_number?: string; intern_code?: string }): {
  column: 'staff_id' | 'nss_number' | 'intern_code';
  value: string;
  challengeKey: string;
} {
  if (input.staff_id) {
    const v = input.staff_id.toUpperCase();
    return { column: 'staff_id', value: v, challengeKey: `webauthn-auth:sid:${v}` };
  }
  if (input.nss_number) {
    const v = input.nss_number.toUpperCase();
    return { column: 'nss_number', value: v, challengeKey: `webauthn-auth:nss:${v}` };
  }
  const v = (input.intern_code ?? '').toUpperCase();
  return { column: 'intern_code', value: v, challengeKey: `webauthn-auth:int:${v}` };
}

authWebAuthnPublicRoutes.post('/login/options', zValidator('json', loginOptionsSchema), async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `webauthn-opts-ip:${ip}`, 20, 300);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many attempts', 429);
  }

  const rp = resolveRp(c);
  if (!rp) return error(c, 'BAD_ORIGIN', 'Origin not allowed', 400);

  const { column, value, challengeKey } = resolveIdentifier(c.req.valid('json'));
  const user = await c.env.DB.prepare(
    `SELECT id FROM users WHERE ${column} = ? AND is_active = 1`
  ).bind(value).first<{ id: string }>();

  // Don't leak account existence — always return options. If no user, use empty allowCredentials
  // so the browser still prompts and we fail verify later.
  const credentials = user ? await c.env.DB.prepare(
    'SELECT id, transports FROM webauthn_credentials WHERE user_id = ?'
  ).bind(user.id).all<{ id: string; transports: string | null }>() : { results: [] };

  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
    allowCredentials: (credentials.results ?? []).map(cr => ({
      id: cr.id,
      transports: cr.transports ? (JSON.parse(cr.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
  });

  // Store challenge keyed by identifier kind+value so staff and NSS namespaces don't collide.
  await c.env.KV.put(
    challengeKey,
    options.challenge,
    { expirationTtl: AUTH_CHALLENGE_TTL },
  );

  return success(c, options);
});

const loginVerifySchema = identifierSchema.and(
  z.object({
    response: z.any(),
    remember: z.boolean().optional(),
  }),
);

authWebAuthnPublicRoutes.post('/login/verify', zValidator('json', loginVerifySchema), async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `webauthn-verify-ip:${ip}`, 20, 300);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many attempts', 429);
  }

  const rp = resolveRp(c);
  if (!rp) return error(c, 'BAD_ORIGIN', 'Origin not allowed', 400);

  const body = c.req.valid('json');
  const { response, remember } = body;
  const { column, value, challengeKey } = resolveIdentifier(body);

  const expectedChallenge = await c.env.KV.get(challengeKey);
  if (!expectedChallenge) return error(c, 'CHALLENGE_EXPIRED', 'Challenge expired — try again', 400);

  const assertion = response as AuthenticationResponseJSON;
  const credentialId = assertion.id;

  const cred = await c.env.DB.prepare(
    `SELECT c.id, c.user_id, c.public_key, c.counter, c.transports
     FROM webauthn_credentials c
     JOIN users u ON c.user_id = u.id
     WHERE c.id = ? AND u.${column} = ? AND u.is_active = 1`
  ).bind(credentialId, value).first<StoredCredential>();

  if (!cred) return error(c, 'NOT_FOUND', 'Credential not recognized', 404);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: cred.transports ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[]) : undefined,
      },
      requireUserVerification: true,
    });
  } catch (e) {
    return error(c, 'VERIFICATION_FAILED', e instanceof Error ? e.message : 'Invalid assertion', 400);
  }

  if (!verification.verified) {
    return error(c, 'VERIFICATION_FAILED', 'Assertion did not verify', 401);
  }

  // Bump counter + last_used
  await c.env.DB.prepare(
    `UPDATE webauthn_credentials SET counter = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).bind(verification.authenticationInfo.newCounter, cred.id).run();

  await c.env.KV.delete(challengeKey);

  // Load user for session payload
  const user = await c.env.DB.prepare(
    'SELECT id, name, email, role, pin_acknowledged FROM users WHERE id = ?'
  ).bind(cred.user_id).first<{ id: string; name: string; email: string; role: string; pin_acknowledged: number }>();
  if (!user) return error(c, 'NOT_FOUND', 'User not found', 404);

  const epoch = (await getUserAuthState(c.env, user.id))?.session_epoch ?? 0;
  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember ?? false, epoch);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  // Use the shared cookie options (HttpOnly, Secure-in-prod, SameSite=Lax,
  // Domain=ohcsghana.org) — same as the OTP/PIN login paths.
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

// -------- Credential management (authenticated) --------

authWebAuthnAuthedRoutes.get('/credentials', async (c) => {
  const session = c.get('session');
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);

  const rows = await c.env.DB.prepare(
    'SELECT id, device_label, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(session.userId).all();

  return success(c, rows.results ?? []);
});

authWebAuthnAuthedRoutes.delete('/credentials/:id', async (c) => {
  const session = c.get('session');
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);

  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?'
  ).bind(id, session.userId).run();

  return success(c, { message: 'Removed' });
});
