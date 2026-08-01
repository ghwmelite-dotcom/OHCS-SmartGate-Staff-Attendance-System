import { useCallback, useEffect, useState } from 'react';
import { clearFailed, listFailed, type QueueRecord } from '@/lib/offlineQueue';

// Amber banner for queued clock events the service worker could NOT deliver
// and has marked failed (terminal 4xx, >24h old, or retry cap reached).
// Before this, the replay silently deleted those entries — the clock event
// simply never existed. Failed entries are retained in IndexedDB until the
// user dismisses here; Dismiss clears ONLY failed entries, never pending.
//
// Refresh triggers: mount, window focus, and the SW's postMessage after a
// replay pass ('queue-drained' / 'queue-failed') — the same channel the
// clock page already uses to invalidate status.
export function QueuedFailuresBanner() {
  const [failed, setFailed] = useState<QueueRecord[]>([]);

  const refresh = useCallback(async () => {
    try {
      setFailed(await listFailed('clock-queue'));
    } catch {
      // IndexedDB unavailable (private mode etc.) — banner is best-effort.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'queue-drained' || e.data?.type === 'queue-failed') void refresh();
    };
    window.addEventListener('focus', onFocus);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('focus', onFocus);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [refresh]);

  if (failed.length === 0) return null;
  const firstReason = failed[0]?.failReason ?? 'Rejected at replay';

  const dismiss = async () => {
    try {
      await clearFailed('clock-queue');
    } catch { /* still hide — next focus re-checks */ }
    setFailed([]);
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 animate-fade-in-up">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500 text-white grid place-items-center text-lg" aria-hidden>
        ⚠️
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          {failed.length} queued clock event{failed.length > 1 ? 's' : ''} couldn&apos;t be submitted
        </p>
        <p className="text-sm text-amber-800 mt-1">
          {firstReason}. If you haven&apos;t already, please clock in/out manually now.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={dismiss}
            className="px-3 py-1.5 text-sm font-medium rounded-xl bg-amber-500 text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
