import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { clearFailed, listFailed, type QueueRecord } from '@/lib/offlineQueue';

// Amber banner for queued visit mutations the service worker could NOT
// deliver and has marked failed (terminal 4xx, >24h old, or retry cap
// reached). Before this, the replay silently deleted those entries — a
// check-in the UI had confirmed as "Saved offline" simply never existed.
// Failed entries are retained in IndexedDB until reception dismisses here;
// Dismiss clears ONLY failed entries, never pending ones.
//
// Refresh triggers: mount, window focus, and the SW's postMessage after a
// replay pass ('queue-drained' / 'queue-failed').
// Ported from packages/staff/src/components/QueuedFailuresBanner.tsx.
export function QueuedFailuresBanner() {
  const [failed, setFailed] = useState<QueueRecord[]>([]);

  const refresh = useCallback(async () => {
    try {
      setFailed(await listFailed('visit-queue'));
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
      await clearFailed('visit-queue');
    } catch { /* still hide — next focus re-checks */ }
    setFailed([]);
  };

  return (
    <div className="bg-accent/10 rounded-2xl border border-accent/15 shadow-sm p-4 flex flex-wrap items-center gap-3 animate-fade-in-up">
      <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
        <AlertTriangle className="h-4 w-4 text-accent-warm" />
      </div>
      <div className="flex-1 min-w-[200px]">
        <p className="text-[14px] font-semibold text-foreground">
          {failed.length} offline check-in{failed.length === 1 ? '' : 's'} couldn&apos;t be submitted.
        </p>
        <p className="text-[12px] text-muted mt-0.5">
          {firstReason}. Please re-do {failed.length === 1 ? 'this check-in' : 'these check-ins'} manually.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="inline-flex items-center gap-2 h-9 px-4 text-[12px] font-semibold rounded-xl transition-all shrink-0 bg-accent text-white hover:bg-accent-warm shadow-sm active:scale-[0.98]"
      >
        Dismiss
      </button>
    </div>
  );
}
