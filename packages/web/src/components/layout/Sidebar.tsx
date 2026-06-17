import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LayoutDashboard, ClipboardCheck, Users, ScrollText, BarChart3, FileText, Settings, LogOut, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useSidebarStore } from '@/stores/sidebar';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/check-in', icon: ClipboardCheck, label: 'Check-In' },
  { to: '/visitors', icon: Users, label: 'Visitors' },
  { to: '/visit-log', icon: ScrollText, label: 'Visit Log' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

const ADMIN_NAV_SUPER = [
  { to: '/admin', icon: Settings, label: 'Admin' },
];

const ADMIN_NAV_HR = [
  { to: '/admin?tab=nss', icon: Settings, label: 'NSS Admin' },
];

interface SidebarProps {
  forceExpanded?: boolean; // Mobile overlay always shows full sidebar
}

export function Sidebar({ forceExpanded }: SidebarProps) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = user?.role === 'superadmin';
  const isHr = user?.role === 'hr';
  const canSeeAdmin = isSuperadmin || isHr;
  const { isCollapsed, toggleCollapse } = useSidebarStore();

  const collapsed = forceExpanded ? false : isCollapsed;

  return (
    <aside
      className={cn(
        'h-screen flex flex-col shrink-0 relative overflow-hidden transition-all duration-300 ease-in-out',
        collapsed ? 'w-[72px]' : 'w-64'
      )}
      style={{
        background: 'linear-gradient(180deg, #1A4D2E 0%, #0F2E1B 60%, #071A0F 100%)',
      }}
    >
      {/* Kente pattern overlay */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 12px),
          repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 12px)`,
      }} />

      {/* Gold accent line */}
      <div className="h-[2px] w-full shrink-0" style={{
        background: 'linear-gradient(90deg, transparent, #D4A017 30%, #F5D76E 50%, #D4A017 70%, transparent)',
      }} />

      {/* Logo section */}
      <div className={cn('relative px-4 pt-5 pb-4', collapsed && 'px-3')}>
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3.5')}>
          <div className={cn(
            'rounded-xl overflow-hidden ring-2 ring-accent/30 shadow-lg shadow-black/20 shrink-0 transition-all duration-300',
            collapsed ? 'w-10 h-10' : 'w-11 h-11'
          )}>
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden leading-tight">
              <h1 className="font-bold text-[16px] tracking-wide text-white whitespace-nowrap" style={{ fontFamily: 'var(--font-display)' }}>
                OHCS <span style={{ color: '#D4A017' }}>VMS</span>
              </h1>
              <p className="text-[9px] tracking-[0.08em] uppercase text-accent/75 font-semibold whitespace-nowrap mt-1">
                Visitor Management System
              </p>
            </div>
          )}
        </div>

        {/* Ghana flag bar */}
        {!collapsed && (
          <div className="mt-4 h-[2px] rounded-full overflow-hidden">
            <div className="h-full w-full" style={{
              background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
            }} />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn('flex-1 py-2 space-y-1 relative', collapsed ? 'px-2' : 'px-3')}>
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}

        {/* Admin section */}
        {canSeeAdmin && (
          <>
            <div className="h-[1px] w-full bg-white/8 my-2" />
            {(isSuperadmin ? ADMIN_NAV_SUPER : ADMIN_NAV_HR).map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} />
            ))}
          </>
        )}
      </nav>

      {/* Motto */}
      {!collapsed && (
        <div className="relative px-5 py-3">
          <p className="text-[9px] tracking-[0.2em] uppercase text-center font-semibold" style={{ color: '#D4A017' }}>
            Loyalty &middot; Excellence &middot; Service
          </p>
        </div>
      )}

      {/* Collapse toggle + sign out */}
      <div className={cn('relative pb-4', collapsed ? 'px-2' : 'px-3')}>
        <div className="h-[1px] w-full bg-white/8 mb-3" />

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleCollapse}
          className={cn(
            'hidden lg:flex items-center gap-3 py-2.5 rounded-xl text-[13px] font-medium text-white/40 hover:bg-white/8 hover:text-white/70 w-full transition-all duration-200',
            collapsed ? 'justify-center px-0' : 'px-3.5'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-[18px] w-[18px] shrink-0" /> : <ChevronsLeft className="h-[18px] w-[18px] shrink-0" />}
          {!collapsed && 'Collapse'}
        </button>

        <button
          onClick={logout}
          className={cn(
            'flex items-center gap-3 py-2.5 rounded-xl text-[14px] font-medium text-white/40 hover:bg-secondary/30 hover:text-white/80 w-full transition-all duration-200',
            collapsed ? 'justify-center px-0' : 'px-3.5'
          )}
          title="Sign Out"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && 'Sign Out'}
        </button>
      </div>
    </aside>
  );
}

function NavItem({ to, icon: Icon, label, collapsed }: {
  to: string; icon: typeof LayoutDashboard; label: string; collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 group relative',
          collapsed ? 'justify-center px-0' : 'px-3.5',
          isActive
            ? 'bg-white/12 text-white shadow-inner shadow-white/5'
            : 'text-white/55 hover:bg-white/8 hover:text-white/90'
        )
      }
      title={collapsed ? label : undefined}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
          )}
          <Icon className={cn(
            'h-[18px] w-[18px] shrink-0 transition-colors',
            isActive ? 'text-accent' : 'text-white/40 group-hover:text-white/70'
          )} />
          {!collapsed && label}
        </>
      )}
    </NavLink>
  );
}
