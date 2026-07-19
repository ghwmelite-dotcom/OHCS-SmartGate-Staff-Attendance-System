import { Hono } from 'hono';
import type { Env } from '../types';
import { success, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { getCurrentPresenceToken } from '../services/presence';
import { getOfficeStatus } from '../services/office-hours';

export const presenceRoutes = new Hono<{ Bindings: Env }>();

// Public: the token is evidence, not a credential — useless without session auth.
presenceRoutes.get('/current', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `presence-ip:${ip}`, 40, 60);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }
  const [{ token, expiresIn }, office] = await Promise.all([
    getCurrentPresenceToken(c.env),
    getOfficeStatus(c.env),
  ]);
  return success(c, { token, expires_in: expiresIn, office_open: office.open });
});
