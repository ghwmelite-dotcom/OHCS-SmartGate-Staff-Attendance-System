import type { Env } from '../types';
import { getAppSettings } from './settings';
import { visitorPhotoKey, visitorIdPhotoKey, visitorIdPhotoBackKey } from '../lib/photo-key';

/**
 * Visitor photo auto-purge.
 *
 * Deletes the sensitive PII objects per visitor — the ID-document front photo, the
 * ID-document back photo (Ghana Card), and the face photo — from R2 a configurable
 * number of days (default 30) after the visitor's last checkout. The visit/visitor
 * records (name, time, purpose) are KEPT as the audit trail; only the R2 objects are
 * removed and the photo URL columns nulled. `photos_deleted` counts R2 delete calls
 * (three per scrubbed visitor), not objects that were actually present — a delete on a
 * missing key is a harmless no-op.
 *
 * Run daily by the 02:00 UTC maintenance cron, and on-demand by the superadmin
 * endpoint POST /api/admin/maintenance/purge-photos.
 *
 * Conservative by design:
 *   - Never touches visits rows, id_photo_check, badge codes, or any non-photo
 *     data.
 *   - Skips any visitor with a currently checked-in visit.
 *   - R2 .delete on a missing key is a no-op, so re-runs are safe.
 *   - Per-visitor work is wrapped in try/catch so one failure can't abort the
 *     batch. Logs are id-only — no PII.
 */

export interface PhotoPurgeResult {
  eligible: number;
  photos_deleted: number;
  visitors_scrubbed: number;
}

const BATCH_LIMIT = 1000;

export async function purgeExpiredVisitorPhotos(env: Env): Promise<PhotoPurgeResult> {
  const days = (await getAppSettings(env)).visitor_photo_retention_days ?? 30;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  // Eligible: still has a photo, has NO currently checked-in visit, and whose most
  // recent checkout (or, lacking any checkout, own created_at) is older than cutoff.
  const eligible = await env.DB.prepare(
    `SELECT v.id FROM visitors v
      WHERE (v.photo_url IS NOT NULL OR v.id_photo_url IS NOT NULL OR v.id_photo_back_url IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM visits w WHERE w.visitor_id = v.id AND w.status = 'checked_in')
        AND COALESCE((SELECT MAX(check_out_at) FROM visits w WHERE w.visitor_id = v.id), v.created_at) < ?
      LIMIT ${BATCH_LIMIT}`
  ).bind(cutoff).all<{ id: string }>();

  const ids = (eligible.results ?? []).map((r) => r.id);
  let photosDeleted = 0;
  let visitorsScrubbed = 0;
  const failedIds: string[] = [];

  for (const id of ids) {
    try {
      // R2 .delete on a missing key is a no-op — safe even if a photo was never
      // uploaded or was already purged.
      await env.STORAGE.delete(visitorPhotoKey(id));
      await env.STORAGE.delete(visitorIdPhotoKey(id));
      await env.STORAGE.delete(visitorIdPhotoBackKey(id));
      photosDeleted += 3;
      await env.DB.prepare(
        'UPDATE visitors SET photo_url = NULL, id_photo_url = NULL, id_photo_back_url = NULL WHERE id = ?'
      ).bind(id).run();
      visitorsScrubbed += 1;
    } catch (err) {
      failedIds.push(id);
      console.error(`[photo-purge] failed visitor=${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const result: PhotoPurgeResult = {
    eligible: ids.length,
    photos_deleted: photosDeleted,
    visitors_scrubbed: visitorsScrubbed,
  };

  console.log(
    `[photo-purge] retention_days=${days} cutoff=${cutoff} ` +
    `eligible=${result.eligible} photos_deleted=${result.photos_deleted} ` +
    `visitors_scrubbed=${result.visitors_scrubbed} failed=${failedIds.length}`
  );

  return result;
}
