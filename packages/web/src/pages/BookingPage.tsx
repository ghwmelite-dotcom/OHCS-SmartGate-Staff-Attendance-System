import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Copy, Check, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface BookableOfficer {
  bookable_id: string;
  officer_id: string;
  officer_name: string;
  officer_title?: string;
  directorate_name: string;
  slot_duration_mins: number;
  slot_start_time: string;
  slot_end_time: string;
  advance_days_min: number;
  advance_days_max: number;
}

interface BookingState {
  officer?: BookableOfficer;
  date?: string;
  timeSlot?: string;
  visitorName?: string;
  visitorPhone?: string;
  visitorEmail?: string;
  organisation?: string;
  purpose?: string;
}

interface BookingSuccess {
  reference_code: string;
  officer_name: string;
  directorate_name: string;
  appointment_date: string;
  time_slot: string;
}

/* ── Zod schema for Step 3 ───────────────────────────────────────────────── */

const detailsSchema = z.object({
  visitorName: z.string().min(2, 'Full name is required (min 2 characters)'),
  visitorPhone: z.string().min(7, 'Phone number is required'),
  visitorEmail: z
    .string()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  organisation: z.string().optional(),
  purpose: z.string().min(10, 'Please describe the purpose (min 10 characters)'),
});
type DetailsForm = z.infer<typeof detailsSchema>;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(slot: string): string {
  // slot is "HH:MM" — return as is (already readable)
  return slot;
}

/* ── Progress bar ────────────────────────────────────────────────────────── */

