import type { FrameAnalysis, FaceLandmarks } from './types';
import { computeSharpness } from './sharpness';

interface InsightfaceResponse {
  faces?: Array<{
    bbox: [number, number, number, number];
    score: number;
    kps: Array<[number, number]>;
  }>;
}

// Per-frame Workers AI budget. Workers AI cold-starts for `buffalo_s` can run
// 3-8s; three parallel calls tipping past the Worker's 30s wall clock was
// surfacing as opaque 5xx errors at the client. Capping each call lets the
// orchestrator degrade to `ai_failure` (which collapses to a `skipped`
// decision when all three fail) instead of hanging the whole request.
const AI_TIMEOUT_MS = 7000;

async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ai_timeout_${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function analyzeFrame(ai: Ai, frame: ArrayBuffer): Promise<FrameAnalysis> {
  // Real, dependency-free sharpness proxy computed from the JPEG bytes. Always
  // available even when the AI call fails or no face is found, so the decision
  // layer can still apply its minimum-sharpness gate.
  const sharpness = computeSharpness(frame);

  let raw: InsightfaceResponse;
  try {
    raw = await raceWithTimeout(
      ai.run('@cf/insightface/buffalo_s' as never, {
        image: Array.from(new Uint8Array(frame)),
      } as never) as Promise<InsightfaceResponse>,
      AI_TIMEOUT_MS,
    );
  } catch {
    return { landmarks: null, sharpness, error: 'ai_failure' };
  }

  const faces = raw.faces ?? [];
  if (faces.length === 0) return { landmarks: null, sharpness };

  const best = faces.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.kps.length < 5) return { landmarks: null, sharpness };

  const landmarks: FaceLandmarks = {
    leftEye:    best.kps[0]!,
    rightEye:   best.kps[1]!,
    nose:       best.kps[2]!,
    mouthLeft:  best.kps[3]!,
    mouthRight: best.kps[4]!,
    faceConfidence: best.score,
  };

  return { landmarks, sharpness };
}
