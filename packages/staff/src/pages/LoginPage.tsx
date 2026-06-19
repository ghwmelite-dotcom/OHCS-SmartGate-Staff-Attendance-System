import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { KeyRound, Fingerprint, Briefcase, GraduationCap, BookUser } from 'lucide-react';
import {
  getLastIdentifier,
  supportsPlatformAuthenticator,
  type IdentifierKind,
} from '@/lib/webauthnClient';

const TAB_STORAGE_KEY = 'ohcs-staff-pwa.login-tab';

type Tab = 'staff' | 'nss' | 'intern';

const TAB_KIND: Record<Tab, IdentifierKind> = {
  staff: 'staff_id',
  nss: 'nss_number',
  intern: 'intern_code',
};

const TAB_COPY: Record<Tab, { label: string; placeholder: string; helper: string }> = {
  staff: {
    label: 'Staff ID',
    placeholder: 'e.g. 1334685',
    helper: 'Issued by HR',
  },
  nss: {
    label: 'NSS Number',
    placeholder: 'e.g. NSSGUE8364724',
    helper: 'From your NSS posting letter',
  },
  intern: {
    label: 'Intern Code',
    placeholder: 'e.g. OHCS-INT-2026-001',
    helper: 'Issued by HR / F&A',
  },
};

function readInitialTab(): Tab {
  // The remembered identifier kind beats the explicit tab choice — a returning NSS user
  // should land on NSS even if they once tapped Staff. If neither exists, fall back to staff.
  try {
    const id = getLastIdentifier();
    if (id?.kind === 'nss_number') return 'nss';
    if (id?.kind === 'staff_id') return 'staff';
    if (id?.kind === 'intern_code') return 'intern';
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'staff' || stored === 'nss' || stored === 'intern') return stored;
  } catch { /* ignore */ }
  return 'staff';
}

