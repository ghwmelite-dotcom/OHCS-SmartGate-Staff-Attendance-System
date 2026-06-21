import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { visitorPhotoKey, visitorIdPhotoKey } from '../lib/photo-key';
import { uploadVisitorPhoto } from '../lib/photo-upload';
import { isJpeg } from '../lib/image-magic';
import { resolveDirectorateScope } from '../lib/directorate-scope';

export const photoRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const MAX_PHOTO_BYTES = 500_000;

// Directors may only view a visitor's photos when that visitor has a visit in
// the director's directorate — mirrors the isolation in visitors.ts. Non-directors
// (admin/superadmin/receptionist/it) are not directorate-bound. Returns true when
// access is allowed.
async function canViewVisitorPhoto(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>,
  visitorId: string,
): Promise<boolean> {
  const scope = await resolveDirectorateScope(c);
  if (scope === null) return true; // not a director — full access by role
  const linked = await c.env.DB.prepare(
    'SELECT 1 FROM visits WHERE visitor_id = ? AND directorate_id = ? LIMIT 1'
  ).bind(visitorId, scope).first();
  return !!linked;
}

// Upload visitor face photo — accepts raw JPEG body
photoRoutes.post('/visitors/:id/photo', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist');
  if (blocked) return blocked;
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');

  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(body))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);

  const photoUrl = `/api/photos/visitors/${visitorId}`;
  await uploadVisitorPhoto(c.env, visitorId, body, visitorPhotoKey(visitorId), 'photo_url', photoUrl);
  return success(c, { photo_url: photoUrl });
});

// Upload visitor ID-document photo — accepts raw JPEG body
photoRoutes.post('/visitors/:id/id-photo', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist');
  if (blocked) return blocked;
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');

  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(body))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);

  const idPhotoUrl = `/api/photos/visitors/${visitorId}/id`;
  await uploadVisitorPhoto(c.env, visitorId, body, visitorIdPhotoKey(visitorId), 'id_photo_url', idPhotoUrl);
  return success(c, { id_photo_url: idPhotoUrl });
});

// Serve visitor face photo from R2 (auth-gated; mounted under /api/*)
photoRoutes.get('/visitors/:id', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const visitorId = c.req.param('id');
  if (!(await canViewVisitorPhoto(c, visitorId))) return notFound(c, 'Photo');
  const object = await c.env.STORAGE.get(visitorPhotoKey(visitorId));
  if (!object) return notFound(c, 'Photo');
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(object.body, { headers });
});

// Serve visitor ID-document photo from R2 (auth-gated)
photoRoutes.get('/visitors/:id/id', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const visitorId = c.req.param('id');
  if (!(await canViewVisitorPhoto(c, visitorId))) return notFound(c, 'Photo');
  const object = await c.env.STORAGE.get(visitorIdPhotoKey(visitorId));
  if (!object) return notFound(c, 'Photo');
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(object.body, { headers });
});
