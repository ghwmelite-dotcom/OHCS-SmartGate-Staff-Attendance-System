import { getToken } from './tokenStore';

// Empty base → relative same-origin URLs; the Worker routes /api/* first-party.
const API_BASE = '';

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface TelegramStatus {
  linked: boolean;
  entityAbbr: string | null;
}

/** Whether this officer has linked a Telegram account for attendance nudges. */
export async function getTelegramStatus(): Promise<TelegramStatus> {
  const res = await fetch(`${API_BASE}/api/notifications/telegram/status`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Telegram status failed (${res.status})`);
  const { data } = await res.json() as { data: TelegramStatus };
  return data;
}

/** Mint a one-time deep link that pairs this account with the officer's Telegram chat. */
export async function createTelegramLinkToken(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/api/notifications/telegram/link-token`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Telegram link-token failed (${res.status})`);
  const { data } = await res.json() as { data: { url: string } };
  return data;
}
