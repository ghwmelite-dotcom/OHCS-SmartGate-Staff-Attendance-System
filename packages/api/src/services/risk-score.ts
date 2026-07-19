// Attendance risk fusion — spec: docs/superpowers/specs/2026-07-19-attendance-risk-fusion-design.md
// Pure scoring: no I/O, no clock reads (elapsed time arrives via RiskInput). Callers
// assemble RiskInput from the signals already present at clock-submit time; each
// evaluated signal records a {name, condition, weight, detail} factor for
// explainability — absent inputs record nothing.

import type { LivenessDecision } from './liveness/types';

// Single tuning surface — ALL weights live here. Negative weights (match_strong,
// later presence valid) actively clear borderline positives. Shadow-mode data
// (risk-distribution endpoint) drives any adjustment before enforcement.
export const WEIGHTS = {
  faceMatch:   { match_strong: -20, no_reference: 15, match_weak: 25, match_fail: 50, match_error: 50 },
  liveness:    { pass: 0, manual_review: 20, fail: 50, skipped: 0 },
  reauth:      { webauthn: 0, pin: 10 },
  geofence:    { inside_deep: 0, inside_near_edge: 0, wall_buffer: 10, accuracy_buffer: 20 },
  gpsAccuracy: { good: 0, medium: 10, zero_spoof_tell: 25 },
  // INERT until presence-QR ships (2026-07-19-presence-qr-design.md). Intended: valid -15, none_or_pending +10, override +20.
  presence:    { valid: 0, none_or_pending: 0, override: 0, not_deployed: 0 },
  travel:      { impossible: 40 },
  device:      { first_seen: 10 },
} as const;

export const REVIEW_THRESHOLD = 30;   // 30–59 → review flag
export const BLOCK_THRESHOLD = 60;    // ≥60  → step-up / block (guardrail-gated)

// Verdict enum from the (not-yet-shipped) 2026-04-29 face-match spec — using it
// now makes wiring the factor later a one-line change in the clock route.
export type FaceMatchStatus = 'not_enforced' | 'no_reference' | 'match_strong' | 'match_weak' | 'match_fail' | 'match_error';
export type RiskBand = 'clear' | 'review' | 'high';

export interface RiskFactor {
  name: string;        // factor family, e.g. 'liveness'
  condition: string;   // the WEIGHTS key that fired — robust against weight retuning
  weight: number;      // signed contribution to the score
  detail: string;      // human-readable explainability (admin tooltip)
}

export interface RiskInput {
  faceMatchStatus?: FaceMatchStatus | null;   // null today — face-match not yet shipped (2026-04-29 spec)
  livenessDecision?: LivenessDecision | null; // null in liveness-shadow mode — recomputed when the verdict lands
  reauthMethod?: 'webauthn' | 'pin' | null;   // null on offline replays → no factor, no penalty
  geofence: {
    inside: boolean;
    edgeMarginMeters: number | null;      // distance to polygon edge (inside) — null if not computed
    outsideDistanceMeters: number;
    wallBufferMeters: number;             // accepted-beyond-wall-buffer ⇒ accuracy buffer
  };
  gpsAccuracyMeters?: number;             // undefined = not reported
  presence?: 'valid' | 'none_or_pending' | 'override' | 'not_deployed';
  previousEvent?: { distanceMeters: number; minutesAgo: number } | null;
  deviceFirstSeen?: boolean;
}

