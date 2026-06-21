import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { invalidateSettingsCache, type AppSettings } from '../services/settings';
import { recordAudit, auditActorFromContext, diffRecords } from '../services/audit';

const AUDITED_SETTINGS_FIELDS = ['work_start_time', 'late_threshold_time', 'work_end_time', 'reception_override_pin', 'clockin_reauth_enforce', 'clockin_passive_liveness_enforce'];

// Response columns — NEVER return the cleartext reception_override_pin (a secret
// readable by admins); expose only whether one is set.
const SETTINGS_COLUMNS = `work_start_time, late_threshold_time, work_end_time,
  (reception_override_pin IS NOT NULL AND reception_override_pin <> '') AS reception_override_pin_set,
  clockin_reauth_enforce, clockin_passive_liveness_enforce, updated_by, updated_at`;

export const adminSettingsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const settingsSchema = z.object({
  work_start_time: z.string().regex(HHMM, 'Must be HH:MM'),
  late_threshold_time: z.string().regex(HHMM, 'Must be HH:MM'),
  work_end_time: z.string().regex(HHMM, 'Must be HH:MM'),
  reception_override_pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits').optional().or(z.literal('')),
  // Clock-in security enforcement (0 = shadow/record-only, 1 = enforce/reject).
  clockin_reauth_enforce: z.number().int().min(0).max(1).optional(),
  clockin_passive_liveness_enforce: z.number().int().min(0).max(1).optional(),
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
    `SELECT ${SETTINGS_COLUMNS} FROM app_settings WHERE id = 1`
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
  const before = await c.env.DB.prepare(
    `SELECT work_start_time, late_threshold_time, work_end_time, reception_override_pin,
            clockin_reauth_enforce, clockin_passive_liveness_enforce FROM app_settings WHERE id = 1`
  ).first<Record<string, number | string | null>>();
  // Write-only PIN: omitted = keep current; '' = clear (NULL); digits = set.
  const overridePin = body.reception_override_pin === undefined
    ? ((before?.reception_override_pin as string | null) ?? null)
    : (body.reception_override_pin || null);
  // Enforce flags are optional in the payload — keep the current value when omitted.
  const reauthEnforce = body.clockin_reauth_enforce ?? (before?.clockin_reauth_enforce ?? 0);
  const livenessEnforce = body.clockin_passive_liveness_enforce ?? (before?.clockin_passive_liveness_enforce ?? 0);
  await c.env.DB.prepare(
    `UPDATE app_settings
     SET work_start_time = ?, late_threshold_time = ?, work_end_time = ?,
         reception_override_pin = ?,
         clockin_reauth_enforce = ?, clockin_passive_liveness_enforce = ?,
         updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = 1`
  ).bind(body.work_start_time, body.late_threshold_time, body.work_end_time, overridePin, reauthEnforce, livenessEnforce, session.userId).run();

  await invalidateSettingsCache(c.env);

  const row = await c.env.DB.prepare(
    `SELECT ${SETTINGS_COLUMNS} FROM app_settings WHERE id = 1`
  ).first<AppSettings>();

  const changes = diffRecords(before, row as unknown as Record<string, unknown>, AUDITED_SETTINGS_FIELDS);
  if (Object.keys(changes).length > 0) {
    await recordAudit(c.env, auditActorFromContext(c), {
      action: 'settings.update', entityType: 'settings', entityId: '1',
      summary: 'Updated working-hours / override settings',
      changes,
    });
  }
  return success(c, row);
});
