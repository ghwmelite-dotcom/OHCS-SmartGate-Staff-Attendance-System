import { describe, it, expect } from 'vitest';
import {
  computeRiskScore, riskBand, isBlockable,
  WEIGHTS, REVIEW_THRESHOLD, BLOCK_THRESHOLD,
  type RiskInput, type RiskFactor,
} from './risk-score';

// Baseline geofence: comfortably inside → a single weight-0 inside_deep factor.
const INSIDE_DEEP: RiskInput['geofence'] = {
  inside: true, edgeMarginMeters: 100, outsideDistanceMeters: 0, wallBufferMeters: 8,
};

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return { geofence: INSIDE_DEEP, ...overrides };
}

function factor(factors: RiskFactor[], name: string): RiskFactor | undefined {
  return factors.find((f) => f.name === name);
}

describe('computeRiskScore — face_match', () => {
  it('scores every shipped condition per WEIGHTS', () => {
    const expected: Array<[NonNullable<RiskInput['faceMatchStatus']>, number]> = [
      ['match_strong', -20],
      ['no_reference', 15],
      ['match_weak', 25],
      ['match_fail', 50],
      ['match_error', 50],
    ];
    for (const [status, weight] of expected) {
      const { factors } = computeRiskScore(input({ faceMatchStatus: status }));
      const f = factor(factors, 'face_match');
      expect(f, status).toMatchObject({ condition: status, weight });
      expect(f!.detail.length).toBeGreaterThan(0);
    }
  });

  it('match_strong actively clears a borderline positive (negative weight)', () => {
    const { score } = computeRiskScore(input({
      faceMatchStatus: 'match_strong',
      reauthMethod: 'pin',
      gpsAccuracyMeters: 20,
    }));
    expect(score).toBe(0); // -20 + 10 + 10, floored at 0
  });

  it('records no factor for null or not_enforced', () => {
    expect(factor(computeRiskScore(input({ faceMatchStatus: null })).factors, 'face_match')).toBeUndefined();
    expect(factor(computeRiskScore(input({ faceMatchStatus: 'not_enforced' })).factors, 'face_match')).toBeUndefined();
    expect(factor(computeRiskScore(input()).factors, 'face_match')).toBeUndefined();
  });
});

describe('computeRiskScore — liveness', () => {
  it('pass 0, manual_review +20, fail +50, skipped 0 (recorded, ai_unavailable)', () => {
    const expected: Array<[NonNullable<RiskInput['livenessDecision']>, number]> = [
      ['pass', 0],
      ['manual_review', 20],
      ['fail', 50],
      ['skipped', 0],
    ];
    for (const [decision, weight] of expected) {
      const { factors } = computeRiskScore(input({ livenessDecision: decision }));
      expect(factor(factors, 'liveness'), decision).toMatchObject({ condition: decision, weight });
    }
  });

  it("skipped records detail 'ai_unavailable' (infra failure is never punitive)", () => {
    const { factors } = computeRiskScore(input({ livenessDecision: 'skipped' }));
    expect(factor(factors, 'liveness')!.detail).toBe('ai_unavailable');
  });

  it('null (shadow-deferred verdict) records nothing', () => {
    expect(factor(computeRiskScore(input({ livenessDecision: null })).factors, 'liveness')).toBeUndefined();
  });
});

describe('computeRiskScore — reauth_method', () => {
  it('webauthn 0, pin +10, null (offline replay) absent', () => {
    expect(factor(computeRiskScore(input({ reauthMethod: 'webauthn' })).factors, 'reauth_method'))
      .toMatchObject({ condition: 'webauthn', weight: 0 });
    expect(factor(computeRiskScore(input({ reauthMethod: 'pin' })).factors, 'reauth_method'))
      .toMatchObject({ condition: 'pin', weight: 10 });
    expect(factor(computeRiskScore(input({ reauthMethod: null })).factors, 'reauth_method')).toBeUndefined();
  });
});

