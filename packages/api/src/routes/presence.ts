import { Hono } from 'hono';
import type { Env } from '../types';
import { success, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { getCurrentPresenceToken, presenceCodeFromToken } from '../services/presence';
import { getOfficeStatus } from '../services/office-hours';
import { getAppSettings } from '../services/settings';
import { timingSafeEqualStrings } from '../services/auth';

export const presenceRoutes = new Hono<{ Bindings: Env }>();

// Public while presence_qr_mode = 0 (shipped dark): the token is evidence, not
// a credential — useless without session auth. Once the feature is switched on
// (mode > 0) the feed drives a wall-mounted lobby display, so it is gated on
// the PRESENCE_DISPLAY_KEY shared secret. Fail CLOSED: mode > 0 with the
// secret unset → 503 (display not provisioned), never open.
presenceRoutes.get('/current', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `presence-ip:${ip}`, 40, 60);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }

  const settings = await getAppSettings(c.env);
  if (settings.presence_qr_mode > 0) {
    const expected = c.env.PRESENCE_DISPLAY_KEY;
    if (!expected) {
      return error(c, 'PRESENCE_DISPLAY_NOT_PROVISIONED', 'Presence display is not provisioned', 503);
    }
    const provided = c.req.header('x-presence-display-key') ?? '';
    if (!provided || !timingSafeEqualStrings(provided, expected)) {
      return error(c, 'PRESENCE_DISPLAY_KEY_INVALID', 'Invalid presence display key', 401);
    }
  }

  const [{ token, expiresIn }, office] = await Promise.all([
    getCurrentPresenceToken(c.env),
    getOfficeStatus(c.env),
  ]);
  // Derive from the SAME token instance — a second getCurrentPresenceToken
  // call could rotate the window between reads and show a mismatched pair.
  const code = await presenceCodeFromToken(token);
  return success(c, { token, expires_in: expiresIn, code, office_open: office.open });
});
