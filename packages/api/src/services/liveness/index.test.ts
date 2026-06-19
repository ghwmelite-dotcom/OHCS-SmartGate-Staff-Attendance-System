import { describe, it, expect, vi } from 'vitest';
import { verifyLivenessBurst } from './index';

function mockAi(perFrameResponses: unknown[]) {
  let i = 0;
  return {
    run: vi.fn(async () => perFrameResponses[i++] ?? { faces: [] }),
  } as unknown as Ai;
}

const PASSING_BLINK = [
  { faces: [{ bbox: [0,0,1,1], score: 0.95, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
  { faces: [{ bbox: [0,0,1,1], score: 0.93, kps: [[0.40,0.42],[0.60,0.42],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
  { faces: [{ bbox: [0,0,1,1], score: 0.96, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
];

const STATIC_FRAMES = Array(3).fill({
  faces: [{ bbox: [0,0,1,1], score: 0.92, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }],
});

const f = (n: number) => new ArrayBuffer(n);

// A frame whose computeSharpness proxy is high enough to clear MIN_SHARPNESS.
// A plain zero-filled buffer has no SOS marker → scanFraction 1 → score 0.3,
// which is above the 0.12 gate, so the default f() frames already pass the gate.

// A frame engineered to score below MIN_SHARPNESS: an SOS (FFDA) marker placed
// near the end yields a tiny, uniform scan segment → varNorm ~0, scanFraction ~0.
function lowSharpnessFrame(n = 2000): ArrayBuffer {
  const buf = new Uint8Array(n);
  const sos = n - 6;            // FFDA near the very end
  buf[sos] = 0xff;
  buf[sos + 1] = 0xda;
  buf[sos + 2] = 0x00;          // segment length high byte
  buf[sos + 3] = 0x02;          // segment length = 2 → scanStart = sos+4, scanLen tiny
  // remaining bytes left at 0 (uniform) → zero variance in the scan segment
  return buf.buffer;
}

describe('verifyLivenessBurst', () => {
  it('returns pass when challenge is completed', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(true);
    expect(result.decision).toBe('pass');
    expect(result.signature.challenge_completed).toBe(true);
    expect(result.signature.model_version).toBe('buffalo_s_v1');
    expect(result.canonicalFrame).toBeInstanceOf(ArrayBuffer);
  });

  it('returns fail when no motion detected', async () => {
    const ai = mockAi(STATIC_FRAMES);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
    expect(result.signature.challenge_completed).toBe(false);
  });

  it('returns skipped on AI error', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('AI down')) } as unknown as Ai;
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.decision).toBe('skipped');
    expect(result.pass).toBe(false);
  });

  it('rejects fewer than 3 frames', async () => {
    const ai = mockAi([]);
    await expect(verifyLivenessBurst({
      ai,
      frames: [f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    })).rejects.toThrow('exactly 3 frames');
  });

  it('records ms_total', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.signature.ms_total).toBeGreaterThanOrEqual(0);
  });

  it('returns fail with all-null landmarks (no face detected anywhere)', async () => {
    const ai = mockAi([{ faces: [] }, { faces: [] }, { faces: [] }]);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
    expect(result.signature.face_score).toBe(0);
  });

  it('never passes when a single frame has no face (no-face never falls through to pass)', async () => {
    // First two frames complete a blink; the third has no face detected.
    // Even though motion across the present frames would otherwise complete,
    // a missing face in ANY frame must hard-fail and never pass.
    const ai = mockAi([
      PASSING_BLINK[0],
      PASSING_BLINK[1],
      { faces: [] },
    ]);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
  });

  it('never passes when a frame face_score is below the minimum', async () => {
    // A weak/low-confidence face in any frame is treated as no usable face.
    const weak = { faces: [{ bbox: [0,0,1,1], score: 0.10, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] };
    const ai = mockAi([PASSING_BLINK[0], weak, PASSING_BLINK[2]]);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
  });

  it('routes a too-blurry/flat capture to manual_review (not a silent pass)', async () => {
    // Faces present + blink motion completes, but the frame bytes score below
    // MIN_SHARPNESS → manual_review, never an auto-pass.
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [lowSharpnessFrame(), lowSharpnessFrame(), lowSharpnessFrame()],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('manual_review');
    expect(result.signature.sharpness).toBeLessThan(0.12);
  });

  it('computes a non-zero sharpness for a frame with detail (no longer hardcoded 0)', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.signature.sharpness).toBeGreaterThan(0);
  });
});
