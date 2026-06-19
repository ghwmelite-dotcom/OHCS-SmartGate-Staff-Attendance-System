import { analyzeFrame } from './ai';
import { detectMotion } from './motion';
import { selectSharpestFrame, MIN_SHARPNESS } from './sharpness';
import type {
  LivenessChallenge, LivenessVerification, LivenessSignature, FrameAnalysis,
} from './types';

export * from './types';
export { isoWeekKey, getReviewCount, incrementReviewCount } from './review-counter';
export { computeSharpness, MIN_SHARPNESS } from './sharpness';

/**
 * Minimum per-frame face confidence required for a confident pass. A face must
 * be detected (landmarks non-null) in EVERY frame AND clear this bar in every
 * frame. "Model ran but found no face / a weak face" can never fall through to
 * a pass — it is a fail. Tuned just under insightface's typical confident-face
 * scores (~0.9+) so genuine captures aren't blocked but empty/weak frames are.
 */
export const MIN_FACE_SCORE = 0.50;

interface VerifyArgs {
  ai: Ai;
  frames: ArrayBuffer[];
  challenge: LivenessChallenge;
  modelVersion: string;
}

export async function verifyLivenessBurst(args: VerifyArgs): Promise<LivenessVerification> {
  const { ai, frames, challenge, modelVersion } = args;
  if (frames.length !== 3) throw new Error('verifyLivenessBurst expects exactly 3 frames');

  const start = Date.now();

  const analyses: FrameAnalysis[] = await Promise.all(frames.map((f) => analyzeFrame(ai, f)));

  // If every frame errored at the AI call level (not just no-face), report skipped.
  // analyzeFrame sets error: 'ai_failure' only when ai.run throws — distinguishing
  // it from a legitimate "no face detected in frame" result.
  const allAiFailed = analyses.every((a) => a.error === 'ai_failure');
  if (allAiFailed) {
    const signature: LivenessSignature = {
      v: 1,
      challenge_action: challenge,
      challenge_completed: false,
      motion_delta: 0,
      face_score: 0,
      sharpness: 0,
      decision: 'skipped',
      model_version: modelVersion,
      screen_artifact_score: null,
      ms_total: Date.now() - start,
    };
    return {
      pass: false,
      decision: 'skipped',
      signature,
      canonicalFrame: frames[0]!,
    };
  }

  const motion = detectMotion(analyses.map((a) => a.landmarks), challenge);
  const sharpestIdx = selectSharpestFrame(analyses);
  const canonicalSharpness = analyses[sharpestIdx]?.sharpness ?? 0;

  // ---- Anti-spoof decision gate ----
  // 1. A real face must be present in EVERY frame and clear MIN_FACE_SCORE in
  //    every frame. A "model ran but no/weak face" frame can NEVER pass — it is
  //    a hard fail (this closes the no-face-falls-through-to-pass hole).
  const everyFrameHasFace = analyses.every(
    (a) => a.landmarks !== null && (a.landmarks.faceConfidence ?? 0) >= MIN_FACE_SCORE,
  );

  let decision: LivenessSignature['decision'];
  if (!everyFrameHasFace) {
    // No usable face in one or more frames → cannot be a live capture.
    decision = 'fail';
  } else if (!motion.completed) {
    // Face present throughout but the challenge motion was not performed.
    decision = 'fail';
  } else if (canonicalSharpness < MIN_SHARPNESS) {
    // Face + motion present, but the capture is too blurry/flat to be a
    // confident live frame (possible defocus or screen-replay flatness).
    // Route to manual_review rather than auto-passing — never a silent pass.
    decision = 'manual_review';
  } else {
    decision = 'pass';
  }

  const signature: LivenessSignature = {
    v: 1,
    challenge_action: challenge,
    challenge_completed: motion.completed,
    motion_delta: motion.delta,
    face_score: meanFaceScore(analyses),
    sharpness: canonicalSharpness,
    decision,
    model_version: modelVersion,
    screen_artifact_score: null,
    ms_total: Date.now() - start,
  };

  return {
    pass: decision === 'pass',
    decision,
    signature,
    canonicalFrame: frames[sharpestIdx]!,
  };
}

function meanFaceScore(analyses: ReadonlyArray<FrameAnalysis>): number {
  const scores = analyses.map((a) => a.landmarks?.faceConfidence ?? 0);
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}
