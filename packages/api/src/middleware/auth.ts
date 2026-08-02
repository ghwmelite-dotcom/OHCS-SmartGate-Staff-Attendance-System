import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { getSession, readSessionId, getUserAuthState, deleteSession, type UserAuthState } from '../services/auth';

export interface LiveSession {
  session: SessionData;
  authState: UserAuthState;
}

/**
 * Resolve the request's session and re-validate it against the live user
 * (short-cached): the session is revoked when the account is deactivated/gone
 * or its epoch was bumped (role change / PIN reset). Returns the session with
 * the CURRENT role (so a stale cached role can't linger), or a ready 401
 * Response the caller returns verbatim.
 *
 * Shared by authMiddleware and the self-service routes under /api/auth
 * (profile / change-pin / me), which are mounted before authMiddleware and
 * would otherwise skip this revalidation.
 */
export async function requireLiveSession<E extends { Bindings: Env }>(
  c: Context<E>,
): Promise<LiveSession | Response> {
  const sessionId = readSessionId(c);
  if (!sessionId) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const session = await getSession(sessionId, c.env);
  if (!session) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
  }

  const authState = await getUserAuthState(c.env, session.userId);
  if (!authState || !authState.is_active) {
    await deleteSession(sessionId, c.env);
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Account is inactive' } }, 401);
  }
  if ((session.epoch ?? 0) !== authState.session_epoch) {
    await deleteSession(sessionId, c.env);
    return c.json({ data: null, error: { code: 'SESSION_REVOKED', message: 'Your session has ended. Please sign in again.' } }, 401);
  }

  return {
    session: { ...session, role: authState.role, directorate_abbr: authState.directorate_abbr },
    authState,
  };
}

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionData };
}>(async (c, next) => {
  const result = await requireLiveSession(c);
  if (result instanceof Response) return result;

  // Server-side forced PIN reset. pin_acknowledged = 0 means the account is
  // still on its admin-issued initial PIN. Scoped to role 'staff' (career
  // staff + NSS + interns — the PIN-login accounts): pin_acknowledged defaults
  // to 0 for ALL users, including admin-tier accounts that sign into the VMS
  // portal via email OTP / WebAuthn and would be trapped by a blanket gate.
  // The only routes left reachable are the /api/auth self-service ones
  // (change-pin / me / logout), mounted before this middleware.
  if (result.authState.role === 'staff' && result.authState.pin_acknowledged !== 1) {
    return c.json({
      data: null,
      error: { code: 'PIN_RESET_REQUIRED', message: 'You must set a new PIN before continuing. Open the attendance app to change your PIN.' },
    }, 403);
  }

  c.set('session', result.session);
  await next();
});
