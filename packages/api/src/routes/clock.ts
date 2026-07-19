import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendLateClockAlert } from '../services/reminders';
import { getAppSettings, hhmmToMinutes } from '../services/settings';
import { verifyClockWebAuthnAssertion, verifyClockPin } from '../services/clock-reauth';
import { devLog } from '../lib/log';
import { recordAudit, auditActorFromContext } from '../services/audit';
import { rateLimit } from '../lib/rate-limit';
import { resolveOverride } from '../services/override';
import { validatePresenceToken } from '../services/presence';
import { isJpeg } from '../lib/image-magic';
import { ALL_CHALLENGES, verifyLivenessBurst, getReviewCount, incrementReviewCount } from '../services/liveness';
import type { LivenessChallenge, LivenessSignature } from '../services/liveness/types';
import { computeRiskScore, riskBand, isBlockable, BLOCK_THRESHOLD, type RiskInput, type RiskFactor } from '../services/risk-score';
import { sha256Hex } from '../db/migrations-index';

export const clockRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// OHCS building footprint (Office of The Head of the Civil Service, Accra).
// The TRUE building outline (~34m × 76m), replacing an earlier ~5m × 7m patch
// near the entrance that was rejecting staff genuinely inside the building
// (they fell outside the tiny patch + 8m buffer). Corners are the surveyed
// building outline; the old patch's centroid sits inside this polygon (verified).
// Order is the perimeter walk; winding direction is irrelevant for the ray-cast.
// The accuracy-aware buffer (WALL_BUFFER_METERS + accuracy * 0.5) absorbs GPS
// jitter for staff right at the walls/doorway. NOTE: this is a tightly-packed
// ministries block (Ministry of Justice ~46m, Controller & Accountant General's
// ~49m away) — field-verify a clock-in from inside before relying on it, and the
// buffer can be tightened now that the footprint (not a patch) is accurate.
type LatLng = readonly [number, number];
const OHCS_POLYGONS: readonly (readonly LatLng[])[] = [
  [
    [5.5525043, -0.1977808],
    [5.5527239, -0.1971268],
    [5.5526358, -0.1970969],
    [5.5524162, -0.1977509],
  ],
];

// Reject a clock-in if the device can't localise to better than this many
// metres. Tight cap: GPS error directly translates to false-positive risk.
const MAX_GPS_ACCURACY_METERS = 30;

// Wall buffer to absorb mobile GPS jitter for staff genuinely inside the
// building. Field testing showed a 5m buffer was rejecting users standing
// inside (~5-10m typical fix error indoors), so bumped to 8m. Anything
// noticeably larger starts re-opening the across-the-street false positive,
// since the nearest road kerb is ~10-15m from the building footprint.
const WALL_BUFFER_METERS = 8;

// Ray-casting: cast a horizontal ray east from the point and count crossings.
function pointInPolygon(lat: number, lng: number, poly: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i] as LatLng;
    const [yj, xj] = poly[j] as LatLng;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distance in metres from (lat,lng) to the closest point on segment AB.
// Uses an equirectangular projection — accurate over the ~tens-of-metres
// scale of a single building.
function distanceToSegmentMeters(
  lat: number, lng: number,
  latA: number, lngA: number,
  latB: number, lngB: number,
): number {
  const R = 6371000;
  const cosLat = Math.cos(((latA + latB) / 2) * Math.PI / 180);
  const x = (lng - lngA) * cosLat;
  const y = lat - latA;
  const dx = (lngB - lngA) * cosLat;
  const dy = latB - latA;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = dx * t - x;
  const py = dy * t - y;
  return Math.sqrt(px * px + py * py) * (Math.PI / 180) * R;
}

