import { getToken } from './tokenStore';
import { API_BASE } from './constants';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta?: { cursor?: string; hasMore?: boolean; total?: number };
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
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
    // Session expired — redirect to login
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.location.href = '/login';
      throw new ApiError('SESSION_EXPIRED', 'Session expired. Please sign in again.', 401);
    }
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'An error occurred',
      res.status
    );
  }

  return json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Resolve a stored photo URL (e.g. "/api/photos/clock/abc") to an absolute URL
// the browser can load. In prod the API lives on a different origin, so <img>
// tags need the full URL; relative paths would resolve against the Pages origin.
export function resolvePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  const origin = API_BASE.replace(/\/api$/, '');
  return `${origin}${url}`;
}

/* ---- Shared API types ---- */

export interface Visitor {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  organisation: string | null;
  id_type: string | null;
  id_number: string | null;
  photo_url: string | null;
  total_visits: number;
  last_visit_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  visitor_id: string;
  host_officer_id: string | null;
  directorate_id: string | null;
  purpose_raw: string | null;
  purpose_category: string | null;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number | null;
  badge_code: string | null;
  status: 'checked_in' | 'checked_out' | 'cancelled';
  notes: string | null;
  created_by: string | null;
  created_at: string;
  id_photo_check?: string | null;
  /* joined fields */
  first_name?: string;
  last_name?: string;
  organisation?: string;
  phone?: string;
  host_name?: string;
  directorate_abbr?: string;
}

export interface Officer {
  id: string;
  name: string;
  title: string | null;
  directorate_id: string;
  email: string | null;
  phone: string | null;
  office_number: string | null;
  is_available: number;
  directorate_name?: string;
  directorate_abbr?: string;
}

export interface Directorate {
  id: string;
  name: string;
  abbreviation: string;
  floor: string | null;
  wing: string | null;
  is_active: number;
  reception_officer_id?: string | null;
}

export interface VisitorDetail extends Visitor {
  visits: Visit[];
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  visit_id: string | null;
  is_read: number;
  created_at: string;
}
