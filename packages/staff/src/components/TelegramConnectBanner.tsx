import { useEffect, useRef, useState } from 'react';
import { getTelegramStatus, createTelegramLinkToken } from '@/lib/telegramClient';

// Proactive Telegram-linking nudge. Telegram delivery is the reliable path for
// the clock nudge ladder (no browser push permission needed, works with the
// app closed), so we ask once on the clock page when the officer hasn't linked
// yet; "Not now" snoozes for 14 days. Returning from Telegram (window focus)
// re-checks the link state and shows a brief confirmation when it flipped.
const DISMISS_KEY = 'ohcs.telegram.connect.dismissed_at';
const REASK_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export function TelegramConnectBanner() {
  const [visible, setVisible] = useState(false);
  const [entityAbbr, setEntityAbbr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const visibleRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const showBanner = (v: boolean) => {
      visibleRef.current = v;
      setVisible(v);
    };

    const check = async () => {
      try {
        const status = await getTelegramStatus();
        if (cancelled) return;
        if (status.linked) {
          if (visibleRef.current) {
            // Returned from Telegram and the link landed — confirm, then hide.
            setDone(true);
            setTimeout(() => { if (!cancelled) showBanner(false); }, 2500);
          }
          return;
        }
        setEntityAbbr(status.entityAbbr);
        const dismissedAt = localStorage.getItem(DISMISS_KEY);
        if (dismissedAt && Date.now() - new Date(dismissedAt).getTime() < REASK_AFTER_MS) return;
        showBanner(true);
      } catch { /* nudge is best-effort — render nothing on failure */ }
    };

    void check();
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* private mode */ }
    visibleRef.current = false;
    setVisible(false);
  };

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await createTelegramLinkToken();
      window.location.assign(url);
    } catch {
      // Token mint failed — hide without snoozing so a later visit retries.
      visibleRef.current = false;
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-sky-50 border border-sky-200 p-4 flex items-start gap-3 animate-fade-in-up">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-sky-500 text-white grid place-items-center text-lg" aria-hidden>
        ✈️
      </div>
      <div className="flex-1 min-w-0">
        {done ? (
          <p className="text-sm font-semibold text-sky-900">
            ✅ Telegram connected — reminders will reach you there too.
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-sky-900">{entityAbbr ?? 'OHCS'} Attendance Alerts</p>
            <p className="text-sm text-sky-800 mt-1">
              Link your Telegram once and we&apos;ll remind you to clock in each morning and clock out each evening — reliably, even with the app closed.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={connect}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium rounded-xl bg-sky-500 text-white disabled:opacity-50"
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-sm font-medium rounded-xl text-sky-700"
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
