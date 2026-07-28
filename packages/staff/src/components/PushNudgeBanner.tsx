import { useEffect, useState } from 'react';
import { enablePush } from '@/lib/pushClient';

// Proactive push opt-in nudge. Push subscription is what makes the clock
// nudge ladder reach officers when the app is CLOSED (majority mobile) — the
// Settings toggle alone leaves most users unsubscribed. Shown once after
// login when the browser hasn't been asked yet (permission === 'default')
// and this device has no subscription; "Not now" snoozes for 14 days. If the
// user denies the browser prompt, permission flips to 'denied' and the banner
// never returns (the Settings toggle remains the recovery path).
const DISMISS_KEY = 'ohcs.push.nudge.dismissed_at';
const REASK_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export function PushNudgeBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
        if (Notification.permission !== 'default') return;
        const dismissedAt = localStorage.getItem(DISMISS_KEY);
        if (dismissedAt && Date.now() - new Date(dismissedAt).getTime() < REASK_AFTER_MS) return;
        const reg = await navigator.serviceWorker.ready;
        if (await reg.pushManager.getSubscription()) return; // already subscribed on this device
        setVisible(true);
      } catch { /* nudge is best-effort */ }
    })();
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* private mode */ }
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      await enablePush();
      setDone(true);
      setTimeout(() => setVisible(false), 2500);
    } catch {
      // Permission denied or unsupported (e.g. iOS outside the installed PWA)
      // — hide and let the Settings toggle be the recovery path.
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3 animate-fade-in-up">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-600 text-white grid place-items-center text-lg" aria-hidden>
        🔔
      </div>
      <div className="flex-1 min-w-0">
        {done ? (
          <p className="text-sm font-semibold text-emerald-900">
            ✅ You&apos;re all set — reminders will reach you even when the app is closed.
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-emerald-900">Get clock reminders on this phone</p>
            <p className="text-sm text-emerald-800 mt-1">
              We&apos;ll nudge you to clock in from 8am and to clock out after 5pm — even when the app isn&apos;t open.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={enable}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium rounded-xl bg-emerald-600 text-white disabled:opacity-50"
              >
                {busy ? 'Enabling…' : 'Enable notifications'}
              </button>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-sm font-medium rounded-xl text-emerald-700"
              >
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