function distanceToPolygonMeters(lat: number, lng: number, poly: readonly LatLng[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as LatLng;
    const b = poly[j] as LatLng;
    const d = distanceToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

function insideAnyPolygon(lat: number, lng: number): boolean {
  for (const poly of OHCS_POLYGONS) {
    if (pointInPolygon(lat, lng, poly)) return true;
  }
  return false;
}

function distanceToNearestPolygonMeters(lat: number, lng: number): number {
  let min = Infinity;
  for (const poly of OHCS_POLYGONS) {
    const d = distanceToPolygonMeters(lat, lng, poly);
    if (d < min) min = d;
  }
  return min;
}

// Great-circle distance in metres between two lat/lng points (haversine) —
// used by the impossible-travel risk factor over previous-event distances.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- Clock-in re-auth + liveness prompt ----
// A randomised liveness challenge (one of 4 actions) is issued at the start
// of every clock-in. Stored single-use in KV, bound to the userId so a
// session swap cannot replay another user's prompt.

interface ClockPrompt {
  userId: string;
  expiresAt: number;            // unix ms
  challengeAction: LivenessChallenge;
}

function chooseChallenge(): LivenessChallenge {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return ALL_CHALLENGES[arr[0]! % ALL_CHALLENGES.length]!;
}

function promptKey(promptId: string): string {
  return `clock-prompt:${promptId}`;
}

// Clock in or out
const clockSchema = z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
  // Re-auth + liveness (optional in soft-rollout; required when
  // app_settings.clockin_reauth_enforce = 1).
  prompt_id: z.string().uuid().optional(),
  webauthn_assertion: z.unknown().optional(),
  pin: z.string().min(4).max(10).optional(),
  // Presence QR (optional; validated when app_settings.presence_qr_mode > 0).
  presence_token: z.string().uuid().optional(),
  presence_override_pin: z.string().min(4).max(12).optional(),
  // Persistent client device id (IndexedDB-stored UUID; hashed server-side, no PII).
  device_id: z.string().uuid().optional(),
  captured_at: z.string().max(40).optional(), // client clock, untrusted — log/diagnostics only
});

clockRoutes.post('/prompt', async (c) => {
  const session = c.get('session');
  const settings = await getAppSettings(c.env);
  const ttl = Math.max(30, Math.min(300, settings.clockin_prompt_ttl_seconds));

  const promptId = crypto.randomUUID();
  const challengeAction = chooseChallenge();
  const expiresAt = Date.now() + ttl * 1000;

  const data: ClockPrompt = { userId: session.userId, expiresAt, challengeAction };
  await c.env.KV.put(promptKey(promptId), JSON.stringify(data), { expirationTtl: ttl });

  devLog(c.env, `[CLOCK_PROMPT] issued ${promptId} challenge=${challengeAction} ttl=${ttl}s user=${session.userId}`);
  return success(c, { prompt_id: promptId, challenge_action: challengeAction, expires_at: expiresAt });
});

