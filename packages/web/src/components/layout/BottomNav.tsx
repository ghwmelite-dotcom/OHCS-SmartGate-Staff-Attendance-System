import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import {
  LayoutDashboard,
  ClipboardCheck,
  Users,
  BarChart3,
  MoreHorizontal,
  ScrollText,
  FileText,
  Settings,
  LogOut,
  X,
  UserCircle,
  Calendar,
  Star,
} from 'lucide-react';

const MAIN_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/check-in', icon: ClipboardCheck, label: 'Check-In' },
  { to: '/visitors', icon: Users, label: 'Visitors' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

const MORE_ITEMS = [
  { to: '/profile', icon: UserCircle, label: 'My Profile' },
  { to: '/visit-log', icon: ScrollText, label: 'Visit Log' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

const APPOINTMENTS_ITEM = { to: '/appointments', icon: Calendar, label: 'Appointments' };

const FEEDBACK_ITEM = { to: '/feedback', icon: Star, label: 'Feedback' };

const ADMIN_ITEMS = [
  { to: '/admin', icon: Settings, label: 'Admin' },
];

export function BottomNav() {
  const [showMore, setShowMore] = useState(false);
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isSuperadmin = user?.role === 'superadmin';
  const canSeeAppointments = ['receptionist', 'admin', 'superadmin'].includes(user?.role ?? '');
  const moreItems = canSeeAppointments ? [APPOINTMENTS_ITEM, FEEDBACK_ITEM, ...MORE_ITEMS] : MORE_ITEMS;

  // Check if current route is in the "more" section
  const moreRoutes = [...moreItems, ...ADMIN_ITEMS].map(i => i.to);
  const isMoreActive = moreRoutes.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute bottom-[68px] left-3 right-3 bg-surface rounded-2xl border border-border shadow-2xl overflow-hidden animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Gold accent */}
            <div className="h-[2px]" style={{
              background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)',
            }} />

            <div className="p-2">
              {moreItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-background'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              ))}

              {isSuperadmin && (
                <>
                  <div className="h-[1px] bg-border mx-3 my-1" />
                  {ADMIN_ITEMS.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setShowMore(false)}
                      className={({ isActive }) => cn(
                        'flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-background'
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </NavLink>
                  ))}
                </>
              )}

              <div className="h-[1px] bg-border mx-3 my-1" />
              <button
                onClick={() => { setShowMore(false); logout(); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium text-danger hover:bg-danger/5 w-full transition-all"
              >
                <LogOut className="h-5 w-5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-border safe-area-bottom">
        <div className="flex items-center justify-around h-[64px] px-2">
          {MAIN_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all relative',
                isActive ? 'text-primary' : 'text-muted'
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-accent" />
                  )}
                  <item.icon className={cn('h-[22px] w-[22px]', isActive && 'text-primary')} />
                  <span className={cn(
                    'text-[11px] font-medium',
                    isActive ? 'text-primary font-semibold' : 'text-muted'
                  )}>
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all relative',
              (showMore || isMoreActive) ? 'text-primary' : 'text-muted'
            )}
          >
            {isMoreActive && !showMore && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-accent" />
            )}
            {showMore
              ? <X className="h-[22px] w-[22px]" />
              : <MoreHorizontal className="h-[22px] w-[22px]" />
            }
            <span className={cn(
              'text-[11px] font-medium',
              (showMore || isMoreActive) ? 'text-primary font-semibold' : 'text-muted'
            )}>
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
