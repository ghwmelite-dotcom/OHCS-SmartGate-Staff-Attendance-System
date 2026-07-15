import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { kioskApi, KioskApiError, type KioskVisit, type KioskDirectorate, type KioskOfficer, type KioskOfficeStatus } from '@/lib/kioskApi';
import { API_BASE, BADGE_BASE } from '@/lib/constants';
import { PhotoCapture } from '@/components/PhotoCapture';
import { QrScanner } from '@/components/QrScanner';
import { FieldWrapper } from '@/components/checkin/FieldWrapper';
import { PurposeRoutingHint } from '@/components/checkin/PurposeRoutingHint';
import { OfficerCombobox } from '@/components/checkin/OfficerCombobox';
import { suggestDirectorate, groupDirectorates } from '@/lib/directorate-routing';
import { StepIndicator } from '@/components/checkin/StepIndicator';
import { CheckCircle2, LogIn, LogOut, Loader2, X, User, Phone, Briefcase, Building2, ShieldAlert } from 'lucide-react';

const visitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'A valid Ghana phone is required'),
  organisation: z.string().max(200).optional(),
  directorate_id: z.string().min(1, 'Select a directorate'),
  host_name: z.string().min(1, 'Please enter who you are visiting').max(100),
  purpose_raw: z.string().min(1, 'Purpose of visit is required').max(500),
});
type VisitorForm = z.infer<typeof visitorSchema>;

type Mode = 'welcome' | 'form' | 'face' | 'submitting' | 'success' | 'office-blocked' | 'checkout-scan' | 'checkout-pin' | 'checkout-confirm' | 'checkout-done';

// Short banner/label for a closed office, by reason.
function officeBannerText(o: KioskOfficeStatus): string {
  switch (o.reason) {
    case 'holiday': return o.holiday_name ? `closed today — ${o.holiday_name}` : 'closed today — public holiday';
    case 'weekend': return 'closed for the weekend';
    case 'before_hours': return `opens at ${o.work_start}`;
    case 'after_hours': return `closed for the day — reopens at ${o.work_start}`;
    default: return 'closed';
  }
}

const fieldCls = 'w-full h-12 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary';

