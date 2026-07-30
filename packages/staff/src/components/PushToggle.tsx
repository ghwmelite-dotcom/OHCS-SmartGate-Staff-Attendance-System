import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Send } from 'lucide-react';
import { enablePush, disablePush, getPushStatus, testPush } from '@/lib/pushClient';

export function PushToggle() {
  const [state, setState] = useState<'idle' | 'loading' | 'on' | 'off' | 'unsupported'>('loading');
  const [err, setErr] = useState('');
  const [testState, setTestState] = useState<'idle' | 'sending'>('idle');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    getPushStatus().then(s => setState(s.subscribed ? 'on' : 'off')).catch(() => setState('off'));
  }, []);

  if (state === 'unsupported') {
    return <div className="text-[12px] text-gray-500 text-center py-2">Push notifications not supported on this browser.</div>;
  }

  async function toggle() {
    setErr('');
    const was = state;
    setState('loading');
    try {
      if (was === 'on') {
        await disablePush();
        setState('off');
      } else {
        await enablePush();
        setState('on');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      setState(was);
    }
  }

  async function sendTest() {
    setTestMsg(null);
    setTestState('sending');
    try {
      const r = await testPush();
      if (r.sent === 0) {
        setTestMsg({ ok: false, text: r.hint ?? 'No subscription found — enable notifications first.' });
      } else if (r.delivered > 0) {
        setTestMsg({ ok: true, text: 'Sent! Check your lock screen — a test notification should appear.' });
      } else {
        const s = r.results[0]?.status ?? 0;
        const why = (s === 401 || s === 403)
          ? 'the app needs a fresh subscription. Fully close the app, reopen it, then Disable and Enable notifications again.'
          : `the push service returned ${s || 'an error'}.`;
        setTestMsg({ ok: false, text: `Not delivered — ${why}` });
      }
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTestState('idle');
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'loading'}
        className="w-full h-11 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold text-[14px] hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
      >
        {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
         state === 'on' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {state === 'on' ? 'Disable notifications' : 'Enable notifications'}
      </button>
      {state === 'on' && (
        <button
          type="button"
          onClick={sendTest}
          disabled={testState === 'sending'}
          className="w-full h-10 px-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-semibold text-[13px] hover:bg-emerald-100 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {testState === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send a test notification
        </button>
      )}
      {testMsg && (
        <p className={`text-[11px] font-medium text-center ${testMsg.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{testMsg.text}</p>
      )}
      {err && <p className="text-red-600 text-[11px] font-medium text-center">{err}</p>}
    </div>
  );
}
