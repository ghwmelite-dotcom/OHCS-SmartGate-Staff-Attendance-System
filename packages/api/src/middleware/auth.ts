import { createMiddleware } from 'hono/factory';
import type { Env, SessionData } from '../types';
import { getSession, readSessionId, getUserAuthState, deleteSession } from '../services/auth';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionData };
}>(async (c, next) => {
  const sessionId = readSessionId(c);
  if (!sessionId) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const session = await getSession(sessionId, c.env);
  if (!session) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
  }

  // Re-validate against the live user (short-cached): revoke the session if the
  // account is deactivated/gone, or its epoch was bumped (role change / PIN reset).
  const authState = await getUserAuthState(c.env, session.userId);
  if (!authState || !authState.is_active) {
    await deleteSession(sessionId, c.env);
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Account is inactive' } }, 401);
  }
  if ((session.epoch ?? 0) !== authState.session_epoch) {
    await deleteSession(sessionId, c.env);
    return c.json({ data: null, error: { code: 'SESSION_REVOKED', message: 'Your session has ended. Please sign in again.' } }, 401);
  }

  // Attach the session with the CURRENT role (so a stale cached role can't linger).
  c.set('session', { ...session, role: authState.role });
  await next();
});
