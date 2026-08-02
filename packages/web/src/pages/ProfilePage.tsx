import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';
import { api, ApiError } from '@/lib/api';
import { roleLabel } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { UserCircle, Phone, Mail, Lock, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';

type Availability = 'available' | 'in_meeting' | 'out_of_office';

const AVAILABILITY_OPTIONS: Array<{ value: Availability; label: string; dot: string }> = [
  { value: 'available',     label: 'Available',     dot: 'bg-success' },
  { value: 'in_meeting',    label: 'In a meeting',  dot: 'bg-warning' },
  { value: 'out_of_office', label: 'Out of office', dot: 'bg-muted-foreground' },
];

// Local row shape — only what the availability card reads from GET /officers.
interface OfficerRow {
  id: string;
  name: string;
  email: string | null;
  availability_status?: Availability | null;
}

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Host availability — only shown when the account maps to an officer row.
  const [officerFound, setOfficerFound] = useState(false);
  const [availability, setAvailability] = useState<Availability>('available');
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilityResult, setAvailabilityResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const userEmail = user?.email;
  const userName = user?.name;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<OfficerRow[]>('/officers');
        const rows = res.data ?? [];
        // Same resolution as the server: email first, then name.
        const me = rows.find((o) => o.email && o.email === userEmail)
          ?? rows.find((o) => o.name === userName);
        if (!cancelled && me) {
          setOfficerFound(true);
          setAvailability(me.availability_status ?? 'available');
        }
      } catch {
        // No officer-list access (or no officer row) → keep the control hidden.
      }
    })();
    return () => { cancelled = true; };
  }, [userEmail, userName]);

  async function handleAvailability(status: Availability) {
    if (status === availability || availabilitySaving) return;
    setAvailabilitySaving(true);
    setAvailabilityResult(null);
    try {
      await api.put('/officers/me/availability', { status });
      setAvailability(status);
      setAvailabilityResult({ ok: true, msg: 'Availability updated.' });
    } catch (err) {
      setAvailabilityResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed to update availability.' });
    } finally {
      setAvailabilitySaving(false);
    }
  }

  if (!user) return null;

  const nameChanged = name.trim() !== user.name;
  const emailChanged = email !== user.email;
  // Identity fields (name, email) need PIN confirmation; phone stays ungated.
  const pinRequired = nameChanged || emailChanged;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const patch: { name?: string; phone?: string; email?: string; current_pin?: string } = {};
      if (phone !== (user?.phone ?? '')) patch.phone = phone;
      if (nameChanged) { patch.name = name.trim(); patch.current_pin = pin; }
      if (emailChanged) { patch.email = email; patch.current_pin = pin; }
      if (Object.keys(patch).length === 0) {
        setResult({ ok: false, msg: 'No changes to save.' });
        setSaving(false);
        return;
      }
      await updateProfile(patch);
      setResult({ ok: true, msg: emailChanged ? 'Profile updated. Other devices have been signed out.' : 'Profile updated.' });
      setPin('');
    } catch (err) {
      // /auth/* 401s are exempt from the client-wide login redirect so
      // WRONG_PIN can render inline — but a revoked session is not a wrong
      // PIN; send the user back to login.
      if (err instanceof ApiError && err.code === 'SESSION_REVOKED') {
        window.location.href = '/login';
        return;
      }
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed to update profile.' });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

  return (
    <div className="space-y-6 max-w-xl">
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          My Profile
        </h1>
        <p className="text-[15px] text-muted mt-0.5">View and correct your basic bio data</p>
      </div>

      {/* Identity card */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-1">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <UserCircle className="h-7 w-7 text-primary" />
          </div>
          <div>
            <p className="text-[18px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{user.name}</p>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {user.staff_id && (
                <span className="text-[12px] font-mono font-semibold text-muted bg-background px-2 py-0.5 rounded-lg border border-border">
                  {user.staff_id}
                </span>
              )}
              <span className="text-[12px] font-semibold text-muted uppercase tracking-wide">{roleLabel(user.role, user.display_role)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Availability — only for accounts that map to an officer row */}
      {officerFound && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-2">
          <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
          <div className="p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                My Availability
              </h2>
              <p className="text-[13px] text-muted mt-0.5">
                Shown to reception and the kiosk when they pick you as a host.
              </p>
            </div>
            <div className="flex rounded-xl border border-border divide-x divide-border overflow-hidden" role="radiogroup" aria-label="My availability">
              {AVAILABILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={availability === opt.value}
                  disabled={availabilitySaving}
                  onClick={() => handleAvailability(opt.value)}
                  className={cn(
                    'flex-1 h-11 text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50',
                    availability === opt.value
                      ? 'bg-primary/10 text-foreground'
                      : 'bg-surface text-muted hover:bg-background-warm',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full shrink-0', opt.dot)} />
                  {opt.label}
                </button>
              ))}
            </div>
            {availabilityResult && (
              <div className={cn(
                'flex items-center gap-2 text-[13px] font-medium',
                availabilityResult.ok ? 'text-success' : 'text-danger'
              )}>
                {availabilityResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <AlertCircle className="h-4 w-4 shrink-0" />}
                {availabilityResult.msg}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit form */}
      <form onSubmit={handleSubmit} className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-2">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6 space-y-5">
          <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Basic Details
          </h2>

          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><UserCircle className="h-3.5 w-3.5" /> Full Name</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="Ama Serwaa"
              minLength={2}
              maxLength={120}
            />
            {nameChanged && (
              <p className="text-[12px] text-muted mt-1">This is the name shown on your attendance and visit records.</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Phone Number</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              placeholder="0241234567"
              inputMode="tel"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Address</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@ohcs.gov.gh"
            />
            {emailChanged && (
              <p className="text-[12px] text-muted mt-1">Changing your email requires your current PIN to confirm.</p>
            )}
          </div>

          {/* PIN confirmation — shown when an identity field (name/email) changes */}
          {pinRequired && (
            <div>
              <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
                <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Current PIN (to confirm {nameChanged && emailChanged ? 'name & email change' : nameChanged ? 'name change' : 'email change'})</span>
              </label>
              <input
                type="password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className={cn(inputCls, 'text-center tracking-[0.4em] font-mono text-xl')}
                placeholder="••••"
                inputMode="numeric"
                required={pinRequired}
              />
            </div>
          )}

          {result && (
            <div className={cn(
              'flex items-center gap-2 text-[13px] font-medium',
              result.ok ? 'text-success' : 'text-danger'
            )}>
              {result.ok
                ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                : <AlertCircle className="h-4 w-4 shrink-0" />}
              {result.msg}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || (pinRequired && (pin.length < 4 || pin.length > 6))}
            className="w-full h-11 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15 active:scale-[0.98]"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>

      <ChangePinCard />
    </div>
  );
}

/* ---- Change PIN — mirrors the staff PWA's change-PIN flow (current + new +
   confirm). POST /auth/change-pin requires the NEW pin to be exactly 4
   digits (current may be 4–6, matching whatever the account was issued). */
function ChangePinCard() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';
  const pinInputCls = cn(inputCls, 'text-center tracking-[0.4em] font-mono text-xl');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPin !== confirmPin) {
      setResult({ ok: false, msg: 'New PINs do not match.' });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      await api.post('/auth/change-pin', { current_pin: currentPin, new_pin: newPin });
      toast.success('PIN changed successfully');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (err) {
      // Same SESSION_REVOKED special-case as the profile form above.
      if (err instanceof ApiError && err.code === 'SESSION_REVOKED') {
        window.location.href = '/login';
        return;
      }
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed to change PIN.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-3">
      <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
      <div className="p-6 space-y-5">
        <div>
          <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Change PIN
          </h2>
          <p className="text-[13px] text-muted mt-0.5">
            Your PIN signs you in and confirms identity changes. New PINs are 4 digits.
          </p>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
            <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Current PIN</span>
          </label>
          <input
            type="password"
            maxLength={6}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
            className={pinInputCls}
            placeholder="••••"
            inputMode="numeric"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> New PIN</span>
            </label>
            <input
              type="password"
              maxLength={4}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              className={pinInputCls}
              placeholder="••••"
              inputMode="numeric"
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Confirm New PIN</span>
            </label>
            <input
              type="password"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className={pinInputCls}
              placeholder="••••"
              inputMode="numeric"
              required
            />
          </div>
        </div>

        {result && (
          <div className={cn(
            'flex items-center gap-2 text-[13px] font-medium',
            result.ok ? 'text-success' : 'text-danger'
          )}>
            {result.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0" />
              : <AlertCircle className="h-4 w-4 shrink-0" />}
            {result.msg}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || currentPin.length < 4 || newPin.length !== 4 || confirmPin.length !== 4}
          className="w-full h-11 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15 active:scale-[0.98]"
        >
          {saving ? 'Changing…' : 'Change PIN'}
        </button>
      </div>
    </form>
  );
}
