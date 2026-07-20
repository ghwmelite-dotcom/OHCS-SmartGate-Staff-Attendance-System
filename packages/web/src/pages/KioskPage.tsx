import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { kioskApi, KioskApiError, type KioskVisit, type KioskDirectorate, type KioskOfficer, type KioskOfficeStatus, type KioskVisitorMatch } from '@/lib/kioskApi';
import { API_BASE, BADGE_BASE } from '@/lib/constants';
import { parseAppointmentRef } from '@/lib/parse-appointment-ref';
import { parseGhanaPhone } from '@/lib/parse-ghana-phone';
import { PhotoCapture } from '@/components/PhotoCapture';
import { QrScanner } from '@/components/QrScanner';
import { FieldWrapper } from '@/components/checkin/FieldWrapper';
import { PurposeRoutingHint } from '@/components/checkin/PurposeRoutingHint';
import { OfficerCombobox } from '@/components/checkin/OfficerCombobox';
import { suggestDirectorate, groupDirectorates } from '@/lib/directorate-routing';
import { StepIndicator } from '@/components/checkin/StepIndicator';
import { CheckCircle2, LogIn, LogOut, Loader2, X, User, Phone, Briefcase, Building2, ShieldAlert, MapPin, CalendarDays, Clock3, Calendar, ArrowLeft, ScanLine, UserCheck, Star } from 'lucide-react';

const visitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string()
    .transform(v => v.replace(/[\s\-()]/g, ''))
    .pipe(z.string().min(1, 'Phone number is required').regex(/^(\+233|0)\d{9}$/, 'Enter a valid Ghana number — e.g. 024 123 4567')),
  organisation: z.string().max(200).optional(),
  directorate_id: z.string().min(1, 'Select a directorate'),
  host_name: z.string().min(1, 'Please enter who you are visiting').max(100),
  purpose_raw: z.string().min(1, 'Purpose of visit is required').max(500),
});
type VisitorForm = z.infer<typeof visitorSchema>;

type Mode = 'welcome' | 'form' | 'face' | 'submitting' | 'success' | 'office-blocked' | 'checkout-scan' | 'checkout-pin' | 'checkout-confirm' | 'checkout-done' | 'survey-comment' | 'survey-thanks' | 'appointment' | 'appointment-scan' | 'appointment-confirm' | 'appointment-done' | 'returning-phone' | 'returning-confirm';