describe('computeRiskScore — geofence_margin', () => {
  it('inside with edge margin > 25 → inside_deep 0', () => {
    const { factors } = computeRiskScore(input({
      geofence: { inside: true, edgeMarginMeters: 25.5, outsideDistanceMeters: 0, wallBufferMeters: 8 },
    }));
    expect(factor(factors, 'geofence_margin')).toMatchObject({ condition: 'inside_deep', weight: 0 });
  });

  it('inside with edge margin exactly 25 → inside_near_edge 0 (spec-gap condition, recorded)', () => {
    const { factors } = computeRiskScore(input({
      geofence: { inside: true, edgeMarginMeters: 25, outsideDistanceMeters: 0, wallBufferMeters: 8 },
    }));
    expect(factor(factors, 'geofence_margin')).toMatchObject({ condition: 'inside_near_edge', weight: 0 });
  });

  it('inside with null edge margin (not computed) → inside_deep 0', () => {
    const { factors } = computeRiskScore(input({
      geofence: { inside: true, edgeMarginMeters: null, outsideDistanceMeters: 0, wallBufferMeters: 8 },
    }));
    expect(factor(factors, 'geofence_margin')).toMatchObject({ condition: 'inside_deep', weight: 0 });
  });

  it('outside at exactly the wall buffer → wall_buffer +10', () => {
    const { factors } = computeRiskScore(input({
      geofence: { inside: false, edgeMarginMeters: null, outsideDistanceMeters: 8, wallBufferMeters: 8 },
    }));
    expect(factor(factors, 'geofence_margin')).toMatchObject({ condition: 'wall_buffer', weight: 10 });
  });

  it('outside beyond the wall buffer → accuracy_buffer +20', () => {
    const { factors } = computeRiskScore(input({
      geofence: { inside: false, edgeMarginMeters: null, outsideDistanceMeters: 8.1, wallBufferMeters: 8 },
    }));
    expect(factor(factors, 'geofence_margin')).toMatchObject({ condition: 'accuracy_buffer', weight: 20 });
  });
});

describe('computeRiskScore — gps_accuracy', () => {
  it('15m → good 0; 16m → medium +10; 30m → medium +10; 0.0m → zero_spoof_tell +25', () => {
    expect(factor(computeRiskScore(input({ gpsAccuracyMeters: 15 })).factors, 'gps_accuracy'))
      .toMatchObject({ condition: 'good', weight: 0 });
    expect(factor(computeRiskScore(input({ gpsAccuracyMeters: 16 })).factors, 'gps_accuracy'))
      .toMatchObject({ condition: 'medium', weight: 10 });
    expect(factor(computeRiskScore(input({ gpsAccuracyMeters: 30 })).factors, 'gps_accuracy'))
      .toMatchObject({ condition: 'medium', weight: 10 });
    expect(factor(computeRiskScore(input({ gpsAccuracyMeters: 0 })).factors, 'gps_accuracy'))
      .toMatchObject({ condition: 'zero_spoof_tell', weight: 25 });
  });

  it('undefined (not reported) records nothing', () => {
    expect(factor(computeRiskScore(input()).factors, 'gps_accuracy')).toBeUndefined();
  });
});

describe('computeRiskScore — presence (inert until presence-QR ships)', () => {
  it('every condition records a factor at weight 0 (locks the inert contract)', () => {
    const conditions: Array<NonNullable<RiskInput['presence']>> = ['valid', 'none_or_pending', 'override', 'not_deployed'];
    for (const condition of conditions) {
      const { score, factors } = computeRiskScore(input({ presence: condition }));
      expect(factor(factors, 'presence'), condition).toMatchObject({ condition, weight: 0 });
      expect(score, condition).toBe(0);
    }
    // The whole presence-side "launch" is flipping these to the spec's -15/+10/+20.
    expect(WEIGHTS.presence).toEqual({ valid: 0, none_or_pending: 0, override: 0, not_deployed: 0 });
  });

  it('absent input records nothing', () => {
    expect(factor(computeRiskScore(input()).factors, 'presence')).toBeUndefined();
  });
});

describe('computeRiskScore — travel_plausibility', () => {
  it('600m in 5min → impossible +40', () => {
    const { factors } = computeRiskScore(input({ previousEvent: { distanceMeters: 600, minutesAgo: 5 } }));
    expect(factor(factors, 'travel_plausibility')).toMatchObject({ condition: 'impossible', weight: 40 });
  });

  it('600m in exactly 10min → none (not <10min)', () => {
    expect(factor(computeRiskScore(input({ previousEvent: { distanceMeters: 600, minutesAgo: 10 } })).factors, 'travel_plausibility'))
      .toBeUndefined();
  });

  it('400m in 5min → none (not >500m)', () => {
    expect(factor(computeRiskScore(input({ previousEvent: { distanceMeters: 400, minutesAgo: 5 } })).factors, 'travel_plausibility'))
      .toBeUndefined();
  });

  it('no previous event → none', () => {
    expect(factor(computeRiskScore(input({ previousEvent: null })).factors, 'travel_plausibility')).toBeUndefined();
    expect(factor(computeRiskScore(input()).factors, 'travel_plausibility')).toBeUndefined();
  });
});

