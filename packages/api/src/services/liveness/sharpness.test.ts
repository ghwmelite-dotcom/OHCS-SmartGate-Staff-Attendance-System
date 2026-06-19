import { describe, it, expect } from 'vitest';
import { selectSharpestFrame, computeSharpness, MIN_SHARPNESS } from './sharpness';
import type { FrameAnalysis } from './types';

function fa(faceConfidence: number, sharpness = 0): FrameAnalysis {
  return {
    landmarks: {
      leftEye: [0.4, 0.4], rightEye: [0.6, 0.4], nose: [0.5, 0.5],
      mouthLeft: [0.45, 0.65], mouthRight: [0.55, 0.65],
      faceConfidence,
    },
    sharpness,
  };
}

describe('selectSharpestFrame', () => {
  it('picks the frame with the highest faceConfidence', () => {
    const frames = [fa(0.80), fa(0.95), fa(0.85)];
    const idx = selectSharpestFrame(frames);
    expect(idx).toBe(1);
  });

  it('breaks ties by proximity to burst midpoint', () => {
    const frames = [fa(0.95), fa(0.95), fa(0.95)];
    const idx = selectSharpestFrame(frames);
    expect(idx).toBe(1); // middle frame wins on tie
  });

  it('falls back to index 0 when no frame has landmarks', () => {
    const frames: FrameAnalysis[] = [
      { landmarks: null, sharpness: 0 },
      { landmarks: null, sharpness: 0 },
      { landmarks: null, sharpness: 0 },
    ];
    expect(selectSharpestFrame(frames)).toBe(0);
  });
});

describe('computeSharpness', () => {
  it('returns a value in [0,1]', () => {
    const s = computeSharpness(new ArrayBuffer(64));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('returns 0 for a degenerate tiny buffer', () => {
    expect(computeSharpness(new ArrayBuffer(2))).toBe(0);
  });

  it('scores a flat, tiny-scan JPEG below the minimum gate', () => {
    // SOS marker near the end → tiny uniform scan segment → low sharpness.
    const n = 2000;
    const buf = new Uint8Array(n);
    buf[n - 6] = 0xff;
    buf[n - 5] = 0xda;
    buf[n - 4] = 0x00;
    buf[n - 3] = 0x02;
    expect(computeSharpness(buf.buffer)).toBeLessThan(MIN_SHARPNESS);
  });

  it('scores a high-variance scan segment higher than a flat one', () => {
    const n = 4000;
    const flat = new Uint8Array(n);
    flat[10] = 0xff; flat[11] = 0xda; flat[12] = 0x00; flat[13] = 0x02;
    // detailed: alternating extreme byte values after the SOS segment
    const detailed = new Uint8Array(n);
    detailed[10] = 0xff; detailed[11] = 0xda; detailed[12] = 0x00; detailed[13] = 0x02;
    for (let i = 14; i < n; i++) detailed[i] = i % 2 === 0 ? 0 : 255;
    expect(computeSharpness(detailed.buffer)).toBeGreaterThan(computeSharpness(flat.buffer));
  });
});
