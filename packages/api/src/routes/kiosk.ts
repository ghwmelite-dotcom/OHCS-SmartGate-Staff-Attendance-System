import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../types';
import { success, created, notFound, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { KioskCreateVisitorSchema, KioskCheckInSchema, KioskCheckOutSchema } from '../lib/validation';
import { visitorPhotoKey, visitorIdPhotoKey } from '../lib/photo-key';
import { uploadVisitorPhoto } from '../lib/photo-upload';
import { performCheckIn } from '../services/check-in';
import { checkOutByBadgeCode } from '../services/check-out';
import { checkIdDocument } from '../services/id-check';

export const kioskRoutes = new Hono<{ Bindings: Env }>();

const KIOSK_USER_ID = 'user_kiosk';
const MAX_PHOTO_BYTES = 500_000;

// Per-IP rate limit for every kiosk action. Conservative: 40 writes / 60s.
async function kioskRateLimit(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `kiosk-ip:${ip}`, 40, 60);
  if (!rl.allowed) c.header('Retry-After', String(rl.retryAfter));
  return rl.allowed;
}

// Create a visitor (no search/list exposure on the kiosk surface).
kioskRoutes.post('/visitors', zValidator('json', KioskCreateVisitorSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO visitors (id, first_name, last_name, phone, organisation, id_type, id_number)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.first_name, body.last_name, body.phone || null,
         body.organisation || null, body.id_type || null, body.id_number || null).run();
  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  return created(c, visitor);
});

// Public directorate list for the kiosk form (id/name/abbreviation only — no PII).
kioskRoutes.get('/directorates', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.name, d.abbreviation, o.name AS reception_officer_name
     FROM directorates d
     LEFT JOIN officers o ON d.reception_officer_id = o.id
     WHERE d.is_active = 1 ORDER BY d.name`
  ).all();
  return success(c, rows.results ?? []);
});

// Raw-JPEG face photo upload.
kioskRoutes.post('/visitors/:id/photo', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  const photoUrl = `/api/photos/visitors/${visitorId}`;
  await uploadVisitorPhoto(c.env, visitorId, buf, visitorPhotoKey(visitorId), 'photo_url', photoUrl);
  return success(c, { photo_url: photoUrl });
});

// Raw-JPEG ID-document photo upload.
kioskRoutes.post('/visitors/:id/id-photo', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  const idPhotoUrl = `/api/photos/visitors/${visitorId}/id`;
  await uploadVisitorPhoto(c.env, visitorId, buf, visitorIdPhotoKey(visitorId), 'id_photo_url', idPhotoUrl);

  // Non-blocking soft-flag: run the AI document check inline (raced ~5s), return
  // it for the live receptionist nudge, and stash it for the check-in to persist.
  const idCheck = await checkIdDocument(c.env, buf);
  await c.env.KV.put(`idcheck:${visitorId}`, JSON.stringify(idCheck), { expirationTtl: 900 });

  return success(c, { id_photo_url: idPhotoUrl, id_check: idCheck });
});

// Check in — attributed to the kiosk system user, source = 'kiosk'.
kioskRoutes.post('/check-in', zValidator('json', KioskCheckInSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const idCheckRaw = await c.env.KV.get(`idcheck:${body.visitor_id}`);
  if (idCheckRaw !== null) await c.env.KV.delete(`idcheck:${body.visitor_id}`);
  const dir = await c.env.DB.prepare('SELECT reception_officer_id FROM directorates WHERE id = ?')
    .bind(body.directorate_id).first<{ reception_officer_id: string | null }>();
  const result = await performCheckIn(c.env, c.executionCtx, {
    ...body,
    host_officer_id: dir?.reception_officer_id ?? null,
    created_by: KIOSK_USER_ID,
    check_in_source: 'kiosk',
    id_photo_check: idCheckRaw ?? JSON.stringify({ verdict: 'indeterminate' }),
  });
  if (!result.ok) return notFound(c, 'Visitor');
  return created(c, result.visit);
});

// Check out by scanned badge code.
kioskRoutes.post('/check-out', zValidator('json', KioskCheckOutSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const { badge_code } = c.req.valid('json');
  const result = await checkOutByBadgeCode(c.env, badge_code);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return notFound(c, 'Visit');
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
