import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, type Directorate } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import {
  X, GraduationCap, Pencil, KeyRound, Power, Loader2, Calendar,
  AlertCircle, History,
} from 'lucide-react';

interface NssDetail {
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
  staff_id: string | null;
  role: string;
  user_type: string;
  intern_code: string | null;
  institution: string | null;
  programme: string | null;
  supervisor_user_id: string | null;
  supervisor_name: string | null;
  pin_acknowledged: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  is_late: number;
}

// Active staff returned by GET /admin/interns/supervisors (already filtered server-side).
interface Supervisor {
  id: string;
  name: string;
}

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  grade: z.string().max(100).optional().or(z.literal('')),
  directorate_id: z.string().min(1, 'Directorate is required'),
  nss_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  nss_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  institution: z.string().max(150).optional().or(z.literal('')),
  programme: z.string().max(150).optional().or(z.literal('')),
  supervisor_user_id: z.string().optional().or(z.literal('')),
}).refine(s => s.nss_end_date > s.nss_start_date, {
  message: 'End date must be after start date',
  path: ['nss_end_date'],
});

type EditValues = z.infer<typeof editSchema>;

interface Props {
  userId: string;
  onClose: () => void;
  onChanged?: () => void;
  onResetPin: (user: NssDetail) => Promise<void> | void;
  onEndService: (user: NssDetail) => void;
}

