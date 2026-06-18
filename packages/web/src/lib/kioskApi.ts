import { API_BASE } from './constants';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

async function kioskRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/kiosk${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}

async function kioskUploadPhoto<T>(visitorId: string, kind: 'photo' | 'id-photo', blob: Blob): Promise<T> {
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

export interface KioskVisit {
  id: string;
  badge_code: string | null;
  visitor_name?: string;
}

export interface KioskDirectorate {
  id: string;
  name: string;
  abbreviation: string;
  reception_officer_name: string | null;
}

export interface IdCheckVerdict {
  verdict: 'document' | 'not_document' | 'indeterminate';
  detected_type?: 'ghana_card' | 'passport' | 'drivers_license' | 'staff_id' | 'other' | 'none';
  confidence?: number;
  model?: string;
  checked_at?: string;
}
export interface IdPhotoResult { id_photo_url: string; id_check?: IdCheckVerdict; }

export const kioskApi = {
  createVisitor: (body: Record<string, unknown>) => kioskRequest<KioskVisitor>('/visitors', body),
  uploadFacePhoto: (id: string, blob: Blob) => kioskUploadPhoto<{ photo_url: string }>(id, 'photo', blob),
  uploadIdPhoto: (id: string, blob: Blob) => kioskUploadPhoto<IdPhotoResult>(id, 'id-photo', blob),
  checkIn: (body: Record<string, unknown>) => kioskRequest<KioskVisit>('/check-in', body),
  checkOut: (badgeCode: string) => kioskRequest<KioskVisit>('/check-out', { badge_code: badgeCode }),
  getDirectorates: () => kioskGet<KioskDirectorate[]>('/directorates'),
};
