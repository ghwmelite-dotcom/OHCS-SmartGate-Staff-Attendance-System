import type { Env } from '../types';
import { parseModelVerdict, type IdCheckVerdict } from '../lib/id-check';

const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DEFAULT_TIMEOUT_MS = 5000;

const PROMPT =
  'You are verifying a photo taken at a building reception desk. Decide whether the image ' +
  'shows a government-issued identity document (a Ghana Card, passport, driver\'s licence, or ' +
  'staff ID card). Reply with ONLY a compact JSON object and no other text: ' +
  '{"is_document": true|false, "type": "ghana_card"|"passport"|"drivers_license"|"staff_id"|"other"|"none", "confidence": 0.0-1.0}';

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`id_check_timeout_${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// Best-effort, non-blocking ID-document check. NEVER throws — any failure
// (timeout, model error, unparseable output, missing license agreement) yields
// an `indeterminate` verdict so the caller can proceed unimpeded.
export async function checkIdDocument(
  env: Env,
  bytes: ArrayBuffer,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<IdCheckVerdict> {
  const checked_at = new Date().toISOString();
  try {
    const res = await raceWithTimeout(
      env.AI.run(MODEL as never, {
        prompt: PROMPT,
        image: [...new Uint8Array(bytes)],
        max_tokens: 100,
      } as never) as Promise<{ response?: string }>,
      timeoutMs,
    );
    return { ...parseModelVerdict(res?.response ?? ''), model: MODEL, checked_at };
  } catch {
    return { verdict: 'indeterminate', model: MODEL, checked_at };
  }
}
