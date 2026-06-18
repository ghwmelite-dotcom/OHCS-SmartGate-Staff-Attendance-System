import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Directorate } from '@/lib/api';
import { cn, formatTime } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import { downloadCSV } from '@/lib/csv';
import { generateNssReportPdf, type NssReportRow, type NssReportSummary } from '@/lib/pdf';
import { NssRegistrationModal } from './NssRegistrationModal';
import { NssDetailModal } from './NssDetailModal';
import {
  GraduationCap, Users, CheckCircle2, AlertTriangle, CalendarClock,
  Search, X, MoreVertical, Eye, Pencil, KeyRound, Power, AlertCircle, Loader2,
  FileDown, FileText, FileSpreadsheet, PlayCircle,
} from 'lucide-react';

/* ---- Types ---- */

interface NssListRow {
  id: string;
  name: string;
  email: string;
  nss_number: string | null;
  nss_start_date: string | null;
  nss_end_date: string | null;
  directorate_id: string | null;
  directorate_abbr: string | null;
  grade: string | null;
  is_active: number;
}

interface NssTodayRow {
  user_id: string;
  name: string;
  nss_number: string | null;
  directorate_abbr: string | null;
  nss_end_date: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  is_late: number;
}

type StatusFilter = 'all' | 'active' | 'expiring' | 'ended';

/* ---- Helpers ---- */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date(todayIso() + 'T00:00:00Z').getTime();
  const target = new Date(iso + 'T00:00:00Z').getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / 86400_000);
}

/* ---- Main tab ---- */

