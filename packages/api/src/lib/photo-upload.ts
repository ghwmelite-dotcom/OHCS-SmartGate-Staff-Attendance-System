import type { Env } from '../types';

// Stores a raw-JPEG photo to R2 under `key`, then writes the resulting public
// URL into `column` on the visitor row. Shared by the auth-gated photo routes
// and the public kiosk routes so the storage + DB-write logic lives in one place.
export async function uploadVisitorPhoto(
  env: Env,
  visitorId: string,
  body: ArrayBuffer,
  key: string,
  column: 'photo_url' | 'id_photo_url' | 'id_photo_back_url',
  publicUrl: string,
): Promise<void> {
  await env.STORAGE.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.DB.prepare(
    `UPDATE visitors SET ${column} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).bind(publicUrl, visitorId).run();
}
