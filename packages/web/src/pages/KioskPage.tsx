import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { kioskApi, type KioskVisit, type KioskDirectorate, type IdCheckVerdict } from '@/lib/kioskApi';
import { API_BASE, BADGE_BASE } from '@/lib/constants';
import { PhotoCapture } from '@/components/PhotoCapture';
import { QrScanner } from '@/components/QrScanner';
import { FieldWrapper } from '@/components/checkin/FieldWrapper';
import { SmartIdFields } from '@/components/checkin/SmartIdFields';
import { PurposeRoutingHint } from '@/components/checkin/PurposeRoutingHint';
import { StepIndicator } from '@/components/checkin/StepIndicator';
import { CheckCircle2, LogIn, LogOut, Loader2, X, User, Phone, Briefcase, Building2 } from 'lucide-react';

const visitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'A valid Ghana phone is required'),
  organisation: z.string().max(200).optional(),
  directorate_id: z.string().min(1, 'Select a directorate'),
  host_name: z.string().max(100).optional(),
  id_type: z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other'], {
    errorMap: () => ({ message: 'Select an ID type' }),
  }),
  id_number: z.string().max(50).optional(),
  purpose_raw: z.string().min(1, 'Purpose of visit is required').max(500),
});
type VisitorForm = z.infer<typeof visitorSchema>;

type Mode = 'welcome' | 'form' | 'face' | 'id' | 'submitting' | 'success' | 'checkout-scan' | 'checkout-confirm' | 'checkout-done';

const fieldCls = 'w-full h-12 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary';