function ProgressBar({ step }: { step: number }) {
  const steps = ['Officer', 'Date & Time', 'Your Details', 'Review'];
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {steps.map((label, i) => {
          const num = i + 1;
          const isActive = num === step;
          const isDone = num < step;
          return (
            <div key={num} className="flex flex-col items-center flex-1">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300"
                style={{
                  background: isActive ? '#1A4D2E' : isDone ? '#1A4D2E' : '#E5E7EB',
                  color: isActive || isDone ? '#fff' : '#9CA3AF',
                  boxShadow: isActive ? '0 0 0 3px rgba(26,77,46,0.2)' : 'none',
                }}
              >
                {isDone ? <Check size={14} /> : num}
              </div>
              <span
                className="text-[11px] mt-1 font-medium hidden sm:block"
                style={{ color: isActive ? '#1A4D2E' : isDone ? '#1A4D2E' : '#9CA3AF' }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {/* connector line */}
      <div className="relative h-1 mx-4 rounded-full bg-gray-200 -mt-5 -z-10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
          style={{ width: `${((step - 1) / 3) * 100}%`, background: '#1A4D2E' }}
        />
      </div>
    </div>
  );
}

/* ── Skeleton loader ─────────────────────────────────────────────────────── */

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-gray-200 animate-pulse ${className ?? ''}`}
    />
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */

export function BookingPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [booking, setBooking] = useState<BookingState>({});
  const [success, setSuccess] = useState<BookingSuccess | null>(null);

  // Step 1
  const [officers, setOfficers] = useState<BookableOfficer[]>([]);
  const [officersLoading, setOfficersLoading] = useState(true);
  const [officersError, setOfficersError] = useState<string | null>(null);

  // Step 2
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Step 4 submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Copy ref code
  const [copied, setCopied] = useState(false);

  // Step 3 form
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<DetailsForm>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      visitorName: booking.visitorName ?? '',
      visitorPhone: booking.visitorPhone ?? '',
      visitorEmail: booking.visitorEmail ?? '',
      organisation: booking.organisation ?? '',
      purpose: booking.purpose ?? '',
    },
  });

  /* Fetch officers on mount */
  useEffect(() => {
    setOfficersLoading(true);
    fetch('/api/appointments/public/officers')
      .then((r) => r.json() as Promise<{ data?: { officers: BookableOfficer[] }; error?: { message: string } }>)
      .then((res) => {
        if (res.data?.officers) {
          setOfficers(res.data.officers);
        } else {
          setOfficersError(res.error?.message ?? 'Failed to load officers.');
        }
      })
      .catch(() => setOfficersError('Could not connect. Please try again.'))
      .finally(() => setOfficersLoading(false));
  }, []);

  /* Fetch slots when date changes in step 2 */
  const fetchSlots = useCallback((officerId: string, date: string) => {
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots([]);
    fetch(`/api/appointments/public/slots?officer_id=${encodeURIComponent(officerId)}&date=${encodeURIComponent(date)}`)
      .then((r) => r.json() as Promise<{ data?: { slots: string[] }; error?: { message: string } }>)
      .then((res) => {
        if (Array.isArray(res.data?.slots)) {
          setSlots(res.data!.slots);
        } else {
          setSlotsError(res.error?.message ?? 'Failed to load slots.');
        }
      })
      .catch(() => setSlotsError('Could not load slots. Please try again.'))
      .finally(() => setSlotsLoading(false));
  }, []);

  /* Submit booking */
  async function submitBooking() {
    if (!booking.officer || !booking.date || !booking.timeSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/appointments/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officer_id: booking.officer.officer_id,
          appointment_date: booking.date,
          time_slot: booking.timeSlot,
          visitor_name: booking.visitorName,
          visitor_phone: booking.visitorPhone,
          visitor_email: booking.visitorEmail || undefined,
          organisation: booking.organisation || undefined,
          purpose: booking.purpose,
        }),
      });
      const data = (await res.json()) as {
        data?: { reference_code?: string };
        error?: { message: string; code?: string };
      };
      if (!res.ok) {
        if (res.status === 409) {
          setSubmitError('That slot was just taken. Please go back and select another.');
        } else if (res.status === 429) {
          setSubmitError('Too many requests. Please wait and try again.');
        } else {
          setSubmitError(data.error?.message ?? 'Something went wrong. Please try again.');
        }
        return;
      }
      const refCode = data.data?.reference_code;
      if (!refCode) {
        setSubmitError('Booking created but no reference code returned. Please contact reception.');
        return;
      }
      setSuccess({
        reference_code: refCode,
        officer_name: booking.officer.officer_name,
        directorate_name: booking.officer.directorate_name,
        appointment_date: booking.date,
        time_slot: booking.timeSlot,
      });
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function copyRefCode() {
    if (!success) return;
    navigator.clipboard.writeText(success.reference_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function resetAll() {
    setStep(1);
    setBooking({});
    setSuccess(null);
    setSlots([]);
    setSubmitError(null);
  }

  /* ── Shared button styles ─────────────────────────────────────────────── */
  const btnPrimary = 'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white text-sm transition-all duration-200 hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';
  const btnSecondary = 'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all duration-200 hover:bg-gray-50 active:scale-95';
  const inputCls = 'w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/30 focus:border-[#1A4D2E] transition-all';

  /* ── Page shell ───────────────────────────────────────────────────────── */
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start py-8 px-4"
      style={{ background: 'linear-gradient(160deg, #f0f7f2 0%, #fafdf9 50%, #f5f9ff 100%)' }}
    >
      {/* Card */}
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        {/* Header */}
        <div
          className="px-8 pt-8 pb-6 text-center"
          style={{ borderBottom: '1px solid #F3F4F6' }}
        >
          <img
            src="/ohcs-logo.jpg"
            alt="OHCS Logo"
            className="w-16 h-16 rounded-xl object-cover mx-auto mb-3 shadow-sm"
          />
          <h1 className="text-xl font-bold" style={{ color: '#1A4D2E' }}>
            Book an Appointment
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 tracking-wide">
            Office of the Head of Civil Service
          </p>
        </div>

        {/* Body */}
        <div className="px-8 py-7">
          {success ? (
            <SuccessScreen success={success} copied={copied} onCopy={copyRefCode} onReset={resetAll} />
          ) : (
            <>
              <ProgressBar step={step} />
              {step === 1 && (
                <Step1
                  officers={officers}
                  loading={officersLoading}
                  error={officersError}
                  selected={booking.officer}
                  onSelect={(o) => setBooking((b) => ({ ...b, officer: o, date: undefined, timeSlot: undefined }))}
                  onNext={() => setStep(2)}
                  btnPrimary={btnPrimary}
                />
              )}
              {step === 2 && booking.officer && (
                <Step2
                  officer={booking.officer}
                  selectedDate={booking.date}
                  selectedSlot={booking.timeSlot}
                  slots={slots}
                  slotsLoading={slotsLoading}
                  slotsError={slotsError}
                  onDateChange={(date) => {
                    setBooking((b) => ({ ...b, date, timeSlot: undefined }));
                    if (date && booking.officer) fetchSlots(booking.officer.officer_id, date);
                  }}
                  onSlotSelect={(slot) => setBooking((b) => ({ ...b, timeSlot: slot }))}
                  onBack={() => setStep(1)}
                  onNext={() => setStep(3)}
                  btnPrimary={btnPrimary}
                  btnSecondary={btnSecondary}
                />
              )}
              {step === 3 && (
                <Step3
                  register={register}
                  errors={errors}
                  inputCls={inputCls}
                  onBack={() => setStep(2)}
                  onNext={async () => {
                    const valid = await trigger();
                    if (!valid) return;
                    const vals = getValues();
                    setBooking((b) => ({
                      ...b,
                      visitorName: vals.visitorName,
                      visitorPhone: vals.visitorPhone,
                      visitorEmail: vals.visitorEmail,
                      organisation: vals.organisation,
                      purpose: vals.purpose,
                    }));
                    setStep(4);
                  }}
                  btnPrimary={btnPrimary}
                  btnSecondary={btnSecondary}
                />
              )}
              {step === 4 && booking.officer && booking.date && booking.timeSlot && (
                <Step4
                  booking={booking as Required<BookingState>}
                  submitting={submitting}
                  submitError={submitError}
                  onBack={() => setStep(3)}
                  onConfirm={submitBooking}
                  btnPrimary={btnPrimary}
                  btnSecondary={btnSecondary}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Ghana flag accent */}
      <div className="mt-6 h-1 w-24 rounded-full" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
      <p className="text-xs text-gray-400 mt-2">OHCS Visitor Management System</p>
    </div>
  );
}

/* ── Step 1: Select Officer ──────────────────────────────────────────────── */

function Step1({
  officers, loading, error, selected, onSelect, onNext, btnPrimary,
}: {
  officers: BookableOfficer[];
  loading: boolean;
  error: string | null;
  selected?: BookableOfficer;
  onSelect: (o: BookableOfficer) => void;
  onNext: () => void;
  btnPrimary: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-800 mb-1">Who would you like to meet?</h2>
      <p className="text-xs text-gray-500 mb-4">Select an officer to book an appointment with.</p>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl p-4 bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {!loading && !error && officers.length === 0 && (
        <div className="rounded-xl p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
          No officers are currently available for booking. Please check back later or contact reception.
        </div>
      )}

      {!loading && !error && officers.length > 0 && (
        <div className={officers.length <= 6 ? 'grid gap-3' : 'block'}>
          {officers.length <= 6 ? (
            officers.map((o) => {
              const isSelected = selected?.bookable_id === o.bookable_id;
              return (
                <button
                  key={o.bookable_id}
                  onClick={() => onSelect(o)}
                  className="w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all duration-200 hover:shadow-sm active:scale-[0.99]"
                  style={{
                    borderColor: isSelected ? '#1A4D2E' : '#E5E7EB',
                    background: isSelected ? '#f0f7f2' : '#fff',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{o.officer_name}</p>
                      {o.officer_title && <p className="text-xs text-gray-500">{o.officer_title}</p>}
                      <p className="text-xs mt-0.5" style={{ color: '#1A4D2E' }}>{o.directorate_name}</p>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#1A4D2E' }}>
                        <Check size={12} color="#fff" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="relative">
              <select
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/30 focus:border-[#1A4D2E] appearance-none"
                value={selected?.bookable_id ?? ''}
                onChange={(e) => {
                  const o = officers.find((x) => x.bookable_id === e.target.value);
                  if (o) onSelect(o);
                }}
              >
                <option value="">-- Select an officer --</option>
                {officers.map((o) => (
                  <option key={o.bookable_id} value={o.bookable_id}>
                    {o.officer_name}{o.officer_title ? ` — ${o.officer_title}` : ''} ({o.directorate_name})
                  </option>
                ))}
              </select>
              <ChevronRight size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 rotate-90 pointer-events-none" />
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end mt-6">
        <button
          onClick={onNext}
          disabled={!selected}
          className={btnPrimary}
          style={{ background: '#1A4D2E' }}
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ── Step 2: Date & Time ─────────────────────────────────────────────────── */

function Step2({
  officer, selectedDate, selectedSlot,
  slots, slotsLoading, slotsError,
  onDateChange, onSlotSelect, onBack, onNext,
  btnPrimary, btnSecondary,
}: {
  officer: BookableOfficer;
  selectedDate?: string;
  selectedSlot?: string;
  slots: string[];
  slotsLoading: boolean;
  slotsError: string | null;
  onDateChange: (d: string) => void;
  onSlotSelect: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
  btnPrimary: string;
  btnSecondary: string;
}) {
  const today = new Date();
  const minDate = addDays(today, officer.advance_days_min);
  const maxDate = addDays(today, officer.advance_days_max);

  function handleDateChange(val: string) {
    if (!val) { onDateChange(''); return; }
    if (isWeekend(val)) {
      // nudge to Monday
      const d = new Date(val + 'T00:00:00');
      d.setDate(d.getDate() + (d.getDay() === 6 ? 2 : 1));
      const fixed = d.toISOString().slice(0, 10);
      onDateChange(fixed);
    } else {
      onDateChange(val);
    }
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-800 mb-1">Choose a Date</h2>
      <p className="text-xs text-gray-500 mb-4">
        Select a weekday between {formatDate(minDate)} and {formatDate(maxDate)}.
      </p>

      <div className="mb-5">
        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Date</label>
        <input
          type="date"
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/30 focus:border-[#1A4D2E] transition-all"
          min={minDate}
          max={maxDate}
          value={selectedDate ?? ''}
          onChange={(e) => handleDateChange(e.target.value)}
        />
        {selectedDate && isWeekend(selectedDate) && (
          <p className="text-xs text-amber-600 mt-1">Weekends are not available. Please select a weekday.</p>
        )}
      </div>

      {selectedDate && !isWeekend(selectedDate) && (
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Available Time Slots</label>

          {slotsLoading && (
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-10" />)}
            </div>
          )}

          {slotsError && (
            <div className="rounded-xl p-3 bg-red-50 border border-red-200 text-red-700 text-sm">{slotsError}</div>
          )}

          {!slotsLoading && !slotsError && slots.length === 0 && (
            <div className="rounded-xl p-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              No slots available for this date. Please try another day.
            </div>
          )}

          {!slotsLoading && !slotsError && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot) => {
                const isSelected = selectedSlot === slot;
                return (
                  <button
                    key={slot}
                    onClick={() => onSlotSelect(slot)}
                    className="py-2.5 px-3 rounded-xl text-sm font-semibold border-2 transition-all duration-150 active:scale-95"
                    style={{
                      borderColor: isSelected ? '#1A4D2E' : '#E5E7EB',
                      background: isSelected ? '#1A4D2E' : '#fff',
                      color: isSelected ? '#fff' : '#374151',
                    }}
                  >
                    {formatTime(slot)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className={btnSecondary} style={{ borderColor: '#D1D5DB', color: '#374151' }}>
          <ChevronLeft size={16} /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!selectedDate || !selectedSlot || isWeekend(selectedDate ?? '')}
          className={btnPrimary}
          style={{ background: '#1A4D2E' }}
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ── Step 3: Visitor Details ─────────────────────────────────────────────── */

function Step3({
  register, errors, inputCls, onBack, onNext, btnPrimary, btnSecondary,
}: {
  register: ReturnType<typeof useForm<DetailsForm>>['register'];
  errors: ReturnType<typeof useForm<DetailsForm>>['formState']['errors'];
  inputCls: string;
  onBack: () => void;
  onNext: () => void;
  btnPrimary: string;
  btnSecondary: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-800 mb-1">Your Details</h2>
      <p className="text-xs text-gray-500 mb-5">Tell us a bit about yourself and the reason for your visit.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
            Full Name <span className="text-red-500">*</span>
          </label>
          <input {...register('visitorName')} placeholder="e.g. Kwame Asante" className={inputCls} />
          {errors.visitorName && <p className="text-xs text-red-500 mt-1">{errors.visitorName.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
            Phone Number <span className="text-red-500">*</span>
          </label>
          <input {...register('visitorPhone')} placeholder="e.g. 024 123 4567" className={inputCls} inputMode="tel" />
          {errors.visitorPhone && <p className="text-xs text-red-500 mt-1">{errors.visitorPhone.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
            Email Address <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input {...register('visitorEmail')} placeholder="e.g. kwame@example.com" className={inputCls} inputMode="email" type="email" />
          {errors.visitorEmail && <p className="text-xs text-red-500 mt-1">{errors.visitorEmail.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
            Organisation / Company <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input {...register('organisation')} placeholder="e.g. Ashanti Regional Coordinating Council" className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
            Purpose of Visit <span className="text-red-500">*</span>
          </label>
          <textarea
            {...register('purpose')}
            placeholder="Briefly describe the reason for your appointment..."
            rows={3}
            className={`${inputCls} resize-none`}
          />
          {errors.purpose && <p className="text-xs text-red-500 mt-1">{errors.purpose.message}</p>}
        </div>
      </div>

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className={btnSecondary} style={{ borderColor: '#D1D5DB', color: '#374151' }}>
          <ChevronLeft size={16} /> Back
        </button>
        <button onClick={onNext} className={btnPrimary} style={{ background: '#1A4D2E' }}>
          Review <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ── Step 4: Review & Submit ─────────────────────────────────────────────── */

function Step4({
  booking, submitting, submitError, onBack, onConfirm, btnPrimary, btnSecondary,
}: {
  booking: Required<BookingState>;
  submitting: boolean;
  submitError: string | null;
  onBack: () => void;
  onConfirm: () => void;
  btnPrimary: string;
  btnSecondary: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-800 mb-1">Review Your Booking</h2>
      <p className="text-xs text-gray-500 mb-5">Please confirm the details below before submitting.</p>

      <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100 mb-5">
        {/* Officer */}
        <div className="px-4 py-3 bg-gray-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Officer</p>
          <p className="font-semibold text-sm text-gray-900">{booking.officer.officer_name}</p>
          {booking.officer.officer_title && <p className="text-xs text-gray-500">{booking.officer.officer_title}</p>}
          <p className="text-xs mt-0.5" style={{ color: '#1A4D2E' }}>{booking.officer.directorate_name}</p>
        </div>

        {/* Date & Time */}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Date & Time</p>
          <p className="font-semibold text-sm text-gray-900">{formatDate(booking.date)}</p>
          <p className="text-xs text-gray-600">{formatTime(booking.timeSlot)}</p>
        </div>

        {/* Visitor */}
        <div className="px-4 py-3 bg-gray-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Your Details</p>
          <p className="font-semibold text-sm text-gray-900">{booking.visitorName}</p>
          <p className="text-xs text-gray-600">{booking.visitorPhone}</p>
          {booking.visitorEmail && <p className="text-xs text-gray-600">{booking.visitorEmail}</p>}
          {booking.organisation && <p className="text-xs text-gray-500 italic">{booking.organisation}</p>}
        </div>

        {/* Purpose */}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Purpose of Visit</p>
          <p className="text-sm text-gray-700 leading-relaxed">{booking.purpose}</p>
        </div>
      </div>

      {submitError && (
        <div className="rounded-xl p-3 bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
          {submitError}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} disabled={submitting} className={btnSecondary} style={{ borderColor: '#D1D5DB', color: '#374151' }}>
          <ChevronLeft size={16} /> Edit
        </button>
        <button
          onClick={onConfirm}
          disabled={submitting}
          className={btnPrimary}
          style={{ background: '#1A4D2E', minWidth: 160 }}
        >
          {submitting ? (
            <><Loader2 size={16} className="animate-spin" /> Submitting…</>
          ) : (
            <>Confirm Booking <ChevronRight size={16} /></>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Success Screen ──────────────────────────────────────────────────────── */

function SuccessScreen({
  success, copied, onCopy, onReset,
}: {
  success: BookingSuccess;
  copied: boolean;
  onCopy: () => void;
  onReset: () => void;
}) {
  return (
    <div className="text-center py-2">
      {/* Animated checkmark */}
      <div
        className="mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-5"
        style={{
          background: 'linear-gradient(135deg, #1A4D2E, #2D7A4F)',
          boxShadow: '0 8px 30px rgba(26,77,46,0.25)',
          animation: 'scale-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
        }}
      >
        <CheckCircle2 size={40} color="#fff" />
      </div>

      <h2 className="text-xl font-bold mb-1" style={{ color: '#1A4D2E' }}>Appointment Booked!</h2>
      <p className="text-sm text-gray-500 mb-6">Your appointment has been successfully submitted for approval.</p>

      {/* Reference code box */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Your Reference Code</p>
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border-2 mx-auto"
          style={{ borderColor: '#D4A017', background: '#FFFDF0', maxWidth: 280 }}
        >
          <span
            className="font-mono text-2xl font-bold tracking-widest flex-1 text-center"
            style={{ color: '#1A4D2E' }}
          >
            {success.reference_code}
          </span>
          <button
            onClick={onCopy}
            className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 active:scale-90"
            style={{ background: copied ? '#1A4D2E' : '#F3F4F6', color: copied ? '#fff' : '#6B7280' }}
            title="Copy reference code"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      {/* Appointment summary */}
      <div className="text-left rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100 mb-6">
        <div className="px-4 py-3 bg-gray-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Officer</p>
          <p className="text-sm font-semibold text-gray-900">{success.officer_name}</p>
          <p className="text-xs" style={{ color: '#1A4D2E' }}>{success.directorate_name}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">When</p>
          <p className="text-sm font-semibold text-gray-900">{formatDate(success.appointment_date)}</p>
          <p className="text-xs text-gray-600">{formatTime(success.time_slot)}</p>
        </div>
      </div>

      {/* Note */}
      <div
        className="rounded-xl px-4 py-3 text-sm text-left mb-6"
        style={{ background: '#F0F7F2', borderLeft: '3px solid #1A4D2E' }}
      >
        <p className="font-semibold text-gray-800 mb-0.5">Important</p>
        <p className="text-gray-600 text-xs leading-relaxed">
          Please bring this reference code when you arrive.
          Present it at the kiosk for a quick check-in. Note that your appointment is subject to approval — you will be contacted if there are any changes.
        </p>
      </div>

      <button
        onClick={onReset}
        className="w-full py-3 rounded-xl font-semibold text-sm border-2 transition-all duration-200 hover:bg-gray-50 active:scale-95"
        style={{ borderColor: '#1A4D2E', color: '#1A4D2E' }}
      >
        Book Another Appointment
      </button>

      <style>{`
        @keyframes scale-in {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.08); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
