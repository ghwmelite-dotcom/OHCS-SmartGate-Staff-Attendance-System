import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type AppointmentRecord } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  CheckCheck,
} from 'lucide-react';

/* ---- Date helpers (local YYYY-MM-DD, matching appointments.appointment_date) ---- */

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

function formatDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/* ---- Status badge (mirrors AppointmentsTab chips) ---- */

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Pending',
    cls: 'bg-amber-50 text-amber-700 border border-amber-200',
    icon: <Clock className="h-3 w-3" />,
  },
  confirmed: {
    label: 'Confirmed',
    cls: 'bg-success/10 text-success border border-success/20',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  declined: {
    label: 'Declined',
    cls: 'bg-danger/10 text-danger border border-danger/20',
    icon: <XCircle className="h-3 w-3" />,
  },
  cancelled: {
    label: 'Cancelled',
    cls: 'bg-border text-muted-foreground',
    icon: <Ban className="h-3 w-3" />,
  },
  completed: {
    label: 'Completed',
    cls: 'bg-info/10 text-info border border-info/20',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-border text-muted-foreground', icon: null };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        cfg.cls
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

/* ---- Page ---- */

export function AppointmentsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdminLevel = user?.role === 'superadmin' || user?.role === 'admin';

  const today = toISODate(new Date());
  const [date, setDate] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments-day', date],
    queryFn: () =>
      api.get<{ appointments: AppointmentRecord[]; total: number }>(
        `/appointments/admin?date_from=${date}&date_to=${date}&limit=100`
      ),
    placeholderData: (prev) => prev,
  });

  // Daily schedule reads ascending by time slot
  const appointments = [...(data?.data?.appointments ?? [])].sort((a, b) =>
    a.time_slot.localeCompare(b.time_slot)
  );

  const expected = appointments.filter((a) => a.status === 'confirmed' || a.status === 'completed').length;
  const arrived = appointments.filter((a) => a.status === 'completed').length;
  const pendingApproval = appointments.filter((a) => a.status === 'pending').length;

  const navBtnCls =
    'h-9 px-3 rounded-xl border border-border bg-surface text-[13px] font-semibold text-foreground hover:border-primary/40 transition-all flex items-center gap-1';

  return (
    <div className="space-y-5">
      {/* Header + day navigation */}
      <div className="flex items-center justify-between gap-3 flex-wrap animate-fade-in-up">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Appointments
          </h1>
          <p className="text-[15px] text-muted mt-0.5">
            {appointments.length > 0
              ? `${expected} expected · ${arrived} arrived · ${pendingApproval} pending approval`
              : 'Visitor appointment schedule'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setDate(shiftDay(date, -1))} className={navBtnCls} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDate(today)}
            disabled={date === today}
            className={cn(navBtnCls, 'px-4 disabled:opacity-50')}
          >
            Today
          </button>
          <button onClick={() => setDate(shiftDay(date, 1))} className={navBtnCls} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-[14px] font-semibold text-foreground ml-1">{formatDay(date)}</span>
        </div>
      </div>

      {/* Day list */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-1">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />

        {isLoading ? (
          <div className="p-10 text-center">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading appointments...</p>
          </div>
        ) : appointments.length === 0 ? (
          <div className="p-10 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-[15px] text-muted font-medium">No appointments on this day</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Time</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Visitor</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Officer</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Directorate</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {appointments.map((appt) => (
                  <tr key={appt.id} className="hover:bg-background-warm/50 transition-colors">
                    <td className="px-5 py-3 text-[14px] font-semibold text-foreground whitespace-nowrap">
                      {appt.time_slot}
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-[14px] font-semibold text-foreground">{appt.visitor_name}</div>
                      {appt.organisation && (
                        <div className="text-[12px] text-muted">{appt.organisation}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-[14px] text-foreground">{appt.officer_name}</div>
                      {appt.officer_title && (
                        <div className="text-[12px] text-muted">{appt.officer_title}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-muted">
                      {appt.directorate_name}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge status={appt.status} />
                        {appt.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-success/10 text-success border border-success/20">
                            <CheckCheck className="h-3 w-3" />
                            Arrived
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Read-only note — approvals live in the admin area */}
      {isAdminLevel && (
        <p className="text-[13px] text-muted animate-fade-in-up stagger-2">
          This view is read-only. Approvals and appointment setup are managed in{' '}
          <Link to="/admin?tab=appointments" className="text-primary font-medium hover:underline">
            Admin → Appointments
          </Link>
          .
        </p>
      )}
    </div>
  );
}
