import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { setBotCommands } from '../services/telegram';

export const adminTelegramRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Publish the bot's command menu to Telegram (superadmin only).
adminTelegramRoutes.post('/sync-commands', async (c) => {
  if (c.get('session').role !== 'superadmin') return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const ok = await setBotCommands(c.env);
  return success(c, { ok });
});
