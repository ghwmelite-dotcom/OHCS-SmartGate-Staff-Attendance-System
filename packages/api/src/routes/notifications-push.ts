import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendWebPush } from '../lib/webpush';

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

// Send a diagnostic push to the caller's own device(s) and return the exact
// push-service status per subscription. This bypasses the best-effort KV
// counters so delivery can be verified directly: 201/200-2xx = delivered;
// 401/403 = VAPID key mismatch (the subscription was made against a different
// public key — fully reopen the app and re-enable notifications); 404/410 =
// dead subscription (auto-cleaned here); a populated `error` = the send threw
// (e.g. server VAPID keys missing/malformed).
notificationsPushRoutes.post('/test', async (c) => {
  const session = c.get('session');
  const subs = await c.env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
  ).bind(session.userId).all<{ endpoint: string; p256dh: string; auth: string }>();

  const rows = subs.results ?? [];
  if (rows.length === 0) {
    return success(c, { sent: 0, delivered: 0, results: [], hint: 'No push subscription on this account — tap Enable notifications first.' });
  }

  const results: Array<{ provider: string; status: number; ok: boolean; error?: string }> = [];
  for (const s of rows) {
    let status = 0;
    let err: string | undefined;
    try {
      status = await sendWebPush(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        { title: 'Test notification ✅', body: "Push is working — you'll get clock-in and clock-out reminders here.", url: '/', type: 'test' },
        c.env,
      );
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    let provider = 'unknown';
    try { provider = new URL(s.endpoint).host; } catch { /* keep default */ }
    results.push({ provider, status, ok: status >= 200 && status < 300, ...(err ? { error: err } : {}) });
    if (status === 404 || status === 410) {
      await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
    }
  }
  const delivered = results.filter((r) => r.ok).length;
  return success(c, { sent: rows.length, delivered, results });
});
