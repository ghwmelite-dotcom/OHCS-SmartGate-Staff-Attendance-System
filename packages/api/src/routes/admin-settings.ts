import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { invalidateSettingsCache, type AppSettings } from '../services/settings';

export const adminSettingsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const settingsSchema = z.object({
  work_start_time: z.string().regex(HHMM, 'Must be HH:MM'),
  late_threshold_time: z.string().regex(HHMM, 'Must be HH:MM'),
  work_end_time: z.string().regex(HHMM, 'Must be HH:MM'),
  reception_override_pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits').optional().or(z.literal('')),
}).refine(
  (s) => s.work_start_time < s.late_threshold_time && s.late_threshold_time < s.work_end_time,
  { message: 'Times must satisfy: start < late < end' },
);

adminSettingsRoutes.get('/', async (c) => {
  const session = c.get('session');
  if (session.role !== 'superadmin' && session.role !== 'admin') {
    return error(c, 'FORBIDDEN', 'Admin access required', 403);
  }
  const row = await c.env.DB.prepare(
    'SELECT work_start_time, late_threshold_time, work_end_time, reception_override_pin, updated_by, updated_at FROM app_settings WHERE id = 1'
  ).first<AppSettings>();
  if (!row) return notFound(c, 'Settings');
  return success(c, row);
});

adminSettingsRoutes.put('/', zValidator('json', settingsSchema), async (c) => {
  const session = c.get('session');
  if (session.role !== 'superadmin') {
    return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  }
  const body = c.req.valid('json');
  // Empty string = disable overrides (store NULL); digits = store as-is.
  const overridePin = body.reception_override_pin ? body.reception_override_pin : null;
  await c.env.DB.prepare(
    `UPDATE app_settings
     SET work_start_time = ?, late_threshold_time = ?, work_end_time = ?,
         reception_override_pin = ?,
         updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = 1`
  ).bind(body.work_start_time, body.late_threshold_time, body.work_end_time, overridePin, session.userId).run();

  await invalidateSettingsCache(c.env);

  const row = await c.env.DB.prepare(
    'SELECT work_start_time, late_threshold_time, work_end_time, reception_override_pin, updated_by, updated_at FROM app_settings WHERE id = 1'
  ).first<AppSettings>();
  return success(c, row);
});
