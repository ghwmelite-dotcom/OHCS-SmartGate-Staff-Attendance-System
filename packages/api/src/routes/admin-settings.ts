import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { invalidateSettingsCache, getAppSettings, REMINDER_DIRECTORATE_IDS_KV_KEY, type AppSettings } from '../services/settings';
import { recordAudit, auditActorFromContext, diffRecords } from '../services/audit';

const AUDITED_SETTINGS_FIELDS = ['work_start_time', 'late_threshold_time', 'work_end_time', 'reception_override_pin', 'clockin_reauth_enforce', 'clockin_passive_liveness_enforce', 'presence_qr_mode', 'risk_fusion_mode', 'risk_fusion_block_enabled', 'reminder_directorate_ids'];

// Response columns — NEVER return the cleartext reception_override_pin (a secret
// readable by admins); expose only whether one is set.
const SETTINGS_COLUMNS = `work_start_time, late_threshold_time, work_end_time,
  (reception_override_pin IS NOT NULL AND reception_override_pin <> '') AS reception_override_pin_set,
  clockin_reauth_enforce, clockin_passive_liveness_enforce, presence_qr_mode,
  risk_fusion_mode, risk_fusion_block_enabled, updated_by, updated_at`;

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
  // Presence QR (0 = off, 1 = shadow/record-only, 2 = enforce/reject).
  presence_qr_mode: z.number().int().min(0).max(2).optional(),
  // Attendance risk fusion (0 = off, 1 = shadow/persist+log only, 2 = enforce bands).
  risk_fusion_mode: z.number().int().min(0).max(2).optional(),
  // ≥60 block band (0 = flags only, 1 = may block — guardrail still applies).
  risk_fusion_block_enabled: z.number().int().min(0).max(1).optional(),
  // Clock-nudge audience scope: comma-separated directorate ids ('' = all directorates).
  // Whitespace/empty segments allowed here — the handler normalizes before storing.
  reminder_directorate_ids: z.string().regex(/^$|^\s*[A-Za-z0-9_-]*(\s*,\s*[A-Za-z0-9_-]*)*\s*$/, 'Comma-separated directorate ids').optional(),
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
  // reminder_directorate_ids has no DB column — overlay the KV-backed value.
  const settings = await getAppSettings(c.env);
  return success(c, { ...row, reminder_directorate_ids: settings.reminder_directorate_ids });
});

adminSettingsRoutes.put('/', zValidator('json', settingsSchema), async (c) => {
  const session = c.get('session');
  if (session.role !== 'superadmin') {
    return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  }
  const body = c.req.valid('json');
  const beforeRow = await c.env.DB.prepare(
    `SELECT work_start_time, late_threshold_time, work_end_time, reception_override_pin,
            clockin_reauth_enforce, clockin_passive_liveness_enforce, presence_qr_mode,
            risk_fusion_mode, risk_fusion_block_enabled FROM app_settings WHERE id = 1`
  ).first<Record<string, number | string | null>>();
  // The directorate allowlist is KV-backed (no DB column) — seed the audit
  // "before" snapshot with the effective value so the diff treats it like any
  // other audited field.
  const beforeSettings = await getAppSettings(c.env);
  const before = { ...beforeRow, reminder_directorate_ids: beforeSettings.reminder_directorate_ids };
  // Write-only PIN: omitted = keep current; '' = clear (NULL); digits = set.
  const overridePin = body.reception_override_pin === undefined
    ? ((beforeRow?.reception_override_pin as string | null) ?? null)
    : (body.reception_override_pin || null);
  // Enforce flags are optional in the payload — keep the current value when omitted.
  const reauthEnforce = body.clockin_reauth_enforce ?? (beforeRow?.clockin_reauth_enforce ?? 0);
  const livenessEnforce = body.clockin_passive_liveness_enforce ?? (beforeRow?.clockin_passive_liveness_enforce ?? 0);
  const presenceQrMode = body.presence_qr_mode ?? (beforeRow?.presence_qr_mode ?? 0);
  const riskFusionMode = body.risk_fusion_mode ?? (beforeRow?.risk_fusion_mode ?? 0);
  const riskFusionBlockEnabled = body.risk_fusion_block_enabled ?? (beforeRow?.risk_fusion_block_enabled ?? 0);
  await c.env.DB.prepare(
    `UPDATE app_settings
     SET work_start_time = ?, late_threshold_time = ?, work_end_time = ?,
         reception_override_pin = ?,
         clockin_reauth_enforce = ?, clockin_passive_liveness_enforce = ?,
         presence_qr_mode = ?,
         risk_fusion_mode = ?, risk_fusion_block_enabled = ?,
         updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = 1`
  ).bind(body.work_start_time, body.late_threshold_time, body.work_end_time, overridePin, reauthEnforce, livenessEnforce, presenceQrMode, riskFusionMode, riskFusionBlockEnabled, session.userId).run();

  // Normalize the CSV (trim each id, drop empties) and store it as a KV
  // override. '' is stored (not deleted) — it means "no filter".
  if (body.reminder_directorate_ids !== undefined) {
    const csv = body.reminder_directorate_ids.split(',').map((id) => id.trim()).filter(Boolean).join(',');
    await c.env.KV.put(REMINDER_DIRECTORATE_IDS_KV_KEY, csv);
  }

  await invalidateSettingsCache(c.env);

  const row = await c.env.DB.prepare(
    `SELECT ${SETTINGS_COLUMNS} FROM app_settings WHERE id = 1`
  ).first<AppSettings>();

  const afterSettings = await getAppSettings(c.env);
  const responseRow = { ...row, reminder_directorate_ids: afterSettings.reminder_directorate_ids };

  const changes = diffRecords(before, responseRow as Record<string, unknown>, AUDITED_SETTINGS_FIELDS);
  if (Object.keys(changes).length > 0) {
    await recordAudit(c.env, auditActorFromContext(c), {
      action: 'settings.update', entityType: 'settings', entityId: '1',
      summary: 'Updated working-hours / override settings',
      changes,
    });
  }
  return success(c, responseRow);
});
