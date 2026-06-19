import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';
import { getToken } from './tokenStore';

const API_BASE = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ohcsghana-main.workers.dev' : '';

// Legacy key (staff_id only) — read on first run, then mirrored into the new key and cleared.
const LEGACY_LAST_STAFF_ID_KEY = 'ohcs.last_staff_id';
// New key persists both the identifier kind and value so NSS users land back on the NSS tab.
const LAST_IDENTIFIER_KEY = 'ohcs-staff-pwa.last-identifier';

export type IdentifierKind = 'staff_id' | 'nss_number' | 'intern_code';
export interface Identifier { kind: IdentifierKind; value: string }

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function rememberIdentifier(identifier: Identifier): void {
  try {
    localStorage.setItem(
      LAST_IDENTIFIER_KEY,
      JSON.stringify({ kind: identifier.kind, value: identifier.value.toUpperCase() }),
    );
    // Once we've migrated forward, drop the legacy key so we don't keep re-mirroring it.
    localStorage.removeItem(LEGACY_LAST_STAFF_ID_KEY);
  } catch { /* ignore */ }
}

export function getLastIdentifier(): Identifier | null {
  try {
    const raw = localStorage.getItem(LAST_IDENTIFIER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { kind?: string; value?: string };
      if (
        (parsed.kind === 'staff_id' || parsed.kind === 'nss_number' || parsed.kind === 'intern_code') &&
        typeof parsed.value === 'string' &&
        parsed.value.length > 0
      ) {
        return { kind: parsed.kind, value: parsed.value };
      }
    }
    // Migration: an older build only stored staff_id as a plain string. Treat it as staff.
    const legacy = localStorage.getItem(LEGACY_LAST_STAFF_ID_KEY);
    if (legacy && legacy.length > 0) {
      const migrated: Identifier = { kind: 'staff_id', value: legacy };
      try {
        localStorage.setItem(LAST_IDENTIFIER_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_LAST_STAFF_ID_KEY);
      } catch { /* ignore */ }
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLastIdentifier(): void {
  try {
    localStorage.removeItem(LAST_IDENTIFIER_KEY);
    localStorage.removeItem(LEGACY_LAST_STAFF_ID_KEY);
  } catch { /* ignore */ }
}

// --- Back-compat shims (kept narrow). Existing call sites can migrate over time. ---

/** @deprecated Use rememberIdentifier({ kind: 'staff_id', value }) */
export function rememberStaffId(staffId: string): void {
  rememberIdentifier({ kind: 'staff_id', value: staffId });
}

/** @deprecated Use getLastIdentifier() */
export function getLastStaffId(): string | null {
  const id = getLastIdentifier();
  return id?.kind === 'staff_id' ? id.value : null;
}

/** @deprecated Use clearLastIdentifier() */
export function clearLastStaffId(): void {
  clearLastIdentifier();
}

export function supportsWebAuthn(): boolean {
  return browserSupportsWebAuthn();
}

export async function supportsPlatformAuthenticator(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export interface StoredCredentialSummary {
  id: string;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
}

function defaultDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'This device';
}

/** Enroll the current authenticated user's device as a biometric credential. */
export async function registerBiometric(deviceLabel?: string): Promise<StoredCredentialSummary> {
  if (!browserSupportsWebAuthn()) throw new Error('Biometrics not supported on this browser');

  const optsRes = await fetch(`${API_BASE}/api/auth/webauthn/register/options`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
  });
  if (!optsRes.ok) throw new Error(`Could not start enrollment (${optsRes.status})`);
  const { data: options } = await optsRes.json() as { data: PublicKeyCredentialCreationOptionsJSON };

  const attResp = await startRegistration({ optionsJSON: options });

  const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/register/verify`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
    body: JSON.stringify({ response: attResp, device_label: deviceLabel ?? defaultDeviceLabel() }),
  });
  if (!verifyRes.ok) {
    const detail = await verifyRes.text().catch(() => '');
    throw new Error(`Enrollment failed: ${detail || verifyRes.status}`);
  }
  const { data } = await verifyRes.json() as { data: { id: string; device_label: string | null } };
  return {
    id: data.id,
    device_label: data.device_label,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export interface WebAuthnUser {
  id: string;
  name: string;
  email: string;
  role: string;
  pin_acknowledged: boolean;
  session_token?: string;
}

export async function loginWithBiometric(identifier: Identifier): Promise<WebAuthnUser> {
  if (!browserSupportsWebAuthn()) throw new Error('Biometrics not supported on this browser');
  const value = identifier.value.toUpperCase();
  const idBody =
    identifier.kind === 'staff_id'   ? { staff_id: value } :
    identifier.kind === 'nss_number' ? { nss_number: value } :
                                       { intern_code: value };

  const optsRes = await fetch(`${API_BASE}/api/auth/webauthn/login/options`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
    body: JSON.stringify(idBody),
  });
  if (!optsRes.ok) throw new Error(`Could not start sign-in (${optsRes.status})`);
  const { data: options } = await optsRes.json() as { data: PublicKeyCredentialRequestOptionsJSON };

  const assertion = await startAuthentication({ optionsJSON: options });

  const verifyRes = await fetch(`${API_BASE}/api/auth/webauthn/login/verify`, {
    method: 'POST', credentials: 'include', headers: authHeaders(),
    body: JSON.stringify({ ...idBody, response: assertion, remember: true }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Sign-in failed (${verifyRes.status})`);
  }
  const { data } = await verifyRes.json() as { data: { user: WebAuthnUser } };
  return data.user;
}

export async function listCredentials(): Promise<StoredCredentialSummary[]> {
  const res = await fetch(`${API_BASE}/api/auth/webauthn/credentials`, {
    credentials: 'include', headers: authHeaders(),
  });
  if (!res.ok) return [];
  const { data } = await res.json() as { data: StoredCredentialSummary[] };
  return data ?? [];
}

export async function removeCredential(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/webauthn/credentials/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'include', headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Could not remove credential (${res.status})`);
}
