import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { kioskApi, type KioskVisit } from '@/lib/kioskApi';
import { API_BASE, ID_TYPES } from '@/lib/constants';
import { PhotoCapture } from '@/components/PhotoCapture';
import { QrScanner } from '@/components/QrScanner';
import { CheckCircle2, LogIn, LogOut, Loader2, X } from 'lucide-react';

const visitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone').or(z.literal('')).optional(),
  organisation: z.string().max(200).optional(),
  id_type: z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other']).optional(),
  id_number: z.string().max(50).optional(),
  purpose_raw: z.string().max(500).optional(),
});
type VisitorForm = z.infer<typeof visitorSchema>;

type Mode = 'welcome' | 'form' | 'face' | 'id' | 'submitting' | 'success' | 'checkout-scan' | 'checkout-confirm' | 'checkout-done';

const fieldCls = 'w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary';

export function KioskPage() {
  const [mode, setMode] = useState<Mode>('welcome');
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [createdVisit, setCreatedVisit] = useState<KioskVisit | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutBadge, setCheckoutBadge] = useState<string | null>(null);
  const [checkoutVisit, setCheckoutVisit] = useState<KioskVisit | null>(null);
  const checkingInRef = useRef(false);
  const checkingOutRef = useRef(false);

  const form = useForm<VisitorForm>({
    resolver: zodResolver(visitorSchema),
    defaultValues: { first_name: '', last_name: '', phone: '', organisation: '', id_number: '', purpose_raw: '' },
  });

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
    if (visitorId) { try { await kioskApi.uploadIdPhoto(visitorId, blob); } catch { /* continue */ } }
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
        purpose_raw: form.getValues('purpose_raw') || '',
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name" error={form.formState.errors.first_name?.message}>
                <input {...form.register('first_name')} className={fieldCls} autoFocus />
              </Field>
              <Field label="Last Name" error={form.formState.errors.last_name?.message}>
                <input {...form.register('last_name')} className={fieldCls} />
              </Field>
            </div>
            <Field label="Phone (optional)" error={form.formState.errors.phone?.message}>
              <input {...form.register('phone')} className={fieldCls} placeholder="0241234567" />
            </Field>
            <Field label="Organisation (optional)">
              <input {...form.register('organisation')} className={fieldCls} />
            </Field>
            <Field label="ID Type (optional)">
              <select {...form.register('id_type')} className={fieldCls}>
                <option value="">Select...</option>
                {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="ID Number (optional)">
              <input {...form.register('id_number')} className={fieldCls} />
            </Field>
            <Field label="Purpose of Visit (optional)">
              <textarea {...form.register('purpose_raw')} rows={2} className={`${fieldCls} h-auto py-2 resize-none`} />
            </Field>
            {submitError && <p className="text-danger text-xs">{submitError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={resetAll} className="h-11 px-4 text-sm text-muted">Cancel</button>
              <button type="submit" disabled={form.formState.isSubmitting} className="flex-1 h-11 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {form.formState.isSubmitting ? 'Registering…' : 'Continue to Photo'}
              </button>
            </div>
          </form>
        )}

        {mode === 'face' && (
          <div className="mt-6">
            <PhotoCapture title="Take Your Photo" facingMode="user" onCapture={handleFaceCapture} onSkip={() => setMode('id')} />
          </div>
        )}

        {mode === 'id' && (
          <div className="mt-6">
            <PhotoCapture title="Photograph Your ID" facingMode="environment" mirror={false} onCapture={handleIdCapture} onSkip={finishCheckIn} />
          </div>
        )}

        {mode === 'submitting' && (
          <div className="mt-8 text-center"><Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" /></div>
        )}

        {mode === 'success' && (
          <div className="mt-6 text-center space-y-4">
            {createdVisit?.badge_code ? (
              <>
                <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">You're Checked In</h2>
                <p className="text-sm text-muted">Scan this code with your phone to keep your badge.</p>
                <KioskBadgeQr badgeCode={createdVisit.badge_code} />
                <p className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</p>
              </>
            ) : (
              <p className="text-danger text-sm">{submitError ?? 'Something went wrong. Please see reception.'}</p>
            )}
            <button onClick={resetAll} className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
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
              <img src={`${API_BASE}/badges/${checkoutBadge}/photo`} alt="" className="w-full h-full object-cover" />
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

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      {children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}

function KioskBadgeQr({ badgeCode }: { badgeCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const apiBase = import.meta.env.PROD
      ? 'https://ohcs-smartgate-api.ohcsghana-main.workers.dev'
      : 'http://localhost:8787';
    QRCode.toCanvas(canvasRef.current, `${apiBase}/badge/${badgeCode}`, {
      width: 200, margin: 2, color: { dark: '#1B3A5C', light: '#FFFFFF' },
    });
  }, [badgeCode]);
  return <canvas ref={canvasRef} className="mx-auto rounded-lg" />;
}
