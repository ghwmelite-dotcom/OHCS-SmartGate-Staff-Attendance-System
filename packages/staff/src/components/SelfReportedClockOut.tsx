import { useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, fetchClockPrompt } from '@/lib/api';

interface Props {
  attendanceDate: string;
  onRecorded: () => void;
}

/** Deliberately online-only: never imply success before the server acknowledges. */
export function SelfReportedClockOut({ attendanceDate, onRecorded }: Props) {
  const [open, setOpen] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [time, setTime] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());
  const locked = useRef(false);
  const requestDeparture = useRef<{ departure_at?: string } | null>(null);
  const control = 'min-h-12 rounded-xl border border-border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

  async function submit(passkey: boolean) {
    if (locked.current) return;
    if (earlier && !/^\d{2}:\d{2}$/.test(time)) { setMessage('Enter the time you left today.'); return; }
    locked.current = true;
    setBusy(true);
    setMessage('');
    // Keep the original payload/key after a lost response. Changing the form
    // explicitly starts a new request; the server still prevents duplicate outs.
    requestDeparture.current ??= earlier ? { departure_at: `${attendanceDate}T${time}:00.000Z` } : {};
    try {
      const prompt = await fetchClockPrompt();
      const assertion = passkey ? await startAuthentication({ optionsJSON: {
        challenge: btoa(prompt.promptId).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
        rpId: window.location.hostname, userVerification: 'required', timeout: 60000,
      } }) : undefined;
      await api.post('/clock/self-report-out', {
        idempotency_key: key.current, prompt_id: prompt.promptId,
        ...requestDeparture.current,
        ...(passkey ? { webauthn_assertion: assertion } : { pin }),
      });
      setPin('');
      setOpen(false);
      setMessage('Departure recorded as self-reported.');
      onRecorded();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not record your departure. Please retry online.');
    } finally { locked.current = false; setBusy(false); }
  }
  function changed() { key.current = crypto.randomUUID(); requestDeparture.current = null; setMessage(''); }

  return <div className="w-full text-sm">
    {!open ? <button type="button" className="min-h-12 w-full text-muted underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setOpen(true)}>
      Already left the office?
    </button> : <form className="space-y-3 rounded-2xl border border-border bg-surface p-4" onSubmit={e => { e.preventDefault(); void submit(false); }} aria-label="Record your departure">
      <h2 className="font-semibold text-foreground">Record your departure</h2>
      <p className="text-muted">No location check needed. This is self-reported, not verified on-site attendance or approval for early leave.</p>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="sr-only">Departure details</legend>
        <label className="flex min-h-12 items-center gap-3"><input type="radio" name="departure" checked={!earlier} onChange={() => { setEarlier(false); changed(); }} />Just left</label>
        <label className="flex min-h-12 items-center gap-3"><input type="radio" name="departure" checked={earlier} onChange={() => { setEarlier(true); changed(); }} />Left earlier today</label>
        {earlier && <label className="block space-y-1"><span>Departure time (Ghana time)</span><input aria-label="Departure time (Ghana time)" className={`${control} w-full`} type="time" required value={time} onChange={e => { setTime(e.target.value); changed(); }} /></label>}
        <label className="block space-y-1"><span>Your 6-digit PIN</span><input className={`${control} w-full`} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <button className="min-h-12 w-full rounded-xl bg-primary px-4 text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" type="submit">{busy ? 'Recording…' : 'Confirm departure'}</button>
        {typeof window.PublicKeyCredential !== 'undefined' && <button className={`${control} w-full`} type="button" onClick={() => void submit(true)}>Confirm with passkey instead</button>}
        <button className={`${control} w-full`} type="button" onClick={() => { setOpen(false); setPin(''); }}>Cancel</button>
      </fieldset>
      <p className="text-xs text-muted">Your departure time and the time you submit this report are both retained. Previous day? Contact admin.</p>
    </form>}
    {message && <p className="mt-2 text-foreground" role="status">{message}</p>}
  </div>;
}
