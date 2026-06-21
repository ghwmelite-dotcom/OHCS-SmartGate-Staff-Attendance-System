import type { Context } from 'hono';
import { alertAdminError } from '../lib/error-alert';

export function errorHandler(err: Error, c: Context) {
  console.error(`[ERROR] ${err.message}`, err.stack);

  // Fire-and-forget Telegram alert (prod-only, throttled, PII-free — never
  // blocks or changes the response, and can't throw). executionCtx may be
  // undefined in some contexts (e.g. tests), so guard it.
  try {
    c.executionCtx?.waitUntil(
      alertAdminError(c.env, `${c.req.method} ${new URL(c.req.url).pathname}`, err),
    );
  } catch {
    // executionCtx unavailable — skip alerting, still return the 500 below.
  }

  // Expose the real error detail to developers and to authenticated superadmins
  // (privileged ops users) — everyone else gets the generic message. Reading the
  // session can't throw, but guard anyway since errors can occur pre-auth.
  let isSuperadmin = false;
  try { isSuperadmin = c.get('session')?.role === 'superadmin'; } catch { /* no session in context */ }
  const exposeDetail = c.env.ENVIRONMENT === 'development' || isSuperadmin;

  return c.json({
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: exposeDetail ? `${err.name}: ${err.message}` : 'An unexpected error occurred',
    },
  }, 500);
}
