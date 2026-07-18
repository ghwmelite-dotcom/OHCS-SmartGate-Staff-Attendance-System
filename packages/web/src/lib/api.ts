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
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
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
  type: string;
  org_type: string | null;
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

/* ---- Appointment types ---- */

export interface AppointmentRecord {
  id: string; officer_id: string; visitor_name: string; visitor_phone: string;
  visitor_email?: string; organisation?: string; purpose: string;
  appointment_date: string; time_slot: string; status: string;
  reference_code: string; approved_by?: string; approved_at?: string;
  decline_reason?: string; approver_notes?: string; visit_id?: string;
  created_at: string; updated_at: string;
  officer_name: string; officer_title?: string; directorate_name: string;
  approved_by_name?: string;
}

export interface BookableOfficerRecord {
  id: string; officer_id: string; is_active: number;
  slot_duration_mins: number; slot_start_time: string; slot_end_time: string;
  advance_days_min: number; advance_days_max: number;
  officer_name: string; officer_title?: string; directorate_name: string;
}

export interface ApproverRecord {
  id: string; officer_id: string; user_id: string; created_at: string;
  user_name: string; user_email: string; user_role: string;
}

export interface ApproverCandidate {
  id: string; name: string; email: string; role: string;
  officer_title: string; directorate_name: string;
}

export interface UpsertBookableOfficer {
  officer_id: string; is_active: boolean; slot_duration_mins: number;
  slot_start_time: string; slot_end_time: string;
  advance_days_min: number; advance_days_max: number;
}

export interface PublicBookableOfficer {
  bookable_id: string; officer_id: string; officer_name: string;
  officer_title?: string; directorate_name: string;
  slot_duration_mins: number; slot_start_time: string; slot_end_time: string;
  advance_days_min: number; advance_days_max: number;
}

/* ---- Appointments API ---- */

export const appointmentsApi = {
  list: (params?: { status?: string; officer_id?: string; date_from?: string; date_to?: string; page?: number }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {})
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => [k, String(v)])
      )
    ).toString();
    return request<{ appointments: AppointmentRecord[]; total: number; page: number; limit: number }>(
      `/appointments/admin${qs ? `?${qs}` : ''}`
    );
  },
  confirm: (id: string, approver_notes?: string) =>
    request<{ ok: boolean }>(`/appointments/admin/${id}/confirm`, { method: 'PATCH', body: JSON.stringify({ approver_notes }) }),
  decline: (id: string, decline_reason: string) =>
    request<{ ok: boolean }>(`/appointments/admin/${id}/decline`, { method: 'PATCH', body: JSON.stringify({ decline_reason }) }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`/appointments/admin/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({}) }),
  complete: (id: string) =>
    request<{ ok: boolean }>(`/appointments/admin/${id}/complete`, { method: 'PATCH', body: JSON.stringify({}) }),
  getBookableOfficers: () =>
    request<{ bookable_officers: BookableOfficerRecord[] }>('/appointments/admin/setup/bookable-officers'),
  upsertBookableOfficer: (data: UpsertBookableOfficer) =>
    request<{ ok: boolean }>('/appointments/admin/setup/bookable-officers', { method: 'POST', body: JSON.stringify(data) }),
  deleteBookableOfficer: (officerId: string) =>
    request<{ ok: boolean }>(`/appointments/admin/setup/bookable-officers/${officerId}`, { method: 'DELETE' }),
  getApprovers: (officerId: string) =>
    request<{ approvers: ApproverRecord[] }>(`/appointments/admin/setup/approvers/${officerId}`),
  addApprover: (officer_id: string, user_id: string) =>
    request<{ ok: boolean }>('/appointments/admin/setup/approvers', { method: 'POST', body: JSON.stringify({ officer_id, user_id }) }),
  removeApprover: (id: string) =>
    request<{ ok: boolean }>(`/appointments/admin/setup/approvers/${id}`, { method: 'DELETE' }),
  getApproverCandidates: () =>
    request<{ candidates: ApproverCandidate[] }>('/appointments/admin/setup/approver-candidates'),
  publicOfficers: () =>
    request<{ officers: PublicBookableOfficer[] }>('/appointments/public/officers'),
};
