import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { alertAdminError } from '../lib/error-alert';

export function errorHandler(err: Error, c: Context) {
  // Expected request failures are not server incidents. Match Hono's typed
  // exception, not message text or SyntaxError (which can be an internal bug).
  if (err instanceof HTTPException && err.status >= 400 && err.status < 500) {
    const headers = new Headers(err.getResponse().headers);
    headers.delete('Content-Length');
    headers.set('Content-Type', 'application/json; charset=UTF-8');
    const responseHeaders: Record<string, string> = {};
    headers.forEach((value, name) => { responseHeaders[name] = value; });
    return c.newResponse(JSON.stringify({
      data: null,
      error: {
        code: err.status === 400 ? 'BAD_REQUEST' : 'REQUEST_ERROR',
        message: err.status === 400 ? 'Invalid request body or parameters' : 'Request could not be accepted',
      },
    }), err.status, responseHeaders);
  }

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