clockRoutes.post('/', async (c) => {
  const session = c.get('session');
  const contentType = c.req.header('content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');

  let body: z.infer<typeof clockSchema>;
  let frames: ArrayBuffer[] | null = null;

  if (isMultipart) {
    const form = await c.req.formData();
    const payloadStr = form.get('payload');
    if (typeof payloadStr !== 'string') {
      return error(c, 'BAD_PAYLOAD', 'payload field missing', 400);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(payloadStr); } catch { return error(c, 'BAD_PAYLOAD', 'payload is not JSON', 400); }
    const result = clockSchema.safeParse(parsed);
    if (!result.success) return error(c, 'BAD_PAYLOAD', result.error.message, 400);
    body = result.data;

    const f0 = form.get('frame_0');
    const f1 = form.get('frame_1');
    const f2 = form.get('frame_2');
    if (!(f0 instanceof Blob) || !(f1 instanceof Blob) || !(f2 instanceof Blob)) {
      return error(c, 'MISSING_FRAMES', 'Three frames are required for liveness verification', 400);
    }
    const TOTAL_LIMIT = 600_000;
    const total = f0.size + f1.size + f2.size;
    if (total > TOTAL_LIMIT) return error(c, 'BURST_TOO_LARGE', 'Liveness burst exceeds size limit', 413);
    frames = [await f0.arrayBuffer(), await f1.arrayBuffer(), await f2.arrayBuffer()];
  } else {
    let parsed: unknown;
    try { parsed = await c.req.json(); } catch { return error(c, 'BAD_JSON', 'Invalid JSON body', 400); }
    const result = clockSchema.safeParse(parsed);
    if (!result.success) return error(c, 'BAD_PAYLOAD', result.error.message, 400);
    body = result.data;
  }

  const { type, latitude, longitude, accuracy, idempotency_key } = body;
  const promptId = body.prompt_id;
  const webauthnAssertion = body.webauthn_assertion as AuthenticationResponseJSON | undefined;
  const pin = body.pin;

  // Idempotency check — return existing record immediately (before geofence re-validation)
  if (idempotency_key) {
    const existing = await c.env.DB.prepare(
      "SELECT id, type, timestamp FROM clock_records WHERE user_id = ? AND idempotency_key = ? LIMIT 1"
    ).bind(session.userId, idempotency_key).first<{ id: string; type: string; timestamp: string }>();
    if (existing) {
      return success(c, {
        id: existing.id,
        type: existing.type,
        timestamp: existing.timestamp,
        user_name: session.name,
        staff_id: '',
        within_geofence: true,
        distance_meters: 0,
        streak: 0,
        longest_streak: 0,
        deduplicated: true,
      });
    }
  }

  // ---- Prompt + re-auth gate (post-idempotency, pre-geofence) ----
  const settings = await getAppSettings(c.env);
  const enforceReauth = settings.clockin_reauth_enforce === 1;
  const enforceLiveness = settings.clockin_passive_liveness_enforce === 1;
  const devBypass = c.env.DEV_BYPASS_REAUTH === 'true';

  let challengeAction: LivenessChallenge | null = null;
  let reauthMethod: 'webauthn' | 'pin' | null = null;

  if (promptId) {
    const raw = await c.env.KV.get(promptKey(promptId));
    if (!raw) {
      return error(c, 'PROMPT_NOT_FOUND', 'Your clock-in prompt has expired or was already used. Please try again.', 410);
    }
    const stored = JSON.parse(raw) as ClockPrompt;
    if (stored.userId !== session.userId) {
      return error(c, 'PROMPT_USER_MISMATCH', 'Prompt does not belong to this user', 403);
    }
    if (stored.expiresAt < Date.now()) {
      await c.env.KV.delete(promptKey(promptId));
      return error(c, 'PROMPT_EXPIRED', 'Your clock-in prompt has expired. Please try again.', 410);
    }
    challengeAction = stored.challengeAction;
  } else if (enforceReauth) {
    return error(c, 'PROMPT_REQUIRED', 'A fresh clock-in prompt is required.', 400);
  }

  // Re-auth: try WebAuthn first; on absence/failure, fall back to PIN.
  if (webauthnAssertion && promptId) {
    if (devBypass) {
      reauthMethod = 'webauthn';
    } else {
      const outcome = await verifyClockWebAuthnAssertion(c, session.userId, promptId, webauthnAssertion);
      if (outcome.ok) {
        reauthMethod = 'webauthn';
      } else if (pin === undefined && enforceReauth) {
        return error(c, 'REAUTH_FAILED', 'Biometric verification failed. Try your PIN.', 401);
      }
    }
  }

  if (reauthMethod === null && pin !== undefined) {
    const outcome = await verifyClockPin(c.env, session.userId, pin, settings.clockin_pin_attempt_cap);
    if (outcome.ok) {
      reauthMethod = 'pin';
    } else if (outcome.reason === 'rate_limited') {
      return error(c, 'REAUTH_RATE_LIMITED', 'Too many wrong PIN attempts. Try again tomorrow.', 429);
    } else if (enforceReauth) {
      return error(c, 'REAUTH_FAILED', 'PIN verification failed.', 401);
    }
  }

  if (enforceReauth && reauthMethod === null) {
    return error(c, 'REAUTH_REQUIRED', 'Biometric or PIN verification is required to clock in.', 401);
  }

  // ---- PRESENCE QR GATE (0 = off, 1 = shadow/record-only, 2 = enforce) ----
  const presenceMode = settings.presence_qr_mode ?? 0; // ?? for pre-migration rows
  let presenceMethod: 'qr' | 'qr_pending' | 'none' | 'override' | null = null;
  let presenceWindow: 'current' | 'previous' | 'expired' | null = null;

  if (presenceMode > 0) {
    if (body.presence_token) {
      const verdict = await validatePresenceToken(c.env, body.presence_token);
      if (verdict === 'invalid') {
        // Rotated out of KV: offline replay (or a very slow submit). Evidence
        // only — classify as expired/pending, never as forgery.
        const capturedMs = body.captured_at ? Date.parse(body.captured_at) : NaN;
        const replay = Number.isFinite(capturedMs) && Date.now() - capturedMs > 3 * 60_000;
        devLog(c.env, `[PRESENCE] token miss user=${session.userId} replay=${replay}`);
        presenceWindow = 'expired';
        presenceMethod = 'qr_pending';
      } else {
        presenceWindow = verdict;
        presenceMethod = 'qr';
      }
    }
    presenceMethod ??= 'none';

    if (presenceMode === 2 && presenceMethod === 'none') {
      // Reception override escape valve (per-officer PINs first, shared PIN
      // fallback — same resolveOverride the kiosk uses). Per-user cap bounds
      // PIN brute-force from an authenticated session.
      if (body.presence_override_pin) {
        const rl = await rateLimit(c.env, `presence-override:${session.userId}`, 10, 300);
        if (!rl.allowed) {
          c.header('Retry-After', String(rl.retryAfter));
          return error(c, 'RATE_LIMITED', 'Too many override attempts. Try again shortly.', 429);
        }
        const override = await resolveOverride(c.env, body.presence_override_pin);
        if (override.ok) {
          presenceMethod = 'override';
          await recordAudit(c.env, auditActorFromContext(c), {
            action: 'clock.presence_missing', entityType: 'user', entityId: session.userId,
            summary: `Presence-QR requirement overridden by ${override.label}`,
          });
        }
      }
      if (presenceMethod === 'none') {
        return error(c, 'PRESENCE_REQUIRED',
          'Please scan the QR code on the reception display to clock in. If it is unavailable, ask reception for the override PIN.', 400);
      }
    }
    // mode 2 + qr_pending: insert proceeds, flagged for HR review (manual-review
    // escape valve). Never silent-accept as 'qr', never reject a replay.
  }

  // ---- LIVENESS GATE ----
  let livenessSignature: LivenessSignature | null = null;
  let livenessDecision: LivenessSignature['decision'] | null = null;
  let canonicalFrame: ArrayBuffer | null = null;
  // When true, defer verifyLivenessBurst to a waitUntil background task so the
  // user-visible response doesn't pay Workers AI cold-start latency. Only
  // safe in shadow mode — enforce mode must gate the response on the result.
  let deferLivenessVerification = false;

  if (frames && challengeAction) {
    if (enforceLiveness) {
      const verification = await verifyLivenessBurst({
        ai: c.env.AI,
        frames,
        challenge: challengeAction,
        modelVersion: settings.clockin_liveness_model_version,
      });
      livenessSignature = verification.signature;
      livenessDecision = verification.decision;
      canonicalFrame = verification.canonicalFrame;

      if (verification.decision === 'fail') {
        return error(c, 'LIVENESS_FAILED', 'Liveness check failed. Please try again or submit for HR review.', 401);
      }
    } else {
      // Shadow mode: insert with NULL liveness fields, run verification +
      // R2 write in the background after the response goes out.
      deferLivenessVerification = true;
    }
  } else if (enforceLiveness) {
    livenessDecision = 'manual_review';
    livenessSignature = {
      v: 1,
      challenge_action: challengeAction ?? 'blink',
      challenge_completed: false,
      motion_delta: 0,
      face_score: 0,
      sharpness: 0,
      decision: 'manual_review',
      model_version: settings.clockin_liveness_model_version,
      screen_artifact_score: null,
      ms_total: 0,
    };
  }

  // Manual-review cap — check BEFORE geofence (matches plan flow)
  if (livenessDecision === 'manual_review') {
    const used = await getReviewCount(c.env.KV, session.userId);
    if (used >= settings.clockin_liveness_review_cap_per_week) {
      return error(c, 'LIVENESS_REVIEW_CAP', "You have reached this week's manual-review limit. Please contact HR.", 429);
    }
    await incrementReviewCount(c.env.KV, session.userId);
  }

  // Reject clock-in if GPS is too imprecise to make a reliable call.
  if (accuracy !== undefined && accuracy > MAX_GPS_ACCURACY_METERS) {
    return error(
      c,
      'GPS_TOO_IMPRECISE',
      `GPS accuracy is too poor (±${Math.round(accuracy)}m). Move somewhere with clearer sky and try again.`,
      400,
    );
  }

  // Check geofence — inside any OHCS polygon, within the static wall buffer,
  // or within an accuracy-aware buffer that absorbs indoor GPS jitter
  // (5-15m typical on mobile inside concrete buildings). The static
  // WALL_BUFFER_METERS handles clean fixes; the accuracy-aware portion
  // accepts noisier fixes proportional to the device's reported uncertainty.
  // Capped by MAX_GPS_ACCURACY_METERS so a spoofed accuracy can't open the
  // door arbitrarily wide.
  const inside = insideAnyPolygon(latitude, longitude);
  const distance = inside ? 0 : distanceToNearestPolygonMeters(latitude, longitude);
  const acc = accuracy && accuracy > 0 ? accuracy : 0;
  const accuracyBuffer = acc > 0 ? acc * 0.5 : 0;
  const effectiveBuffer = WALL_BUFFER_METERS + accuracyBuffer;
  const withinGeofence = inside || distance <= effectiveBuffer;
  devLog(c.env, `[CLOCK_GEO] inside=${inside} dist=${Math.round(distance)}m acc=${Math.round(acc)}m buffer=${Math.round(effectiveBuffer)}m -> ${withinGeofence ? 'IN' : 'OUT'}`);

  if (!withinGeofence) {
    const accStr = acc > 0 ? ` (GPS accuracy ±${Math.round(acc)}m)` : '';
    return error(
      c,
      'OUTSIDE_GEOFENCE',
      `You are ${Math.round(distance)}m outside the OHCS building${accStr}. You must be inside the building to clock ${type === 'clock_in' ? 'in' : 'out'}.`,
      400,
    );
  }

  // Check if already clocked in/out today
  const today = new Date().toISOString().slice(0, 10);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM clock_records WHERE user_id = ? AND type = ? AND DATE(timestamp) = ?`
  ).bind(session.userId, type, today).first();

  if (existing) {
    return error(c, 'ALREADY_CLOCKED', `You have already clocked ${type === 'clock_in' ? 'in' : 'out'} today.`, 400);
  }

  // If clocking out, must have clocked in first
  if (type === 'clock_out') {
    const clockedIn = await c.env.DB.prepare(
      `SELECT id FROM clock_records WHERE user_id = ? AND type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(session.userId, today).first();
    if (!clockedIn) {
      return error(c, 'NOT_CLOCKED_IN', 'You must clock in before clocking out.', 400);
    }
  }

  // ---- RISK FUSION (0 = off, 1 = shadow/persist+log, 2 = enforce bands) ----
  // Scored after re-auth/liveness verdicts and geofence math exist, before the
  // INSERT so a block can still prevent it. Mode 0 short-circuits before any
  // extra query. Spec: docs/superpowers/specs/2026-07-19-attendance-risk-fusion-design.md
  let riskInput: RiskInput | null = null;
  let riskScore: number | null = null;
  let riskFactors: RiskFactor[] | null = null;

  if (settings.risk_fusion_mode > 0) {
    // Device novelty — KV set of sha256(device_id) hashes per user, no PII.
    // Read-modify-write race is benign (worst case: novelty double-fires, +10).
    let deviceFirstSeen = false;
    if (body.device_id) {
      const hash = await sha256Hex(body.device_id);
      const key = `device:${session.userId}`;
      const set: string[] = JSON.parse((await c.env.KV.get(key)) ?? '[]');
      if (!set.includes(hash)) {
        deviceFirstSeen = true;
        set.push(hash);
        await c.env.KV.put(key, JSON.stringify(set.slice(-20)), { expirationTtl: 180 * 86400 }); // sliding, self-cleaning
      }
    }

    // Impossible travel — previous clock event for this user.
    const prev = await c.env.DB.prepare(
      'SELECT latitude, longitude, timestamp FROM clock_records WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).bind(session.userId).first<{ latitude: number | null; longitude: number | null; timestamp: string }>();

    riskInput = {
      faceMatchStatus: null, // face-match not shipped (2026-04-29 spec); wire match_status here when it lands
      livenessDecision,      // null in liveness-shadow mode — recomputed in the waitUntil below
      reauthMethod,
      geofence: {
        inside,
        edgeMarginMeters: inside ? distanceToNearestPolygonMeters(latitude, longitude) : null,
        outsideDistanceMeters: distance,
        wallBufferMeters: WALL_BUFFER_METERS,
      },
      gpsAccuracyMeters: accuracy,
      // Presence-QR wiring point (plan cross-dependency): consume the gate's
      // verdict when presence is live; 'not_deployed' otherwise. Weights stay
      // inert (all 0) until the intended -15/+10/+20 values are switched on.
      presence: presenceMode > 0
        ? (presenceMethod === 'qr' ? 'valid' : presenceMethod === 'override' ? 'override' : 'none_or_pending')
        : 'not_deployed',
      previousEvent: prev?.latitude != null && prev?.longitude != null
        ? { distanceMeters: haversineMeters(prev.latitude, prev.longitude, latitude, longitude),
            minutesAgo: (Date.now() - new Date(prev.timestamp).getTime()) / 60000 }
        : null,
      deviceFirstSeen,
    };
    const r = computeRiskScore(riskInput);
    riskScore = r.score;
    riskFactors = r.factors;

    // Band enforcement — enforce mode only; shadow (1) never reaches this.
    // With liveness in shadow mode the verdict is still pending here, so
    // isBlockable is false and no block can fire — intended proportionality.
    if (settings.risk_fusion_mode === 2 && riskScore >= BLOCK_THRESHOLD) {
      const stepUpClean = livenessDecision === 'pass' && reauthMethod === 'webauthn'; // PIN fallback not accepted
      if (!stepUpClean) {
        if (settings.risk_fusion_block_enabled === 1 && isBlockable(riskFactors)) {
          await recordAudit(c.env, auditActorFromContext(c), {
            action: 'clock.risk_block', entityType: 'user', entityId: session.userId,
            summary: `Clock ${type} blocked: risk ${riskScore} (${riskFactors.map((f) => `${f.name}:${f.condition}`).join(', ')})`,
          });
          return error(c, 'RISK_BLOCK', 'This clock-in needs verification. Please see reception to complete it.', 422);
        }
        // Guardrail or flags-only stage: allow, flag, and let the High-risk filter route it to review.
        devLog(c.env, `[CLOCK_RISK] high score ${riskScore} allowed (guardrail/flags-only) user=${session.userId}`);
      }
    }
  }

  const id = crypto.randomUUID().replace(/-/g, '');

  try {
    await c.env.DB.prepare(
      `INSERT INTO clock_records
        (id, user_id, type, latitude, longitude, within_geofence, idempotency_key,
         reauth_method, liveness_challenge, liveness_decision, liveness_signature,
         presence_method, presence_token_window, risk_score, risk_factors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      session.userId,
      type,
      latitude,
      longitude,
      withinGeofence ? 1 : 0,
      idempotency_key ?? null,
      reauthMethod,
      challengeAction,
      livenessDecision,
      livenessSignature ? JSON.stringify(livenessSignature) : null,
      presenceMethod,
      presenceWindow,
      riskScore,
      riskFactors ? JSON.stringify(riskFactors) : null,
    ).run();
  } catch (e) {
    // Idempotency-key race: a concurrent clock request with the same
    // (user_id, idempotency_key) won the insert. Re-read and return the
    // existing record instead of surfacing a 500 — same shape as the
    // dedup-hit path above.
    const msg = e instanceof Error ? e.message : String(e);
    if (idempotency_key && /UNIQUE/i.test(msg) && /idempotency_key/i.test(msg)) {
      const existing = await c.env.DB.prepare(
        "SELECT id, type, timestamp FROM clock_records WHERE user_id = ? AND idempotency_key = ? LIMIT 1"
      ).bind(session.userId, idempotency_key).first<{ id: string; type: string; timestamp: string }>();
      if (existing) {
        return success(c, {
          id: existing.id,
          type: existing.type,
          timestamp: existing.timestamp,
          user_name: session.name,
          staff_id: '',
          within_geofence: true,
          distance_meters: 0,
          streak: 0,
          longest_streak: 0,
          deduplicated: true,
        });
      }
    }
    throw e;
  }

  // Shadow-mode calibration log (dev/staging only — the persisted columns are
  // the production calibration dataset).
  if (riskScore !== null && riskFactors !== null) {
    devLog(c.env, `[CLOCK_RISK] ${id} score=${riskScore} band=${riskBand(riskScore)} factors=${riskFactors.map((f) => `${f.name}:${f.condition}:${f.weight > 0 ? '+' : ''}${f.weight}`).join(', ')}`);
  }

  // Write canonical frame to R2 when verification produced one. We persist for
  // both confident passes AND manual_review decisions so HR has an image to
  // adjudicate; only `skipped` (AI unavailable — frame is not a verified
  // capture) is excluded.
  if (canonicalFrame && livenessDecision && livenessDecision !== 'skipped') {
    const r2Key = `photos/clock/${id}.jpg`;
    await c.env.STORAGE.put(r2Key, canonicalFrame, { httpMetadata: { contentType: 'image/jpeg' } });
    await c.env.DB.prepare('UPDATE clock_records SET photo_url = ? WHERE id = ?')
      .bind(`/api/photos/clock/${id}`, id).run();
  }

  // Shadow-mode: kick off liveness verification in the background. The row was
  // already inserted with NULL liveness fields; this closure UPDATEs them once
  // the (slow) AI work finishes. Saves ~3-7s of user-visible latency per
  // clock-in by not blocking the response on Workers AI cold-start.
  if (deferLivenessVerification && frames && challengeAction) {
    const challenge = challengeAction;
    const capturedFrames = frames;
    const modelVersion = settings.clockin_liveness_model_version;
    // Captured for the deferred risk recompute (null when risk_fusion_mode = 0).
    const capturedRiskInput = riskInput;
    c.executionCtx.waitUntil((async () => {
      try {
        const verification = await verifyLivenessBurst({
          ai: c.env.AI,
          frames: capturedFrames,
          challenge,
          modelVersion,
        });
        await c.env.DB.prepare(
          'UPDATE clock_records SET liveness_decision = ?, liveness_signature = ? WHERE id = ?'
        ).bind(
          verification.decision,
          JSON.stringify(verification.signature),
          id,
        ).run();
        // Risk recompute: the row was scored with a pending (null) liveness
        // verdict; fold the real verdict in now. Bands are NOT re-enforced in
        // the background — a late verdict moves the row into/out of review,
        // never blocks after the fact.
        if (capturedRiskInput) {
          const rescored = computeRiskScore({ ...capturedRiskInput, livenessDecision: verification.decision });
          await c.env.DB.prepare(
            'UPDATE clock_records SET risk_score = ?, risk_factors = ? WHERE id = ?'
          ).bind(rescored.score, JSON.stringify(rescored.factors), id).run();
        }
        // Persist the canonical frame for passes AND manual_review (HR needs an
        // image to adjudicate review cases); only skip when AI was unavailable.
        if (verification.decision !== 'skipped') {
          const r2Key = `photos/clock/${id}.jpg`;
          await c.env.STORAGE.put(r2Key, verification.canonicalFrame, {
            httpMetadata: { contentType: 'image/jpeg' },
          });
          await c.env.DB.prepare('UPDATE clock_records SET photo_url = ? WHERE id = ?')
            .bind(`/api/photos/clock/${id}`, id).run();
        }
        devLog(c.env, `[CLOCK_LIVENESS_BG] ${id} decision=${verification.decision} ms=${verification.signature.ms_total}`);
      } catch (e) {
        devLog(c.env, `[CLOCK_LIVENESS_BG] ${id} background verification threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    })());
  }

  // Consume the prompt — single-use enforced by KV.delete after a successful insert.
  if (promptId) {
    await c.env.KV.delete(promptKey(promptId));
  }

  // Update streak on clock-in
  if (type === 'clock_in') {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayRecord = await c.env.DB.prepare(
      `SELECT id FROM clock_records WHERE user_id = ? AND type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(session.userId, yesterday).first();

    if (yesterdayRecord) {
      // Consecutive day — increment streak
      await c.env.DB.prepare(
        `UPDATE users SET current_streak = current_streak + 1,
         longest_streak = MAX(longest_streak, current_streak + 1) WHERE id = ?`
      ).bind(session.userId).run();
    } else {
      // Streak broken — reset to 1
      await c.env.DB.prepare(
        `UPDATE users SET current_streak = 1,
         longest_streak = MAX(longest_streak, 1) WHERE id = ?`
      ).bind(session.userId).run();
    }
  }

  // Late-clock alert: fires for clock_in past the configured late threshold (Ghana time = UTC+0).
  if (type === 'clock_in') {
    const thresholdMin = hhmmToMinutes(settings.late_threshold_time);
    const now = new Date();
    const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minOfDay > thresholdMin) {
      c.executionCtx.waitUntil(sendLateClockAlert(c.env, session.userId, now.toISOString()));
    }
  }

  // Get updated user for response
  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(session.userId).first<{ name: string; staff_id: string; current_streak: number; longest_streak: number }>();

  devLog(c.env, `[CLOCK] ${user?.name} (${user?.staff_id}) — ${type} liveness=${livenessDecision ?? 'none'} reauth=${reauthMethod ?? 'none'} presence=${presenceMethod ?? 'off'}`);

  return success(c, {
    id,
    type,
    timestamp: new Date().toISOString(),
    user_name: user?.name ?? session.name,
    staff_id: user?.staff_id ?? '',
    within_geofence: withinGeofence,
    distance_meters: Math.round(distance),
    streak: user?.current_streak ?? 0,
    longest_streak: user?.longest_streak ?? 0,
    liveness_decision: livenessDecision,
  });
});

// Upload clock photo
clockRoutes.post('/:id/photo', async (c) => {
  const session = c.get('session');
  const clockId = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT id FROM clock_records WHERE id = ? AND user_id = ?'
  ).bind(clockId, session.userId).first();
  if (!record) return error(c, 'NOT_FOUND', 'Clock record not found', 404);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY', 'No photo', 400);
  if (body.byteLength > 500_000) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(body))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);

  const key = `photos/clock/${clockId}.jpg`;
  await c.env.STORAGE.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });

  const photoUrl = `/api/photos/clock/${clockId}`;
  await c.env.DB.prepare('UPDATE clock_records SET photo_url = ? WHERE id = ?').bind(photoUrl, clockId).run();

  return success(c, { photo_url: photoUrl });
});

// Get my status today
clockRoutes.get('/my-status', async (c) => {
  const session = c.get('session');
  const today = new Date().toISOString().slice(0, 10);

  const records = await c.env.DB.prepare(
    `SELECT type, timestamp FROM clock_records WHERE user_id = ? AND DATE(timestamp) = ? ORDER BY timestamp`
  ).bind(session.userId, today).all();

  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(session.userId).first<{ name: string; staff_id: string; current_streak: number; longest_streak: number }>();

  const clockIn = (records.results ?? []).find((r: Record<string, unknown>) => r.type === 'clock_in');
  const clockOut = (records.results ?? []).find((r: Record<string, unknown>) => r.type === 'clock_out');

  return success(c, {
    user_name: user?.name ?? '',
    staff_id: user?.staff_id ?? '',
    clocked_in: !!clockIn,
    clocked_out: !!clockOut,
    clock_in_time: clockIn ? (clockIn as Record<string, unknown>).timestamp : null,
    clock_out_time: clockOut ? (clockOut as Record<string, unknown>).timestamp : null,
    streak: user?.current_streak ?? 0,
    longest_streak: user?.longest_streak ?? 0,
  });
});

// ---- Admin helpers ----
function requireAdmin(c: { get: (key: 'session') => SessionData }) {
  const role = c.get('session').role;
  return role === 'superadmin' || role === 'admin';
}

function requireSuperadmin(c: { get: (key: 'session') => SessionData }) {
  return c.get('session').role === 'superadmin';
}

// TEMPORARY TEST TOOLING — remove after pilot stabilises.
// Lets a superadmin clear a user's clock_records for a given date so a test
// cycle can be re-run without DB shell access. Audit: every invocation is
// logged via [CLOCK_TEST_CLEAR] with the calling superadmin, target user,
// date, and rows-deleted count.
clockRoutes.post('/admin/clear-test-records', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);

  const body = await c.req.json().catch(() => null) as { user_id?: unknown; date?: unknown } | null;
  if (!body || typeof body.user_id !== 'string' || body.user_id.length < 1 || body.user_id.length > 100) {
    return error(c, 'BAD_PAYLOAD', 'user_id is required', 400);
  }
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : new Date().toISOString().slice(0, 10);

  const result = await c.env.DB.prepare(
    'DELETE FROM clock_records WHERE user_id = ? AND DATE(timestamp) = ?'
  ).bind(body.user_id, date).run();

  const deleted = result.meta?.changes ?? 0;
  const session = c.get('session');
  devLog(c.env, `[CLOCK_TEST_CLEAR] superadmin=${session.userId} cleared=${deleted} target_user=${body.user_id} date=${date}`);
  // Durable, tamper-evident record of this destructive test-tooling action.
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'clock.test_records_cleared', entityType: 'user', entityId: body.user_id,
    summary: `Cleared ${deleted} clock record(s) for user ${body.user_id} on ${date} (test tooling)`,
  });

  return success(c, { deleted, user_id: body.user_id, date });
});

// Admin: aggregate liveness metrics for the last `days` (default 7, max 30).
clockRoutes.get('/admin/liveness-metrics', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const days = Math.min(30, Math.max(1, Number(c.req.query('days') ?? 7)));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const rows = await c.env.DB.prepare(
    `SELECT liveness_decision, liveness_challenge, liveness_signature
     FROM clock_records
     WHERE timestamp >= ? AND liveness_decision IS NOT NULL`
  ).bind(since).all<{ liveness_decision: string; liveness_challenge: string | null; liveness_signature: string | null }>();

  const all = rows.results ?? [];
  const total = all.length;
  const passes = all.filter((r) => r.liveness_decision === 'pass').length;
  const reviews = all.filter((r) => r.liveness_decision === 'manual_review').length;
  const skipped = all.filter((r) => r.liveness_decision === 'skipped').length;

  const perChallenge: Record<string, { total: number; pass: number }> = {};
  const msSamples: number[] = [];

  for (const r of all) {
    if (r.liveness_challenge) {
      const slot = perChallenge[r.liveness_challenge] ?? { total: 0, pass: 0 };
      slot.total += 1;
      if (r.liveness_decision === 'pass') slot.pass += 1;
      perChallenge[r.liveness_challenge] = slot;
    }
    if (r.liveness_signature) {
      try {
        const sig = JSON.parse(r.liveness_signature) as { ms_total?: number };
        if (typeof sig.ms_total === 'number') msSamples.push(sig.ms_total);
      } catch { /* ignore parse errors */ }
    }
  }

  msSamples.sort((a, b) => a - b);
  const median = msSamples.length ? msSamples[Math.floor(msSamples.length / 2)]! : 0;

  return success(c, {
    total,
    pass_rate: total ? passes / total : 0,
    review_rate: total ? reviews / total : 0,
    skipped_rate: total ? skipped / total : 0,
    per_challenge: perChallenge,
    median_ms: median,
    days,
  });
});

// Get my history
clockRoutes.get('/my-history', async (c) => {
  const session = c.get('session');
  const days = Number(c.req.query('days') ?? 30);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const records = await c.env.DB.prepare(
    `SELECT id, type, timestamp, within_geofence, photo_url
     FROM clock_records WHERE user_id = ? AND DATE(timestamp) >= ?
     ORDER BY timestamp DESC`
  ).bind(session.userId, from).all();

  return success(c, records.results ?? []);
});
