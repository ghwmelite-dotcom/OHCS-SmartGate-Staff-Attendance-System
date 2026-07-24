import { useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { UserRound, X, Check, Phone, Mail, Lock } from 'lucide-react';

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Self-service bio data — view + correct name, phone, email. Name and email are
 * identity fields (name lands on attendance records), so changing either asks
 * for the current PIN; phone-only edits save directly.
 */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  if (!user) return null;

  const identifier = user.staff_id ?? user.nss_number ?? user.intern_code ?? null;
  const nameChanged = name.trim() !== user.name;
  const emailChanged = email.trim().toLowerCase() !== user.email;
  const pinRequired = nameChanged || emailChanged;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      const patch: { name?: string; phone?: string; email?: string; current_pin?: string } = {};
      if (phone !== (user?.phone ?? '')) patch.phone = phone;
      if (nameChanged) { patch.name = name.trim(); patch.current_pin = pin; }
      if (emailChanged) { patch.email = email.trim().toLowerCase(); patch.current_pin = pin; }
      if (Object.keys(patch).length === 0) {
        setErrorMsg('No changes to save');
        setStatus('error');
        return;
      }
      await updateProfile(patch);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update profile');
      setStatus('error');
    }
  }

  const inputCls = 'w-full h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl max-h-[calc(100dvh-40px)] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          {status === 'success' ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="h-7 w-7 text-green-600" />
              </div>
              <p className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Profile Updated</p>
              <p className="text-[14px] text-gray-500 mt-1">
                {emailChanged ? 'Your other devices have been signed out' : 'Your details are now up to date'}
              </p>
              <button onClick={onClose} className="mt-4 h-10 px-6 bg-[#1A4D2E] text-white text-[14px] font-semibold rounded-xl">Done</button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <UserRound className="h-5 w-5 text-[#1A4D2E]" />
                  <h3 className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>My Profile</h3>
                </div>
                <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Identity line — read-only */}
              <div className="flex items-center gap-2 mb-5 text-[12px]">
                {identifier && (
                  <span className="font-mono font-semibold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-200">
                    {identifier}
                  </span>
                )}
                <span className="font-semibold text-gray-400 uppercase tracking-wide">{roleLabel(user.role)}</span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> Full Name</span>
                  </label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)}
                    className={inputCls} placeholder="Ama Serwaa" minLength={2} maxLength={120} />
                  {nameChanged && (
                    <p className="text-[12px] text-gray-400 mt-1">Shown on your attendance records.</p>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Phone Number</span>
                  </label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    className={inputCls} placeholder="0241234567" inputMode="tel" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Address</span>
                  </label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className={inputCls} placeholder="you@ohcs.gov.gh" />
                </div>

                {pinRequired && (
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Current PIN (to confirm {nameChanged && emailChanged ? 'name & email change' : nameChanged ? 'name change' : 'email change'})</span>
                    </label>
                    <input type="password" required maxLength={6} value={pin}
                      onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-center tracking-[0.5em] font-mono text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]"
                      inputMode="numeric" />
                  </div>
                )}

                {status === 'error' && errorMsg && <p className="text-red-600 text-[13px] font-medium">{errorMsg}</p>}
                <button type="submit"
                  disabled={status === 'loading' || (pinRequired && (pin.length < 4 || pin.length > 6))}
                  className="w-full h-12 bg-[#1A4D2E] text-white rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 transition-all">
                  {status === 'loading' ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
