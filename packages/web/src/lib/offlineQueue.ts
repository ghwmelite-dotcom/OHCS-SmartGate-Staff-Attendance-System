import { getToken } from './tokenStore';

const DB_NAME = 'ohcs-queue';
const DB_VERSION = 1;
const STORES = ['visit-queue'] as const;
export type QueueTag = typeof STORES[number];

export interface QueueRecord {
  id: string;
  endpoint: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  createdAt: number;
  // Replay state, written by the service worker (public/sw.js). IndexedDB
  // object stores are schemaless, so these ride on the record shape — no DB
  // version bump, and records queued before this shipped simply lack them
  // (treated as attempts=0 / status='pending').
  attempts?: number;
  status?: 'pending' | 'failed';
  failReason?: string;
  failedAt?: number;
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

// Terminally-failed replay entries, oldest first — the SW marks these instead
// of deleting them so reception is told the visit mutation never landed.
export async function listFailed(tag: QueueTag): Promise<QueueRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tag, 'readonly');
    const req = tx.objectStore(tag).getAll();
    req.onsuccess = () => {
      db.close();
      const failed = (req.result as QueueRecord[]).filter((r) => r.status === 'failed');
      failed.sort((a, b) => (a.failedAt ?? 0) - (b.failedAt ?? 0));
      resolve(failed);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// Dismiss — deletes ONLY failed entries; pending ones are never touched.
export async function clearFailed(tag: QueueTag): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tag, 'readwrite');
    const store = tx.objectStore(tag);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const r of req.result as QueueRecord[]) {
        if (r.status === 'failed') store.delete(r.id);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export type ApiOrQueueResult<T> = { ok: true; data: T } | { queued: true; id: string };

export async function apiOrQueue<T>(
  tag: QueueTag,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ApiOrQueueResult<T>> {
  const idempotency_key = crypto.randomUUID();
  // Original capture time — rides on BOTH the live attempt and the queued
  // body, so a replay hours later can be recorded at the moment reception
  // actually tapped (the server validates it against a 48h window and ignores
  // anything outside it).
  const captured_at = new Date().toISOString();
  const fullBody = { ...body, idempotency_key, captured_at };
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
    // Propagate so the caller's onError can surface the real message.
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(errBody?.error?.message ?? `Request failed (${res.status})`);
  }

  const parsed = await res.json() as { data: T };
  return { ok: true, data: parsed.data };
}