interface AppointmentLookup {
  id: string;
  officer_name: string;
  officer_title?: string;
  directorate_name: string;
  directorate_floor?: string | null;
  directorate_wing?: string | null;
  visitor_name: string;
  visitor_phone: string;
  appointment_date: string;
  time_slot: string;
  status: string;
  reference_code: string;
  purpose: string;
}

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

  // Post-checkout satisfaction survey (spec: 2026-07-20-visitor-satisfaction-survey-design).
  // The single-use token arrives on the checkout response; rating state lives
  // here so the rate → comment → thanks steps can span kiosk modes.
  const [surveyToken, setSurveyToken] = useState<string | null>(null);
  const [surveyRating, setSurveyRating] = useState<number | null>(null);
  const [surveyComment, setSurveyComment] = useState('');
  const [surveySubmitting, setSurveySubmitting] = useState(false);

  const [apptRef, setApptRef] = useState('');
  const [apptData, setApptData] = useState<AppointmentLookup | null>(null);
  const [apptLoading, setApptLoading] = useState(false);
  const [apptError, setApptError] = useState('');

  // Returning-visitor fast lane. `returningVisitor` is set once a phone lookup
  // matches; it locks the form's identity fields and its id is submitted on
  // check-in instead of creating a new visitor row.
  const [returningPhone, setReturningPhone] = useState('');
  const [returningVisitor, setReturningVisitor] = useState<KioskVisitorMatch | null>(null);
  const [returningLoading, setReturningLoading] = useState(false);
  // Warn-not-block note when the picked host isn't available (missing field ⇒ available).
  const [hostWarning, setHostWarning] = useState<string | null>(null);

  const form = useForm<VisitorForm>({
    resolver: zodResolver(visitorSchema),
    defaultValues: { first_name: '', last_name: '', phone: '', organisation: '', directorate_id: '', host_name: '', purpose_raw: '' },
  });

  const rawPhone = (form.watch('phone') ?? '').replace(/[\s\-()]/g, '');
  const isPhoneValid = /^(\+233|0)\d{9}$/.test(rawPhone);
  // Identity fields lock once a returning visitor is confirmed (readOnly, not
  // disabled, so react-hook-form keeps the values on submit).
  const identityLocked = returningVisitor !== null;

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
    setApptRef('');
    setApptData(null);
    setApptLoading(false);
    setApptError('');
    setReturningPhone('');
    setReturningVisitor(null);
    setReturningLoading(false);
    setHostWarning(null);
    setSurveyToken(null);
    setSurveyRating(null);
    setSurveyComment('');
    setSurveySubmitting(false);
    setMode('welcome');
  }

  function handleScanned(code: string) {
    setCheckoutBadge(code);
    setMode('checkout-confirm');
  }

  // Single lookup path for appointment references — typed entry and QR scan
  // converge here (same fetch, same confirm screen).
  async function lookupAppointment(ref: string) {
    setApptLoading(true);
    setApptError('');
    try {
      const res = await fetch(`/api/appointments/public/ref/${ref.trim()}`);
      const json = await res.json() as { data?: { appointment: AppointmentLookup }; error?: { message?: string } };
      if (!res.ok) {
        setApptError(json.error?.message ?? 'Appointment not found.');
      } else {
        setApptData(json.data?.appointment ?? null);
        setMode('appointment-confirm');
      }
    } catch {
      setApptError('Could not connect. Please try again.');
    } finally {
      setApptLoading(false);
    }
  }

  function handleApptScanned(code: string) {
    setApptRef(code);
    setMode('appointment'); // any lookup error surfaces on the typed screen
    void lookupAppointment(code);
  }

  function handleApptScanRejected() {
    setApptError('Not an appointment QR — try typing the code');
    setMode('appointment');
  }

  // Returning-visitor lookup. A miss (404 — unknown number or no completed
  // visit, deliberately indistinguishable) drops into the full form with the
  // entered phone prefilled; network/rate-limit failures degrade the same way
  // so the lobby flow never blocks.
  async function startReturningLookup() {
    const local = parseGhanaPhone(returningPhone);
    if (!local || returningLoading) return;
    setReturningLoading(true);
    setSubmitError(null);
    try {
      const match = await kioskApi.getVisitorByPhone(local);
      setReturningVisitor(match);
      setMode('returning-confirm');
    } catch {
      setReturningVisitor(null);
      form.reset({ first_name: '', last_name: '', phone: local, organisation: '', directorate_id: '', host_name: '', purpose_raw: '' });
      setSubmitError("No record found — let's register you.");
      setMode('form');
    } finally {
      setReturningLoading(false);
    }
  }

  // "Yes, that's me" — lock identity to the matched visitor and continue the
  // normal purpose → host → photo → submit path with the existing visitor id.
  function confirmReturningVisitor() {
    if (!returningVisitor) return;
    setVisitorId(returningVisitor.id);
    form.reset({
      first_name: returningVisitor.first_name,
      last_name: returningVisitor.last_name,
      phone: parseGhanaPhone(returningPhone) ?? '',
      organisation: returningVisitor.organisation ?? '',
      directorate_id: '',
      host_name: '',
      purpose_raw: '',
    });
    setMode('form');
  }

  async function confirmCheckout() {
    if (!checkoutBadge || checkingOutRef.current) return;
    checkingOutRef.current = true;
    try {
      const visit = await kioskApi.checkOut(checkoutBadge);
      setCheckoutVisit(visit);
      setSurveyToken(visit.survey_token ?? null);
      setMode('checkout-done');
    } catch (e) {
      setSurveyToken(null);
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
      setSurveyToken(visit.survey_token ?? null);
      setMode('checkout-done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PIN not recognised. Please check the number or see reception.';
      setPinError(msg);
    } finally {
      setPinSubmitting(false);
    }
  }

  // Rating is already chosen when this runs; the comment step is optional.
  // Failures are quiet by design — a leaving visitor never sees a survey error.
  async function submitSurvey(withComment: boolean) {
    if (!surveyToken || !surveyRating || surveySubmitting) return;
    setSurveySubmitting(true);
    try {
      await kioskApi.submitSurvey({
        token: surveyToken,
        rating: surveyRating,
        ...(withComment && surveyComment.trim() ? { comment: surveyComment.trim() } : {}),
      });
    } catch { /* quiet */ } finally {
      setSurveySubmitting(false);
      setMode('survey-thanks');
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
              <LogIn className="h-5 w-5" /> New Visitor Check In
            </button>
            <button onClick={() => { setSubmitError(null); setMode('checkout-scan'); }} className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <LogOut className="h-5 w-5" /> Visitor Check Out
            </button>
            <button onClick={() => { setReturningPhone(''); setSubmitError(null); setMode('returning-phone'); }} className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <UserCheck className="h-5 w-5" /> Been Here Before?
            </button>
            <button onClick={() => { setApptRef(''); setMode('appointment'); }} className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <Calendar className="h-5 w-5" /> I Have an Appointment
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
              {identityLocked && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2">
                  <p className="text-[12px] text-foreground">Your saved details are locked in — just tell us why you're here.</p>
                  <button type="button" onClick={resetAll} className="text-[12px] text-muted underline-offset-2 hover:underline shrink-0">Not you?</button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <FieldWrapper icon={<User className="h-4 w-4" />} label="First Name" error={form.formState.errors.first_name?.message}>
                  <input {...form.register('first_name')} readOnly={identityLocked} className={`${fieldCls}${identityLocked ? ' bg-background-warm text-muted' : ''}`} autoFocus={!identityLocked} />
                </FieldWrapper>
                <FieldWrapper icon={<User className="h-4 w-4" />} label="Last Name" error={form.formState.errors.last_name?.message}>
                  <input {...form.register('last_name')} readOnly={identityLocked} className={`${fieldCls}${identityLocked ? ' bg-background-warm text-muted' : ''}`} />
                </FieldWrapper>
              </div>
              <FieldWrapper icon={<Phone className="h-4 w-4" />} label="Phone" error={form.formState.errors.phone?.message}>
                <div className="relative">
                  <input
                    {...form.register('phone', {
                      onChange: e => {
                        const v = e.target.value.replace(/[^\d+\s\-()]/g, '').slice(0, 16);
                        if (e.target.value !== v) e.target.value = v;
                      },
                    })}
                    readOnly={identityLocked}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={16}
                    placeholder="024 123 4567"
                    className={`${fieldCls} pr-9 transition-colors ${
                      identityLocked
                        ? 'bg-background-warm text-muted'
                        : isPhoneValid
                        ? 'border-success focus:ring-success/30'
                        : form.formState.errors.phone
                        ? 'border-danger focus:ring-danger/20'
                        : ''
                    }`}
                  />
                  {isPhoneValid && (
                    <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-success pointer-events-none" />
                  )}
                </div>
              </FieldWrapper>
              <FieldWrapper icon={<Briefcase className="h-4 w-4" />} label="Organisation (optional)">
                <input {...form.register('organisation')} readOnly={identityLocked} className={`${fieldCls}${identityLocked ? ' bg-background-warm text-muted' : ''}`} />
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
                    // Warn, never block: availability_status may be absent until
                    // the host-availability column lands ⇒ treat as available.
                    const picked = officers.find((x) => x.id === o.id);
                    const status = picked?.availability_status ?? 'available';
                    if (picked && status !== 'available') {
                      setHostWarning(
                        status === 'in_meeting'
                          ? `${picked.name} is in a meeting — you can still check in; they'll be notified.`
                          : `${picked.name} is out of the office — you can still check in; they'll be notified.`,
                      );
                    } else {
                      setHostWarning(null);
                    }
                  }}
                  onManual={(name) => {
                    form.setValue('host_name', name, { shouldValidate: !!name });
                    setHostWarning(null);
                  }}
                />
                {hostWarning && (
                  <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 mt-2">
                    <ShieldAlert className="h-4 w-4 text-accent-warm shrink-0 mt-0.5" />
                    <p className="text-[12px] text-foreground">{hostWarning}</p>
                  </div>
                )}
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

        {mode === 'returning-phone' && (
          <div className="mt-6 space-y-5 text-center">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Welcome Back</h2>
              <p className="text-sm text-muted mt-1">Enter the phone number you registered with</p>
            </div>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={16}
              value={returningPhone}
              onChange={e => { setReturningPhone(e.target.value.replace(/[^\d+\s\-()]/g, '').slice(0, 16)); setSubmitError(null); }}
              onKeyDown={e => e.key === 'Enter' && void startReturningLookup()}
              placeholder="024 123 4567"
              className="w-full max-w-xs mx-auto block text-center text-2xl font-mono font-bold tracking-widest h-16 rounded-xl border-2 border-border focus:border-primary focus:outline-none bg-background"
              autoFocus
            />
            {submitError && <p className="text-danger text-sm">{submitError}</p>}
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={resetAll}
                className="h-11 px-4 text-sm text-muted border border-border rounded-xl hover:border-primary/30 transition-all"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void startReturningLookup()}
                disabled={!parseGhanaPhone(returningPhone) || returningLoading}
                className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 disabled:opacity-50 transition-all"
              >
                {returningLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                {returningLoading ? 'Checking…' : 'Find My Details'}
              </button>
            </div>
          </div>
        )}

        {mode === 'returning-confirm' && returningVisitor && (
          <div className="mt-6 space-y-5 text-center">
            <div className="w-24 h-24 rounded-2xl overflow-hidden mx-auto border-2 border-border bg-surface flex items-center justify-center">
              {returningVisitor.photo_url ? (
                <img
                  src={returningVisitor.photo_url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <User className="h-10 w-10 text-muted" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Welcome back, {returningVisitor.first_name}!</h2>
              <p className="text-sm text-muted mt-1">
                {returningVisitor.first_name} {returningVisitor.last_name}
                {returningVisitor.organisation ? ` — ${returningVisitor.organisation}` : ''}
              </p>
              <p className="text-sm text-muted mt-0.5">Is this you?</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => { setReturningVisitor(null); setReturningPhone(''); setMode('returning-phone'); }}
                className="h-12 px-5 text-sm text-muted border border-border rounded-xl hover:border-primary/30 transition-all"
              >
                Not You?
              </button>
              <button
                type="button"
                onClick={confirmReturningVisitor}
                className="h-12 px-6 bg-primary text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 active:scale-[0.99]"
              >
                <CheckCircle2 className="h-4 w-4" /> Yes, That's Me
              </button>
            </div>
          </div>
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
              <div className="bg-surface rounded-2xl border border-border shadow-sm p-6 text-center space-y-4">
                <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">You're Checked In</h2>
                  <p className="text-sm text-muted mt-1">Scan the QR code or photograph your visit details below</p>
                </div>
                <KioskBadgeQr badgeCode={createdVisit.badge_code} />
                <p className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</p>

                <VisitInfoCard visit={createdVisit} />

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
            {/* Successful checkout with a survey token → invite the rating
                inline; anything else → plain Done. */}
            {checkoutVisit && surveyToken ? (
              <SurveyRatePanel
                onRate={(n) => { setSurveyRating(n); setMode('survey-comment'); }}
                onSkip={resetAll}
              />
            ) : (
              <button onClick={resetAll} className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
            )}
          </div>
        )}

        {/* SURVEY — optional comment after the rating tap */}
        {mode === 'survey-comment' && surveyRating !== null && (
          <SurveyCommentPanel
            rating={surveyRating}
            comment={surveyComment}
            submitting={surveySubmitting}
            onChange={setSurveyComment}
            onSkip={() => submitSurvey(false)}
            onSubmit={() => submitSurvey(true)}
            onTimeout={resetAll}
          />
        )}

        {/* SURVEY — thank-you, then auto-return to the welcome screen */}
        {mode === 'survey-thanks' && <SurveyThanksPanel onDone={resetAll} />}

        {mode === 'appointment' && (
          <div className="mt-6 space-y-5">
            <button
              type="button"
              onClick={() => setMode('welcome')}
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div>
              <h2 className="text-lg font-semibold text-foreground">I Have an Appointment</h2>
              <p className="text-sm text-muted mt-0.5">Enter your reference code to check in</p>
            </div>
            <div className="bg-surface rounded-xl border border-border shadow-sm p-5 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">Reference Code</label>
                <input
                  type="text"
                  value={apptRef}
                  onChange={(e) => setApptRef(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="e.g. ABC123"
                  className="w-full h-12 px-3 rounded-lg border border-border bg-background text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary text-center text-base font-bold"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && apptRef.length >= 3 && !apptLoading) {
                      e.preventDefault();
                      void lookupAppointment(apptRef);
                    }
                  }}
                />
              </div>
              {apptError && (
                <p className="text-danger text-sm">{apptError}</p>
              )}
            </div>
            <button
              type="button"
              disabled={apptRef.length < 3 || apptLoading}
              onClick={() => void lookupAppointment(apptRef)}
              className="w-full h-14 bg-primary text-white text-base font-semibold rounded-xl inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99]"
            >
              {apptLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Calendar className="h-5 w-5" />}
              {apptLoading ? 'Looking up…' : 'Look Up'}
            </button>
            <button
              type="button"
              disabled={apptLoading}
              onClick={() => { setApptError(''); setMode('appointment-scan'); }}
              className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99]"
            >
              <ScanLine className="h-5 w-5" /> Scan QR instead
            </button>
          </div>
        )}

        {mode === 'appointment-scan' && (
          <div className="mt-6 space-y-4">
            <QrScanner
              label="Scan the QR code in your confirmation email"
              parse={parseAppointmentRef}
              onScan={handleApptScanned}
              onReject={handleApptScanRejected}
              onCancel={() => setMode('appointment')}
            />
          </div>
        )}

        {mode === 'appointment-confirm' && apptData && (
          <div className="mt-6 space-y-5">
            <button
              type="button"
              onClick={() => { setApptData(null); setMode('appointment'); }}
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Your Appointment</h2>
            </div>
            <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="bg-primary/8 px-4 py-2.5 border-b border-primary/15 flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                <p className="text-[11px] font-semibold text-primary tracking-wide uppercase">Appointment Details</p>
              </div>
              <div className="divide-y divide-border/60">
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-muted shrink-0"><User className="h-3.5 w-3.5" /></span>
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Meeting with</span>
                  <span className="text-[13px] font-semibold text-foreground leading-snug">
                    {apptData.officer_name}
                    {apptData.officer_title && <span className="font-normal text-muted"> — {apptData.officer_title}</span>}
                  </span>
                </div>
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-muted shrink-0"><Building2 className="h-3.5 w-3.5" /></span>
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Directorate</span>
                  <span className="text-[13px] font-semibold text-foreground leading-snug">{apptData.directorate_name}</span>
                </div>
                {(apptData.directorate_floor || apptData.directorate_wing) && (
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    <span className="mt-0.5 text-muted shrink-0"><MapPin className="h-3.5 w-3.5" /></span>
                    <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Location</span>
                    <span className="text-[13px] font-semibold text-foreground leading-snug">
                      {[apptData.directorate_floor, apptData.directorate_wing ? `${apptData.directorate_wing} Wing` : null].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-muted shrink-0"><CalendarDays className="h-3.5 w-3.5" /></span>
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Date</span>
                  <span className="text-[13px] font-semibold text-foreground leading-snug">
                    {new Date(apptData.appointment_date).toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-muted shrink-0"><Clock3 className="h-3.5 w-3.5" /></span>
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Time</span>
                  <span className="text-[13px] font-semibold text-foreground leading-snug">{apptData.time_slot}</span>
                </div>
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-muted shrink-0"><User className="h-3.5 w-3.5" /></span>
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Name</span>
                  <span className="text-[13px] font-semibold text-foreground leading-snug">{apptData.visitor_name}</span>
                </div>
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-muted shrink-0"><MapPin className="h-3.5 w-3.5" /></span>
                  <span className="w-24 shrink-0 text-[11px] font-medium text-muted">Reference</span>
                  <span className="text-[13px] font-mono font-bold text-accent leading-snug tracking-widest">{apptData.reference_code}</span>
                </div>
              </div>
            </div>

            {apptData.status !== 'confirmed' && (
              <div className="flex items-start gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
                <ShieldAlert className="h-4.5 w-4.5 text-accent-warm shrink-0 mt-0.5" />
                <p className="text-[13px] text-foreground">
                  {apptData.status === 'pending' && 'Your appointment is pending approval. Please check back later or contact reception.'}
                  {apptData.status === 'completed' && 'This appointment has already been checked in.'}
                  {(apptData.status === 'declined' || apptData.status === 'cancelled') && 'This appointment was cancelled. Please contact reception.'}
                </p>
              </div>
            )}

            {apptError && <p className="text-danger text-sm">{apptError}</p>}

            {apptData.status === 'confirmed' ? (
              <button
                type="button"
                disabled={apptLoading}
                onClick={async () => {
                  setApptLoading(true);
                  setApptError('');
                  try {
                    const res = await fetch('/api/appointments/public/arrive', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ reference_code: apptData.reference_code }),
                    });
                    const json = await res.json() as { data?: unknown; error?: { code?: string; message?: string } };
                    if (!res.ok) {
                      if (json.error?.code === 'APPT_WRONG_DATE') {
                        setApptError('Your appointment is not scheduled for today.');
                      } else {
                        setApptError(json.error?.message ?? 'Could not confirm arrival. Please see reception.');
                      }
                    } else {
                      setMode('appointment-done');
                    }
                  } catch {
                    setApptError('Could not connect. Please try again.');
                  } finally {
                    setApptLoading(false);
                  }
                }}
                className="w-full h-14 bg-primary text-white text-base font-semibold rounded-xl inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99]"
              >
                {apptLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                {apptLoading ? 'Confirming…' : 'Confirm My Arrival'}
              </button>
            ) : (
              <button
                type="button"
                onClick={resetAll}
                className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                Return to Start
              </button>
            )}
          </div>
        )}

        {mode === 'appointment-done' && apptData && (
          <AppointmentDoneScreen apptData={apptData} onReset={resetAll} />
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

function AppointmentDoneScreen({ apptData, onReset }: { apptData: AppointmentLookup; onReset: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onReset, 10_000);
    return () => clearTimeout(timer);
  }, [onReset]);

  return (
    <div className="mt-6 text-center space-y-5">
      <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-8 w-8 text-success" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Welcome!</h2>
        <p className="text-sm text-muted mt-1">
          Your arrival has been confirmed. Please proceed to the{' '}
          <span className="font-semibold text-foreground">{apptData.directorate_name}</span> office
          {(apptData.directorate_floor || apptData.directorate_wing) && (
            <> — <span className="font-semibold text-foreground">
              {[apptData.directorate_floor, apptData.directorate_wing ? `${apptData.directorate_wing} Wing` : null].filter(Boolean).join(', ')}
            </span></>
          )}.
        </p>
      </div>
      <p className="text-xs text-muted">A member of staff will attend to you shortly.</p>
      <button
        type="button"
        onClick={onReset}
        className="h-12 px-6 bg-primary text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2"
      >
        Return to Start
      </button>
    </div>
  );
}

function VisitInfoCard({ visit }: { visit: import('@/lib/kioskApi').KioskVisit }) {
  const { host_name, directorate_name, directorate_abbr, check_in_at, floor, wing } = visit;

  const locationParts = [floor, wing ? `${wing} Wing` : null].filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join(', ') : null;

  const dirLabel = directorate_abbr && directorate_name
    ? `${directorate_abbr} — ${directorate_name}`
    : (directorate_name ?? directorate_abbr ?? null);

  let dateStr: string | null = null;
  let timeStr: string | null = null;
  if (check_in_at) {
    const d = new Date(check_in_at);
    dateStr = d.toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    timeStr = d.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  type InfoRow = { icon: JSX.Element; label: string; value: string };
  const rows: InfoRow[] = (
    [
      host_name    ? { icon: <User         className="h-3.5 w-3.5" />, label: 'Host',        value: host_name } : null,
      dirLabel     ? { icon: <Building2    className="h-3.5 w-3.5" />, label: 'Directorate',  value: dirLabel  } : null,
      location     ? { icon: <MapPin       className="h-3.5 w-3.5" />, label: 'Location',    value: location  } : null,
      dateStr      ? { icon: <CalendarDays className="h-3.5 w-3.5" />, label: 'Date',        value: dateStr   } : null,
      timeStr      ? { icon: <Clock3       className="h-3.5 w-3.5" />, label: 'Check In',    value: timeStr   } : null,
    ] as (InfoRow | null)[]
  ).filter((r): r is InfoRow => r !== null);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-white text-left overflow-hidden">
      <div className="bg-primary/8 px-4 py-2 border-b border-primary/15 flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-[11px] font-semibold text-primary tracking-wide uppercase">Where to Go</p>
        <p className="ml-auto text-[10px] text-muted">📸 Take a photo of this</p>
      </div>
      <div className="divide-y divide-border/60">
        {rows.map(({ icon, label, value }) => (
          <div key={label} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 text-muted shrink-0">{icon}</span>
            <span className="w-20 shrink-0 text-[11px] font-medium text-muted">{label}</span>
            <span className="text-[13px] font-semibold text-foreground leading-snug">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


/* ---- Post-checkout satisfaction survey (spec: 2026-07-20-visitor-satisfaction-survey-design) ---- */

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

// Rating step — five large stars + Skip, inline under the Checked Out
// confirmation. Auto-skips after 20s so the kiosk never strands on a visitor
// who walked away mid-screen.
function SurveyRatePanel({ onRate, onSkip }: { onRate: (n: number) => void; onSkip: () => void }) {
  const [hovered, setHovered] = useState(0);
  useEffect(() => {
    const t = setTimeout(onSkip, 20_000);
    return () => clearTimeout(t);
  }, [onSkip]);
  return (
    <div className="pt-4 mt-1 border-t border-border/60 space-y-2 animate-fade-in">
      <p className="text-[15px] font-semibold text-foreground">How was your visit today?</p>
      <div className="flex items-center justify-center gap-1.5" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onRate(n)}
            onMouseEnter={() => setHovered(n)}
            className="p-1 rounded-xl transition-transform hover:scale-110 active:scale-90"
            aria-label={`Rate ${n} out of 5 — ${RATING_LABELS[n - 1]}`}
          >
            <Star className={`h-10 w-10 transition-colors ${n <= hovered ? 'fill-[#D4A017] text-[#D4A017]' : 'text-border-strong'}`} />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted h-4">{hovered ? RATING_LABELS[hovered - 1] : ''}</p>
      <button onClick={onSkip} className="text-[13px] text-muted hover:text-foreground transition-colors">
        No thanks, skip
      </button>
    </div>
  );
}

// Comment step — optional free text; Skip submits the rating alone. The idle
// timer re-arms on every keystroke so someone mid-sentence is never cut off,
// but a walk-away still returns the kiosk to the welcome screen.
function SurveyCommentPanel({ rating, comment, submitting, onChange, onSkip, onSubmit, onTimeout }: {
  rating: number;
  comment: string;
  submitting: boolean;
  onChange: (v: string) => void;
  onSkip: () => void;
  onSubmit: () => void;
  onTimeout: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onTimeout, 45_000);
    return () => clearTimeout(t);
  }, [comment, onTimeout]);
  return (
    <div className="mt-6 text-center space-y-4 animate-fade-in">
      <div className="flex items-center justify-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} className={`h-6 w-6 ${n <= rating ? 'fill-[#D4A017] text-[#D4A017]' : 'text-border-strong'}`} />
        ))}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">Anything you'd like us to know?</h2>
        <p className="text-xs text-muted mt-1">Optional — your feedback goes to our Client Service team.</p>
      </div>
      <textarea
        value={comment}
        onChange={(e) => onChange(e.target.value.slice(0, 500))}
        rows={3}
        autoFocus
        placeholder="Share a comment (optional)…"
        className="w-full px-4 py-3 text-[15px] border-2 border-border rounded-2xl focus:border-primary focus:outline-none bg-surface text-foreground resize-none"
      />
      <div className="flex items-center justify-center gap-3">
        <button onClick={onSkip} disabled={submitting} className="h-11 px-4 text-sm text-muted hover:text-foreground transition-colors">
          Skip
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Submit feedback
        </button>
      </div>
    </div>
  );
}

// Thank-you — brief gold moment, then auto-return to the welcome screen.
function SurveyThanksPanel({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4_000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="mt-6 text-center space-y-4 animate-fade-in">
      <div className="w-12 h-12 bg-accent/15 rounded-full flex items-center justify-center mx-auto">
        <Star className="h-6 w-6 text-accent-warm fill-accent-warm" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">Thank you for your feedback!</h2>
      <p className="text-sm text-muted">Have a safe journey.</p>
      <button onClick={onDone} className="text-[13px] text-muted hover:text-foreground transition-colors">Done</button>
    </div>
  );
}
