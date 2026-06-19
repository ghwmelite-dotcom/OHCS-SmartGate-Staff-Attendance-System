import { useState, useEffect, useMemo, useRef, useLayoutEffect, Fragment } from 'react';
import { LivenessEvidenceCard } from './LivenessEvidenceCard';
import { LivenessMetricsWidget } from './LivenessMetricsWidget';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, resolvePhotoUrl, type Directorate } from '@/lib/api';
import { cn, formatTime, formatDate } from '@/lib/utils';
import { downloadCSV } from '@/lib/csv';
import { generateAttendancePdf, type AttendanceSegment } from '@/lib/pdf';
import { useAuthStore } from '@/stores/auth';
import { SettingsModal, type AppSettings } from './SettingsModal';
import {
  Users, Clock, AlertTriangle, TrendingUp, CheckCircle2,
  XCircle, Download, Calendar, Building2, FileText, Loader2, Search, X, Settings as SettingsIcon,
  LogOut, Trash2,
} from 'lucide-react';

interface TodayOverview {
  total_staff: number;
  clocked_in: number;
  clocked_out: number;
  not_clocked_in: number;
  late_arrivals: number;
  early_departures: number;
  attendance_rate: number;
}

interface AttendanceRecord {
  user_id: string;
  name: string;
  staff_id: string | null;
  role: string;
  directorate_abbr: string | null;
  clock_in_time: string | null;
  clock_out_time: string | null;
  clock_in_photo: string | null;
  clock_in_reauth_method: 'webauthn' | 'pin' | null;
  clock_out_reauth_method: 'webauthn' | 'pin' | null;
  liveness_decision: 'pass' | 'fail' | 'manual_review' | 'skipped' | null;
  liveness_signature: string | null;
  is_late: number;
  is_early_departure: number;
  current_streak: number;
}

interface DirBreakdown {
  abbreviation: string;
  name: string;
  total_staff: number;
  present: number;
  late: number;
}

