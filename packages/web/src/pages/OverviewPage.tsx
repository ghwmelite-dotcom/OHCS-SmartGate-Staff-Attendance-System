import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AccessDenied } from '@/components/AccessDenied';
import { useAuthStore } from '@/stores/auth';
import { OVERSIGHT_DISPLAY_ROLES } from '@/lib/roles';
import {
  Users,
  UserX,
  Clock,
  BellOff,
  Building2,
  DoorOpen,
  RefreshCw,
} from 'lucide-react';

// Oversight home (spec 2026-08-02-oversight-roles-cd-hos-design §5) — mounted
// at `/` for directors and CD/HoS instead of the reception DashboardPage.
// Directors see their entity (server force-scopes every query); CD/HoS see
// the same cards org-wide plus the by-directorate breakdown.

interface AttendanceToday {
  total_staff: number;
  clocked_in: number;
  clocked_out: number;
  not_clocked_in: number;
  late_arrivals: number;
  early_departures: number;
  attendance_rate: number;
}

interface AttendanceRecordRow {
  user_id: string;
  name: string;
  staff_id: string | null;
  directorate_abbr: string | null;
  clock_in_time: string | null;
  clock_out_time: string | null;
  is_late: number;
  // Absence-notice fields ride the row only if the API joins notices — read
  // defensively so the list degrades to names only when they are absent.
  absence_reason?: string | null;
  absence_note?: string | null;
}

interface DirectorateBreakdownRow {
  abbreviation: string | null;
  name: string | null;
  total_staff: number;
  present: number;
  late: number;
}

interface ActiveVisitRow {
  id: string;
}

const ABSENCE_REASON_LABELS: Record<string, string> = {
  sick: 'Sick',
  family_emergency: 'Family emergency',
  transport: 'Transport',
  other: 'Other',
};

function todayDate(): string {
  // Ghana is UTC+0 year-round — browser local date matches the server date.
  return new Date().toISOString().slice(0, 10);
}