export function KioskPage() {
  const [mode, setMode] = useState<Mode>('welcome');
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [createdVisit, setCreatedVisit] = useState<KioskVisit | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [overridePin, setOverridePin] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [office, setOffice] = useState<KioskOfficeStatus | null>(null);
  const [officeClosedMsg, setOfficeClosedMsg] = useState<string | null>(null);
  const [checkoutBadge, setCheckoutBadge] = useState<string | null>(null);
  const [checkoutVisit, setCheckoutVisit] = useState<KioskVisit | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const checkingInRef = useRef(false);
  const checkingOutRef = useRef(false);

  const form = useForm<VisitorForm>({
    resolver: zodResolver(visitorSchema),
    defaultValues: { first_name: '', last_name: '', phone: '', organisation: '', directorate_id: '', host_name: '', purpose_raw: '' },
  });

  const [directorates, setDirectorates] = useState<KioskDirectorate[]>([]);
  const [officers, setOfficers] = useState<KioskOfficer[]>([]);
  useEffect(() => {
    if (mode === 'form') {
      if (directorates.length === 0) {
        kioskApi.getDirectorates().then(setDirectorates).catch(() => { /* leave empty; reception assists */ });
      }
      if (officers.length === 0) {
        kioskApi.getOfficers().then(setOfficers).catch(() => { /* leave empty; text entry still works */ });
      }
    }
  }, [mode, directorates.length, officers.length]);

  // Refresh the office-open status whenever the kiosk returns to its idle screen,
  // so the closed banner reflects the current time/day without a page reload.
  useEffect(() => {
    if (mode === 'welcome') {
      kioskApi.getStatus().then(setOffice).catch(() => { /* assume open on error — never block */ });
    }
  }, [mode]);

  async function onSubmitForm(data: VisitorForm) {
    setSubmitError(null);
    try {
      let id = visitorId;
      if (!id) {
        const visitor = await kioskApi.createVisitor({
          first_name: data.first_name,
          last_name: data.last_name,
          phone: data.phone || '',
          organisation: data.organisation || '',
        });
        id = visitor.id;
        setVisitorId(id);
      }
      setMode('face');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not register. Please try again.');
    }
  }

  async function handleFaceCapture(blob: Blob) {
    setMode('submitting');
    if (visitorId) { try { await kioskApi.uploadFacePhoto(visitorId, blob); } catch { /* continue */ } }
    await finishCheckIn();
  }

  async function finishCheckIn(overridePinArg?: string) {
    if (!visitorId || checkingInRef.current) return;
    checkingInRef.current = true;
    setSubmitError(null);
    const isOverride = !!overridePinArg;
    if (isOverride) {
      setOverrideSubmitting(true);
      setOverrideError(null);
    } else {
      setMode('submitting');
    }
    try {
      const visit = await kioskApi.checkIn({
        visitor_id: visitorId,
        directorate_id: form.getValues('directorate_id'),
        host_name_manual: form.getValues('host_name'),
        purpose_raw: form.getValues('purpose_raw'),
        ...(overridePinArg ? { reception_override_pin: overridePinArg } : {}),
      });
      setCreatedVisit(visit);
      setMode('success');
    } catch (e) {
      const code = e instanceof KioskApiError ? e.code : null;
      const status = e instanceof KioskApiError ? e.status : 0;
      if (status === 423 && code === 'OFFICE_CLOSED') {
        setOfficeClosedMsg(e instanceof Error ? e.message : 'The office is currently closed.');
        if (isOverride) {
          setOverrideError('Incorrect PIN — please ask reception to assist at the desk.');
        } else {
          setOverridePin('');
          setOverrideError(null);
        }
        setMode('office-blocked'); // prompt for the reception override
      } else {
        setSubmitError(e instanceof Error ? e.message : 'Check-in failed. Please see reception.');
        setMode('success');
      }
    } finally {
      checkingInRef.current = false;
      setOverrideSubmitting(false);
    }
  }

  function resetAll() {
    form.reset();
    setVisitorId(null);
    setCreatedVisit(null);
    setSubmitError(null);
    setOverridePin('');
    setOverrideError(null);
    setOfficeClosedMsg(null);
    setCheckoutBadge(null);
    setCheckoutVisit(null);
    checkingInRef.current = false;
    checkingOutRef.current = false;
    setMode('welcome');
  }

  function handleScanned(code: string) {
    setCheckoutBadge(code);
    setMode('checkout-confirm');
  }

  async function confirmCheckout() {
    if (!checkoutBadge || checkingOutRef.current) return;
    checkingOutRef.current = true;
    try {
      const visit = await kioskApi.checkOut(checkoutBadge);
      setCheckoutVisit(visit);
      setMode('checkout-done');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Checkout failed. Please see reception.');
      setMode('checkout-done');
    } finally {
      checkingOutRef.current = false;
    }
  }

  async function submitPinCheckout() {
    if (pinInput.length !== 6 || pinSubmitting) return;
    setPinSubmitting(true);
    setPinError(null);
    try {
      const visit = await kioskApi.checkOutByPin(pinInput);
      setCheckoutVisit(visit);
      setMode('checkout-done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PIN not recognised. Please check the number or see reception.';
      setPinError(msg);
    } finally {
      setPinSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-civic relative flex flex-col items-center justify-center p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none select-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden"
      >
        <img
          src="/ohcs-logo.jpg"
          alt=""
          className="kiosk-seal w-[min(72vw,124vh,1040px)] max-w-none opacity-[0.11] grayscale mix-blend-multiply"
        />
      </div>
      <div className="relative z-10 w-full max-w-lg bg-white/70 backdrop-blur-sm rounded-2xl border border-border shadow-xl ring-1 ring-accent/10 overflow-hidden p-6">
        <div className="ghana-flag-bar -mt-6 -mx-6 mb-5" />
        <KioskHeader />

        {(mode === 'form' || mode === 'face' || mode === 'submitting' || mode === 'success') && (
          <div className="mt-4 flex">
            <StepIndicator
              steps={[
                { key: 'form', label: 'Details' },
                { key: 'face', label: 'Photo' },
                { key: 'success', label: 'Done' },
              ]}
              currentIdx={mode === 'form' ? 0 : mode === 'face' || mode === 'submitting' ? 1 : 2}
            />
          </div>
        )}

        {mode === 'welcome' && (
          <div className="space-y-3 mt-6">
            {office && !office.open && (
              <div className="flex items-start gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
                <ShieldAlert className="h-4.5 w-4.5 text-accent-warm shrink-0 mt-0.5" />
                <p className="text-[13px] text-foreground">
                  <span className="font-semibold capitalize">Office {officeBannerText(office)}.</span>{' '}
                  <span className="text-muted">Check-in needs reception authorisation; check-out is available.</span>
                </p>
              </div>
            )}
            <button onClick={() => { form.reset(); setMode('form'); }} className="w-full h-14 bg-primary text-white text-base font-semibold rounded-xl inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <LogIn className="h-5 w-5" /> Check In
            </button>
            <button onClick={() => { setSubmitError(null); setMode('checkout-scan'); }} className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <LogOut className="h-5 w-5" /> Check Out
            </button>
          </div>
        )}

        {mode === 'form' && (
          <form onSubmit={form.handleSubmit(onSubmitForm)} className="space-y-4 mt-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Your Details</h2>
              <p className="text-sm text-muted mt-0.5">Tell us who you are and who you're visiting</p>
            </div>
            <div className="bg-surface rounded-xl border border-border shadow-sm p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FieldWrapper icon={<User className="h-4 w-4" />} label="First Name" error={form.formState.errors.first_name?.message}>
                  <input {...form.register('first_name')} className={fieldCls} autoFocus />
                </FieldWrapper>
                <FieldWrapper icon={<User className="h-4 w-4" />} label="Last Name" error={form.formState.errors.last_name?.message}>
                  <input {...form.register('last_name')} className={fieldCls} />
                </FieldWrapper>
              </div>
              <FieldWrapper icon={<Phone className="h-4 w-4" />} label="Phone" error={form.formState.errors.phone?.message}>
                <input {...form.register('phone')} className={fieldCls} placeholder="0241234567" inputMode="tel" />
              </FieldWrapper>
              <FieldWrapper icon={<Briefcase className="h-4 w-4" />} label="Organisation (optional)">
                <input {...form.register('organisation')} className={fieldCls} />
              </FieldWrapper>
              <FieldWrapper label="Purpose of Visit" error={form.formState.errors.purpose_raw?.message}>
                <textarea
                  {...form.register('purpose_raw', {
                    onChange: (e) => {
                      const match = suggestDirectorate(e.currentTarget.value, directorates);
                      if (match && !form.getValues('directorate_id')) {
                        form.setValue('directorate_id', match.id);
                      }
                    },
                  })}
                  rows={2}
                  className={`${fieldCls} h-auto py-2 resize-none`}
                  placeholder="e.g. Submit documents, salary enquiry, training..."
                />
              </FieldWrapper>
              <PurposeRoutingHint
                purpose={form.watch('purpose_raw') ?? ''}
                directorates={directorates}
                currentDirectorateId={form.watch('directorate_id') ?? ''}
                onAccept={(id) => form.setValue('directorate_id', id)}
              />
              <FieldWrapper icon={<Building2 className="h-4 w-4" />} label="Directorate" error={form.formState.errors.directorate_id?.message}>
                <select {...form.register('directorate_id')} className={fieldCls}>
                  <option value="">Select office...</option>
                  {groupDirectorates(directorates).map(({ label, items }) => (
                    <optgroup key={label} label={label}>
                      {items.map((d) => (
                        <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </FieldWrapper>
              <FieldWrapper icon={<User className="h-4 w-4" />} label="Who are you visiting?" error={form.formState.errors.host_name?.message}>
                {/* hidden input keeps RHF aware of the field so errors surface */}
                <input type="hidden" {...form.register('host_name')} />
                <OfficerCombobox
                  officers={officers}
                  rowSize="lg"
                  inputClassName={fieldCls}
                  placeholder="e.g. Mensah, Doris…"
                  onSelect={(o) => {
                    form.setValue('host_name', o.name, { shouldValidate: true });
                    if (o.directorate_id && !form.getValues('directorate_id')) {
                      form.setValue('directorate_id', o.directorate_id);
                    }
                  }}
                  onManual={(name) => form.setValue('host_name', name, { shouldValidate: !!name })}
                />
              </FieldWrapper>
            </div>
            {submitError && <p className="text-danger text-xs">{submitError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={resetAll} className="h-14 px-4 text-sm text-muted">Cancel</button>
              <button type="submit" disabled={form.formState.isSubmitting} className="flex-1 h-14 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {form.formState.isSubmitting ? 'Saving…' : 'Continue to Photo'}
              </button>
            </div>
          </form>
        )}

        {mode === 'face' && (
          <div className="mt-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Take Your Photo</h2>
              <p className="text-sm text-muted mt-0.5">Look at the camera and capture a clear photo</p>
            </div>
            <div className="bg-surface rounded-2xl border border-border shadow-sm p-6">
              <PhotoCapture title="Take Your Photo" facingMode="user" required onCapture={handleFaceCapture} onSkip={() => finishCheckIn()} />
            </div>
          </div>
        )}

        {mode === 'submitting' && (
          <div className="mt-8 text-center"><Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" /></div>
        )}

        {mode === 'office-blocked' && (
          <div className="mt-6 space-y-4">
            <div className="bg-accent/5 rounded-2xl border border-accent/30 shadow-sm p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 shrink-0 bg-accent/15 rounded-full flex items-center justify-center">
                  <ShieldAlert className="h-5 w-5 text-accent-warm" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Office closed</h3>
                  <p className="text-[13px] text-muted mt-1">{officeClosedMsg ?? 'The office is currently closed.'}</p>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-[13px] text-muted">Ask the reception officer to enter the override PIN to authorise this check-in.</p>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="\d*"
                  maxLength={8}
                  value={overridePin}
                  onChange={(e) => setOverridePin(e.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
                  className={fieldCls}
                  placeholder="Reception PIN"
                  autoFocus
                />
                {overrideError && <p className="text-danger text-xs">{overrideError}</p>}
                <div className="flex gap-2">
                  <button onClick={resetAll} className="h-11 px-4 text-sm text-muted">Cancel</button>
                  <button
                    onClick={() => finishCheckIn(overridePin)}
                    disabled={overrideSubmitting || overridePin.length < 4}
                    className="flex-1 h-11 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    {overrideSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {overrideSubmitting ? 'Verifying…' : 'Approve & Check In'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {mode === 'success' && (
          <div className="mt-6">
            {createdVisit?.badge_code ? (
              <div className="bg-surface rounded-2xl border border-border shadow-sm p-8 text-center space-y-4">
                <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">You're Checked In</h2>
                  <p className="text-sm text-muted mt-1">Scan this code with your phone to keep your badge</p>
                </div>
                <KioskBadgeQr badgeCode={createdVisit.badge_code} />
                <p className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</p>
                {createdVisit.checkout_pin && (
                  <div className="border-t border-border pt-4 space-y-1.5">
                    <p className="text-xs text-muted">No phone? Use this PIN to check out at the kiosk</p>
                    <p className="text-3xl font-mono font-bold tracking-[0.25em] text-foreground">
                      {createdVisit.checkout_pin}
                    </p>
                    <p className="text-xs text-muted">Keep this number — it's your checkout PIN</p>
                  </div>
                )}
                <button onClick={resetAll} className="h-12 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-danger text-sm">{submitError ?? 'Something went wrong. Please see reception.'}</p>
                <button onClick={resetAll} className="h-12 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
              </div>
            )}
          </div>
        )}

        {mode === 'checkout-scan' && (
          <div className="mt-6 space-y-4">
            <QrScanner onScan={handleScanned} onCancel={resetAll} />
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setPinInput(''); setPinError(null); setMode('checkout-pin'); }}
                className="text-sm text-muted hover:text-foreground underline-offset-2 hover:underline transition-colors"
              >
                No badge? Enter checkout PIN
              </button>
            </div>
          </div>
        )}

        {mode === 'checkout-pin' && (
          <div className="mt-6 space-y-5 text-center">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Enter Checkout PIN</h2>
              <p className="text-sm text-muted mt-1">Type the 6-digit PIN shown at check-in</p>
            </div>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={pinInput}
              onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitPinCheckout()}
              placeholder="000000"
              className="w-48 mx-auto block text-center text-3xl font-mono font-bold tracking-[0.3em] h-16 rounded-xl border-2 border-border focus:border-primary focus:outline-none bg-background"
              autoFocus
            />
            {pinError && <p className="text-danger text-sm">{pinError}</p>}
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setMode('checkout-scan')}
                className="h-11 px-4 text-sm text-muted border border-border rounded-xl hover:border-primary/30 transition-all"
              >
                Back
              </button>
              <button
                type="button"
                onClick={submitPinCheckout}
                disabled={pinInput.length !== 6 || pinSubmitting}
                className="h-11 px-6 bg-danger text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 disabled:opacity-50 transition-all"
              >
                {pinSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Check Out
              </button>
            </div>
          </div>
        )}

        {mode === 'checkout-confirm' && checkoutBadge && (
          <div className="mt-6 text-center space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Confirm Check Out</h2>
            <div className="w-24 h-24 rounded-2xl overflow-hidden mx-auto border-2 border-border">
              <img src={`${API_BASE}/badges/${checkoutBadge}/photo`} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
            <p className="text-sm font-mono text-accent">{checkoutBadge}</p>
            {submitError && <p className="text-danger text-xs">{submitError}</p>}
            <div className="flex gap-3 justify-center">
              <button onClick={resetAll} className="h-11 px-4 text-sm text-muted">Cancel</button>
              <button onClick={confirmCheckout} className="h-11 px-6 bg-danger text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2">
                <LogOut className="h-4 w-4" /> Confirm Check Out
              </button>
            </div>
          </div>
        )}

        {mode === 'checkout-done' && (
          <div className="mt-6 text-center space-y-4">
            <div className={`w-12 h-12 ${checkoutVisit ? 'bg-success/10' : 'bg-danger/10'} rounded-full flex items-center justify-center mx-auto`}>
              {checkoutVisit ? <CheckCircle2 className="h-6 w-6 text-success" /> : <X className="h-6 w-6 text-danger" />}
            </div>
            <h2 className="text-lg font-semibold text-foreground">{checkoutVisit ? 'Checked Out' : 'Could Not Check Out'}</h2>
            {submitError && !checkoutVisit && <p className="text-danger text-sm">{submitError}</p>}
            <button onClick={resetAll} className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function KioskHeader() {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl overflow-hidden mx-auto mb-3 shadow">
        <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
      </div>
      <h1 className="text-base font-bold text-foreground">OHCS Visitor Check-In</h1>
      <p className="text-xs text-muted">Office of the Head of the Civil Service</p>
    </div>
  );
}

function KioskBadgeQr({ badgeCode }: { badgeCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, `${BADGE_BASE}/badge/${badgeCode}`, {
      width: 200, margin: 2, color: { dark: '#1B3A5C', light: '#FFFFFF' },
    });
  }, [badgeCode]);
  return <canvas ref={canvasRef} className="mx-auto rounded-lg" />;
}
