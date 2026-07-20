import type { Env } from '../types';

// One-time survey token, minted at kiosk checkout and required to submit a
// rating — the same KV pattern as presence tokens. Single-use and short-lived
// so there is no unauthenticated way to inject survey rows.
const SURVEY_TOKEN_TTL_S = 600; // 10 minutes — long enough to rate on the way out

export async function mintSurveyToken(env: Env, visitId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.KV.put(`survey_token:${token}`, visitId, { expirationTtl: SURVEY_TOKEN_TTL_S });
  return token;
}

// Returns the visit id, or null when the token is missing/expired/used.
export async function consumeSurveyToken(env: Env, token: string): Promise<string | null> {
  const key = `survey_token:${token}`;
  const visitId = await env.KV.get(key);
  if (!visitId) return null;
  await env.KV.delete(key);
  return visitId;
}