export function LoginPage() {
  const last = useMemo(() => getLastIdentifier(), []);
  const [tab, setTab] = useState<Tab>(() => readInitialTab());
  // Two independent inputs so swapping tabs doesn't lose what the user typed in the other.
  const [staffValue, setStaffValue] = useState(() => (last?.kind === 'staff_id' ? last.value : ''));
  const [nssValue, setNssValue] = useState(() => (last?.kind === 'nss_number' ? last.value : ''));
  const [internValue, setInternValue] = useState(() => (last?.kind === 'intern_code' ? last.value : ''));
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const { loginWithPin, loginWithWebAuthn } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    supportsPlatformAuthenticator().then((ok) => {
      if (!cancelled) setBioAvailable(ok);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  const copy = TAB_COPY[tab];
  const value = tab === 'staff' ? staffValue : tab === 'nss' ? nssValue : internValue;
  const setValue = tab === 'staff' ? setStaffValue : tab === 'nss' ? setNssValue : setInternValue;
  const trimmed = value.trim();
  const showNssWelcome = tab === 'nss' && !last;
  const tabIdx = tab === 'staff' ? 0 : tab === 'nss' ? 1 : 2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!trimmed) {
      setError(`Enter your ${copy.label} first`);
      return;
    }
    setIsLoading(true);
    try {
      await loginWithPin({ kind: TAB_KIND[tab], value: trimmed }, pin);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleBiometric() {
    if (!trimmed) {
      setError(`Enter your ${copy.label} first`);
      return;
    }
    setError('');
    setBioLoading(true);
    try {
      await loginWithWebAuthn({ kind: TAB_KIND[tab], value: trimmed });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Biometric sign-in failed');
    } finally {
      setBioLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5" style={{
      background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)',
    }}>
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
          repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
      }} />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden ring-2 ring-[#D4A017]/20 shadow-2xl mx-auto mb-4">
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
          <p className="text-[11px] text-[#D4A017]/70 tracking-[0.2em] uppercase mt-1">OHCS ClockIn System</p>
        </div>

        <div className="bg-white/[0.08] backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="h-4 w-4 text-[#D4A017]" />
            <span className="text-[14px] font-semibold text-white">Sign In</span>
          </div>

          {/* Tab pill — single component with sliding gold underline */}
          <div
            role="tablist"
            aria-label="Choose account type"
            className="relative grid grid-cols-3 mb-5 rounded-xl bg-white/5 border border-white/10 p-1"
          >
            {/* Sliding indicator */}
            <span
              aria-hidden
              className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(33.333%-4px)] rounded-lg bg-white/[0.07] ring-1 ring-[#D4A017]/30 transition-transform duration-[250ms] ease-out motion-reduce:transition-none"
              style={{ transform: `translateX(${tabIdx * 100}%)` }}
            />
            {/* Gold underline bar */}
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-px left-1 h-[2px] w-[calc(33.333%-4px)] rounded-full bg-[#D4A017] transition-transform duration-[250ms] ease-out motion-reduce:transition-none"
              style={{ transform: `translateX(${tabIdx * 100}%)` }}
            />
            {(['staff', 'nss', 'intern'] as const).map((t) => {
              const isActive = tab === t;
              const Icon = t === 'staff' ? Briefcase : t === 'nss' ? GraduationCap : BookUser;
              const labelText = t === 'staff' ? 'Staff' : t === 'nss' ? 'NSS' : 'Intern';
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="login-form"
                  onClick={() => { setTab(t); setError(''); }}
                  className={`relative z-[1] h-11 inline-flex items-center justify-center gap-2 rounded-lg text-[13px] font-semibold tracking-wide transition-colors ${
                    isActive ? 'text-white' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {labelText}
                </button>
              );
            })}
          </div>

          <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-identifier" className="block text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1.5">
                {copy.label}
              </label>
              <input
                id="login-identifier"
                type="text"
                required
                value={value}
                onChange={(e) => setValue(e.target.value.toUpperCase())}
                placeholder={copy.placeholder}
                autoFocus={!trimmed}
                autoComplete="username"
                inputMode={tab === 'staff' ? 'numeric' : 'text'}
                className="w-full h-12 px-4 rounded-xl bg-white/10 border border-white/10 text-white text-[15px] font-medium tracking-wider placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4A017]/30 focus:border-[#D4A017]/40 transition-all"
              />
              <p className="mt-1.5 text-[11px] text-white/40">{copy.helper}</p>
            </div>
            <div>
              <label htmlFor="login-pin" className="block text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1.5">PIN</label>
              <input
                id="login-pin"
                type="password"
                required
                maxLength={6}
                minLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                inputMode="numeric"
                autoComplete="current-password"
                className="w-full h-14 px-4 rounded-xl bg-white/10 border border-white/10 text-white text-center text-2xl font-bold tracking-[0.5em] font-mono placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#D4A017]/30 focus:border-[#D4A017]/40 transition-all"
              />
            </div>
            {error && <p className="text-red-400 text-[13px] font-medium" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={isLoading || bioLoading || pin.length < 4 || !trimmed}
              className="w-full h-12 bg-[#D4A017] text-[#071A0F] rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 shadow-lg shadow-[#D4A017]/20 active:scale-[0.98] transition-all"
            >
              {isLoading ? 'Signing in…' : 'Sign In'}
            </button>

            {bioAvailable && (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-[10px] tracking-[0.2em] uppercase text-white/30 font-semibold">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                <button
                  type="button"
                  onClick={handleBiometric}
                  disabled={isLoading || bioLoading || !trimmed}
                  className="w-full h-12 rounded-xl bg-white/10 border border-[#D4A017]/30 text-white text-[14px] font-semibold hover:bg-white/15 hover:border-[#D4A017]/50 disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <Fingerprint className="h-5 w-5 text-[#D4A017]" />
                  {bioLoading ? 'Authenticating…' : 'Sign in with Biometrics'}
                </button>
                <p className="text-[11px] text-white/40 text-center">Enroll from the Settings menu after signing in</p>
              </>
            )}

            {showNssWelcome && (
              <p className="text-[11px] text-white/50 text-center pt-1 leading-relaxed">
                Use the 6-digit PIN F&amp;A gave you. You can switch to a 4-digit PIN after sign-in.
              </p>
            )}
          </form>
        </div>

        <div className="flex items-center justify-center gap-3 mt-8" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-50">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-30" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-50">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-30" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-50">Service</span>
        </div>
      </div>
    </div>
  );
}