export function NssTab() {
  const qc = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const canRunEos = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
  const [status, setStatus] = useState<StatusFilter>('active');
  const [directorateId, setDirectorateId] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showRegistration, setShowRegistration] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [resetPinUser, setResetPinUser] = useState<NssListRow | null>(null);
  const [endServiceUser, setEndServiceUser] = useState<NssListRow | null>(null);
  const [resetPinResult, setResetPinResult] = useState<{ user: NssListRow; pin: string } | null>(null);
  const [runningEos, setRunningEos] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    function onClick() { setOpenMenuId(null); }
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [openMenuId]);

  /* ---- Queries ---- */

  const { data: dirsData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });
  const directorates = dirsData?.data ?? [];

  // Filtered list (status + search + directorate)
  const listQueryKey = ['nss-users', status, directorateId, debouncedSearch] as const;
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('status', status);
      if (directorateId) params.set('directorate_id', directorateId);
      if (debouncedSearch) params.set('q', debouncedSearch);
      return api.get<NssListRow[]>(`/admin/nss?${params.toString()}`);
    },
  });
  const list = listData?.data ?? [];

  // Today board (always returns active NSS)
  const { data: todayData } = useQuery({
    queryKey: ['nss-today'],
    queryFn: () => api.get<NssTodayRow[]>('/admin/nss/today'),
    refetchInterval: 60_000,
  });
  const todayRows = todayData?.data ?? [];

  // Always-active count (for stat card + banner)
  const { data: activeAllData } = useQuery({
    queryKey: ['nss-users', 'active', '', ''],
    queryFn: () => api.get<NssListRow[]>('/admin/nss?status=active'),
    staleTime: 30_000,
  });
  const activeAll = activeAllData?.data ?? [];

  /* ---- Stats ---- */

  const stats = useMemo(() => {
    const totalActive = activeAll.length;
    const presentToday = todayRows.filter(r => !!r.clock_in_at).length;
    const lateToday = todayRows.filter(r => r.is_late === 1).length;
    const expiringSoon = activeAll.filter(r => {
      const d = daysUntil(r.nss_end_date);
      return d !== null && d >= 0 && d <= 30;
    }).length;
    return { totalActive, presentToday, lateToday, expiringSoon };
  }, [activeAll, todayRows]);

  // 14-day banner
  const endingIn14 = useMemo(() => {
    return activeAll.filter(r => {
      const d = daysUntil(r.nss_end_date);
      return d !== null && d >= 0 && d <= 14;
    });
  }, [activeAll]);

  // Map list rows -> today status
  const todayByUser = useMemo(() => {
    const m = new Map<string, NssTodayRow>();
    for (const r of todayRows) m.set(r.user_id, r);
    return m;
  }, [todayRows]);

  /* ---- Mutations (inline) ---- */

  async function handleResetPin(user: NssListRow) {
    try {
      const res = await api.post<{ initial_pin: string }>(`/admin/nss/${user.id}/reset-pin`, {});
      if (res.data) {
        setResetPinResult({ user, pin: res.data.initial_pin });
        toast.success('PIN reset');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset PIN');
    } finally {
      setResetPinUser(null);
    }
  }

  async function handleEndService(user: NssListRow) {
    try {
      await api.delete(`/admin/nss/${user.id}`);
      toast.success(`${user.name} — service ended`);
      qc.invalidateQueries({ queryKey: ['nss-users'] });
      qc.invalidateQueries({ queryKey: ['nss-today'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end service');
    } finally {
      setEndServiceUser(null);
    }
  }

  async function handleRunEos() {
    if (runningEos) return;
    setRunningEos(true);
    try {
      const res = await api.post<{ deactivated: number; expiring_soon: number }>(
        '/admin/nss/run-eos',
        {},
      );
      const d = res.data;
      if (d) {
        const parts = [
          `${d.deactivated} auto-deactivated`,
          `${d.expiring_soon} ending in 7d`,
        ];
        toast.success(`EOS check ran — ${parts.join(' · ')}`);
        if (d.deactivated > 0) {
          qc.invalidateQueries({ queryKey: ['nss-users'] });
          qc.invalidateQueries({ queryKey: ['nss-today'] });
        }
      } else {
        toast.error(res.error?.message ?? 'EOS check failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run EOS check');
    } finally {
      setRunningEos(false);
    }
  }

  /* ---- Render ---- */

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-start justify-between gap-3 animate-fade-in-up">
        <div>
          <h2 className="text-[20px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            NSS Personnel
          </h2>
          <p className="text-[13px] text-muted mt-0.5">
            Monitored centrally by F&amp;A Directorate
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            className="inline-flex items-center gap-2 h-11 px-4 bg-surface text-foreground text-[13px] font-semibold rounded-xl border border-border hover:border-accent/40 transition-all"
          >
            <FileDown className="h-4 w-4 text-accent-warm" />
            Export Report
          </button>
          <button
            onClick={() => setShowRegistration(true)}
            className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15 active:scale-[0.98]"
          >
            <GraduationCap className="h-4.5 w-4.5" />
            Register NSS
          </button>
        </div>
      </div>

      {showRegistration && <NssRegistrationModal onClose={() => setShowRegistration(false)} />}
      {showExport && (
        <NssExportModal
          directorates={directorates}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Ending-soon banner */}
      {endingIn14.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-warning/30 bg-warning/5 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center">
              <CalendarClock className="h-4.5 w-4.5 text-warning" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-foreground">
                {endingIn14.length} NSS personnel ending within 14 days
              </p>
              <p className="text-[12px] text-muted">
                Plan handover, certificate generation, and PIN deactivation.
              </p>
            </div>
          </div>
          <button
            onClick={() => setStatus('expiring')}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold text-warning border border-warning/30 rounded-xl hover:bg-warning/10 transition-all"
          >
            View expiring
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-fade-in-up stagger-1">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Active NSS"
          value={stats.totalActive}
          tone="primary"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Present today"
          value={stats.presentToday}
          tone="success"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Late today"
          value={stats.lateToday}
          tone="warning"
        />
        <StatCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Ending in 30d"
          value={stats.expiringSoon}
          tone="accent"
        />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-in-up stagger-2">
        <div className="flex items-center gap-1 bg-surface rounded-xl border border-border p-1">
          {(['all', 'active', 'expiring', 'ended'] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                'h-9 px-4 rounded-lg text-[13px] font-medium transition-all capitalize',
                status === s
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, NSS#…"
              aria-label="Search NSS personnel"
              className="h-9 pl-8 pr-8 rounded-xl border border-border bg-background text-[13px] w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-muted hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <select
            value={directorateId}
            onChange={e => setDirectorateId(e.target.value)}
            className="h-9 px-3 rounded-xl border border-border bg-background text-[13px]"
            aria-label="Filter by directorate"
          >
            <option value="">All directorates</option>
            {directorates.map(d => (
              <option key={d.id} value={d.id}>{d.abbreviation}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Today board / list */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-3">
        <div className="h-[2px]" style={{
          background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
        }} />

        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Today&apos;s board
            </h3>
            <p className="text-[13px] text-muted">
              {list.length} NSS personnel · {status} filter
            </p>
          </div>
        </div>

        {listLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="h-5 w-5 text-primary animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading NSS personnel…</p>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            search={debouncedSearch}
            status={status}
            onClearSearch={() => setSearch('')}
            onResetStatus={() => setStatus('active')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Personnel</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dir</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Service end</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Today</th>
                  <th className="text-right px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map(user => {
                  const today = todayByUser.get(user.id);
                  const endDays = daysUntil(user.nss_end_date);
                  const isMenuOpen = openMenuId === user.id;
                  return (
                    <tr key={user.id} className="hover:bg-background-warm/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-[13px] font-bold shrink-0">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <button
                              onClick={() => setDetailUserId(user.id)}
                              className="text-[15px] font-semibold text-primary hover:underline text-left truncate"
                            >
                              {user.name}
                            </button>
                            <p className="text-[12px] font-mono text-muted truncate">{user.nss_number ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {user.directorate_abbr ? (
                          <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-lg">
                            {user.directorate_abbr}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <EndDateCell endDate={user.nss_end_date} days={endDays} />
                      </td>
                      <td className="px-6 py-4">
                        <TodayStatusCell row={today} active={user.is_active === 1} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="relative inline-block">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(isMenuOpen ? null : user.id);
                            }}
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/5 transition-all"
                            aria-label={`Actions for ${user.name}`}
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {isMenuOpen && (
                            <div
                              role="menu"
                              onClick={e => e.stopPropagation()}
                              className="absolute right-0 mt-1 w-48 bg-surface rounded-xl border border-border shadow-xl z-20 overflow-hidden"
                            >
                              <MenuItem icon={Eye} label="View profile" onClick={() => { setDetailUserId(user.id); setOpenMenuId(null); }} />
                              <MenuItem icon={Pencil} label="Edit" onClick={() => { setDetailUserId(user.id); setOpenMenuId(null); }} />
                              <MenuItem icon={KeyRound} label="Reset PIN" onClick={() => { setResetPinUser(user); setOpenMenuId(null); }} />
                              <div className="h-[1px] bg-border" />
                              <MenuItem
                                icon={Power}
                                label="End service"
                                tone="danger"
                                onClick={() => { setEndServiceUser(user); setOpenMenuId(null); }}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canRunEos && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-border bg-background/40">
            <p className="text-[12px] text-muted">
              End-of-service runs daily at 00:30 GMT. Run it now to verify or catch up.
            </p>
            <button
              type="button"
              onClick={handleRunEos}
              disabled={runningEos}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-[12px] font-semibold text-foreground bg-surface border border-border rounded-xl hover:border-accent/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {runningEos
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <PlayCircle className="h-3.5 w-3.5 text-accent-warm" />}
              Run end-of-service check
            </button>
          </div>
        )}
      </div>

      {/* Detail / edit modal */}
      {detailUserId && (
        <NssDetailModal
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['nss-users'] });
            qc.invalidateQueries({ queryKey: ['nss-today'] });
          }}
          onResetPin={async (user) => {
            await handleResetPin(user);
          }}
          onEndService={(user) => setEndServiceUser(user)}
        />
      )}

      {/* Confirm: reset PIN */}
      {resetPinUser && (
        <ConfirmDialog
          title="Reset PIN?"
          body={`Generate a new initial PIN for ${resetPinUser.name}? They will be required to set a new PIN on next sign-in.`}
          confirmLabel="Reset PIN"
          tone="primary"
          onCancel={() => setResetPinUser(null)}
          onConfirm={() => handleResetPin(resetPinUser)}
        />
      )}

      {/* PIN result modal — shown once */}
      {resetPinResult && (
        <PinResultModal
          name={resetPinResult.user.name}
          nssNumber={resetPinResult.user.nss_number}
          pin={resetPinResult.pin}
          onClose={() => setResetPinResult(null)}
        />
      )}

      {/* Confirm: end service */}
      {endServiceUser && (
        <ConfirmDialog
          title="End service?"
          body={`End service for ${endServiceUser.name}? Records are preserved; the user can no longer clock in.`}
          confirmLabel="End service"
          tone="danger"
          onCancel={() => setEndServiceUser(null)}
          onConfirm={() => handleEndService(endServiceUser)}
        />
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string | number;
  tone: 'primary' | 'success' | 'warning' | 'accent';
}) {
  const tones = {
    primary: 'bg-primary/8 text-primary',
    success: 'bg-success/8 text-success',
    warning: 'bg-warning/10 text-warning',
    accent: 'bg-accent/10 text-accent-warm',
  };
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', tones[tone])}>
        {icon}
      </div>
      <p className="text-xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{value}</p>
      <p className="text-[12px] text-muted font-medium mt-0.5">{label}</p>
    </div>
  );
}

function EndDateCell({ endDate, days }: { endDate: string | null; days: number | null }) {
  if (!endDate) return <span className="text-[14px] text-muted">—</span>;
  const formatted = new Date(endDate + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  let pill: React.ReactNode = null;
  if (days !== null) {
    if (days < 0) {
      pill = <span className="ml-2 inline-flex h-5 px-1.5 text-[10px] font-bold rounded-md bg-foreground/5 text-muted">Ended</span>;
    } else if (days === 0) {
      pill = <span className="ml-2 inline-flex h-5 px-1.5 text-[10px] font-bold rounded-md bg-warning/10 text-warning">Ends today</span>;
    } else if (days <= 30) {
      pill = (
        <span className={cn(
          'ml-2 inline-flex h-5 px-1.5 text-[10px] font-bold rounded-md',
          days <= 14 ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent-warm',
        )}>
          Ending in {days}d
        </span>
      );
    }
  }
  return (
    <span className="text-[14px] text-foreground inline-flex items-center">
      {formatted}
      {pill}
    </span>
  );
}

function TodayStatusCell({ row, active }: { row: NssTodayRow | undefined; active: boolean }) {
  if (!active) {
    return <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-foreground/5 text-muted">Inactive</span>;
  }
  if (!row || !row.clock_in_at) {
    return <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-foreground/5 text-muted">Not yet</span>;
  }
  const inTime = formatTime(row.clock_in_at);
  if (row.clock_out_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-foreground">
        <span className="text-muted">In {inTime} · Out</span>
        <span className="font-medium">{formatTime(row.clock_out_at)}</span>
      </span>
    );
  }
  if (row.is_late) {
    return (
      <span className="inline-flex items-center h-6 px-2.5 text-[11px] font-bold rounded-full bg-warning/10 text-warning">
        Late at {inTime}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center h-6 px-2.5 text-[11px] font-bold rounded-full bg-success/10 text-success">
      Clocked in {inTime}
    </span>
  );
}

function MenuItem({ icon: Icon, label, onClick, tone = 'default' }: {
  icon: typeof Eye; label: string; onClick: () => void; tone?: 'default' | 'danger';
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left transition-colors',
        tone === 'danger'
          ? 'text-danger hover:bg-danger/5'
          : 'text-foreground hover:bg-background',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function EmptyState({ search, status, onClearSearch, onResetStatus }: {
  search: string; status: StatusFilter; onClearSearch: () => void; onResetStatus: () => void;
}) {
  return (
    <div className="p-12 text-center">
      <GraduationCap className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
      <p className="text-[15px] text-foreground font-semibold">No NSS personnel match these filters</p>
      <p className="text-[13px] text-muted mt-1">
        {search ? `No results for "${search}".` : `No personnel in "${status}" status.`}
      </p>
      <div className="flex items-center justify-center gap-2 mt-4">
        {search && (
          <button onClick={onClearSearch} className="h-9 px-4 text-[13px] font-medium text-primary border border-primary/20 rounded-xl hover:bg-primary/5 transition-all">
            Clear search
          </button>
        )}
        {status !== 'active' && (
          <button onClick={onResetStatus} className="h-9 px-4 text-[13px] font-medium text-muted hover:text-foreground transition-colors">
            Show active
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title, body, confirmLabel, tone, onCancel, onConfirm,
}: {
  title: string; body: string; confirmLabel: string;
  tone: 'primary' | 'danger';
  onCancel: () => void; onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onCancel}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-labelledby="confirm-title"
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md overflow-hidden focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-[2px]" style={{
          background: tone === 'danger'
            ? 'linear-gradient(90deg, #B33A3A, #E07171, #B33A3A)'
            : 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)',
        }} />
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              tone === 'danger' ? 'bg-danger/10' : 'bg-primary/10',
            )}>
              <AlertCircle className={cn('h-5 w-5', tone === 'danger' ? 'text-danger' : 'text-primary')} />
            </div>
            <div>
              <h3 id="confirm-title" className="text-[16px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                {title}
              </h3>
              <p className="text-[13px] text-muted mt-1">{body}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onCancel}
              className="h-10 px-4 text-[13px] text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={cn(
                'h-10 px-5 text-[13px] font-semibold text-white rounded-xl transition-all shadow-sm',
                tone === 'danger'
                  ? 'bg-danger hover:bg-danger/90 shadow-danger/15'
                  : 'bg-primary hover:bg-primary-light shadow-primary/15',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PinResultModal({ name, nssNumber, pin, onClose }: {
  name: string; nssNumber: string | null; pin: string; onClose: () => void;
}) {
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Copy failed — select and copy manually'),
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-success/30 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #2E7D5B, #5BA77B 50%, #2E7D5B)' }} />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                {name}
              </p>
              <p className="text-[12px] font-mono text-muted">{nssNumber ?? '—'}</p>
            </div>
          </div>
          <div className="rounded-xl bg-background border border-border p-4">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
              New initial PIN — shown once
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[28px] font-mono font-bold tracking-[0.4em] text-primary">{pin}</span>
              <button
                onClick={() => copy(pin)}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-[12px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/15 transition-all"
              >
                Copy
              </button>
            </div>
          </div>
          <p className="text-[12px] text-muted">
            Hand this PIN to the personnel privately. They will be prompted to set a new one on first sign-in.
          </p>
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="h-10 px-5 text-[13px] font-semibold bg-primary text-white rounded-xl hover:bg-primary-light transition-all shadow-sm"
            >
              I&apos;ve recorded this
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- NSS Export modal ---- */

interface NssExportResponse {
  range: { from: string; to: string; working_days: number };
  directorate_id: string | null;
  total_users: number;
  rows: NssReportRow[];
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function formatDateGB(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function NssExportModal({
  directorates,
  onClose,
}: {
  directorates: Directorate[];
  onClose: () => void;
}) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [directorateId, setDirectorateId] = useState('');
  const [busy, setBusy] = useState<null | 'pdf' | 'csv'>(null);
  const [err, setErr] = useState<string | null>(null);

  const validRange = from && to && from <= to;

  async function fetchExport(): Promise<NssExportResponse | null> {
    setErr(null);
    if (!validRange) {
      setErr('Select a valid date range — "from" must be on or before "to"');
      return null;
    }
    const params = new URLSearchParams({ from, to });
    if (directorateId) params.set('directorate_id', directorateId);
    try {
      const res = await api.get<NssExportResponse>(`/admin/nss/export?${params.toString()}`);
      if (!res.data) {
        setErr(res.error?.message ?? 'Empty response');
        return null;
      }
      return res.data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load report';
      setErr(msg);
      return null;
    }
  }

  function directorateLabel(): string | undefined {
    if (!directorateId) return undefined;
    const d = directorates.find(x => x.id === directorateId);
    return d ? `${d.abbreviation} — ${d.name}` : undefined;
  }

  async function downloadPdf() {
    if (busy) return;
    setBusy('pdf');
    try {
      const data = await fetchExport();
      if (!data) return;
      const summary: NssReportSummary = {
        range: data.range,
        total_users: data.total_users,
        rows: data.rows,
        directorate_label: directorateLabel(),
      };
      const doc = generateNssReportPdf(summary);
      doc.save(`OHCS-NSS-Report-${data.range.from}-to-${data.range.to}.pdf`);
      toast.success('NSS report PDF downloaded');
    } finally {
      setBusy(null);
    }
  }

  async function downloadCsv() {
    if (busy) return;
    setBusy('csv');
    try {
      const data = await fetchExport();
      if (!data) return;
      const headers = [
        'Name', 'NSS Number', 'Directorate', 'Posting Start',
        'Posting End', 'Clock-Ins', 'Late Count', 'Streak', 'Absent Days',
      ];
      const rows = data.rows.map(r => [
        r.name,
        r.nss_number ?? '',
        r.directorate_abbr ?? '',
        r.nss_start_date ?? '',
        r.nss_end_date ?? '',
        String(r.clock_ins),
        String(r.late_count),
        String(r.current_streak),
        String(r.absent_days),
      ]);
      const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
      downloadCSV(csv, `OHCS-NSS-Report-${data.range.from}-to-${data.range.to}.csv`);
      toast.success('NSS report CSV downloaded');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nss-export-title"
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileDown className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h3 id="nss-export-title" className="text-[17px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Export NSS Report
              </h3>
              <p className="text-[12px] text-muted">Roll-up across the selected window</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-semibold text-foreground mb-1">From</label>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                max={to}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-foreground mb-1">To</label>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                min={from}
                max={todayIso()}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          {/* Directorate */}
          <div>
            <label className="block text-[13px] font-semibold text-foreground mb-1">Directorate</label>
            <select
              value={directorateId}
              onChange={e => setDirectorateId(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="">All directorates</option>
              {directorates.map(d => (
                <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted mt-1">
              {validRange ? (
                <>Range: {formatDateGB(from)} — {formatDateGB(to)}</>
              ) : (
                <span className="text-danger">Select a valid date range</span>
              )}
            </p>
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 bg-danger/5 border border-danger/20 rounded-xl">
              <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <p className="text-[13px] text-danger">{err}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-background/40">
          <button
            onClick={onClose}
            className="h-10 px-4 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadCsv}
              disabled={busy !== null || !validRange}
              className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-[13px] font-semibold rounded-xl border border-border hover:border-accent/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 text-accent-warm" />}
              Download CSV
            </button>
            <button
              onClick={downloadPdf}
              disabled={busy !== null || !validRange}
              className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white text-[13px] font-semibold rounded-xl shadow-sm hover:bg-primary-light transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
