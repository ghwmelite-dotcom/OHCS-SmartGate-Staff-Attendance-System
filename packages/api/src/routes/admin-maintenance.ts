import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { purgeExpiredVisitorPhotos } from '../services/photo-purge';
import { exportBackupToR2 } from '../services/backup';

export const adminMaintenanceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Manual trigger (superadmin) — runs the visitor photo purge on demand and returns
// the counts, so the result can be verified before trusting the daily cron.
adminMaintenanceRoutes.post('/purge-photos', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const result = await purgeExpiredVisitorPhotos(c.env);
  return success(c, result);
});

// Manual trigger (superadmin) — runs the D1 -> R2 table backup on demand and
// returns the per-table row counts + pruned count, so backups can be verified
// without waiting for the daily cron.
adminMaintenanceRoutes.post('/run-backup', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const result = await exportBackupToR2(c.env);
  return success(c, result);
});
