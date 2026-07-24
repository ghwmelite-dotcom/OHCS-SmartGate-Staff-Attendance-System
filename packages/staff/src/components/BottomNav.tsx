import { useState } from 'react';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { SettingsMenu } from './SettingsMenu';
import { ProfileModal } from './ProfileModal';
import { PinChangeModal } from '@/hooks/usePinChange';
import { useAuthStore } from '@/stores/auth';

export function BottomNav() {
  const logout = useAuthStore((s) => s.logout);
  const [showPin, setShowPin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#D4A017]/20"
        style={{
          background: 'linear-gradient(180deg, #1A4D2E, #0F2E1B)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        aria-label="Primary navigation"
      >
        <div className="flex items-stretch justify-around h-[56px] px-2">
          <SettingsMenu placement="top" variant="nav-item" />
          <button
            type="button"
            onClick={() => setShowProfile(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-6 h-full text-white/70 hover:text-white transition-colors"
          >
            <UserRound className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">Profile</span>
          </button>
          <button
            type="button"
            onClick={() => setShowPin(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-6 h-full text-white/70 hover:text-white transition-colors"
          >
            <KeyRound className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">PIN</span>
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex flex-col items-center justify-center gap-0.5 px-6 h-full text-white/70 hover:text-white transition-colors"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">Sign Out</span>
          </button>
        </div>
      </nav>
      {showPin && <PinChangeModal onClose={() => setShowPin(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </>
  );
}
