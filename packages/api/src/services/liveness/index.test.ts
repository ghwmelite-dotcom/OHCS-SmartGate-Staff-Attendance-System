import { describe, it, expect } from 'vitest';
import { verifyLivenessBurst, LIVENESS_ENGINE_VERSION } from './index';

// A plain zero-filled buffer has no SOS marker → scanFraction 1, varNorm 0 →
// computeSharpness ≈ 0.3, above the 0.12 gate. So default frames are "sharp".
const f = (n = 64) => new ArrayBuffer(n);

// A frame engineered to score below MIN_SHARPNESS: an SOS (FFDA) marker near the
// end yields a tiny, uniform scan segment → varNorm ~0, scanFraction ~0.
function lowSharpnessFrame(n = 2000): ArrayBuffer {
  const buf = new Uint8Array(n);
  const sos = n - 6;
  buf[sos] = 0xff;
  buf[sos + 1] = 0xda;
  buf[sos + 2] = 0x00;
  buf[sos + 3] = 0x02;
  return buf.buffer;
}

describe('verifyLivenessBurst (client-side engine)', () => {
  it('passes when the on-device challenge completed and the frame is sharp', async () => {
    const result = await verifyLivenessBurst({
      frames: [f(), f(), f()],
      challenge: 'blink',
      clientCompleted: true,
    });
    expect(result.pass).toBe(true);
    expect(result.decision).toBe('pass');
    expect(result.signature.challenge_completed).toBe(true);
    expect(result.signature.model_version).toBe(LIVENESS_ENGINE_VERSION);
    expect(result.canonicalFrame).toBeInstanceOf(ArrayBuffer);
  });

  it('routes to manual_review when the challenge did not complete (never a silent pass or hard fail)', async () => {
    const result = await verifyLivenessBurst({
      frames: [f(), f(), f()],
      challenge: 'blink',
      clientCompleted: false,
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('manual_review');
    expect(result.signature.challenge_completed).toBe(false);
  });

  it('routes a completed-but-too-flat/blurry capture to manual_review', async () => {
    const result = await verifyLivenessBurst({
      frames: [lowSharpnessFrame(), lowSharpnessFrame(), lowSharpnessFrame()],
      challenge: 'blink',
      clientCompleted: true,
    });
    expect(result.decision).toBe('manual_review');
    expect(result.signature.sharpness).toBeLessThan(0.12);
  });

  it('rejects fewer than 3 frames', async () => {
    await expect(
      verifyLivenessBurst({ frames: [f(), f()], challenge: 'blink', clientCompleted: true }),
    ).rejects.toThrow('exactly 3 frames');
  });

  it('records a non-negative ms_total and a real sharpness signal', async () => {
    const result = await verifyLivenessBurst({
      frames: [f(), f(), f()],
      challenge: 'smile',
      clientCompleted: true,
    });
    expect(result.signature.ms_total).toBeGreaterThanOrEqual(0);
    expect(result.signature.sharpness).toBeGreaterThan(0);
  });
});
