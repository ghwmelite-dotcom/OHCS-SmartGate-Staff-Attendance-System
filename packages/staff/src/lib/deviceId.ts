// Persistent per-install device identifier sent with each clock submit
// (attendance risk fusion — device_novelty factor, see
// docs/superpowers/plans/2026-07-19-attendance-risk-fusion.md). Random UUID,
// no PII, never tied to user identity client-side.
//
// Stored in its OWN tiny IndexedDB database ('ohcs-device', store 'meta') —
// deliberately NOT a version bump of offlineQueue.ts's 'ohcs-queue' DB, so
// the two openers never coordinate onupgradeneeded. IDB survives service
// worker updates; localStorage is the fallback when IDB is unavailable.

const DB_NAME = 'ohcs-device';
const DB_VERSION = 1;
const STORE = 'meta';
const KEY = 'device_id';

let memo: string | null = null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDeviceId(): Promise<string> {
  if (memo) return memo;
  try {
    const db = await open();
    const existing = await idbGet(db, KEY);
    if (existing) {
      db.close();
      return (memo = existing);
    }
    const id = crypto.randomUUID();
    await idbPut(db, KEY, id);
    db.close();
    return (memo = id);
  } catch {
    // IDB unavailable (private mode, old browser) — localStorage fallback.
    const ls = localStorage.getItem(KEY);
    if (ls) return (memo = ls);
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return (memo = id);
  }
}
