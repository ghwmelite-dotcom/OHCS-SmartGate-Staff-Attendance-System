import { computeSharpness, MIN_SHARPNESS } from './sharpness';
import type { LivenessChallenge, LivenessVerification, LivenessSignature } from './types';

export * from './types';
export { isoWeekKey, getReviewCount, incrementReviewCount } from './review-counter';
export { computeSharpness, MIN_SHARPNESS } from './sharpness';

/**
 * Engine tag recorded on every signature. Face + challenge detection runs
 * on-device (MediaPipe in the staff PWA); the server no longer calls any
 * Workers AI model (the previous `@cf/insightface/buffalo_s` model does not
 * exist on the platform and threw on every frame → every verdict was `skipped`).
 */
export const LIVENESS_ENGINE_VERSION = 'client_mediapipe_v1';

interface VerifyArgs {
  frames: ArrayBuffer[];
  challenge: LivenessChallenge;
  /** On-device MediaPipe verdict: did the challenge motion complete in-browser? */
  clientCompleted: boolean;
}

/**
 * Produce a liveness verdict from a 3-frame burst without any server-side AI.
 *
 * Two signals combine:
 *  - `clientCompleted` — the browser's MediaPipe detector confirms the blink /
 *    turn / smile actually happened. This is the liveness (anti-photo) signal.
 *  - server-measured sharpness of the raw JPEG bytes — a real, decode-free proxy
 *    the client cannot fabricate without submitting genuinely detailed frames.
 *    Guards against flat/blurry screen-replay captures.
 *
 * Decision ladder (never a silent pass, never a hard lockout on an ambiguous
 * signal):
 *  - motion not confirmed → manual_review (either not performed, or MediaPipe
 *    was unavailable and the browser fell back to a blind capture — HR
 *    adjudicates via the stored frame).
 *  - motion confirmed but capture too flat/blurry → manual_review.
 *  - motion confirmed and capture sharp → pass.
 */
export async function verifyLivenessBurst(args: VerifyArgs): Promise<LivenessVerification> {
  const { frames, challenge, clientCompleted } = args;
  if (frames.length !== 3) throw new Error('verifyLivenessBurst expects exactly 3 frames');

  const start = Date.now();

  const sharpnesses = frames.map(computeSharpness);
  const canonicalIdx = sharpnesses.indexOf(Math.max(...sharpnesses));
  const canonicalSharpness = sharpnesses[canonicalIdx] ?? 0;

  let decision: LivenessSignature['decision'];
  if (!clientCompleted) {
    decision = 'manual_review';
  } else if (canonicalSharpness < MIN_SHARPNESS) {
    decision = 'manual_review';
  } else {
    decision = 'pass';
  }

  const signature: LivenessSignature = {
    v: 1,
    challenge_action: challenge,
    challenge_completed: clientCompleted,
    // motion_delta/face_score are measured on-device; we record the challenge
    // outcome as a 0/1 proxy (the boolean is the wire contract). `challenge_completed`
    // is the authoritative field for adjudication.
    motion_delta: clientCompleted ? 1 : 0,
    face_score: clientCompleted ? 1 : 0,
    sharpness: canonicalSharpness,
    decision,
    model_version: LIVENESS_ENGINE_VERSION,
    screen_artifact_score: null,
    ms_total: Date.now() - start,
  };

  return {
    pass: decision === 'pass',
    decision,
    signature,
    canonicalFrame: frames[canonicalIdx]!,
  };
}
