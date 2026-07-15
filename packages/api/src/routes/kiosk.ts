import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../types';
import { success, created, notFound, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { KioskCreateVisitorSchema, KioskCheckInSchema, KioskCheckOutSchema, KioskCheckOutByPinSchema } from '../lib/validation';
import { visitorPhotoKey, visitorIdPhotoKey, visitorIdPhotoBackKey } from '../lib/photo-key';
import { uploadVisitorPhoto } from '../lib/photo-upload';
import { isJpeg } from '../lib/image-magic';
import { performCheckIn } from '../services/check-in';
import { checkOutByBadgeCode, checkOutByPin } from '../services/check-out';
import { checkIdDocument } from '../services/id-check';
import { isBlockingVerdict, mostConservativeVerdict, type IdCheckVerdict } from '../lib/id-check';
import { getAppSettings } from '../services/settings';
import { getOfficeStatus, officeClosedMessage } from '../services/office-hours';
import { resolveOverride } from '../services/override';
import { recordAudit, systemActor } from '../services/audit';

export const kioskRoutes = new Hono<{ Bindings: Env }>();

const KIOSK_USER_ID = 'user_kiosk';
const MAX_PHOTO_BYTES = 500_000;

// The shape persisted onto visits.id_photo_check — an IdCheckVerdict plus an
// optional reception-override audit annotation.
type PersistedIdCheck = IdCheckVerdict & {
  override?: { by: string; officer_id?: string | null; at: string };
};

// Safely parse a KV-stashed verdict JSON into a verdict; any failure → null
// (treated as "no verdict", which is non-blocking — never hard-block on infra error).
function parseStashedVerdict(raw: string | null): IdCheckVerdict | null {
  if (raw === null) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj === 'object' && obj !== null && 'verdict' in obj) {
      return obj as IdCheckVerdict;
    }
  } catch {
    /* fall through */
  }
  return null;
}

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

// Public office-open status for the kiosk (drives the closed banner + the
// reception-override prompt on check-in). No auth — same surface as /directorates.
kioskRoutes.get('/status', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const status = await getOfficeStatus(c.env);
  return success(c, status);
});

// Public officer list for the kiosk host-name autocomplete.
// Returns name + title + directorate only — no phone, email, or override PIN.
kioskRoutes.get('/officers', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.title, o.directorate_id, d.abbreviation AS directorate_abbr
     FROM officers o
     JOIN directorates d ON d.id = o.directorate_id
     WHERE o.is_available = 1 AND d.is_active = 1
     ORDER BY o.name`
  ).all();
  return success(c, rows.results ?? []);
});

// Public directorate list for the kiosk form. type/org_type included for dropdown
// grouping; the reception officer's NAME is deliberately NOT returned (PII on an
// unauthenticated endpoint).
kioskRoutes.get('/directorates', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, abbreviation, type, org_type FROM directorates WHERE is_active = 1 ORDER BY name`
  ).all();
  return success(c, rows.results ?? []);
});

// Raw-JPEG face photo upload.
kioskRoutes.post('/visitors/:id/photo', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(buf))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);
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
  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(buf))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);
  const idPhotoUrl = `/api/photos/visitors/${visitorId}/id`;
  await uploadVisitorPhoto(c.env, visitorId, buf, visitorIdPhotoKey(visitorId), 'id_photo_url', idPhotoUrl);

  // Non-blocking soft-flag: run the AI document check inline (raced ~5s), return
  // it for the live receptionist nudge, and stash it for the check-in to persist.
  const idCheck = await checkIdDocument(c.env, buf);
  await c.env.KV.put(`idcheck:${visitorId}`, JSON.stringify(idCheck), { expirationTtl: 900 });

  return success(c, { id_photo_url: idPhotoUrl, id_check: idCheck });
});

// Raw-JPEG ID-document BACK photo upload (Ghana Card). No AI check — the front
// photo already drives the document gate.
kioskRoutes.post('/visitors/:id/id-photo-back', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(buf))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);
  const idPhotoBackUrl = `/api/photos/visitors/${visitorId}/id-back`;
  await uploadVisitorPhoto(c.env, visitorId, buf, visitorIdPhotoBackKey(visitorId), 'id_photo_back_url', idPhotoBackUrl);
  return success(c, { id_photo_back_url: idPhotoBackUrl });
});

