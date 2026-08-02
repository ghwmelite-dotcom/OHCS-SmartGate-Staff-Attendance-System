import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listFailed, clearFailed, queueCount } from './offlineQueue';

// Queue-layer behaviour for terminally-failed replay entries: the SW marks a
// record { status: 'failed', failReason, failedAt } instead of deleting it;
// the reception banner lists those entries and dismiss clears ONLY the failed
// ones. Ported from packages/staff/src/lib/offlineQueue.test.ts (clock-queue →
// visit-queue). jsdom has no IndexedDB, so these tests run against a minimal
// in-memory fake that implements exactly the surface offlineQueue uses.

type StoreData = Map<string, Record<string, unknown>>;

function makeFakeIndexedDB() {
  const databases = new Map<string, Map<string, StoreData>>();

  function makeDb(stores: Map<string, StoreData>) {
    return {
      objectStoreNames: { contains: (n: string) => stores.has(n) },
      createObjectStore: (n: string) => { stores.set(n, new Map()); },
      transaction(storeName: string, _mode: string) {
        const data = stores.get(storeName)!;
        let pending = 0;
        const tx: {
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          objectStore: () => Record<string, (arg?: any) => unknown>;
        } = { oncomplete: null, onerror: null, objectStore: () => ({}) };
        const finish = () => {
          pending--;
          if (pending === 0) queueMicrotask(() => tx.oncomplete?.());
        };
        const run = (fn: () => unknown) => {
          pending++;
          const req: {
            result?: unknown; error?: unknown;
            onsuccess: (() => void) | null; onerror: (() => void) | null;
          } = { onsuccess: null, onerror: null };
          queueMicrotask(() => {
            try {
              req.result = fn();
              req.onsuccess?.();
            } catch (e) {
              req.error = e;
              req.onerror?.();
              queueMicrotask(() => tx.onerror?.());
              return;
            }
            finish();
          });
          return req;
        };
        tx.objectStore = () => ({
          add: (rec: { id: string }) => run(() => {
            if (data.has(rec.id)) throw new Error('ConstraintError');
            data.set(rec.id, { ...rec });
          }),
          put: (rec: { id: string }) => run(() => { data.set(rec.id, { ...rec }); }),
          delete: (id: string) => run(() => { data.delete(id); }),
          getAll: () => run(() => [...data.values()]),
          count: () => run(() => data.size),
        });
        return tx;
      },
      close: () => {},
    };
  }

  return {
    open(name: string, _version?: number) {
      const req: {
        result?: unknown; error?: unknown;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = { onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        const isNew = !databases.has(name);
        if (isNew) databases.set(name, new Map());
        req.result = makeDb(databases.get(name)!);
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// Seed a record the way the SW would leave it after a replay pass.
async function seedRecord(rec: Record<string, unknown>): Promise<void> {
  const db = await new Promise<{ transaction: (s: string, m: string) => {
    objectStore: (s: string) => { put: (r: Record<string, unknown>) => void };
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
  }; close: () => void }>((resolve, reject) => {
    const req = (indexedDB as unknown as ReturnType<typeof makeFakeIndexedDB>).open('ohcs-queue', 1) as {
      result: never; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null;
    };
    req.onupgradeneeded = () => {
      const d = req.result as unknown as { objectStoreNames: { contains: (n: string) => boolean }; createObjectStore: (n: string) => void };
      if (!d.objectStoreNames.contains('visit-queue')) d.createObjectStore('visit-queue');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('open failed'));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('visit-queue', 'readwrite');
    tx.objectStore('visit-queue').put(rec);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(new Error('seed failed'));
  });
}

function pendingRecord(id: string): Record<string, unknown> {
  // Legacy shape — none of the new replay-state fields.
  return {
    id,
    endpoint: '/api/visits/check-in',
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
    createdAt: Date.now(),
  };
}

function failedRecord(id: string): Record<string, unknown> {
  return {
    ...pendingRecord(id),
    attempts: 1,
    status: 'failed',
    failReason: 'Session expired — sign in again',
    failedAt: Date.now(),
  };
}

describe('offlineQueue failed-entry handling', () => {
  beforeEach(() => {
    // Fresh fake per test so stores don't leak between cases.
    Object.defineProperty(globalThis, 'indexedDB', {
      value: makeFakeIndexedDB(),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
  });

  it('lists no failed entries when the queue only holds pending/legacy records', async () => {
    await seedRecord(pendingRecord('a'));
    await seedRecord(pendingRecord('b'));
    expect(await listFailed('visit-queue')).toEqual([]);
    expect(await queueCount('visit-queue')).toBe(2);
  });

  it('retains failed entries and returns them with their reason', async () => {
    await seedRecord(failedRecord('x'));
    const failed = await listFailed('visit-queue');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.id).toBe('x');
    expect(failed[0]!.failReason).toBe('Session expired — sign in again');
    expect(failed[0]!.failedAt).toBeTypeOf('number');
    // Retained — still in the store.
    expect(await queueCount('visit-queue')).toBe(1);
  });

  it('listFailed excludes pending records', async () => {
    await seedRecord(pendingRecord('p'));
    await seedRecord(failedRecord('f'));
    const failed = await listFailed('visit-queue');
    expect(failed.map((r) => r.id)).toEqual(['f']);
  });

  it('clearFailed removes only the failed entries and keeps pending ones', async () => {
    await seedRecord(pendingRecord('keep-1'));
    await seedRecord(failedRecord('drop-1'));
    await seedRecord(failedRecord('drop-2'));
    await clearFailed('visit-queue');
    expect(await listFailed('visit-queue')).toEqual([]);
    expect(await queueCount('visit-queue')).toBe(1);
  });
});
