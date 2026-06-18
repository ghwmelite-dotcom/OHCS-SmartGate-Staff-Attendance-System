import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { setBotCommands } from '../services/telegram';

export const adminTelegramRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Publish the bot's command menu to Telegram (superadmin only).
adminTelegramRoutes.post('/sync-commands', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;
  const ok = await setBotCommands(c.env);
  return success(c, { ok });
});
