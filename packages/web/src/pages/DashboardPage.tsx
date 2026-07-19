import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Visit } from '@/lib/api';
import { apiOrQueue } from '@/lib/offlineQueue';
import { cn, formatTime, formatDateTime } from '@/lib/utils';
import { VisitorAvatar } from '@/components/VisitorAvatar';
import { HostResponseChip } from '@/components/HostResponseChip';
import type { AppSettings } from '@/components/admin/SettingsModal';
import { toast } from '@/stores/toast';
import { playCheckOutChime } from '@/lib/sounds';
import { useAuthStore } from '@/stores/auth';
import {
  Users,
  LogIn,
  LogOut as LogOutIcon,
  Clock,
  RefreshCw,
  ArrowRight,
  Search,
  Flame,
  AlertTriangle,
  Siren,
  Printer,
  Send,
  X,
} from 'lucide-react';

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const canEvacuate = ['receptionist', 'admin', 'superadmin', 'it'].includes(user?.role ?? '');
  const [evacOpen, setEvacOpen] = useState(false);

  const { data: activeVisits, isLoading } = useQuery({
    queryKey: ['visits', 'active'],
    queryFn: () => api.get<Visit[]>('/visits/active'),
    refetchInterval: 15_000,
  });

  const { data: todayVisits } = useQuery({
    queryKey: ['visits', 'today'],
    queryFn: () =>
      api.get<Visit[]>(
        `/visits?date=${new Date().toISOString().slice(0, 10)}&limit=100`
      ),
  });

  // Office close time for the still-in-building banner. Receptionists can't
  // read /admin/settings (403) — the query just fails and we fall back to the
  // 17:00 default.
  const { data: settingsData } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<AppSettings>('/admin/settings'),
    staleTime: 60_000,
  });

  const checkOutMutation = useMutation({
    mutationFn: (visitId: string) => apiOrQueue<unknown>('visit-queue', `/visits/${visitId}/check-out`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      setCheckingOut(null);
      toast.success('Visitor checked out successfully');
      playCheckOutChime();
    },
  });

  const bulkCheckOutMutation = useMutation({
    mutationFn: () => api.post<{ checked_out: number }>('/visits/bulk-checkout', {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      toast.success(`Checked out ${res.data?.checked_out ?? 0} visitor(s)`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Bulk checkout failed');
    },
  });

  const active = activeVisits?.data ?? [];
  const today = todayVisits?.data ?? [];

  // Past office close? Ghana is UTC+0 year-round, so local browser time at the
  // office matches working-hours settings.
  const closeTime = settingsData?.data?.work_end_time ?? '17:00';
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const now = new Date();
  const pastClose = now.getHours() * 60 + now.getMinutes() >= (closeH ?? 17) * 60 + (closeM ?? 0);
  const checkedOutToday = today.filter((v) => v.status === 'checked_out').length;
  const avgDuration =
    today.filter((v) => v.duration_minutes).length > 0
      ? Math.round(
          today
            .filter((v) => v.duration_minutes)
            .reduce((sum, v) => sum + (v.duration_minutes ?? 0), 0) /
            today.filter((v) => v.duration_minutes).length
        )
      : 0;

  function handleCheckOut(visitId: string) {
    setCheckingOut(visitId);
    checkOutMutation.mutate(visitId);
  }

  // Waiting-time SLA (spec 2026-07-19-sla-and-evacuation-design §Feature A):
  // minutes since check-in; unanswered visits (host_response unset) sort above
  // answered ones, longest wait first.
  const waitMinutes = (v: Visit) =>
    Math.max(0, Math.floor((now.getTime() - new Date(v.check_in_at).getTime()) / 60_000));
  const sortedActive = [...active].sort((a, b) => {
    const aAnswered = a.host_response ? 1 : 0;
    const bAnswered = b.host_response ? 1 : 0;
    if (aAnswered !== bAnswered) return aAnswered - bAnswered;
    return new Date(a.check_in_at).getTime() - new Date(b.check_in_at).getTime();
  });

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Dashboard
        </h1>
        <p className="text-[15px] text-muted mt-0.5">Real-time visitor overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="In Building"
          value={active.length}
          color="primary"
          delay="stagger-1"
        />
        <StatCard
          icon={<LogIn className="h-5 w-5" />}
          label="Checked In Today"
          value={today.length}
          color="accent"
          delay="stagger-2"
        />
        <StatCard
          icon={<LogOutIcon className="h-5 w-5" />}
          label="Checked Out Today"
          value={checkedOutToday}
          color="success"
          delay="stagger-3"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Avg Duration"
          value={avgDuration > 0 ? `${avgDuration}m` : '--'}
          color="muted"
          delay="stagger-4"
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-3 animate-fade-in-up stagger-3">
        <button
          onClick={() => navigate('/check-in')}
          className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15 active:scale-[0.98]"
        >
          <LogIn className="h-4 w-4" />
          New Check-In
        </button>
        <button
          onClick={() => navigate('/visitors')}
          className="inline-flex items-center gap-2 h-11 px-5 bg-surface text-foreground text-[14px] font-medium rounded-xl border border-border hover:border-accent/40 hover:shadow-sm transition-all"
        >
          <Search className="h-4 w-4 text-muted" />
          Find Visitor
        </button>
        {canEvacuate && (
          <button
            onClick={() => setEvacOpen(true)}
            className="inline-flex items-center gap-2 h-11 px-5 bg-surface text-foreground text-[14px] font-medium rounded-xl border border-border hover:border-accent/40 hover:shadow-sm transition-all"
          >
            <Siren className="h-4 w-4 text-danger" />
            Evacuation Roll
          </button>
        )}
      </div>

      {/* Still-in-building banner — only after office close with open visits */}
      {pastClose && active.length > 0 && (
        <div className="bg-accent/10 rounded-2xl border border-accent/15 shadow-sm p-4 flex flex-wrap items-center gap-3 animate-fade-in-up">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-accent-warm" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="text-[14px] font-semibold text-foreground">
              {active.length} visitor{active.length === 1 ? '' : 's'} still marked in building.
            </p>
            <p className="text-[12px] text-muted mt-0.5">
              The office has closed — please verify and check them out.
            </p>
          </div>
          <button
            onClick={() => bulkCheckOutMutation.mutate()}
            disabled={bulkCheckOutMutation.isPending}
            className={cn(
              'inline-flex items-center gap-2 h-9 px-4 text-[12px] font-semibold rounded-xl transition-all shrink-0',
              'bg-accent text-white hover:bg-accent-warm shadow-sm active:scale-[0.98]',
              bulkCheckOutMutation.isPending && 'opacity-50 cursor-wait'
            )}
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            {bulkCheckOutMutation.isPending ? 'Checking out...' : 'Check out all'}
          </button>
        </div>
      )}

      {/* Active visits - live feed */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-4">
        {/* Gold top accent */}
        <div className="h-[2px]" style={{
          background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
        }} />

        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Flame className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Active Visits
              </h2>
              <p className="text-[12px] text-muted mt-0.5">
                Currently in building &middot; auto-refreshes
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['visits', 'active'] })
            }
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/5 transition-all"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-muted text-sm">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            Loading active visits...
          </div>
        ) : active.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-background flex items-center justify-center mx-auto mb-3">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted font-medium">No visitors currently in building</p>
            <button
              onClick={() => navigate('/check-in')}
              className="inline-flex items-center gap-1 text-sm text-primary font-semibold mt-2.5 hover:underline"
            >
              Check in a visitor <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sortedActive.map((visit, i) => {
              // SLA tone: colored only while waiting (no host response yet).
              const wait = waitMinutes(visit);
              const waitTone = visit.host_response
                ? 'text-muted-foreground'
                : wait >= 30
                  ? 'text-danger font-bold'
                  : wait >= 15
                    ? 'text-warning font-semibold'
                    : 'text-muted-foreground';
              return (
              <div
                key={visit.id}
                className={cn(
                  'flex items-center gap-4 px-5 py-3.5 hover:bg-background-warm/50 transition-all animate-fade-in-up',
                  `stagger-${Math.min(i + 1, 5)}`
                )}
              >
                {/* Avatar */}
                <VisitorAvatar
                  firstName={visit.first_name ?? ''}
                  lastName={visit.last_name ?? ''}
                  photoUrl={(visit as Visit & { photo_url?: string }).photo_url}
                />

                {/* Visitor info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-foreground truncate">
                    {visit.first_name} {visit.last_name}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                    {visit.organisation && (
                      <span className="truncate">{visit.organisation}</span>
                    )}
                    {visit.organisation && visit.host_name && (
                      <span className="text-border-strong">&middot;</span>
                    )}
                    {visit.host_name && (
                      <span className="truncate">Host: {visit.host_name}</span>
                    )}
                    <HostResponseChip value={visit.host_response} />
                  </div>
                </div>

                {/* Directorate badge */}
                {visit.directorate_abbr && (
                  <span className="hidden sm:inline-flex items-center h-6 px-2.5 text-[10px] font-bold bg-primary/8 text-primary rounded-lg tracking-wide">
                    {visit.directorate_abbr}
                  </span>
                )}

                {/* Time + SLA wait */}
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-[11px] font-medium text-foreground">
                    {formatTime(visit.check_in_at)}
                  </p>
                  <p className={cn('text-[10px]', waitTone)}>
                    {wait}m wait
                  </p>
                </div>

                {/* Badge code */}
                {visit.badge_code && (
                  <span className="hidden md:inline-flex items-center h-6 px-2 text-[10px] font-mono font-bold bg-accent/10 text-accent-warm rounded-lg">
                    {visit.badge_code}
                  </span>
                )}

                {/* Check-out button */}
                <button
                  onClick={() => handleCheckOut(visit.id)}
                  disabled={checkingOut === visit.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3.5 text-[11px] font-semibold rounded-lg transition-all shrink-0',
                    'bg-secondary/10 text-secondary hover:bg-secondary hover:text-white',
                    checkingOut === visit.id && 'opacity-50 cursor-wait'
                  )}
                >
                  <LogOutIcon className="h-3.5 w-3.5" />
                  {checkingOut === visit.id ? 'Leaving...' : 'Check Out'}
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Evacuation roll — "who is in the building right now" */}
      {evacOpen && <EvacuationRollModal onClose={() => setEvacOpen(false)} />}
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
  color: 'primary' | 'accent' | 'success' | 'muted';
  delay: string;
}) {
  const colorMap = {
    primary: { bg: 'bg-primary/8', text: 'text-primary', border: 'border-primary/10' },
    accent: { bg: 'bg-accent/10', text: 'text-accent-warm', border: 'border-accent/15' },
    success: { bg: 'bg-success/8', text: 'text-success', border: 'border-success/10' },
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

/* ---- Evacuation roll (spec 2026-07-19-sla-and-evacuation-design §Feature B) ---- */

interface EvacuationRoll {
  generated_at: string;
  visitors: {
    name: string;
    badge_code: string | null;
    host_name: string | null;
    directorate: string | null;
    since: string;
    party_size: number | null;
  }[];
  staff: {
    name: string;
    staff_id: string | null;
    directorate: string | null;
    since: string;
  }[];
  counts: { visitors: number; staff: number; total: number };
}

function EvacuationRollModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'evacuation'],
    queryFn: () => api.get<EvacuationRoll>('/reports/evacuation'),
  });

  const notifyMutation = useMutation({
    mutationFn: () => api.post<{ sent: boolean }>('/reports/evacuation/notify', {}),
    onSuccess: () => toast.success('Evacuation roll sent to Telegram'),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send to Telegram'),
  });

  const roll = data?.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* Print only the roll itself — every other element (app chrome included)
          is visibility-hidden, and the roll is lifted out of the modal flow. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #evacuation-roll, #evacuation-roll * { visibility: visible; }
          #evacuation-roll { position: absolute; left: 0; top: 0; width: 100%; max-height: none; overflow: visible; }
        }
      `}</style>
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Siren className="h-5 w-5 text-danger" />
            <div>
              <h3 className="text-[17px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Evacuation Roll
              </h3>
              <p className="text-[12px] text-muted">Who is in the building right now</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              disabled={!roll}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              onClick={() => notifyMutation.mutate()}
              disabled={notifyMutation.isPending}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-semibold rounded-lg bg-secondary/10 text-secondary hover:bg-secondary hover:text-white transition-all disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {notifyMutation.isPending ? 'Sending...' : 'Telegram'}
            </button>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-foreground/5 transition-all"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {isLoading || !roll ? (
            <div className="p-10 text-center text-muted text-sm">
              <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
              Building the roll...
            </div>
          ) : (
            <div id="evacuation-roll" className="space-y-5">
              <div>
                <p className="text-[12px] text-muted">Generated {formatDateTime(roll.generated_at)}</p>
                <p className="text-[15px] font-bold text-foreground mt-1">
                  {roll.counts.total} {roll.counts.total === 1 ? 'person' : 'people'} in building
                  — {roll.counts.visitors} visitor{roll.counts.visitors === 1 ? '' : 's'},{' '}
                  {roll.counts.staff} staff
                </p>
              </div>

              <div>
                <h4 className="text-[13px] font-bold text-foreground mb-2">
                  Visitors ({roll.counts.visitors})
                </h4>
                {roll.visitors.length === 0 ? (
                  <p className="text-[13px] text-muted">No visitors in building.</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-3 font-semibold">Name</th>
                        <th className="py-1.5 pr-3 font-semibold">Badge</th>
                        <th className="py-1.5 pr-3 font-semibold">Host</th>
                        <th className="py-1.5 pr-3 font-semibold">Directorate</th>
                        <th className="py-1.5 font-semibold">Since</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roll.visitors.map((v, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-3 font-medium text-foreground">
                            {v.name}
                            {(v.party_size ?? 1) > 1 && (
                              <span className="text-muted"> ×{v.party_size}</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{v.badge_code ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-muted">{v.host_name ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-muted">{v.directorate ?? '—'}</td>
                          <td className="py-1.5 text-muted">{formatTime(v.since)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <h4 className="text-[13px] font-bold text-foreground mb-2">
                  Staff ({roll.counts.staff})
                </h4>
                {roll.staff.length === 0 ? (
                  <p className="text-[13px] text-muted">No staff clocked in.</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-3 font-semibold">Name</th>
                        <th className="py-1.5 pr-3 font-semibold">Staff ID</th>
                        <th className="py-1.5 pr-3 font-semibold">Directorate</th>
                        <th className="py-1.5 font-semibold">Since</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roll.staff.map((s, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-3 font-medium text-foreground">{s.name}</td>
                          <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{s.staff_id ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-muted">{s.directorate ?? '—'}</td>
                          <td className="py-1.5 text-muted">{formatTime(s.since)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                Staff presence is based on today's clock records — anyone clocked in and not
                yet clocked out is listed (NSS and interns included).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