export function NssDetailModal({ userId, onClose, onChanged, onResetPin, onEndService }: Props) {
  const qc = useQueryClient();

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['nss-detail', userId],
    queryFn: () => api.get<NssDetail>(`/admin/nss/${userId}`),
  });
  const detail = detailData?.data ?? null;

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['nss-activity', userId],
    queryFn: () => api.get<ActivityRow[]>(`/admin/nss/${userId}/activity`),
  });
  const activity = activityData?.data ?? [];

  const { data: dirsData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });
  const directorates = dirsData?.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nss-detail-title"
      >
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />

        {isLoading || !detail ? (
          <div className="p-12 text-center">
            <Loader2 className="h-5 w-5 text-primary animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading personnel…</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-[16px] font-bold shrink-0">
                  {detail.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 id="nss-detail-title" className="text-[18px] font-bold text-foreground truncate" style={{ fontFamily: 'var(--font-display)' }}>
                    {detail.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={cn(
                      'inline-flex items-center h-5 px-2 text-[10px] font-bold rounded-md',
                      detail.user_type === 'intern' ? 'bg-accent/10 text-accent-warm' : 'bg-success/10 text-success',
                    )}>
                      {detail.user_type === 'intern' ? 'Intern' : 'NSS'}
                    </span>
                    <span className="text-[12px] font-mono text-muted">
                      {detail.user_type === 'intern' ? (detail.intern_code ?? '—') : (detail.nss_number ?? '—')}
                    </span>
                    {detail.directorate_abbr && (
                      <span className="inline-flex items-center h-5 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-md">
                        {detail.directorate_abbr}
                      </span>
                    )}
                    {!detail.is_active && (
                      <span className="inline-flex items-center h-5 px-2 text-[10px] font-bold bg-foreground/5 text-muted rounded-md">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Posting progress */}
              <PostingProgress
                start={detail.nss_start_date}
                end={detail.nss_end_date}
                isIntern={detail.user_type === 'intern'}
              />

              {/* Edit form */}
              <EditForm
                detail={detail}
                directorates={directorates}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['nss-detail', userId] });
                  qc.invalidateQueries({ queryKey: ['nss-users'] });
                  qc.invalidateQueries({ queryKey: ['nss-today'] });
                  onChanged?.();
                }}
              />

              {/* Recent activity */}
              <div className="px-6 pb-6">
                <div className="flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-primary" />
                  <h4 className="text-[14px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                    Recent activity (14 days)
                  </h4>
                </div>
                {activityLoading ? (
                  <p className="text-[13px] text-muted">Loading…</p>
                ) : activity.length === 0 ? (
                  <p className="text-[13px] text-muted">No clock activity in the last 14 days.</p>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-background/50">
                          <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">Date</th>
                          <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">In</th>
                          <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">Out</th>
                          <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {activity.map(row => (
                          <tr key={row.date}>
                            <td className="px-3 py-2 text-[13px] text-foreground font-mono">{row.date}</td>
                            <td className="px-3 py-2 text-[13px] text-foreground font-mono">{row.clock_in ?? '—'}</td>
                            <td className="px-3 py-2 text-[13px] text-foreground font-mono">{row.clock_out ?? '—'}</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'inline-flex items-center h-5 px-1.5 text-[10px] font-bold rounded-md',
                                row.is_late ? 'bg-warning/10 text-warning' : 'bg-success/8 text-success',
                              )}>
                                {row.is_late ? 'Late' : 'On time'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-2 px-6 py-3 border-t border-border bg-background/40">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onResetPin(detail)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 text-[13px] font-medium text-foreground bg-surface rounded-xl border border-border hover:border-primary/40 transition-all"
                >
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  Reset PIN
                </button>
                {detail.is_active === 1 && (
                  <button
                    onClick={() => onEndService(detail)}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 text-[13px] font-medium text-danger bg-surface rounded-xl border border-danger/20 hover:bg-danger/5 transition-all"
                  >
                    <Power className="h-3.5 w-3.5" />
                    End service
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                className="h-9 px-4 text-[13px] text-muted hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Posting progress bar ---- */

function PostingProgress({ start, end, isIntern }: { start: string | null; end: string | null; isIntern?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const ts = (s: string) => new Date(s + 'T00:00:00Z').getTime();

  const data = useMemo(() => {
    if (!start || !end) return null;
    const sMs = ts(start);
    const eMs = ts(end);
    const tMs = ts(today);
    if (Number.isNaN(sMs) || Number.isNaN(eMs) || eMs <= sMs) return null;
    const totalDays = Math.round((eMs - sMs) / 86400_000);
    const elapsedDays = Math.max(0, Math.round((tMs - sMs) / 86400_000));
    const remainingDays = Math.max(0, Math.round((eMs - tMs) / 86400_000));
    const pct = Math.min(100, Math.max(0, ((tMs - sMs) / (eMs - sMs)) * 100));
    return { totalDays, elapsedDays, remainingDays, pct, started: tMs >= sMs, ended: tMs > eMs };
  }, [start, end, today]);

  if (!data || !start || !end) return null;

  const fmt = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="px-6 pt-5 pb-4">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="h-4 w-4 text-primary" />
        <h4 className="text-[13px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {isIntern ? 'Placement window' : 'Posting window'}
        </h4>
        <span className="text-[12px] text-muted">
          · {data.totalDays} days total
        </span>
      </div>
      <div className="flex items-center justify-between text-[12px] text-muted font-mono mb-2">
        <span>{fmt(start)}</span>
        <span>
          {data.ended ? 'Service ended' : data.started ? `${data.remainingDays} days remaining` : 'Not yet started'}
        </span>
        <span>{fmt(end)}</span>
      </div>
      <div className="relative h-2 bg-border rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{
            width: `${data.pct}%`,
            background: data.ended
              ? 'linear-gradient(90deg, #6B7280, #9CA3AF)'
              : 'linear-gradient(90deg, #D4A017, #F5D76E)',
          }}
        />
        {data.started && !data.ended && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-surface shadow"
            style={{ left: `calc(${data.pct}% - 6px)` }}
            aria-label="Today"
          />
        )}
      </div>
    </div>
  );
}

/* ---- Edit form ---- */

function EditForm({ detail, directorates, onSaved }: {
  detail: NssDetail;
  directorates: Directorate[];
  onSaved: () => void;
}) {
  const isIntern = detail.user_type === 'intern';

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: detail.name,
      grade: detail.grade ?? '',
      directorate_id: detail.directorate_id ?? '',
      nss_start_date: detail.nss_start_date ?? '',
      nss_end_date: detail.nss_end_date ?? '',
      institution: detail.institution ?? '',
      programme: detail.programme ?? '',
      supervisor_user_id: detail.supervisor_user_id ?? '',
    },
  });

  // Re-sync when detail changes (e.g. after save)
  useEffect(() => {
    form.reset({
      name: detail.name,
      grade: detail.grade ?? '',
      directorate_id: detail.directorate_id ?? '',
      nss_start_date: detail.nss_start_date ?? '',
      nss_end_date: detail.nss_end_date ?? '',
      institution: detail.institution ?? '',
      programme: detail.programme ?? '',
      supervisor_user_id: detail.supervisor_user_id ?? '',
    });
  }, [detail, form]);

  const { data: supervisorsData } = useQuery({
    queryKey: ['intern-supervisors'],
    queryFn: () => api.get<Supervisor[]>('/admin/interns/supervisors'),
    staleTime: 60_000,
    enabled: isIntern,
  });
  // Ensure the intern's current supervisor is always selectable, even if they are
  // no longer in the active-staff list (e.g. deactivated since assignment).
  const supervisorOptions = useMemo<Supervisor[]>(() => {
    const list = supervisorsData?.data ?? [];
    if (
      detail.supervisor_user_id &&
      !list.some((s) => s.id === detail.supervisor_user_id)
    ) {
      return [
        { id: detail.supervisor_user_id, name: detail.supervisor_name ?? '(current supervisor)' },
        ...list,
      ];
    }
    return list;
  }, [supervisorsData, detail.supervisor_user_id, detail.supervisor_name]);

  // Backend exposes PATCH; the shared api client only has GET/POST/PUT/DELETE,
  // so we use fetch directly here to send PATCH /api/admin/nss/:id.
  const patchMutation = useMutation({
    mutationFn: async (values: EditValues) => {
      const payload: Record<string, unknown> = {
        name: values.name,
        grade: values.grade || undefined,
        directorate_id: values.directorate_id,
        nss_start_date: values.nss_start_date,
        nss_end_date: values.nss_end_date,
      };
      if (isIntern) {
        // Only include intern fields that actually changed, so untouched fields
        // (notably supervisor) are NOT clobbered to null by the PATCH.
        const norm = (v: string | null | undefined) => ((v ?? '') === '' ? null : v);
        if (norm(values.institution) !== norm(detail.institution)) {
          payload.institution = norm(values.institution);
        }
        if (norm(values.programme) !== norm(detail.programme)) {
          payload.programme = norm(values.programme);
        }
        if (norm(values.supervisor_user_id) !== norm(detail.supervisor_user_id)) {
          payload.supervisor_user_id = norm(values.supervisor_user_id);
        }
      }
      const { API_BASE } = await import('@/lib/constants');
      const { getToken } = await import('@/lib/tokenStore');
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/nss/${detail.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as { data: NssDetail | null; error: { code: string; message: string } | null };
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? 'Update failed');
      }
      return json.data;
    },
    onSuccess: () => {
      toast.success(isIntern ? 'Intern updated' : 'NSS personnel updated');
      onSaved();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit(values => patchMutation.mutate(values))}
      className="px-6 pt-2 pb-5 border-t border-border-subtle"
    >
      <div className="flex items-center gap-2 mb-4 mt-4">
        <Pencil className="h-4 w-4 text-accent-warm" />
        <h4 className="text-[14px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          Edit details
        </h4>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Full Name" error={form.formState.errors.name?.message}>
          <input {...form.register('name')} className={inputCls} />
        </FormField>
        <FormField label={isIntern ? 'Intern Code' : 'NSS Number'}>
          <input
            value={(isIntern ? detail.intern_code : detail.nss_number) ?? ''}
            readOnly
            className={cn(inputCls, 'bg-background-warm font-mono cursor-not-allowed')}
            aria-readonly="true"
            title={isIntern ? 'Intern code cannot be changed' : 'NSS number cannot be changed'}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <FormField label="Email">
          <input
            value={detail.email}
            readOnly
            className={cn(inputCls, 'bg-background-warm cursor-not-allowed')}
            aria-readonly="true"
          />
        </FormField>
        <FormField label="Grade (optional)">
          <input {...form.register('grade')} className={inputCls} placeholder="e.g. National Service Personnel" />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <FormField label="Directorate" error={form.formState.errors.directorate_id?.message}>
          <select {...form.register('directorate_id')} className={inputCls}>
            <option value="">Select…</option>
            {directorates.map(d => (
              <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label={isIntern ? 'Placement start' : 'Service start'} error={form.formState.errors.nss_start_date?.message}>
          <input {...form.register('nss_start_date')} type="date" className={inputCls} />
        </FormField>
        <FormField label={isIntern ? 'Placement end' : 'Service end'} error={form.formState.errors.nss_end_date?.message}>
          <input {...form.register('nss_end_date')} type="date" className={inputCls} />
        </FormField>
      </div>

      {isIntern && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <FormField label="Institution" error={form.formState.errors.institution?.message}>
            <input {...form.register('institution')} className={inputCls} placeholder="e.g. University of Ghana" />
          </FormField>
          <FormField label="Programme" error={form.formState.errors.programme?.message}>
            <input {...form.register('programme')} className={inputCls} placeholder="e.g. BSc Computer Science" />
          </FormField>
          <FormField label="Supervisor">
            <select {...form.register('supervisor_user_id')} className={inputCls}>
              <option value="">No supervisor</option>
              {supervisorOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </FormField>
        </div>
      )}

      {patchMutation.isError && (
        <div className="flex items-start gap-2 p-3 mt-4 bg-danger/5 border border-danger/20 rounded-xl">
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <p className="text-[13px] text-danger">
            {patchMutation.error instanceof Error ? patchMutation.error.message : 'Update failed'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={() => form.reset()}
          disabled={!form.formState.isDirty || patchMutation.isPending}
          className="h-10 px-4 text-[13px] text-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="submit"
          disabled={!form.formState.isDirty || patchMutation.isPending}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-sm shadow-primary/15"
        >
          {patchMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GraduationCap className="h-4 w-4" />
          )}
          {patchMutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

/* ---- Helpers ---- */

const inputCls =
  'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function FormField({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="text-danger text-[12px] mt-1">{error}</p>}
    </div>
  );
}
