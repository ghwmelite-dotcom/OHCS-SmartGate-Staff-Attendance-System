import { describe, it, expect } from 'vitest';
import { assessFrameQuality } from './image-quality';

function solid(level: number, w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = level; data[i + 1] = level; data[i + 2] = level; data[i + 3] = 255; }
  return { data, width: w, height: h };
}
function highContrast(w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = p < (w * h) / 2 ? 0 : 255;
    data[p * 4] = v; data[p * 4 + 1] = v; data[p * 4 + 2] = v; data[p * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('assessFrameQuality', () => {
  it('rejects a near-black frame', () => { expect(assessFrameQuality(solid(4)).ok).toBe(false); });
  it('rejects a near-white frame', () => { expect(assessFrameQuality(solid(252)).ok).toBe(false); });
  it('rejects a flat mid-grey frame (no detail)', () => { expect(assessFrameQuality(solid(128)).ok).toBe(false); });
  it('accepts a high-contrast frame (has detail at usable brightness)', () => { expect(assessFrameQuality(highContrast()).ok).toBe(true); });
  it('returns a reason string when rejected', () => { expect(typeof assessFrameQuality(solid(4)).reason).toBe('string'); });
});
