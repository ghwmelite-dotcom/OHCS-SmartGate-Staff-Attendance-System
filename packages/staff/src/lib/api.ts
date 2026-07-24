import { getToken } from './tokenStore';

// Same-origin relative base. The staff PWA is served from
// staff-attendance.ohcsghana.org and the Worker routes the full API first-party
// at that origin's /api/*, so requests stay same-origin (first-party cookie).
const API_BASE = '/api';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  const json = await res.json() as ApiResponse<T>;
  if (!res.ok || json.error) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.location.href = '/login';
    throw new ApiError(json.error?.code ?? 'UNKNOWN', json.error?.message ?? 'Error', res.status);
  }
  return json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, {
    method: 'PATCH',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }),
};

// ---- Clock-in re-auth + liveness helpers ----

export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';

export interface ClockPrompt {
  promptId: string;
  challengeAction: LivenessChallenge;
  expiresAt: number;
}

/** Issue a fresh single-use prompt for the next clock-in. */
export async function fetchClockPrompt(): Promise<ClockPrompt> {
  const res = await api.post<{
    prompt_id: string;
    challenge_action: LivenessChallenge;
    expires_at: number;
  }>('/clock/prompt');
  if (!res.data) throw new Error('Empty prompt response');
  return {
    promptId: res.data.prompt_id,
    challengeAction: res.data.challenge_action,
    expiresAt: res.data.expires_at,
  };
}

export interface ClockSubmission {
  type: 'clock_in' | 'clock_out';
  latitude: number;
  longitude: number;
  accuracy?: number;
  idempotencyKey?: string;
  promptId?: string;
  webauthnAssertion?: unknown;
  pin?: string;
  presenceToken?: string;
  presenceCode?: string;
  presenceOverridePin?: string;
  capturedAt?: string;
  deviceId?: string;
  livenessBurst?: { frame0: Blob; frame1: Blob; frame2: Blob; claimedCompleted: boolean };
}

export interface ClockResult {
  id: string;
  type: 'clock_in' | 'clock_out';
  timestamp: string;
  user_name: string;
  staff_id: string;
  within_geofence: boolean;
  distance_meters: number;
  streak: number;
  longest_streak: number;
  deduplicated?: boolean;
  liveness_decision?: 'pass' | 'fail' | 'manual_review' | 'skipped' | null;
}

/** Submit a clock-in/out — multipart when liveness frames are attached, JSON otherwise. */
export async function submitClock(input: ClockSubmission): Promise<ClockResult> {
  const payload = {
    type: input.type,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    idempotency_key: input.idempotencyKey,
    prompt_id: input.promptId,
    webauthn_assertion: input.webauthnAssertion,
    pin: input.pin,
    presence_token: input.presenceToken,
    presence_code: input.presenceCode,
    presence_override_pin: input.presenceOverridePin,
    captured_at: input.capturedAt,
    device_id: input.deviceId,
  };

  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let body: BodyInit;
  if (input.livenessBurst) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    fd.append('frame_0', input.livenessBurst.frame0, 'frame_0.jpg');
    fd.append('frame_1', input.livenessBurst.frame1, 'frame_1.jpg');
    fd.append('frame_2', input.livenessBurst.frame2, 'frame_2.jpg');
    fd.append('challenge_action_completed', input.livenessBurst.claimedCompleted ? 'true' : 'false');
    body = fd;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  const res = await fetch(`${API_BASE}/clock/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body,
  });
  const json = await res.json() as ApiResponse<ClockResult>;
  if (!res.ok || json.error) {
    if (res.status === 401) window.location.href = '/login';
    throw new ApiError(json.error?.code ?? 'UNKNOWN', json.error?.message ?? 'Error', res.status);
  }
  if (!json.data) throw new Error('Empty clock response');
  return json.data;
}
