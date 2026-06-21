import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const listSchema = z.object({
  unread_only: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

notificationRoutes.get('/', zValidator('query', listSchema), async (c) => {
  const session = c.get('session');
  const { unread_only, limit } = c.req.valid('query');

  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params: unknown[] = [session.userId];

  if (unread_only === 'true') {
    sql += ' AND is_read = 0';
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

notificationRoutes.get('/unread-count', async (c) => {
  const session = c.get('session');
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(session.userId).first<{ count: number }>();

  return success(c, { count: result?.count ?? 0 });
});

notificationRoutes.post('/:id/read', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');

  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).bind(id, session.userId).run();

  return success(c, { message: 'Marked as read' });
});

notificationRoutes.post('/read-all', async (c) => {
  const session = c.get('session');

  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
  ).bind(session.userId).run();

  return success(c, { message: 'All marked as read' });
});

// Remove a single notification (own only).
notificationRoutes.delete('/:id', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM notifications WHERE id = ? AND user_id = ?'
  ).bind(id, session.userId).run();
  return success(c, { message: 'Deleted' });
});

// Clear ALL of the current user's notifications (read and unread).
notificationRoutes.delete('/', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare(
    'DELETE FROM notifications WHERE user_id = ?'
  ).bind(session.userId).run();
  return success(c, { message: 'All cleared' });
});