export function OverviewPage() {
  const user = useAuthStore((s) => s.user);
  const isOrgWide = (OVERSIGHT_DISPLAY_ROLES as readonly string[]).includes(user?.display_role ?? '');
  const date = todayDate();

  const { data: todayData, error: todayError, isLoading: todayLoading } = useQuery({
    queryKey: ['overview', 'attendance-today', date],
    queryFn: () => api.get<AttendanceToday>(`/attendance/today?date=${date}`),
    refetchInterval: 60_000,
  });

  const { data: recordsData, error: recordsError, isLoading: recordsLoading } = useQuery({
    queryKey: ['overview', 'attendance-records', date],
    queryFn: () => api.get<AttendanceRecordRow[]>(`/attendance/records?date=${date}`),
    refetchInterval: 60_000,
  });

  const { data: visitsData, error: visitsError } = useQuery({
    queryKey: ['overview', 'active-visits'],
    queryFn: () => api.get<ActiveVisitRow[]>('/visits?status=checked_in&limit=500'),
    refetchInterval: 30_000,
  });

  const { data: byDirData, error: byDirError } = useQuery({
    queryKey: ['overview', 'by-directorate', date],
    queryFn: () => api.get<DirectorateBreakdownRow[]>(`/attendance/by-directorate?date=${date}`),
    refetchInterval: 60_000,
  });

  // Role-gated module: a 403 (e.g. the API deploy has not opened attendance
  // to directors yet) renders the shared no-access state, not zeros.
  const forbidden = [todayError, recordsError, visitsError, byDirError].some(
    (e) => e instanceof ApiError && e.status === 403
  );

  const today = todayData?.data;
  const records = recordsData?.data ?? [];
  const byDir = byDirData?.data ?? [];
  const activeVisits = visitsData?.data?.length ?? 0;

  // Reported absent = register rows with no clock-in today. Reason/note show
  // only when the API row carries notice info; otherwise names only.
  const absentRows = records.filter((r) => !r.clock_in_time);
  const notifiedAbsent = absentRows.filter((r) => r.absence_reason || r.absence_note).length;

  // Director header: the scoped by-directorate call collapses to their entity.
  const entityName = isOrgWide
    ? 'Office of the Head of the Civil Service'
    : byDir[0]?.name ?? 'My Directorate';

  if (forbidden) {
    return (
      <div className="space-y-6">
        <div className="animate-fade-in-up">
          <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Overview
          </h1>
          <p className="text-[15px] text-muted mt-0.5">Attendance and visitor oversight</p>
        </div>
        <AccessDenied module="the Overview" />
      </div>
    );
  }

  const isLoading = todayLoading || recordsLoading;

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Overview
        </h1>
        <p className="text-[15px] text-muted mt-0.5">
          {entityName} &middot; today's attendance and visitors
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Present Today"
          value={today?.clocked_in ?? '--'}
          color="primary"
          delay="stagger-1"
        />
        <StatCard
          icon={<UserX className="h-5 w-5" />}
          label="Absent"
          value={today?.not_clocked_in ?? '--'}
          color="danger"
          delay="stagger-2"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Late Arrivals"
          value={today?.late_arrivals ?? '--'}
          color="accent"
          delay="stagger-3"
        />
        <StatCard
          icon={<BellOff className="h-5 w-5" />}
          label="Notified Absent"
          value={isLoading ? '--' : notifiedAbsent}
          color="muted"
          delay="stagger-4"
        />
        <StatCard
          icon={<DoorOpen className="h-5 w-5" />}
          label="Active Visits"
          value={visitsData ? activeVisits : '--'}
          color="success"
          delay="stagger-5"
        />
      </div>

      {/* Reported absent list */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-4">
        <div className="h-[2px]" style={{
          background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
        }} />
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
              <UserX className="h-4 w-4 text-danger" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Reported Absent
              </h2>
              <p className="text-[12px] text-muted mt-0.5">
                No clock-in today &middot; auto-refreshes
              </p>
            </div>
          </div>
          <span className="inline-flex items-center h-6 px-2.5 text-[11px] font-bold bg-danger/10 text-danger rounded-lg">
            {absentRows.length}
          </span>
        </div>

        {recordsLoading ? (
          <div className="p-10 text-center text-muted text-sm">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            Loading today's register...
          </div>
        ) : absentRows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-background flex items-center justify-center mx-auto mb-3">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted font-medium">Everyone has clocked in today</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {absentRows.map((row, i) => (
              <div
                key={row.user_id}
                className={cn(
                  'flex items-center gap-4 px-5 py-3 animate-fade-in-up',
                  `stagger-${Math.min(i + 1, 5)}`
                )}
              >
                <div className="w-9 h-9 rounded-xl bg-foreground/5 text-muted flex items-center justify-center text-[12px] font-bold shrink-0">
                  {row.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-foreground truncate">{row.name}</p>
                  <p className="text-[11px] text-muted mt-0.5 truncate">
                    {row.absence_reason
                      ? `${ABSENCE_REASON_LABELS[row.absence_reason] ?? row.absence_reason}${row.absence_note ? ` — ${row.absence_note}` : ''}`
                      : 'No absence notice on file'}
                  </p>
                </div>
                {row.directorate_abbr && (
                  <span className="hidden sm:inline-flex items-center h-6 px-2.5 text-[10px] font-bold bg-primary/8 text-primary rounded-lg tracking-wide">
                    {row.directorate_abbr}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By-directorate breakdown — CD/HoS only (a director's scoped call
          collapses to the single card already reflected in the header). */}
      {isOrgWide && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-5">
          <div className="h-[2px]" style={{
            background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
          }} />
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                  By Directorate
                </h2>
                <p className="text-[12px] text-muted mt-0.5">
                  Presence across OHCS today
                </p>
              </div>
            </div>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </div>

          {byDir.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-muted font-medium">No directorate data for today</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
              {byDir.map((d) => {
                const rate = d.total_staff > 0 ? Math.round((d.present / d.total_staff) * 100) : 0;
                return (
                  <div
                    key={d.abbreviation ?? d.name ?? 'unknown'}
                    className="rounded-xl border border-border bg-background p-4 card-lift"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-bold text-foreground truncate" title={d.name ?? undefined}>
                        {d.abbreviation ?? d.name ?? '—'}
                      </p>
                      <span className={cn(
                        'inline-flex items-center h-6 px-2 text-[11px] font-bold rounded-lg shrink-0',
                        rate >= 80 ? 'bg-success/10 text-success'
                          : rate >= 50 ? 'bg-accent/15 text-accent-warm'
                          : 'bg-danger/10 text-danger'
                      )}>
                        {rate}%
                      </span>
                    </div>
                    <p className="text-[12px] text-muted mt-1.5">
                      {d.present} of {d.total_staff} present
                      {d.late > 0 && <> &middot; <span className="text-accent-warm font-medium">{d.late} late</span></>}
                    </p>
                    <div className="mt-2.5 h-1.5 rounded-full bg-foreground/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'primary' | 'accent' | 'success' | 'danger' | 'muted';
  delay: string;
}) {
  const colorMap = {
    primary: { bg: 'bg-primary/8', text: 'text-primary', border: 'border-primary/10' },
    accent: { bg: 'bg-accent/10', text: 'text-accent-warm', border: 'border-accent/15' },
    success: { bg: 'bg-success/8', text: 'text-success', border: 'border-success/10' },
    danger: { bg: 'bg-danger/8', text: 'text-danger', border: 'border-danger/10' },
    muted: { bg: 'bg-foreground/5', text: 'text-foreground', border: 'border-border' },
  };
  const c = colorMap[color];

  return (
    <div className={cn(
      'bg-surface rounded-2xl border shadow-sm p-5 flex items-center gap-4 card-lift animate-fade-in-up',
      c.border,
      delay
    )}>
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', c.bg, c.text)}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
          {value}
        </p>
        <p className="text-[13px] text-muted font-medium mt-0.5">{label}</p>
      </div>
    </div>
  );
}
