import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ShieldCheck, ChevronLeft, ChevronRight, CheckCircle2, Search, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface Notice {
  id: string; user_id: string; staff_name: string; directorate_name: string | null;
  directorate_abbr: string | null; reason: string; note: string | null; notice_date: string;
  expected_return_date: string | null; created_at: string; version: number;
  status: 'submitted' | 'acknowledged' | 'withdrawn'; acknowledged_at: string | null;
  acknowledged_by_name: string | null; withdrawn_at: string | null;
}
interface Detail extends Notice {
  can_acknowledge: boolean;
  revisions: { version: number; event: string; reason: string; note: string | null; expected_return_date: string | null; at: string; actor_name: string | null }[];
}
interface Register { notices: Notice[]; total: number; page: number; page_size: number; can_review: boolean }
const reasons: Record<string, string> = { sick: 'Sick', family_emergency: 'Family emergency', transport: 'Transport', other: 'Other' };
const statuses = { submitted: 'Awaiting acknowledgement', acknowledged: 'Acknowledged', withdrawn: 'Withdrawn' };
const date = (v: string | null) => v ? new Date(v.length === 10 ? v + 'T00:00:00Z' : v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' }) : 'Not recorded';
const time = (v: string) => new Date(v).toLocaleString('en-GB', { timeZone: 'Africa/Accra' });
const control = 'min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

export function NoticesPage({ personalOnly = false }: { personalOnly?: boolean }) {
  const userId = useAuthStore(s => s.user?.id);
  const [params, setParams] = useSearchParams();
  const selected = params.get('notice');
  const [view, setView] = useState<'mine' | 'register'>(!personalOnly && params.get('view') === 'register' ? 'register' : 'mine');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const client = useQueryClient();
  const query = new URLSearchParams({ view: personalOnly ? 'mine' : view, page: String(page), q, status });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const list = useQuery({ queryKey: ['notices', userId, query.toString()], queryFn: () => api.get<Register>('/notices?' + query), refetchInterval: 60_000 });
  const detail = useQuery({ queryKey: ['notice', userId, selected], queryFn: () => api.get<Detail>('/notices/' + encodeURIComponent(selected!)), enabled: !!selected });
  const acknowledge = useMutation({
    mutationFn: (record: Detail) => api.post('/notices/' + encodeURIComponent(record.id) + '/acknowledge', { version: record.version }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['notices', userId] }), client.invalidateQueries({ queryKey: ['notice', userId] })]); },
    onError: () => { void client.invalidateQueries({ queryKey: ['notice', userId] }); },
  });
  const data = list.isError ? null : list.data?.data;
  const record = detail.isError ? null : detail.data?.data;
  const open = (id: string | null) => { acknowledge.reset(); setParams(id ? { notice: id } : {}); };
  return <main className={personalOnly ? 'min-h-screen bg-background px-4 py-6 pb-24 text-foreground' : 'space-y-6 text-foreground'}>
    <div className="mx-auto max-w-6xl space-y-6">
      {personalOnly && <Link to="/clock" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><ArrowLeft size={18} /> Back to attendance</Link>}
      <header className="rounded-2xl border border-primary/20 bg-primary/5 p-6 md:p-8">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck size={20} /> OHCS · Staff Records &amp; Notices</div>
        <h1 className="font-display text-3xl font-bold md:text-4xl">{personalOnly ? 'My Notices' : 'Every notice. A clear record.'}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Track absence notices, keep their history and see when they have been acknowledged. Acknowledgement confirms receipt; it is not approval of leave.</p>
      </header>
      {!personalOnly && <div className="flex flex-wrap gap-2" aria-label="Notice views">
        <button className={control + (view === 'mine' ? ' font-bold ring-2 ring-primary' : '')} aria-pressed={view === 'mine'} onClick={() => { setView('mine'); setPage(1); }}>My Notices</button>
        {data?.can_review && <button className={control + (view === 'register' ? ' font-bold ring-2 ring-primary' : '')} aria-pressed={view === 'register'} onClick={() => { setView('register'); setPage(1); }}>Directorate register</button>}
      </div>}
      {selected ? <section className="rounded-2xl border border-border bg-surface p-5 md:p-7" aria-label="Notice details">
        <button className={control + ' mb-5 inline-flex items-center gap-2'} onClick={() => open(null)}><ArrowLeft size={16} /> Back to notices</button>
        {detail.isPending && <p role="status">Loading notice…</p>}
        {detail.isError && <p role="alert">{detail.error.message}</p>}
        {record && <>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-muted">Absence notice · Version {record.version}</p><h2 className="mt-2 text-2xl font-bold">{record.staff_name}</h2><p className="mt-1 text-sm text-muted">{record.directorate_name ?? 'No directorate recorded'}</p></div><span className="rounded-full bg-primary/10 px-3 py-2 text-sm font-semibold">{statuses[record.status]}</span></div>
          <p className="mt-4 break-all text-xs text-muted">Reference: {record.id}</p>
          <dl className="my-6 grid grid-cols-1 gap-5 sm:grid-cols-3">{[['Absence from', date(record.notice_date)], ['Expected back', date(record.expected_return_date)], ['Reason', reasons[record.reason] ?? record.reason]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>
          <div className="rounded-xl border border-border p-4"><h3 className="text-sm font-semibold">Staff explanation</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{record.note || 'No explanation recorded.'}</p></div>
          {record.acknowledged_at && <p className="mt-4 text-sm">Acknowledged by {record.acknowledged_by_name ?? 'authorised reviewer'} on {time(record.acknowledged_at)}.</p>}
          {record.withdrawn_at && <p className="mt-4 text-sm">Withdrawn on {time(record.withdrawn_at)}. Retained for reference.</p>}
          {!personalOnly && record.can_acknowledge && <div className="mt-5"><button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(record)} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white disabled:opacity-50"><CheckCircle2 size={18} /> {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge receipt'}</button><p className="mt-2 text-xs text-muted">Confirms you have reviewed this version. Does not grant leave.</p></div>}
          {acknowledge.isError && <p role="alert" className="mt-3 text-sm">{acknowledge.error.message}</p>}
          {acknowledge.isSuccess && <p role="status" className="mt-3 text-sm">Receipt acknowledged.</p>}
          <h3 className="mb-4 mt-8 text-lg font-bold">Record history</h3>
          <ol className="space-y-3">{record.revisions.map((r, i) => <li key={i} className="rounded-xl border border-border p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="capitalize">{r.event} · Version {r.version}</strong><span className="text-xs text-muted">{time(r.at)}</span></div>{r.actor_name && <p className="mt-1">By {r.actor_name}</p>}<p className="mt-2 whitespace-pre-wrap break-words">{reasons[r.reason] ?? r.reason}{r.note ? ' — ' + r.note : ''}</p><p className="mt-2 text-xs text-muted">Expected back: {date(r.expected_return_date)}</p></li>)}</ol>
        </>}
      </section> : <>
        <form onSubmit={e => { e.preventDefault(); setQ(search); setPage(1); }} className="grid gap-3 rounded-2xl border border-border bg-surface p-4 md:grid-cols-5">
          <label className="text-xs font-semibold md:col-span-2">Search name or reference<div className="mt-2 flex gap-2"><input className={control + ' min-w-0 flex-1'} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or reference" maxLength={100} /><button className={control} aria-label="Search notices"><Search size={18} /></button></div></label>
          <label className="text-xs font-semibold">Status<select className={control + ' mt-2 w-full'} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">All notices</option><option value="submitted">Awaiting acknowledgement</option><option value="acknowledged">Acknowledged</option><option value="withdrawn">Withdrawn</option></select></label>
          <label className="text-xs font-semibold">From<input type="date" className={control + ' mt-2 w-full min-w-0'} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="text-xs font-semibold">To<input type="date" className={control + ' mt-2 w-full min-w-0'} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        </form>
        {list.isPending && <p role="status">Loading notices…</p>}
        {list.isError && <div role="alert" className="rounded-xl border border-border p-4"><p>{list.error.message}</p><button className={control + ' mt-3'} onClick={() => void list.refetch()}>Try again</button></div>}
        {data && <><div className="flex items-center justify-between text-sm"><p><strong>{data.total}</strong> matching {data.total === 1 ? 'notice' : 'notices'}</p><button className={control} onClick={() => void list.refetch()}>Refresh</button></div>
          {!data.notices.length && <div className="rounded-2xl border border-dashed border-border p-10 text-center"><FileText className="mx-auto mb-3 text-primary" size={32} /><h2 className="font-semibold">No notices to show</h2><p className="mt-2 text-sm text-muted">Submitted absence notices appear here. Try adjusting your filters.</p></div>}
          <div className="grid gap-4 md:grid-cols-2">{data.notices.map(n => <button key={n.id} onClick={() => open(n.id)} className="rounded-2xl border border-border bg-surface p-5 text-left transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><div className="flex items-start justify-between gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><FileText size={20} /></span><span className="text-xs font-semibold text-primary">{statuses[n.status]}</span></div><h2 className="mt-4 text-lg font-bold">{n.staff_name}</h2><p className="mt-1 text-sm text-muted">{n.directorate_abbr ?? 'Unassigned'} · {reasons[n.reason] ?? n.reason}</p><div className="mt-4 border-t border-border pt-3 text-sm"><p>Absent from <strong>{date(n.notice_date)}</strong></p><p className="mt-1 text-muted">Expected back {date(n.expected_return_date)}</p></div><span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">View record <ChevronRight size={16} /></span></button>)}</div>
          <nav className="flex items-center justify-between gap-3" aria-label="Notice pages"><button className={control + ' inline-flex items-center gap-1 disabled:opacity-40'} disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /> Previous</button><span className="text-sm">Page {page} of {Math.max(1, Math.ceil(data.total / 20))}</span><button className={control + ' inline-flex items-center gap-1 disabled:opacity-40'} disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={16} /></button></nav>
        </>}
      </>}
      <p className="text-xs leading-5 text-muted">Access is limited to your own records and assigned oversight responsibilities. Notices withdrawn before this register was introduced are not recoverable here.</p>
    </div>
  </main>;
}
