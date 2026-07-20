import { API_BASE } from './constants';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

/** Error thrown by kiosk requests. Carries the server error code + HTTP status so
 *  callers can distinguish specific failures (e.g. 422 ID_NOT_VERIFIED). */
export class KioskApiError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = 'KioskApiError';
    this.code = code;
    this.status = status;
  }
}

async function kioskRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/kiosk${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) {
    throw new KioskApiError(
      json.error?.message ?? `Request failed (${res.status})`,
      json.error?.code ?? null,
      res.status,
    );
  }
  return json.data as T;
}

async function kioskUploadPhoto<T>(visitorId: string, kind: 'photo' | 'id-photo' | 'id-photo-back', blob: Blob): Promise<T> {
  const buf = await blob.arrayBuffer();
  const res = await fetch(`${API_BASE}/kiosk/visitors/${visitorId}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: buf,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Photo upload failed (${res.status})`);
  return json.data as T;
}

async function kioskGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/kiosk${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}

export interface KioskVisitor {
  id: string;
  first_name: string;
  last_name: string;
}

/** Host availability (host-availability contract). Missing/undefined ⇒ available. */
export type AvailabilityStatus = 'available' | 'in_meeting' | 'out_of_office';

/** Minimal returning-visitor match from GET /kiosk/visitor-by-phone. */
export interface KioskVisitorMatch {
  id: string;
  first_name: string;
  last_name: string;
  organisation: string | null;
  photo_url: string | null;
}

export interface KioskVisit {
  id: string;
  badge_code: string | null;
  checkout_pin: string | null;
  visitor_name?: string;
  host_name?: string | null;
  directorate_name?: string | null;
  directorate_abbr?: string | null;
  check_in_at?: string | null;
  floor?: string | null;
  wing?: string | null;
  /** Single-use satisfaction-survey token, minted at checkout (10-min TTL). */
  survey_token?: string | null;
}

export interface KioskOfficer {
  id: string;
  name: string;
  title: string | null;
  directorate_id: string;
  directorate_abbr: string;
  /** Additive host-availability field — absent until that column lands; treat as available. */
  availability_status?: AvailabilityStatus | null;
}

export interface KioskDirectorate {
  id: string;
  name: string;
  abbreviation: string;
  type: string;
  org_type: string | null;
}

export type OfficeStatusReason = 'open' | 'before_hours' | 'after_hours' | 'weekend' | 'holiday';

export interface KioskOfficeStatus {
  open: boolean;
  reason: OfficeStatusReason;
  holiday_name: string | null;
  work_start: string;
  work_end: string;
  date: string;
  weekday: number;
  server_time: string;
}

export interface IdCheckVerdict {
  verdict: 'document' | 'not_document' | 'indeterminate';
  detected_type?: 'ghana_card' | 'passport' | 'drivers_license' | 'staff_id' | 'other' | 'none';
  confidence?: number;
  model?: string;
  checked_at?: string;
}
export interface IdPhotoResult { id_photo_url: string; id_check?: IdCheckVerdict; }

export interface KioskCheckInBody {
  visitor_id: string;
  directorate_id?: string;
  host_name_manual?: string;
  purpose_raw?: string;
  /** AI document-gate verdict captured during ID upload. */
  id_check?: IdCheckVerdict;
  /** Reception PIN to override a failed ID document gate. */
  reception_override_pin?: string;
}

export const kioskApi = {
  createVisitor: (body: Record<string, unknown>) => kioskRequest<KioskVisitor>('/visitors', body),
  uploadFacePhoto: (id: string, blob: Blob) => kioskUploadPhoto<{ photo_url: string }>(id, 'photo', blob),
  uploadIdPhoto: (id: string, blob: Blob) => kioskUploadPhoto<IdPhotoResult>(id, 'id-photo', blob),
  uploadIdPhotoBack: (id: string, blob: Blob) => kioskUploadPhoto<{ id_photo_back_url: string }>(id, 'id-photo-back', blob),
  checkIn: (body: KioskCheckInBody) => kioskRequest<KioskVisit>('/check-in', body),
  checkOut: (badgeCode: string) => kioskRequest<KioskVisit>('/check-out', { badge_code: badgeCode }),
  checkOutByPin: (pin: string) => kioskRequest<KioskVisit>('/check-out-by-pin', { pin }),
  submitSurvey: (body: { token: string; rating: number; comment?: string }) =>
    kioskRequest<{ ok: boolean }>('/survey', body),
  getOfficers: () => kioskGet<KioskOfficer[]>('/officers'),
  getDirectorates: () => kioskGet<KioskDirectorate[]>('/directorates'),
  getStatus: () => kioskGet<KioskOfficeStatus>('/status'),
  getVisitorByPhone: (phone: string) =>
    kioskGet<KioskVisitorMatch>(`/visitor-by-phone?phone=${encodeURIComponent(phone)}`),
};
