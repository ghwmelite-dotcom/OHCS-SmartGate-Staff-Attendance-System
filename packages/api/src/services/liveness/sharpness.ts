import type { FrameAnalysis } from './types';

/**
 * Minimum confident-pass sharpness. Frames whose computed sharpness proxy falls
 * below this are too blurry/flat to be a confident live capture and are routed
 * to manual_review (never an outright pass) in enforce mode. Tuned against the
 * proxy's [0,1] output range; conservative so genuine captures aren't blocked.
 */
export const MIN_SHARPNESS = 0.12;

/**
 * Compute a lightweight, dependency-free sharpness proxy from a JPEG frame.
 *
 * RESIDUAL LIMITATION (documented, deliberate): the Workers runtime has no
 * image-decode primitive (no OffscreenCanvas / createImageBitmap) and we add no
 * heavy pure-JS JPEG decoder. A true variance-of-Laplacian over decoded luma is
 * therefore not computed. Instead we measure high-frequency *content* directly
 * from the JPEG entropy-coded scan segment: a sharp, detailed frame retains more
 * high-frequency DCT energy and so its compressed scan data has both higher
 * bytes-per-pixel-proxy and higher local byte variance than a blurry or flat
 * (e.g. lens-covered, out-of-focus, or uniform-screen) frame. We combine:
 *   - scan-segment byte length relative to total file size (compression ratio
 *     proxy — blurry frames compress harder), and
 *   - normalised variance of the scan bytes (entropy/detail proxy).
 * This is a real computed signal that responds to blur/flatness, but it is a
 * proxy for spatial sharpness, not a pixel-accurate focus metric. It is used
 * only as a *minimum* gate (too-flat → manual_review), never to fabricate a
 * high-confidence pass. Returns a value in [0, 1].
 */
export function computeSharpness(frame: ArrayBuffer): number {
  const bytes = new Uint8Array(frame);
  const n = bytes.length;
  if (n < 4) return 0;

  // Locate the Start-Of-Scan (FFDA) marker; entropy-coded image data follows the
  // 2-byte SOS segment-length header. If not found (not a JPEG / truncated), fall
  // back to scanning the whole buffer.
  let scanStart = 0;
  for (let i = 0; i + 1 < n; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xda) {
      // SOS marker; skip marker (2) + segment length (2) + the segment payload.
      const segLen = i + 3 < n ? ((bytes[i + 2]! << 8) | bytes[i + 3]!) : 0;
      scanStart = Math.min(i + 2 + segLen, n - 1);
      break;
    }
  }

  const scanLen = n - scanStart;
  if (scanLen < 2) return 0;

  // Mean + variance of the entropy-coded scan bytes. Sharp/detailed frames spread
  // byte values widely (high variance); flat/blurry frames cluster (low variance).
  let sum = 0;
  for (let i = scanStart; i < n; i++) sum += bytes[i]!;
  const mean = sum / scanLen;
  let varSum = 0;
  for (let i = scanStart; i < n; i++) {
    const d = bytes[i]! - mean;
    varSum += d * d;
  }
  const variance = varSum / scanLen;          // [0, ~16384] (max when bytes split 0/255)
  const varNorm = Math.min(1, variance / 5000); // normalise; ~5000 ≈ healthy detail

  // Compression-ratio proxy: fraction of the file that is entropy-coded scan data.
  // Heavily compressed (blurry/flat) frames have a smaller scan fraction.
  const scanFraction = Math.min(1, scanLen / n);

  // Weighted blend — variance dominates (direct detail signal), scan fraction
  // backstops it (guards against tiny high-variance noise blobs).
  const score = 0.7 * varNorm + 0.3 * scanFraction;
  return Math.max(0, Math.min(1, score));
}

export function selectSharpestFrame(frames: ReadonlyArray<FrameAnalysis>): number {
  if (frames.length === 0) return 0;

  // If no frame has detectable landmarks, return index 0 as a safe default.
  const hasAnyLandmarks = frames.some((f) => f.landmarks !== null);
  if (!hasAnyLandmarks) return 0;

  const midIdx = Math.floor((frames.length - 1) / 2);
  let bestIdx = 0;
  let bestScore = -Infinity;

  frames.forEach((frame, idx) => {
    const conf = frame.landmarks?.faceConfidence ?? 0;
    // Composite score: face confidence dominates (it gates whether the frame is
    // usable at all), the real sharpness proxy lightly favours the crispest of
    // the high-confidence frames, and mid-burst proximity breaks remaining ties.
    const sharp = frame.sharpness * 0.05;
    const tieBreak = -Math.abs(idx - midIdx) * 1e-6;
    const score = conf + sharp + tieBreak;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return bestIdx;
}