describe('computeRiskScore — device_novelty', () => {
  it('first-seen device +10; known/absent → none', () => {
    expect(factor(computeRiskScore(input({ deviceFirstSeen: true })).factors, 'device_novelty'))
      .toMatchObject({ condition: 'first_seen', weight: 10 });
    expect(factor(computeRiskScore(input({ deviceFirstSeen: false })).factors, 'device_novelty')).toBeUndefined();
    expect(factor(computeRiskScore(input()).factors, 'device_novelty')).toBeUndefined();
  });
});

describe('computeRiskScore — clamp to [0, 100]', () => {
  it('stacked positives clamp to exactly 100', () => {
    const { score } = computeRiskScore(input({
      faceMatchStatus: 'match_fail',          // 50
      livenessDecision: 'fail',               // 50
      reauthMethod: 'pin',                    // 10
      gpsAccuracyMeters: 0,                   // 25
      previousEvent: { distanceMeters: 900, minutesAgo: 2 }, // 40
      deviceFirstSeen: true,                  // 10
    }));
    expect(score).toBe(100);
  });

  it('match_strong (-20) + pin (+10) floors at 0', () => {
    const { score } = computeRiskScore(input({ faceMatchStatus: 'match_strong', reauthMethod: 'pin' }));
    expect(score).toBe(0);
  });

  it('negative weights offset positives exactly (match_strong + wall_buffer + gps medium → 0)', () => {
    const { score } = computeRiskScore(input({
      faceMatchStatus: 'match_strong',        // -20
      geofence: { inside: false, edgeMarginMeters: null, outsideDistanceMeters: 5, wallBufferMeters: 8 }, // +10
      gpsAccuracyMeters: 20,                  // +10
    }));
    expect(score).toBe(0);
  });

  it('a clean input scores 0 with only weight-0 explainability factors', () => {
    const { score, factors } = computeRiskScore(input({
      livenessDecision: 'pass', reauthMethod: 'webauthn', gpsAccuracyMeters: 10, presence: 'valid',
    }));
    expect(score).toBe(0);
    expect(factors.every((f) => f.weight === 0)).toBe(true);
  });
});

describe('riskBand', () => {
  it('band edges: 29 clear, 30 review, 59 review, 60 high', () => {
    expect(riskBand(0)).toBe('clear');
    expect(riskBand(REVIEW_THRESHOLD - 1)).toBe('clear');   // 29
    expect(riskBand(REVIEW_THRESHOLD)).toBe('review');      // 30
    expect(riskBand(BLOCK_THRESHOLD - 1)).toBe('review');   // 59
    expect(riskBand(BLOCK_THRESHOLD)).toBe('high');         // 60
    expect(riskBand(100)).toBe('high');
  });

  it('crafted input summing to exactly 30 lands in review (manual_review 20 + pin 10)', () => {
    const { score } = computeRiskScore(input({ livenessDecision: 'manual_review', reauthMethod: 'pin' }));
    expect(score).toBe(30);
    expect(riskBand(score)).toBe('review');
  });
});

describe('isBlockable — proportionality guardrail', () => {
  it('liveness fail → blockable', () => {
    const { factors } = computeRiskScore(input({ livenessDecision: 'fail' }));
    expect(isBlockable(factors)).toBe(true);
  });

  it('face match_fail → blockable', () => {
    const { factors } = computeRiskScore(input({ faceMatchStatus: 'match_fail' }));
    expect(isBlockable(factors)).toBe(true);
  });

  it('face match_error → NOT blockable (fail-only per spec)', () => {
    const { factors } = computeRiskScore(input({ faceMatchStatus: 'match_error' }));
    expect(isBlockable(factors)).toBe(false);
  });

  it('innocent signals stacked to 85 (device 10 + zero-GPS 25 + wall_buffer 10 + travel 40) → high band but NOT blockable', () => {
    const { score, factors } = computeRiskScore(input({
      geofence: { inside: false, edgeMarginMeters: null, outsideDistanceMeters: 5, wallBufferMeters: 8 },
      gpsAccuracyMeters: 0,
      previousEvent: { distanceMeters: 600, minutesAgo: 5 },
      deviceFirstSeen: true,
    }));
    expect(score).toBe(85);
    expect(riskBand(score)).toBe('high');
    expect(isBlockable(factors)).toBe(false);
  });
});
