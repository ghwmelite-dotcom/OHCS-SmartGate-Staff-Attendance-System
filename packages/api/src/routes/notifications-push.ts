import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';

export const notificationsPushRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }),
});

notificationsPushRoutes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const session = c.get('session');
  const { endpoint, keys } = c.req.valid('json');

  // Only update an existing subscription if it already belongs to this user — a
  // caller cannot reassign (hijack) another user's endpoint to themselves. A stale
  // endpoint from a previous user on a shared device is cleared on their logout
  // (unsubscribe deletes by endpoint).
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
     WHERE push_subscriptions.user_id = excluded.user_id`
  ).bind(session.userId, endpoint, keys.p256dh, keys.auth).run();

  return success(c, { ok: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

notificationsPushRoutes.post('/unsubscribe', zValidator('json', unsubscribeSchema), async (c) => {
  const session = c.get('session');
  const { endpoint } = c.req.valid('json');
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .bind(session.userId, endpoint).run();
  return success(c, { ok: true });
});

notificationsPushRoutes.get('/status', async (c) => {
  const session = c.get('session');
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?')
    .bind(session.userId).first<{ n: number }>();
  return success(c, { subscribed: (row?.n ?? 0) > 0, endpoints: row?.n ?? 0 });
});