export function AttendanceTab() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [dirFilter, setDirFilter] = useState('');
  const [segment, setSegment] = useState<AttendanceSegment>('staff');
  const [monthlyUser, setMonthlyUser] = useState<{ id: string; name: string } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const currentUser = useAuthStore(s => s.user);
  const canEditSettings = currentUser?.role === 'superadmin';
  const isSuperadmin = currentUser?.role === 'superadmin';
  const queryClient = useQueryClient();
  const [clearingUserId, setClearingUserId] = useState<string | null>(null);

  // TEMPORARY TEST TOOLING — paired with POST /api/clock/admin/clear-test-records.
  // Remove once the test cycle stabilises.
  const clearMutation = useMutation({
    mutationFn: async (input: { user_id: string; date: string; name: string }) => {
      const res = await api.post<{ deleted: number; user_id: string; date: string }>(
        '/clock/admin/clear-test-records',
        { user_id: input.user_id, date: input.date },
      );
      return { ...res.data, name: input.name } as { deleted: number; user_id: string; date: string; name: string };
    },
    onSuccess: (data) => {
      setClearingUserId(null);
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      // eslint-disable-next-line no-alert
      alert(`Cleared ${data?.deleted ?? 0} record(s) for ${data?.name} on ${data?.date}.`);
    },
    onError: (err) => {
      setClearingUserId(null);
      // eslint-disable-next-line no-alert
      alert(`Failed to clear records: ${err instanceof Error ? err.message : 'unknown error'}`);
    },
  });

  function handleClear(userId: string, name: string) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Clear ALL clock records for ${name} on ${selectedDate}?\n\nThis cannot be undone. Use only for test cycles.`)) return;
    setClearingUserId(userId);
    clearMutation.mutate({ user_id: userId, date: selectedDate, name });
  }

  // Ctrl/Cmd+K focuses the search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data: overviewData } = useQuery({
    queryKey: ['attendance', 'today', selectedDate, segment],
    queryFn: () => api.get<TodayOverview>(`/attendance/today?user_type=${segment}`),
  });

  const { data: recordsData, isLoading } = useQuery({
    queryKey: ['attendance', 'records', selectedDate, dirFilter, segment],
    queryFn: () => {
      let url = `/attendance/records?date=${selectedDate}&user_type=${segment}`;
      if (dirFilter) url += `&directorate_id=${dirFilter}`;
      return api.get<AttendanceRecord[]>(url);
    },
  });

  const { data: dirData } = useQuery({
    queryKey: ['attendance', 'by-directorate', selectedDate, segment],
    queryFn: () => api.get<DirBreakdown[]>(`/attendance/by-directorate?date=${selectedDate}&user_type=${segment}`),
  });

  const { data: dirsData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<AppSettings>('/admin/settings'),
    staleTime: 60_000,
  });

  const overview = overviewData?.data;
  const records = recordsData?.data ?? [];
  const dirBreakdown = dirData?.data ?? [];
  const directorates = dirsData?.data ?? [];
  const settings = settingsData?.data ?? null;

  const isToday = selectedDate === new Date().toISOString().slice(0, 10);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.staff_id ?? '').toLowerCase().includes(q) ||
      (r.directorate_abbr ?? '').toLowerCase().includes(q)
    );
  }, [records, search]);

  function segmentFilenameSlug(): string {
    if (segment === 'nss') return 'NSS-Attendance';
    if (segment === 'intern') return 'Interns-Attendance';
    if (segment === 'all') return 'Attendance-All';
    return 'Attendance';
  }

  function exportAttendanceCSV() {
    const source = filteredRecords;
    const headers = ['Name', 'Staff ID', 'Directorate', 'Clock In', 'Clock Out', 'Late', 'Left Early', 'Streak', 'Photo URL'];
    const rows = source.map(r => [
      r.name,
      r.staff_id ?? '',
      r.directorate_abbr ?? '',
      r.clock_in_time ? formatTime(r.clock_in_time) : 'Absent',
      r.clock_out_time ? formatTime(r.clock_out_time) : '',
      r.is_late ? 'Yes' : 'No',
      r.is_early_departure ? 'Yes' : 'No',
      String(r.current_streak),
      resolvePhotoUrl(r.clock_in_photo) ?? '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    downloadCSV(csv, `OHCS-${segmentFilenameSlug()}-${selectedDate}.csv`);
  }

  async function exportAttendancePDF() {
    if (!overview || pdfExporting) return;
    setPdfExporting(true);
    try {
      const doc = await generateAttendancePdf(selectedDate, filteredRecords, overview, segment);
      doc.save(`OHCS-${segmentFilenameSlug()}-${selectedDate}.pdf`);
    } finally {
      setPdfExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* TEMPORARY TEST TOOLING — banner only renders for superadmin. Remove
          when the pilot test cycle stabilises. */}
      {isSuperadmin && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div className="text-[13px] leading-snug">
            <span className="inline-flex items-center h-5 px-2 mr-2 text-[10px] font-bold rounded-md bg-amber-600 text-white tracking-wider align-middle">
              TEST TOOL
            </span>
            A trash-can button appears in each attendance row (last column) so you can wipe a user&apos;s clock_in/clock_out for the selected date and re-run a clock-in test cycle. Action is logged. Visible to superadmin only and intended to be removed once the pilot stabilises.
          </div>
        </div>
      )}

      <LivenessMetricsWidget />

      {/* Staff / NSS / Interns / All segment pill */}
      <SegmentToggle value={segment} onChange={setSegment} />

      {/* Date picker + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {!isToday && (
            <button
              onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
              className="h-10 px-4 text-[13px] font-medium text-primary border border-primary/20 rounded-xl hover:bg-primary/5 transition-all"
            >
              Today
            </button>
          )}
          {settings && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-background text-[12px] text-muted hover:text-foreground hover:border-accent/40 transition-all"
              title={canEditSettings ? 'Edit working hours' : 'View working hours'}
            >
              <SettingsIcon className="h-3.5 w-3.5 text-accent-warm" />
              <span className="font-mono tabular-nums">
                {settings.work_start_time} – {settings.work_end_time}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-warning">late {settings.late_threshold_time}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportAttendanceCSV}
            className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-[13px] font-medium rounded-xl border border-border hover:border-accent/40 transition-all"
          >
            <Download className="h-4 w-4 text-accent-warm" />
            Export CSV
          </button>
          <button
            onClick={exportAttendancePDF}
            disabled={pdfExporting || !overview}
            className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-[13px] font-medium rounded-xl border border-border hover:border-accent/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pdfExporting ? (
              <Loader2 className="h-4 w-4 text-accent-warm animate-spin" />
            ) : (
              <FileText className="h-4 w-4 text-accent-warm" />
            )}
            {pdfExporting ? 'Generating...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Total Staff" value={overview.total_staff} color="primary" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Clocked In" value={overview.clocked_in} color="success" />
          <StatCard icon={<XCircle className="h-4 w-4" />} label="Not In" value={overview.not_clocked_in} color="danger" />
          <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Late" value={overview.late_arrivals} color="warning" />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Clocked Out" value={overview.clocked_out} color="muted" />
          <StatCard icon={<LogOut className="h-4 w-4" />} label="Left Early" value={overview.early_departures ?? 0} color="warning" />
          <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Rate" value={`${overview.attendance_rate}%`} color="accent" />
        </div>
      )}

      {/* Directorate breakdown */}
      {dirBreakdown.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              By Directorate
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {dirBreakdown.filter(d => d.total_staff > 0).map(d => {
              const rate = d.total_staff > 0 ? Math.round((d.present / d.total_staff) * 100) : 0;
              return (
                <div key={d.abbreviation} className="bg-background rounded-xl p-3 border border-border-subtle">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">{d.abbreviation}</span>
                    <span className={cn('text-[13px] font-bold', rate >= 80 ? 'text-success' : rate >= 50 ? 'text-warning' : 'text-danger')}>
                      {rate}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', rate >= 80 ? 'bg-success' : rate >= 50 ? 'bg-warning' : 'bg-danger')}
                      style={{ width: `${rate}%` }} />
                  </div>
                  <p className="text-[11px] text-muted mt-1.5">{d.present}/{d.total_staff} present{d.late > 0 ? ` · ${d.late} late` : ''}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly user report modal */}
      {monthlyUser && (
        <MonthlyReportModal userId={monthlyUser.id} userName={monthlyUser.name} onClose={() => setMonthlyUser(null)} />
      )}

      {/* Working hours settings */}
      {settingsOpen && settings && (
        <SettingsModal current={settings} canEdit={canEditSettings} onClose={() => setSettingsOpen(false)} />
      )}

      {/* Records table */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />

        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4.5 w-4.5 text-primary" />
            <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Attendance Records — {formatDate(selectedDate + 'T00:00:00Z')}
            </h3>
            {search && (
              <span className="text-[12px] text-muted">
                · {filteredRecords.length} match{filteredRecords.length === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, staff ID, dir…"
                aria-label="Search attendance records"
                className="h-9 pl-8 pr-8 rounded-xl border border-border bg-background text-[13px] w-56 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-muted hover:text-foreground hover:bg-foreground/5 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline text-[10px] font-mono text-muted bg-foreground/5 rounded px-1.5 py-0.5 border border-border">
                  ⌘K
                </kbd>
              )}
            </div>
            <select
              value={dirFilter}
              onChange={e => setDirFilter(e.target.value)}
              className="h-9 px-3 rounded-xl border border-border bg-background text-[13px]"
            >
              <option value="">All Directorates</option>
              {directorates.map(d => (
                <option key={d.id} value={d.id}>{d.abbreviation}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-[14px] text-muted">Loading records...</div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted">No attendance records for this date</div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted">
            No records match “{search}”.{' '}
            <button onClick={() => setSearch('')} className="text-primary hover:underline">Clear search</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff ID</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dir</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Clock In</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Clock Out</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Liveness</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Verified</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Streak</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Photo</th>
                  {isSuperadmin && (
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-amber-700 uppercase tracking-wide">Test</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRecords.map(r => (
                  <Fragment key={r.user_id}>
                    <tr className="hover:bg-background-warm/50 transition-colors">
                      <td className="px-5 py-3">
                          <button onClick={() => setMonthlyUser({ id: r.user_id, name: r.name })}
                            className="text-[15px] font-semibold text-primary hover:underline text-left">
                            {r.name}
                          </button>
                        </td>
                      <td className="px-5 py-3 text-[14px] font-mono text-muted">{r.staff_id ?? '—'}</td>
                      <td className="px-5 py-3">
                        {r.directorate_abbr ? (
                          <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-lg">
                            {r.directorate_abbr}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3">
                        {r.clock_in_time ? (
                          <span className={cn('text-[14px] font-medium', r.is_late ? 'text-danger' : 'text-success')}>
                            {formatTime(r.clock_in_time)}
                          </span>
                        ) : (
                          <span className="text-[14px] text-muted-foreground italic">Absent</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-[14px]', r.is_early_departure ? 'text-warning font-medium' : 'text-foreground')}>
                            {r.clock_out_time ? formatTime(r.clock_out_time) : '—'}
                          </span>
                          {r.is_early_departure ? (
                            <span className="inline-flex items-center h-5 px-1.5 text-[10px] font-bold rounded-md bg-warning/10 text-warning">
                              Early
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {!r.clock_in_time ? (
                          <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-danger/10 text-danger">Absent</span>
                        ) : r.is_late ? (
                          <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-warning/10 text-warning">Late</span>
                        ) : (
                          <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-success/10 text-success">On Time</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {r.liveness_signature ? (
                          <button
                            onClick={() => setExpandedRow(expandedRow === r.user_id ? null : r.user_id)}
                            className="flex items-center gap-1.5 group"
                            aria-expanded={expandedRow === r.user_id}
                            aria-label={`${expandedRow === r.user_id ? 'Hide' : 'Show'} liveness evidence for ${r.name}`}
                          >
                            <LivenessPill decision={r.liveness_decision} />
                            <span className="text-[10px] text-muted group-hover:text-foreground transition-colors">
                              {expandedRow === r.user_id ? '▲' : '▼'}
                            </span>
                          </button>
                        ) : (
                          <LivenessPill decision={r.liveness_decision} />
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {r.clock_in_reauth_method === 'webauthn' && (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">🔒 Bio</span>
                        )}
                        {r.clock_in_reauth_method === 'pin' && (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-warning">🔢 PIN</span>
                        )}
                        {!r.clock_in_reauth_method && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {r.current_streak > 0 ? (
                          <span className="text-[13px] font-medium text-accent-warm">{r.current_streak}d</span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3">
                        {r.clock_in_photo ? (
                          <div className="w-8 h-8 rounded-lg overflow-hidden border border-border">
                            <img src={resolvePhotoUrl(r.clock_in_photo)!} alt="" className="w-full h-full object-cover" />
                          </div>
                        ) : '—'}
                      </td>
                      {isSuperadmin && (
                        <td className="px-5 py-3">
                          {(r.clock_in_time || r.clock_out_time) ? (
                            <button
                              onClick={() => handleClear(r.user_id, r.name)}
                              disabled={clearingUserId === r.user_id}
                              className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium rounded-md border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              title={`Clear all clock records for ${r.name} on ${selectedDate}`}
                              aria-label={`Clear clock records for ${r.name}`}
                            >
                              {clearingUserId === r.user_id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                              Clear
                            </button>
                          ) : (
                            <span className="text-muted-foreground text-[12px]">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                    {expandedRow === r.user_id && r.liveness_signature && (
                      <tr className="bg-zinc-50/60">
                        <td colSpan={isSuperadmin ? 11 : 10} className="px-5 py-3">
                          <LivenessEvidenceCard signature={JSON.parse(r.liveness_signature)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LivenessPill({ decision }: { decision: string | null }) {
  const cls =
    decision === 'pass' ? 'bg-emerald-100 text-emerald-800'
    : decision === 'fail' ? 'bg-red-100 text-red-800'
    : decision === 'manual_review' ? 'bg-amber-100 text-amber-800'
    : 'bg-zinc-100 text-zinc-600';
  const label = decision ?? '—';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}

function MonthlyReportModal({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'monthly', userId, month],
    queryFn: () => api.get<{
      user: { name: string; staff_id: string; current_streak: number; longest_streak: number };
      month: string;
      total_days_present: number;
      late_days: number;
      on_time_days: number;
      daily_records: Record<string, { clock_in?: string; clock_out?: string; is_late: boolean }>;
    }>(`/attendance/user/${userId}/monthly?month=${month}`),
  });

  const report = data?.data;
  const days = report ? Object.entries(report.daily_records).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-[18px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{userName}</h3>
            <p className="text-[13px] text-muted">Monthly Attendance Report</p>
          </div>
          <div className="flex items-center gap-3">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="h-9 px-3 rounded-xl border border-border bg-background text-[13px]" />
            <button onClick={onClose} className="text-muted hover:text-foreground">
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-[14px] text-muted">Loading...</div>
        ) : report ? (
          <div className="flex-1 overflow-y-auto">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 px-6 py-4">
              <div className="text-center p-3 bg-success/8 rounded-xl">
                <p className="text-[20px] font-bold text-success">{report.on_time_days}</p>
                <p className="text-[11px] text-muted">On Time</p>
              </div>
              <div className="text-center p-3 bg-warning/10 rounded-xl">
                <p className="text-[20px] font-bold text-warning">{report.late_days}</p>
                <p className="text-[11px] text-muted">Late</p>
              </div>
              <div className="text-center p-3 bg-primary/8 rounded-xl">
                <p className="text-[20px] font-bold text-primary">{report.total_days_present}</p>
                <p className="text-[11px] text-muted">Total Days</p>
              </div>
            </div>

            {/* Daily records */}
            <div className="px-6 pb-4">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-[11px] font-semibold text-muted uppercase">Date</th>
                    <th className="text-left py-2 text-[11px] font-semibold text-muted uppercase">In</th>
                    <th className="text-left py-2 text-[11px] font-semibold text-muted uppercase">Out</th>
                    <th className="text-left py-2 text-[11px] font-semibold text-muted uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {days.map(([date, rec]) => (
                    <tr key={date}>
                      <td className="py-2 text-[14px] text-foreground">{formatDate(date + 'T00:00:00Z')}</td>
                      <td className="py-2 text-[14px] text-foreground">{rec.clock_in ?? '—'}</td>
                      <td className="py-2 text-[14px] text-foreground">{rec.clock_out ?? '—'}</td>
                      <td className="py-2">
                        <span className={cn(
                          'text-[11px] font-bold px-2 py-0.5 rounded-full',
                          rec.is_late ? 'bg-warning/10 text-warning' : 'bg-success/8 text-success'
                        )}>
                          {rec.is_late ? 'Late' : 'On Time'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {days.length === 0 && (
                <p className="text-center text-[14px] text-muted py-6">No records for this month</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SegmentToggle({ value, onChange }: {
  value: AttendanceSegment;
  onChange: (next: AttendanceSegment) => void;
}) {
  const options: Array<{ key: AttendanceSegment; label: string }> = [
    { key: 'staff', label: 'Staff' },
    { key: 'nss', label: 'NSS' },
    { key: 'intern', label: 'Interns' },
    { key: 'all', label: 'All' },
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<AttendanceSegment, HTMLButtonElement | null>>({
    staff: null, nss: null, intern: null, all: null,
  });
  const [underline, setUnderline] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  // Recompute underline position when value changes or layout settles.
  useLayoutEffect(() => {
    const btn = buttonRefs.current[value];
    const container = containerRef.current;
    if (!btn || !container) return;
    const btnRect = btn.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setUnderline({ left: btnRect.left - containerRect.left, width: btnRect.width });
  }, [value]);

  // Re-measure on resize so the underline never desyncs.
  useEffect(() => {
    function onResize() {
      const btn = buttonRefs.current[value];
      const container = containerRef.current;
      if (!btn || !container) return;
      const btnRect = btn.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setUnderline({ left: btnRect.left - containerRect.left, width: btnRect.width });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [value]);

  return (
    <div className="flex">
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Attendance segment"
        className="relative inline-flex items-center bg-surface rounded-2xl border border-border shadow-sm p-1"
      >
        {/* Animated gold underline */}
        <span
          aria-hidden
          className="absolute bottom-0 h-[2px] rounded-full transition-all duration-300 ease-out"
          style={{
            left: underline.left,
            width: underline.width,
            background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
            transform: 'translateY(-2px)',
          }}
        />
        {options.map(opt => {
          const active = opt.key === value;
          return (
            <button
              key={opt.key}
              ref={el => { buttonRefs.current[opt.key] = el; }}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.key)}
              className={cn(
                'relative h-10 px-5 rounded-xl text-[13px] font-semibold transition-colors duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                active ? 'text-primary' : 'text-muted hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number;
  color: 'primary' | 'success' | 'danger' | 'warning' | 'muted' | 'accent';
}) {
  const colors = {
    primary: 'bg-primary/8 text-primary',
    success: 'bg-success/8 text-success',
    danger: 'bg-danger/8 text-danger',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-foreground/5 text-foreground',
    accent: 'bg-accent/10 text-accent-warm',
  };
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', colors[color])}>
        {icon}
      </div>
      <p className="text-xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{value}</p>
      <p className="text-[12px] text-muted font-medium mt-0.5">{label}</p>
    </div>
  );
}
