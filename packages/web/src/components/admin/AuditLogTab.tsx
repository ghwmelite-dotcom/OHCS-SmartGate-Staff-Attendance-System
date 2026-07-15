import { Fragment, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ScrollText, ShieldCheck, ShieldAlert, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';

interface AuditChangeValue { from: unknown; to: unknown }
interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_label: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  changes: Record<string, AuditChangeValue> | null;
  ip: string | null;
}
interface AuditPage { entries: AuditEntry[]; nextCursor: number | null }
interface VerifyResult { ok: boolean; checked: number; brokenAtSeq: number | null }

const ENTITY_TYPES = ['', 'user', 'directorate', 'officer', 'holiday', 'settings', 'visit', 'migration'];

const ROLE_COLOURS: Record<string, string> = {
  superadmin: 'bg-accent/20 text-accent-warm',
  admin: 'bg-primary/15 text-primary',
  reception: 'bg-success/15 text-success',
  staff: 'bg-muted/30 text-foreground',
};

function actorInitial(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name[0].toUpperCase();
}

function ActorCell({ name, role }: { name: string | null; role: string | null }) {
  const display = name ?? 'system';
  const isSystem = !name;
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn(
        'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold',
        isSystem ? 'bg-muted/20 text-muted' : 'bg-primary/15 text-primary',
      )}>
        {actorInitial(name)}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-tight truncate">{display}</p>
        {role && (
          <span className={cn('inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0 rounded-md leading-5', ROLE_COLOURS[role] ?? 'bg-muted/20 text-muted')}>
            {role}
          </span>
        )}
      </div>
    </div>
  );
}

function actionColor(action: string): string {
  if (action.includes('deactivate') || action.includes('delete') || action.includes('remove')) return 'bg-danger/10 text-danger';
  if (action.includes('role_change') || action.includes('override')) return 'bg-accent/15 text-accent-warm';
  if (action.includes('create') || action.includes('add')) return 'bg-success/10 text-success';
  return 'bg-primary/10 text-primary';
}

export function AuditLogTab() {
  const [entityType, setEntityType] = useState('');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  const query = useQuery({
    queryKey: ['audit', entityType, qApplied],
    queryFn: () => {
      const p = new URLSearchParams();
      if (entityType) p.set('entity_type', entityType);
      if (qApplied) p.set('q', qApplied);
      return api.get<AuditPage>(`/admin/audit${p.toString() ? `?${p}` : ''}`);
    },
  });
  const entries = query.data?.data?.entries ?? [];

  const verifyM = useMutation({
    mutationFn: () => api.get<VerifyResult>('/admin/audit/verify'),
    onSuccess: (r) => setVerify(r.data ?? null),
  });

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <ScrollText className="h-4.5 w-4.5 text-primary" />
          <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Audit Log
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {verify && (
            <span className={cn('inline-flex items-center gap-1.5 h-8 px-2.5 text-[12px] font-semibold rounded-lg',
              verify.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
              {verify.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {verify.ok ? `Intact (${verify.checked})` : `Broken at #${verify.brokenAtSeq}`}
            </span>
          )}
          <button onClick={() => verifyM.mutate()} disabled={verifyM.isPending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-semibold rounded-lg border border-border text-foreground hover:border-primary/40 disabled:opacity-50">
            {verifyM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-accent-warm" />}
            Verify integrity
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-background/40 flex-wrap">
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)}
          className="h-9 px-2 rounded-lg border border-border bg-background text-[13px]">
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t === '' ? 'All entities' : t}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQApplied(q.trim()); }} className="flex items-center gap-2 flex-1 min-w-[180px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search summary…"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-[13px]" />
          </div>
          <button type="submit" className="h-9 px-3 text-[13px] font-medium text-muted hover:text-foreground">Search</button>
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-background/50">
              <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">When</th>
              <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Actor</th>
              <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Action</th>
              <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.isLoading && (
              <tr><td colSpan={4} className="px-6 py-8 text-center"><Loader2 className="h-5 w-5 text-primary mx-auto animate-spin" /></td></tr>
            )}
            {!query.isLoading && entries.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-[13px] text-muted">No audit entries yet.</td></tr>
            )}
            {entries.map(e => {
              const hasChanges = e.changes && Object.keys(e.changes).length > 0;
              const isOpen = expanded === e.id;
              return (
                <Fragment key={e.id}>
                  <tr className={cn('hover:bg-background-warm/50 transition-colors', hasChanges && 'cursor-pointer')}
                    onClick={() => hasChanges && setExpanded(isOpen ? null : e.id)}>
                    <td className="px-6 py-3 text-[13px] text-muted whitespace-nowrap font-mono">{new Date(e.at).toLocaleString('en-GB')}</td>
                    <td className="px-6 py-3">
                      <ActorCell name={e.actor_name ?? e.actor_label} role={e.actor_role} />
                    </td>
                    <td className="px-6 py-3">
                      <span className={cn('inline-flex items-center gap-1 h-6 px-2 text-[11px] font-bold rounded-lg font-mono', actionColor(e.action))}>
                        {hasChanges && (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                        {e.action}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[13px] text-foreground">{e.summary ?? '—'}</td>
                  </tr>
                  {isOpen && hasChanges && (
                    <tr className="bg-background/40">
                      <td colSpan={4} className="px-6 py-3">
                        <div className="space-y-1">
                          {Object.entries(e.changes!).map(([field, v]) => (
                            <div key={field} className="text-[12px] font-mono flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-muted">{field}:</span>
                              <span className="text-danger line-through">{fmt(v.from)}</span>
                              <span className="text-muted">→</span>
                              <span className="text-success">{fmt(v.to)}</span>
                            </div>
                          ))}
                          {e.ip && <p className="text-[11px] text-muted mt-1">IP: {e.ip}{e.entity_id ? ` · entity: ${e.entity_id}` : ''}</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v === '' ? '∅' : v;
  return JSON.stringify(v);
}
