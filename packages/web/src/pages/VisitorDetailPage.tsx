import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type VisitorDetail, type Visit } from '@/lib/api';
import { cn, getInitials, formatDate, formatTime, formatDateTime } from '@/lib/utils';
import { VISIT_STATUS, ID_TYPES } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { IdCheckBadge } from '@/components/IdCheckBadge';
import {
  ChevronLeft,
  User,
  Phone,
  Mail,
  Briefcase,
  CreditCard,
  Calendar,
  Clock,
  Building2,
  Star,
  ShieldAlert,
} from 'lucide-react';

/* ---- Watchlist + delegation fields ride on API rows (additive, so extend
   the shared types locally instead of touching api.ts) ---- */
type VisitorFlag = 'vip' | 'banned';
type VisitorDetailWithFlag = VisitorDetail & {
  flag?: VisitorFlag | null;
  flag_note?: string | null;
  flag_updated_at?: string | null;
};
type VisitWithParty = Visit & { party_size?: number | null; party_names?: string | null };

// Tooltip content for the +N party chip: accompanying member names.
function partyMembers(partyNames: string | null | undefined): string | undefined {
  if (!partyNames) return undefined;
  try {
    const names = JSON.parse(partyNames) as unknown;
    return Array.isArray(names) && names.length > 0 ? names.join(', ') : undefined;
  } catch {
    return undefined;
  }
}