// Check in — attributed to the kiosk system user, source = 'kiosk'.
kioskRoutes.post('/check-in', zValidator('json', KioskCheckInSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const idCheckKey = `idcheck:${body.visitor_id}`;

  // The kiosk is PUBLIC — the AI document gate MUST be enforced here, server-side.
  // Read the KV-stashed verdict (raced from the id-photo step) and the verdict
  // echoed back in the body (survives the 900s KV TTL even if the visitor lingers).
  const kvVerdict = parseStashedVerdict(await c.env.KV.get(idCheckKey));
  const bodyVerdict: IdCheckVerdict | null = body.id_check ?? null;
  // Take the more conservative of the two so a forged body `document` cannot
  // unblock a KV `not_document`. Used for BOTH the gate decision and persistence.
  const effective = mostConservativeVerdict(kvVerdict, bodyVerdict);

  await getAppSettings(c.env); // (kept for cache warm-up / parity)
  const ip = c.req.header('cf-connecting-ip') ?? null;

  // Resolve the override PIN ONCE — a single entry clears both gates. Per-officer
  // PINs (hashed) are matched first for named attribution; the shared PIN is the
  // anonymous fallback. Per-IP kiosk rate limit (40/60s) bounds brute-force.
  const override = body.reception_override_pin
    ? await resolveOverride(c.env, body.reception_override_pin)
    : { ok: false, officerId: null, label: '' };

  // What gets persisted onto the visit's id_photo_check (default: indeterminate).
  let persistedCheck: PersistedIdCheck = effective ?? { verdict: 'indeterminate' };

  if (isBlockingVerdict(effective)) {
    if (!override.ok) {
      // Block BEFORE creating any visit. Do NOT delete the KV verdict here, so a
      // retake or a reception override retry still sees the stashed verdict.
      return error(
        c,
        'ID_NOT_VERIFIED',
        'The ID photo could not be verified as a valid document. Please retake or ask reception to assist.',
        422,
      );
    }
    // Override accepted — annotate the persisted verdict (who approved) for audit.
    persistedCheck = { ...effective!, override: { by: override.label, officer_id: override.officerId, at: new Date().toISOString() } };
    await recordAudit(c.env, systemActor(override.label, ip), {
      action: 'override.use', entityType: 'visit', entityId: body.visitor_id,
      summary: `Reception override accepted — ID document gate (by ${override.label})`,
    });
  }

  // Office-hours gate: outside working hours / weekend / public holiday, a check-in
  // requires a reception override (same resolved PIN). Check-out is never gated.
  const office = await getOfficeStatus(c.env);
  if (!office.open) {
    if (!override.ok) {
      return error(c, 'OFFICE_CLOSED', officeClosedMessage(office), 423);
    }
    await recordAudit(c.env, systemActor(override.label, ip), {
      action: 'override.use', entityType: 'visit', entityId: body.visitor_id,
      summary: `Reception override accepted — office closed (${office.reason}) (by ${override.label})`,
    });
  }

  const dir = await c.env.DB.prepare('SELECT reception_officer_id FROM directorates WHERE id = ?')
    .bind(body.directorate_id).first<{ reception_officer_id: string | null }>();
  const result = await performCheckIn(c.env, c.executionCtx, {
    ...body,
    host_officer_id: dir?.reception_officer_id ?? null,
    created_by: KIOSK_USER_ID,
    check_in_source: 'kiosk',
    id_photo_check: JSON.stringify(persistedCheck),
  });
  if (!result.ok) return notFound(c, 'Visitor');

  // Only delete the stashed verdict once the check-in has actually proceeded.
  await c.env.KV.delete(idCheckKey);
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

// Check out by 6-digit PIN (for visitors without a smartphone to scan their badge).
kioskRoutes.post('/check-out-by-pin', zValidator('json', KioskCheckOutByPinSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const { pin } = c.req.valid('json');
  const result = await checkOutByPin(c.env, pin);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return error(c, 'PIN_NOT_FOUND', 'No active check-in found for that PIN. Check the number and try again.', 404);
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