export function computeRiskScore(input: RiskInput): { score: number; factors: RiskFactor[] } {
  const factors: RiskFactor[] = [];

  const fm = input.faceMatchStatus;
  if (fm && fm !== 'not_enforced') {
    const detail: Record<Exclude<FaceMatchStatus, 'not_enforced'>, string> = {
      match_strong: 'strong face match',
      no_reference: 'no reference photo on file',
      match_weak: 'weak face match',
      match_fail: 'face match failed',
      match_error: 'face match error',
    };
    factors.push({ name: 'face_match', condition: fm, weight: WEIGHTS.faceMatch[fm], detail: detail[fm] });
  }

  const lv = input.livenessDecision;
  if (lv) {
    // 'skipped' keeps weight 0 with an infra detail — an AI outage is never
    // punitive (same discipline as the kiosk id-check).
    const detail: Record<LivenessDecision, string> = {
      pass: 'liveness passed',
      manual_review: 'liveness submitted for manual review',
      fail: 'liveness failed',
      skipped: 'ai_unavailable',
    };
    factors.push({ name: 'liveness', condition: lv, weight: WEIGHTS.liveness[lv], detail: detail[lv] });
  }

  const reauth = input.reauthMethod;
  if (reauth) {
    factors.push({
      name: 'reauth_method',
      condition: reauth,
      weight: WEIGHTS.reauth[reauth],
      detail: reauth === 'pin' ? 'PIN fallback re-auth' : 'WebAuthn re-auth',
    });
  }

  const g = input.geofence;
  if (!g.inside && g.outsideDistanceMeters > g.wallBufferMeters) {
    factors.push({
      name: 'geofence_margin', condition: 'accuracy_buffer', weight: WEIGHTS.geofence.accuracy_buffer,
      detail: 'outside polygon, accepted via accuracy buffer',
    });
  } else if (!g.inside) {
    factors.push({
      name: 'geofence_margin', condition: 'wall_buffer', weight: WEIGHTS.geofence.wall_buffer,
      detail: 'outside polygon, within wall buffer',
    });
  } else {
    // Inside the polygon. Spec-gap: the spec table weights only three of the
    // four conditions — inside-near-edge is unlisted, so it scores 0 with the
    // condition recorded; calibration may assign a weight from evidence.
    // A null margin (not computed) reads as inside_deep: both weigh 0 and we
    // can't claim proximity we didn't measure.
    const nearEdge = g.edgeMarginMeters !== null && g.edgeMarginMeters <= 25;
    factors.push({
      name: 'geofence_margin',
      condition: nearEdge ? 'inside_near_edge' : 'inside_deep',
      weight: nearEdge ? WEIGHTS.geofence.inside_near_edge : WEIGHTS.geofence.inside_deep,
      detail: nearEdge ? 'within 25m of polygon edge' : '>25m inside polygon edge',
    });
  }

  const acc = input.gpsAccuracyMeters;
  if (acc !== undefined) {
    // >30m never reaches scoring in practice — rejected upstream by
    // MAX_GPS_ACCURACY_METERS — but the function stays total: it reads as medium.
    if (acc === 0) {
      factors.push({
        name: 'gps_accuracy', condition: 'zero_spoof_tell', weight: WEIGHTS.gpsAccuracy.zero_spoof_tell,
        detail: 'reported 0.0m GPS accuracy (spoofer tell)',
      });
    } else if (acc <= 15) {
      factors.push({
        name: 'gps_accuracy', condition: 'good', weight: WEIGHTS.gpsAccuracy.good,
        detail: 'GPS accuracy within 15m',
      });
    } else {
      factors.push({
        name: 'gps_accuracy', condition: 'medium', weight: WEIGHTS.gpsAccuracy.medium,
        detail: 'GPS accuracy 15-30m',
      });
    }
  }

  if (input.presence) {
    // Inert (all weights 0) until presence-QR ships — the condition is recorded
    // so shadow data shows what the factor WOULD have contributed.
    const detail: Record<NonNullable<RiskInput['presence']>, string> = {
      valid: 'valid presence token',
      none_or_pending: 'no valid presence token',
      override: 'reception presence override',
      not_deployed: 'presence QR not deployed',
    };
    factors.push({
      name: 'presence',
      condition: input.presence,
      weight: WEIGHTS.presence[input.presence],
      detail: detail[input.presence],
    });
  }

  const prev = input.previousEvent;
  if (prev && prev.distanceMeters > 500 && prev.minutesAgo < 10) {
    factors.push({
      name: 'travel_plausibility',
      condition: 'impossible',
      weight: WEIGHTS.travel.impossible,
      detail: `${Math.round(prev.distanceMeters)}m from previous clock event ${prev.minutesAgo.toFixed(1)}min ago`,
    });
  }

  if (input.deviceFirstSeen) {
    factors.push({
      name: 'device_novelty',
      condition: 'first_seen',
      weight: WEIGHTS.device.first_seen,
      detail: 'first clock from this device',
    });
  }

  const raw = factors.reduce((sum, f) => sum + f.weight, 0);
  return { score: Math.max(0, Math.min(100, raw)), factors };
}

export function riskBand(score: number): RiskBand {
  if (score >= BLOCK_THRESHOLD) return 'high';
  if (score >= REVIEW_THRESHOLD) return 'review';
  return 'clear';
}

/** Proportionality guardrail: weak-but-innocent signals alone can never block. */
export function isBlockable(factors: RiskFactor[]): boolean {
  return factors.some(f =>
    (f.name === 'liveness' && f.condition === 'fail') ||
    (f.name === 'face_match' && f.condition === 'match_fail'));
}
