// A structural subset of ImageData so this is testable without a DOM canvas.
export interface FramePixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export interface QualityResult {
  ok: boolean;
  reason?: string;
}

// Reject frames that clearly contain no usable subject: too dark, blown-out, or
// flat (a blank wall / lens covered). Uses mean luminance + luminance stdev on a
// subsampled set of pixels. Pure + deterministic.
export function assessFrameQuality(frame: FramePixels): QualityResult {
  const { data, width, height } = frame;
  const pixelCount = width * height;
  if (pixelCount === 0) return { ok: false, reason: 'Empty frame — please retake.' };

  const step = Math.max(1, Math.floor(pixelCount / 1024));
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let p = 0; p < pixelCount; p += step) {
    const i = p * 4;
    const lum = 0.299 * Number(data[i]) + 0.587 * Number(data[i + 1]) + 0.114 * Number(data[i + 2]);
    sum += lum;
    sumSq += lum * lum;
    n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const stdev = Math.sqrt(variance);

  if (mean < 25) return { ok: false, reason: 'Image too dark — please retake in better light.' };
  if (mean > 235) return { ok: false, reason: 'Image too bright — please retake.' };
  if (stdev < 12) return { ok: false, reason: 'Image looks blank — make sure the ID fills the frame.' };
  return { ok: true };
}