export function VisitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = user?.role === 'superadmin';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [flagNote, setFlagNote] = useState('');

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/visitors/${id}`),
    onSuccess: () => {
      toast.success('Visitor deleted');
      navigate('/visitors');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    },
  });

  const flagMutation = useMutation({
    mutationFn: (flag: VisitorFlag | null) =>
      api.put(`/visitors/${id}/flag`, { flag, note: flagNote.trim() || undefined }),
    onSuccess: (_res, flag) => {
      toast.success(flag ? `Visitor flagged as ${flag === 'vip' ? 'VIP' : 'banned'}` : 'Watchlist flag cleared');
      setFlagNote('');
      queryClient.invalidateQueries({ queryKey: ['visitor', id] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update flag');
    },
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['visitor', id],
    queryFn: () => api.get<VisitorDetailWithFlag>(`/visitors/${id}`),
    enabled: !!id,
  });

  const visitor = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !visitor) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">Visitor not found</p>
        <button onClick={() => navigate('/visitors')} className="text-sm text-primary font-medium mt-2 hover:underline">
          Back to visitors
        </button>
      </div>
    );
  }

  const idTypeLabel = ID_TYPES.find((t) => t.value === visitor.id_type)?.label;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/visitors')}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        All Visitors
      </button>

      {/* Profile card */}
      <div className="bg-surface rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold shrink-0">
            {getInitials(visitor.first_name, visitor.last_name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground">
              <span className="inline-flex items-center gap-2 flex-wrap">
                {visitor.first_name} {visitor.last_name}
                {visitor.flag === 'vip' && (
                  <span className="inline-flex items-center gap-1 h-5 px-2 text-[10px] font-bold rounded-full bg-warning-light text-accent-warm border border-accent/40 align-middle">
                    <Star className="h-3 w-3" />
                    VIP
                  </span>
                )}
              </span>
            </h2>
            {visitor.organisation && (
              <p className="text-sm text-muted mt-0.5">{visitor.organisation}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mt-4">
              {visitor.phone && (
                <DetailRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={visitor.phone} />
              )}
              {visitor.email && (
                <DetailRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={visitor.email} />
              )}
              {visitor.id_type && (
                <DetailRow icon={<CreditCard className="h-3.5 w-3.5" />} label="ID Type" value={idTypeLabel ?? visitor.id_type} />
              )}
              {visitor.id_number && (
                <DetailRow icon={<CreditCard className="h-3.5 w-3.5" />} label="ID Number" value={visitor.id_number} />
              )}
              <DetailRow icon={<Calendar className="h-3.5 w-3.5" />} label="Total Visits" value={String(visitor.total_visits)} />
              {visitor.last_visit_at && (
                <DetailRow icon={<Clock className="h-3.5 w-3.5" />} label="Last Visit" value={formatDate(visitor.last_visit_at)} />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => navigate('/check-in')}
              className="h-9 px-4 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors"
            >
              Check In
            </button>
            {isSuperadmin && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="h-9 px-4 text-[13px] font-medium text-danger border border-danger/20 rounded-xl hover:bg-danger/5 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <div className="mt-4 p-4 bg-danger-light border border-danger/20 rounded-xl animate-fade-in">
            <p className="text-[14px] font-medium text-danger">
              Delete {visitor.first_name} {visitor.last_name} and all their visit records?
            </p>
            <p className="text-[13px] text-muted mt-1">This action cannot be undone.</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="h-9 px-4 bg-danger text-white text-[13px] font-semibold rounded-xl hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="h-9 px-4 text-[13px] font-medium text-muted border border-border rounded-xl hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Watchlist flag management — superadmin only */}
      {isSuperadmin && (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Watchlist Flag</h3>
              <p className="text-xs text-muted mt-0.5">
                VIP alerts directorate leadership on arrival; banned triggers a discreet security alert at check-in.
              </p>
            </div>
            {visitor.flag && (
              <span className={cn(
                'inline-flex items-center gap-1 h-6 px-2.5 text-[10px] font-bold rounded-full border shrink-0',
                visitor.flag === 'vip'
                  ? 'bg-warning-light text-accent-warm border-accent/40'
                  : 'bg-danger-light text-danger border-danger/30'
              )}>
                {visitor.flag === 'vip' ? <Star className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                {visitor.flag === 'vip' ? 'VIP' : 'BANNED'}
              </span>
            )}
          </div>

          {visitor.flag && (visitor.flag_note || visitor.flag_updated_at) && (
            <p className="text-xs text-muted">
              {visitor.flag_note && <>Note: {visitor.flag_note}</>}
              {visitor.flag_note && visitor.flag_updated_at && ' · '}
              {visitor.flag_updated_at && <>Set {formatDateTime(visitor.flag_updated_at)}</>}
            </p>
          )}

          <input
            type="text"
            value={flagNote}
            onChange={(e) => setFlagNote(e.target.value)}
            maxLength={200}
            placeholder="Reason (optional, staff-only)"
            className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => flagMutation.mutate('vip')}
              disabled={flagMutation.isPending || visitor.flag === 'vip'}
              className="h-9 px-4 bg-accent text-white text-[13px] font-semibold rounded-xl hover:brightness-110 disabled:opacity-50 transition-all inline-flex items-center gap-1.5"
            >
              <Star className="h-3.5 w-3.5" />
              Mark VIP
            </button>
            <button
              onClick={() => flagMutation.mutate('banned')}
              disabled={flagMutation.isPending || visitor.flag === 'banned'}
              className="h-9 px-4 bg-danger text-white text-[13px] font-semibold rounded-xl hover:brightness-110 disabled:opacity-50 transition-all inline-flex items-center gap-1.5"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Mark Banned
            </button>
            {visitor.flag && (
              <button
                onClick={() => flagMutation.mutate(null)}
                disabled={flagMutation.isPending}
                className="h-9 px-4 text-[13px] font-medium text-muted border border-border rounded-xl hover:text-foreground transition-colors disabled:opacity-50"
              >
                Clear Flag
              </button>
            )}
          </div>
        </div>
      )}

      {/* Visit history */}
      <div className="bg-surface rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Visit History</h3>
          <p className="text-xs text-muted mt-0.5">Last 20 visits</p>
        </div>

        {visitor.visits.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            No visit history yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Date</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Check In</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Check Out</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Duration</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Host</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Directorate</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visitor.visits.map((visit: VisitWithParty) => {
                  const statusCfg = VISIT_STATUS[visit.status];
                  return (
                    <tr key={visit.id} className="hover:bg-background/30 transition-colors">
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {formatDate(visit.check_in_at)}
                          {visit.party_size != null && visit.party_size > 1 && (
                            <span
                              className="inline-flex items-center h-5 px-1.5 text-[10px] font-bold bg-primary/10 text-primary rounded"
                              title={partyMembers(visit.party_names)}
                            >
                              +{visit.party_size - 1}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {formatTime(visit.check_in_at)}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {visit.check_out_at ? formatTime(visit.check_out_at) : '—'}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {visit.duration_minutes ? `${visit.duration_minutes}m` : '—'}
                      </td>
                      <td className="px-5 py-3 text-foreground truncate max-w-[160px]">
                        {visit.host_name ?? '—'}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {visit.directorate_abbr ? (
                          <span className="inline-flex items-center h-5 px-1.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
                            {visit.directorate_abbr}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-flex items-center h-5 px-2 text-[10px] font-medium rounded-full',
                              statusCfg.color
                            )}
                          >
                            {statusCfg.label}
                          </span>
                          <IdCheckBadge value={visit.id_photo_check} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <span className="text-xs text-muted">{label}:</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
