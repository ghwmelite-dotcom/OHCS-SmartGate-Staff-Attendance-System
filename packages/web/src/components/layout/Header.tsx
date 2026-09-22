import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { formatDate } from '@/lib/utils';
import { NotificationBell } from '../NotificationBell';
import { SettingsMenu } from '@/components/SettingsMenu';
import { MapPin, Sun, Moon, Monitor, UserPlus, HelpCircle } from 'lucide-react';
import { roleLabel } from '@/lib/roles';
import { cn } from '@/lib/utils';

export function Header({ onOpenWizard }: { onOpenWizard: () => void }) {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useThemeStore();
  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
    { value: 'system' as const, icon: Monitor, label: 'System' },
  ];

  return (
    <header
      className="bg-surface-warm border-b border-border px-3 md:px-6 flex items-center justify-between gap-2 shrink-0 relative z-40"
      style={{
        minHeight: '60px',
        paddingTop: 'max(0px, env(safe-area-inset-top, 0px))',
      }}
    >
      {/* Left — location & date */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile: show OHCS logo instead of location text */}
        <div className="lg:hidden flex shrink-0 items-center gap-2">
          <div className="relative w-8 h-8 flex-shrink-0">
            <div className="w-full h-full rounded-lg overflow-hidden">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div
              className="absolute -bottom-1 -right-1 w-[14px] h-[14px] rounded-full flex items-center justify-center shadow-sm"
              style={{ background: '#D4A017', boxShadow: '0 0 0 1.5px var(--color-surface-warm)' }}
              aria-hidden="true"
            >
              <UserPlus className="h-[8px] w-[8px] text-white" strokeWidth={2.5} />
            </div>
          </div>
          <span className="whitespace-nowrap text-[15px] font-bold text-foreground tracking-wide" style={{ fontFamily: 'var(--font-display)' }}><span className="hidden sm:inline">OHCS </span><span className="text-accent">VMS</span></span>
        </div>

        <div className="hidden lg:flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-accent">
            <MapPin className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-foreground/80 tracking-wide">
              Office of the Head of the Civil Service
            </p>
            <p className="text-[11px] text-muted-foreground">
              Accra, Ghana &middot; {formatDate(new Date().toISOString())}
            </p>
          </div>
        </div>
      </div>

      {/* Right — theme + notifications + user */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2 md:gap-3">
        <div className="relative h-11 w-11 sm:hidden">
          <select aria-label="Colour theme" value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}
            className="absolute inset-0 h-11 w-11 cursor-pointer appearance-none rounded-lg border border-border bg-background text-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {themeOptions.map(opt => <option key={opt.value} value={opt.value} className="text-foreground">{opt.label}</option>)}
          </select>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-primary-ink">
            {theme === 'dark' ? <Moon className="h-[18px] w-[18px]" /> : theme === 'light' ? <Sun className="h-[18px] w-[18px]" /> : <Monitor className="h-[18px] w-[18px]" />}
          </span>
        </div>
        {/* Theme toggle */}
        <div className="hidden sm:flex items-center bg-background rounded-lg border border-border p-0.5">
          {themeOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn(
                'h-11 w-11 rounded-md flex items-center justify-center transition-all',
                theme === opt.value
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              )}
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={theme === opt.value}
            >
              <opt.icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <SettingsMenu />
        <NotificationBell />

        {/* Welcome tour — re-openable anytime, every page */}
        <button
          onClick={onOpenWizard}
          className="h-11 w-11 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-background transition-colors"
          title="Take the welcome tour"
          aria-label="Open the welcome tour"
        >
          <HelpCircle className="h-[18px] w-[18px]" />
        </button>

        <div className="hidden md:block h-8 w-[1px] bg-border" />

        <div className="hidden xl:flex min-w-0 items-center gap-3">
          <div className="text-right">
            <p className="max-w-48 truncate text-sm font-semibold text-foreground" title={user?.name}>{user?.name}</p>
            <p className="text-[11px] text-accent font-medium uppercase tracking-wide">{roleLabel(user?.role, user?.display_role)}</p>
          </div>
        </div>
        <div aria-hidden="true" className="hidden sm:flex shrink-0 w-9 h-9 rounded-xl bg-primary text-white items-center justify-center text-sm font-bold shadow-sm">
          {user?.name?.charAt(0) ?? '?'}
        </div>
      </div>
    </header>
  );
}
