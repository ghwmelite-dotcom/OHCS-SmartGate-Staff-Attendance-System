import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { clockEffectiveDateSql } from '../lib/clock-date';
import { verifyClockPin, verifyClockWebAuthnAssertion } from '../services/clock-reauth';
import { getAppSettings } from '../services/settings';
import { devError } from '../lib/log';
import { rateLimit } from '../lib/rate-limit';
import { recordAudit, auditActorFromContext } from '../services/audit';

const inputSchema = z.object({
  idempotency_key: z.string().uuid(),
  prompt_id: z.string().uuid(),
  departure_at: z.string().datetime().optional(),
  pin: z.string().regex(/^\d{6}$/).optional(),
  webauthn_assertion: z.object({
    id: z.string().min(1), rawId: z.string(), type: z.literal('public-key'),
    response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string(), userHandle: z.string().optional() }),
    clientExtensionResults: z.object({}).passthrough(),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  }).optional(),
}).strict();

interface DepartureRow {
  id: string;
  type: string;
  timestamp: string;
  reported_departure_at: string | null;
}

export const selfReportedClockOutRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

selfReportedClockOutRoutes.post('/', async (c) => {
  const parsed = inputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(c, 'BAD_REQUEST', 'Check your departure time and verification details.', 400);
  const input = parsed.data;
  const { userId } = c.get('session');
  const existing = await c.env.DB.prepare(
    'SELECT id, type, timestamp, reported_departure_at FROM clock_records WHERE user_id = ? AND idempotency_key = ?'
  ).bind(userId, input.idempotency_key).first<DepartureRow>();
  if (existing) {
    if (existing.type !== 'clock_out' || !existing.reported_departure_at) {
      return error(c, 'IDEMPOTENCY_CONFLICT', 'This request identifier has already been used.', 409);
    }
    return success(c, { ...existing, self_reported: true, deduplicated: true });
  }
  if (!(await rateLimit(c.env, `self-report-out:${userId}`, 10, 60)).allowed) {
    return error(c, 'RATE_LIMITED', 'Please wait a minute before trying again.', 429);
  }

  const prompt = await c.env.KV.get<{ userId: string; expiresAt: number }>(`clock-prompt:${input.prompt_id}`, 'json');
  if (!prompt || prompt.userId !== userId || prompt.expiresAt <= Date.now()) {
    return error(c, 'PROMPT_EXPIRED', 'Verification expired. Please try again.', 400);
  }
  const settings = await getAppSettings(c.env);
  const auth = input.webauthn_assertion
    ? await verifyClockWebAuthnAssertion(c, userId, input.prompt_id, input.webauthn_assertion as AuthenticationResponseJSON)
    : input.pin
      ? await verifyClockPin(c.env, userId, input.pin, Math.max(1, Math.min(10, settings.clockin_pin_attempt_cap)))
      : null;
  if (!auth?.ok) {
    if (auth && auth.reason === 'rate_limited') return error(c, 'RATE_LIMITED', 'Too many PIN attempts. Please contact your administrator.', 429);
    return error(c, 'REAUTH_REQUIRED', 'Confirm with your PIN or registered passkey.', 403);
  }

  // Both timestamps come from this request's server clock; client time is only
  // accepted as an explicit, bounded declaration, never as verification.
  const submittedAt = new Date().toISOString();
  const today = submittedAt.slice(0, 10);
  const departureAt = input.departure_at ? new Date(input.departure_at).toISOString() : submittedAt;
  const clockIn = await c.env.DB.prepare(
    `SELECT timestamp FROM clock_records WHERE user_id = ? AND type = 'clock_in'
     AND ${clockEffectiveDateSql('clock_records')} = ? ORDER BY timestamp LIMIT 1`
  ).bind(userId, today).first<{ timestamp: string }>();
  if (!clockIn) return error(c, 'NOT_CLOCKED_IN', 'Clock in today before recording a departure.', 400);
  if (departureAt.slice(0, 10) !== today || Date.parse(departureAt) > Date.parse(submittedAt)
    || Date.parse(departureAt) < Date.parse(clockIn.timestamp)) {
    return error(c, 'INVALID_DEPARTURE', 'Departure must be today, after your clock-in and not in the future. Contact admin for a previous day.', 400);
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  // D1 serializes each statement. The normal route uses the same NOT EXISTS
  // condition, so competing on-site/self-report requests cannot both insert.
  await c.env.DB.prepare(
    `INSERT INTO clock_records
       (id, user_id, type, timestamp, reported_departure_at, within_geofence, idempotency_key, reauth_method)
     SELECT ?, ?, 'clock_out', ?, ?, 0, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM clock_records WHERE user_id = ? AND type = 'clock_out'
       AND ${clockEffectiveDateSql('clock_records')} = ?)`
  ).bind(id, userId, submittedAt, departureAt, input.idempotency_key, auth.method, userId, today).run();
  const saved = await c.env.DB.prepare(
    'SELECT id, type, timestamp, reported_departure_at FROM clock_records WHERE user_id = ? AND idempotency_key = ?'
  ).bind(userId, input.idempotency_key).first<DepartureRow>();
  if (!saved) return error(c, 'ALREADY_CLOCKED', 'You have already clocked out today.', 409);

  // A post-insert KV failure must never turn a recorded departure into a failure.
  await c.env.KV.delete(`clock-prompt:${input.prompt_id}`).catch(err => devError(c.env, '[clock] prompt cleanup failed', err));
  if (saved.id === id) c.executionCtx.waitUntil(recordAudit(c.env, auditActorFromContext(c), {
    action: 'clock.self_reported_out', entityType: 'clock_record', entityId: id,
    summary: `Self-reported departure ${departureAt}; submitted ${submittedAt}; reauth ${auth.method}`,
  }).catch(err => devError(c.env, '[clock] self-report audit failed', err)));
  return success(c, { ...saved, self_reported: true, deduplicated: saved.id !== id });
});
