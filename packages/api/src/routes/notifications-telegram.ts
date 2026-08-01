import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';

export const notificationsTelegramRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Mint a one-time deep-link token so the signed-in user can connect their own
// Telegram chat (spec §6.2). The /start handler consumes telegram-user-link:*
// and records telegram-user:<userId> → chatId. Token TTL: 1 hour.
notificationsTelegramRoutes.post('/link-token', async (c) => {
  const session = c.get('session');
  // Staff linking lives on the dedicated attendance bot; until its username is
  // configured the main bot's is used (shared KV link store keeps both working).
  const username = c.env.TELEGRAM_ATTENDANCE_BOT_USERNAME || c.env.TELEGRAM_BOT_USERNAME;
  // Guard: until a real bot @username is configured, a deep link would be malformed.
  if (!username || username === 'REPLACE_WITH_BOT_USERNAME') {
    return error(c, 'BOT_NOT_CONFIGURED', 'Telegram bot username is not configured yet. Set TELEGRAM_ATTENDANCE_BOT_USERNAME (or TELEGRAM_BOT_USERNAME) before generating deep links.', 503);
  }
  const token = crypto.randomUUID().replace(/-/g, '');
  await c.env.KV.put(`telegram-user-link:${token}`, session.userId, { expirationTtl: 3600 });
  return success(c, { url: `https://t.me/${username}?start=${token}` });
});

// Whether the caller has a Telegram chat linked, plus their org-entity
// abbreviation so the client can label the connection.
notificationsTelegramRoutes.get('/status', async (c) => {
  const session = c.get('session');
  const chatId = await c.env.KV.get(`telegram-user:${session.userId}`);
  const row = await c.env.DB.prepare(
    'SELECT d.abbreviation FROM users u LEFT JOIN directorates d ON d.id = u.directorate_id WHERE u.id = ?'
  ).bind(session.userId).first<{ abbreviation: string | null }>();
  return success(c, { linked: !!chatId, entityAbbr: row?.abbreviation ?? null });
});