export function KioskPage() {
  const [mode, setMode] = useState<Mode>('welcome');
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [createdVisit, setCreatedVisit] = useState<KioskVisit | null>(null);
  const [idCheck, setIdCheck] = useState<IdCheckVerdict | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutBadge, setCheckoutBadge] = useState<string | null>(null);
  const [checkoutVisit, setCheckoutVisit] = useState<KioskVisit | null>(null);
  const checkingInRef = useRef(false);
  const checkingOutRef = useRef(false);

  const form = useForm<VisitorForm>({
    resolver: zodResolver(visitorSchema),
    defaultValues: { first_name: '', last_name: '', phone: '', organisation: '', directorate_id: '', host_name: '', id_number: '', purpose_raw: '' },
  });

  const [directorates, setDirectorates] = useState<KioskDirectorate[]>([]);
  useEffect(() => {
    if (mode === 'form' && directorates.length === 0) {
      kioskApi.getDirectorates().then(setDirectorates).catch(() => { /* leave empty; reception assists */ });
    }
  }, [mode, directorates.length]);

  async function onSubmitForm(data: VisitorForm) {
    setSubmitError(null);
    try {
      const visitor = await kioskApi.createVisitor({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone || '',
        organisation: data.organisation || '',
        id_type: data.id_type,
        id_number: data.id_number || '',
      });
      setVisitorId(visitor.id);
      setMode('face');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not register. Please try again.');
    }
  }

  async function handleFaceCapture(blob: Blob) {
    if (visitorId) { try { await kioskApi.uploadFacePhoto(visitorId, blob); } catch { /* continue */ } }
    setMode('id');
  }

  async function handleIdCapture(blob: Blob) {
    setMode('submitting');
    let verdict: IdCheckVerdict | undefined;
    if (visitorId) {
      try { verdict = (await kioskApi.uploadIdPhoto(visitorId, blob)).id_check; } catch { /* continue */ }
    }
    setIdCheck(verdict ?? null);
    await finishCheckIn();
  }

  async function finishCheckIn() {
    if (!visitorId || checkingInRef.current) return;
    checkingInRef.current = true;
    setMode('submitting');
    setSubmitError(null);
    try {
      const visit = await kioskApi.checkIn({
        visitor_id: visitorId,
        directorate_id: form.getValues('directorate_id'),
        host_name_manual: form.getValues('host_name'),
        purpose_raw: form.getValues('purpose_raw'),
      });
      setCreatedVisit(visit);
      setMode('success');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Check-in failed. Please see reception.');
      setMode('success');
    } finally {
      checkingInRef.current = false;
    }
  }

  function resetAll() {
    form.reset();
    setVisitorId(null);
    setCreatedVisit(null);
    setIdCheck(null);
    setSubmitError(null);
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

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-border shadow-lg p-6">
        <KioskHeader />

        {(mode === 'form' || mode === 'face' || mode === 'id' || mode === 'submitting' || mode === 'success') && (
          <div className="mt-4 flex">
            <StepIndicator
              steps={[
                { key: 'form', label: 'Details' },
                { key: 'face', label: 'Photo' },
                { key: 'id', label: 'ID' },
                { key: 'success', label: 'Done' },
              ]}
              currentIdx={mode === 'form' ? 0 : mode === 'face' ? 1 : mode === 'id' || mode === 'submitting' ? 2 : 3}
            />
          </div>
        )}

        {mode === 'welcome' && (
          <div className="space-y-3 mt-6">
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
              <FieldWrapper icon={<Building2 className="h-4 w-4" />} label="Directorate" error={form.formState.errors.directorate_id?.message}>
                <select {...form.register('directorate_id')} className={fieldCls}>
                  <option value="">Select directorate...</option>
                  {directorates.map((d) => (
                    <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
                  ))}
                </select>
              </FieldWrapper>
              {(() => {
                const sel = directorates.find((d) => d.id === form.watch('directorate_id'));
                return sel?.reception_officer_name ? (
                  <p className="text-[13px] text-muted -mt-2">
                    You'll be received by <span className="font-semibold text-foreground">{sel.reception_officer_name}</span>.
                  </p>
                ) : null;
              })()}
              <FieldWrapper icon={<User className="h-4 w-4" />} label="Who are you visiting? (optional)" error={form.formState.errors.host_name?.message}>
                <input {...form.register('host_name')} className={fieldCls} placeholder="e.g. Mr. Mensah" />
              </FieldWrapper>
              <SmartIdFields
                idType={form.watch('id_type')}
                idNumber={form.watch('id_number') ?? ''}
                onIdTypeChange={(v) => {
                  form.setValue('id_type', v as never);
                  if (v) form.clearErrors('id_type');
                  else form.setValue('id_number', '');
                }}
                onIdNumberChange={(v) => form.setValue('id_number', v)}
                idTypeError={form.formState.errors.id_type?.message}
                idNumberError={form.formState.errors.id_number?.message}
                inputClassName={fieldCls}
              />
              <FieldWrapper label="Purpose of Visit" error={form.formState.errors.purpose_raw?.message}>
                <textarea {...form.register('purpose_raw')} rows={2} className={`${fieldCls} h-auto py-2 resize-none`} placeholder="e.g. Submit documents, salary enquiry, training..." />
              </FieldWrapper>
              <PurposeRoutingHint
                purpose={form.watch('purpose_raw') ?? ''}
                directorates={directorates}
                currentDirectorateId={form.watch('directorate_id') ?? ''}
                onAccept={(id) => form.setValue('directorate_id', id)}
              />
            </div>
            {submitError && <p className="text-danger text-xs">{submitError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={resetAll} className="h-14 px-4 text-sm text-muted">Cancel</button>
              <button type="submit" disabled={form.formState.isSubmitting} className="flex-1 h-14 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {form.formState.isSubmitting ? 'Registering…' : 'Continue to Photo'}
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
              <PhotoCapture title="Take Your Photo" facingMode="user" required onCapture={handleFaceCapture} onSkip={() => setMode('id')} />
            </div>
          </div>
        )}

        {mode === 'id' && (
          <div className="mt-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Photograph Your ID</h2>
              <p className="text-sm text-muted mt-0.5">Place your ID in the frame and capture it</p>
            </div>
            <div className="bg-surface rounded-2xl border border-border shadow-sm p-6">
              <PhotoCapture title="Photograph Your ID" facingMode="environment" mirror={false} required qualityGuard onCapture={handleIdCapture} onSkip={finishCheckIn} />
            </div>
          </div>
        )}

        {mode === 'submitting' && (
          <div className="mt-8 text-center"><Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" /></div>
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
                {(() => {
                  const declared = form.getValues('id_type');
                  const flagged = idCheck && (
                    idCheck.verdict === 'not_document' ||
                    (idCheck.detected_type && idCheck.detected_type !== 'none' && declared && idCheck.detected_type !== declared)
                  );
                  return flagged ? (
                    <p className="text-[13px] text-accent-warm bg-accent/10 border border-accent/20 rounded-xl px-3 py-2">
                      ⚠ ID photo looks unclear or doesn't match the chosen ID type — please verify with reception.
                    </p>
                  ) : null;
                })()}
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
          <div className="mt-6">
            <QrScanner onScan={handleScanned} onCancel={resetAll} />
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
