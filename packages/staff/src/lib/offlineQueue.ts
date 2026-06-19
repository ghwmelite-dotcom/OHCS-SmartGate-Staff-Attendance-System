import { getToken } from './tokenStore';

const DB_NAME = 'ohcs-queue';
const DB_VERSION = 1;
const STORES = ['clock-queue'] as const;
export type QueueTag = typeof STORES[number];

interface QueueRecord {
  id: string;
  endpoint: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(tag: QueueTag, record: QueueRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tag, 'readwrite');
    tx.objectStore(tag).add(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function queueCount(tag: QueueTag): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tag, 'readonly');
    const req = tx.objectStore(tag).count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export type ApiOrQueueResult<T> = { ok: true; data: T } | { queued: true; id: string };

export async function apiOrQueue<T>(
  tag: QueueTag,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ApiOrQueueResult<T>> {
  const idempotency_key = crypto.randomUUID();
  const fullBody = { ...body, idempotency_key };
  const token = getToken();
  // Relative same-origin URL; the Worker routes /api/* first-party.
  const url = `/api${endpoint}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(fullBody),
    });
  } catch {
    // Network failure (TypeError "Failed to fetch"). Queue for retry.
    await enqueue(tag, {
      id: idempotency_key,
      endpoint: url,
      method: 'POST',
      body: JSON.stringify(fullBody),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      createdAt: Date.now(),
    });
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(tag);
      } catch {
        // Fallback: SW online handler will flush.
      }
    }
    return { queued: true, id: idempotency_key };
  }

  if (!res.ok) {
    // Server responded with an HTTP error — NOT a network failure.
    // Propagate the error code alongside the message so callers can branch
    // on it (e.g. open a PIN modal on REAUTH_REQUIRED).
    const errBody = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const err = new Error(errBody?.error?.message ?? `Request failed (${res.status})`) as Error & { code?: string };
    err.code = errBody?.error?.code;
    throw err;
  }

  const parsed = await res.json() as { data: T };
  return { ok: true, data: parsed.data };
}
