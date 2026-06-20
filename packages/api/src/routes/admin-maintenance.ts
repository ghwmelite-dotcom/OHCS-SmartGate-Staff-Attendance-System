import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { purgeExpiredVisitorPhotos } from '../services/photo-purge';

export const adminMaintenanceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Manual trigger (superadmin) — runs the visitor photo purge on demand and returns
// the counts, so the result can be verified before trusting the daily cron.
adminMaintenanceRoutes.post('/purge-photos', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const result = await purgeExpiredVisitorPhotos(c.env);
  return success(c, result);
});
