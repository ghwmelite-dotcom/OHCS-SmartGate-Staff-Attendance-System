const CACHE_NAME = 'staff-clock-v7';
const OFFLINE_URL = '/offline.html';
const QUEUE_DB = 'ohcs-queue';
const QUEUE_DB_VERSION = 1;
const QUEUE_STORES = ['clock-queue'];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))),
  ]));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api') || url.hostname !== self.location.hostname) return;

  // Never SW-cache the navigation root or the SW itself — every deploy
  // changes the bundle hashes referenced from index.html, and a stale
  // index.html would point at non-existent JS files. Always go to network
  // for these so new deploys propagate the moment the user reopens the PWA.
  const isShell = e.request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname === '/sw.js';

  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && !isShell) {
        const c = r.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, c));
      }
      return r;
    }).catch(async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === 'navigate') {
        const offline = await caches.match(OFFLINE_URL);
        if (offline) return offline;
      }
      return new Response('', { status: 504 });
    })
  );
});

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, QUEUE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of QUEUE_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(db, store, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function putRecord(db, store, rec) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Replay-outcome classification -----------------------------------------
// VERBATIM copy of src/lib/replayOutcome.ts (this file is a plain script and
// cannot import). Keep the two in sync; the TS copy carries the unit tests.
const MAX_REPLAY_ATTEMPTS = 10;

const FAIL_REASONS = {
  PROMPT_NOT_FOUND: 'Clock session expired',
  PROMPT_EXPIRED: 'Clock session expired',
  REAUTH_REQUIRED: 'Sign-in verification expired',
  REAUTH_FAILED: 'Sign-in verification failed',
  PRESENCE_REQUIRED: 'Presence scan missing at replay',
  OUTSIDE_GEOFENCE: 'Outside office zone at replay',
  GPS_TOO_IMPRECISE: 'GPS signal too weak at replay',
};

function classifyReplayOutcome(res, attempts, ageMs) {
  if (ageMs > MAX_AGE_MS) {
    return { action: 'failed', reason: 'Queued for over 24 hours' };
  }
  const retryOrCap = () =>
    attempts + 1 >= MAX_REPLAY_ATTEMPTS
      ? { action: 'failed', reason: `Server unreachable after ${MAX_REPLAY_ATTEMPTS} tries` }
      : { action: 'retry' };

  if (!res || res.networkError) return retryOrCap();
  const { status, errorCode } = res;
  if (status >= 200 && status < 300) return { action: 'delivered' };
  if (errorCode === 'ALREADY_CLOCKED') return { action: 'delivered' };
  if (status === 429 || status >= 500) return retryOrCap();
  if (status >= 400 && status < 500) {
    return { action: 'failed', reason: FAIL_REASONS[errorCode] || 'Rejected by the server at replay' };
  }
  return retryOrCap();
}

// Failed entries are retained for user dismissal but never replayed again.
// Missing status (records queued before this shipped) = pending.
function isReplayPending(rec) {
  return rec.status !== 'failed';
}
// --- end verbatim copy ------------------------------------------------------

async function drainStore(storeName) {
  const db = await openQueueDb();
  const records = await readAll(db, storeName);
  let synced = 0, failed = 0, firstFailReason = null;
  for (const rec of records) {
    if (!isReplayPending(rec)) continue;
    const attempts = rec.attempts || 0;
    const ageMs = Date.now() - rec.createdAt;

    let fetchResult = null;
    if (ageMs <= MAX_AGE_MS) {
      try {
        const res = await fetch(rec.endpoint, { method: rec.method, headers: rec.headers, body: rec.body, credentials: 'include' });
        fetchResult = { status: res.status, errorCode: null };
        if (!res.ok) {
          // Parse the error envelope ({error:{code}}) — ALREADY_CLOCKED is a
          // delivered record, not a failure.
          const body = await res.json().catch(() => null);
          fetchResult.errorCode = body && body.error && body.error.code ? body.error.code : null;
        }
      } catch {
        fetchResult = { networkError: true };
      }
    }

    const outcome = classifyReplayOutcome(fetchResult, attempts, ageMs);
    if (outcome.action === 'delivered') {
      await deleteRecord(db, storeName, rec.id);
      synced++;
    } else if (outcome.action === 'retry') {
      await putRecord(db, storeName, { ...rec, attempts: attempts + 1 });
      // Transient failure — back off until the next sync/online flush instead
      // of hammering a struggling server with the rest of the queue.
      break;
    } else {
      // Terminal failure — MARK the entry (never silently delete); the clock
      // page surfaces it until the user dismisses.
      await putRecord(db, storeName, {
        ...rec,
        attempts: attempts + 1,
        status: 'failed',
        failReason: outcome.reason,
        failedAt: Date.now(),
      });
      failed++;
      if (!firstFailReason) firstFailReason = outcome.reason;
    }
  }
  db.close();
  return { synced, failed, firstFailReason };
}

async function notifyClients({ synced, failed, firstFailReason }) {
  const clientsList = await self.clients.matchAll({ type: 'window' });
  for (const c of clientsList) {
    c.postMessage({ type: 'queue-drained', synced, failed });
    if (failed > 0) c.postMessage({ type: 'queue-failed', failed, reason: firstFailReason });
  }
}

async function drainAll() {
  let synced = 0, failed = 0, firstFailReason = null;
  for (const s of QUEUE_STORES) {
    const r = await drainStore(s);
    synced += r.synced; failed += r.failed;
    if (!firstFailReason) firstFailReason = r.firstFailReason;
  }
  await notifyClients({ synced, failed, firstFailReason });
}

self.addEventListener('sync', (event) => {
  if (QUEUE_STORES.includes(event.tag)) {
    event.waitUntil(drainStore(event.tag).then(notifyClients));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'flush-queue') event.waitUntil(drainAll());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'OHCS Staff Attendance';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.type || 'default',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.endsWith(url) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
