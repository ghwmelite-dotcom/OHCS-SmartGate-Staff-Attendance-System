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

export async function getPushStatus(): Promise<{ subscribed: boolean; endpoints: number }> {
  const res = await fetch(`${API_BASE}/api/notifications/push/status`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) return { subscribed: false, endpoints: 0 };
  const { data } = await res.json() as { data: { subscribed: boolean; endpoints: number } };
  return data;
}

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Push not supported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission denied');
  const vapidPub = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPub) throw new Error('VAPID public key not configured');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidPub),
  });
  const json = sub.toJSON();
  const res = await fetch(`${API_BASE}/api/notifications/push/subscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) {
    // Roll back local subscription so UI state matches server state
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    const detail = await res.text().catch(() => '');
    throw new Error(`Subscribe failed (${res.status}): ${detail || 'server error'}`);
  }
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const res = await fetch(`${API_BASE}/api/notifications/push/unsubscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    console.error('[push] unsubscribe server-side failed:', res.status);
  }
}
