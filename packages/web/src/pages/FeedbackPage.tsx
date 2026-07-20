import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { downloadCSV } from '@/lib/csv';
import { cn, formatTime } from '@/lib/utils';
import {
  Star, Download, MessageSquareText, AlertTriangle, Percent, Clock,
} from 'lucide-react';

/* Visitor satisfaction survey — read side for the Client Service tier.
   Spec: 2026-07-20-visitor-satisfaction-survey-design. */

interface SurveyRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  wait_minutes: number | null;
  badge_code: string | null;
  source: string;
  first_name: string;
  last_name: string;
  directorate_abbr: string | null;
  host_name: string | null;
}

interface SurveyList {
  rows: SurveyRow[];
  total: number;
  page: number;
  page_size: number;
}

interface SurveySummary {
  average: number | null;
  total: number;
  low: number;
  distribution: Record<string, number>;
  checkouts: number;
  response_rate: number | null;
}

interface Directorate {
  id: string;
  name: string;
  abbreviation: string;
}

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildQuery(from: string, to: string, rating: number | 0, directorateId: string): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (rating) p.set('rating', String(rating));
  if (directorateId) p.set('directorate_id', directorateId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function FeedbackPage() {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [rating, setRating] = useState<number | 0>(0);
  const [directorateId, setDirectorateId] = useState('');

  const qs = useMemo(() => buildQuery(from, to, rating, directorateId), [from, to, rating, directorateId]);
  // Summary ignores the rating filter (the distribution IS the rating view).
  const summaryQs = useMemo(() => buildQuery(from, to, 0, directorateId), [from, to, directorateId]);

  const { data: summaryData } = useQuery({
    queryKey: ['surveys', 'summary', summaryQs],
    queryFn: () => api.get<SurveySummary>(`/surveys/summary${summaryQs}`),
  });
  const { data: listData, isLoading } = useQuery({
    queryKey: ['surveys', 'list', qs],
    queryFn: () => api.get<SurveyList>(`/surveys${qs}${qs ? '&' : '?'}page_size=200`),
  });
  const { data: directoratesData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
  });

  const summary = summaryData?.data;
  const rows = listData?.data?.rows ?? [];
  const total = listData?.data?.total ?? 0;
  const directorates = directoratesData?.data ?? [];

  async function exportCsv() {
    const res = await api.get<SurveyList>(`/surveys${qs}${qs ? '&' : '?'}page_size=500`);
    const all = res.data?.rows ?? [];
    const headers = ['Date', 'Time', 'Rating', 'Comment', 'Visitor', 'Host', 'Directorate', 'Wait (min)', 'Source', 'Badge Code'];
    const body = all.map((r) => [
      new Date(r.created_at).toLocaleDateString('en-GB'),
      formatTime(r.created_at),
      `${r.rating}/5`,
      (r.comment ?? '').replace(/,/g, ';'),
      `${r.first_name} ${r.last_name}`,
      r.host_name ?? '',
      r.directorate_abbr ?? '',
      r.wait_minutes != null ? String(r.wait_minutes) : '',
      r.source,
      r.badge_code ?? '',
    ]);
    const csv = [headers, ...body].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    downloadCSV(csv, `visitor-feedback-${from || 'all'}-to-${to || 'all'}.csv`);
  }

  const maxDist = Math.max(1, ...Object.values(summary?.distribution ?? {}));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Visitor Feedback
          </h1>
          <p className="text-[15px] text-muted mt-0.5">Post-checkout satisfaction surveys from the kiosk</p>
        </div>
        <button
          onClick={exportCsv}
          className="h-10 px-4 bg-surface border border-border rounded-xl text-[13px] font-semibold text-foreground inline-flex items-center gap-2 hover:bg-background transition-all shrink-0"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up stagger-1">
        <StatCard
          icon={<Star className="h-4 w-4" />}
          label="Average rating"
          tone="accent"
          value={summary?.average != null ? summary.average.toFixed(1) : '--'}
          sub={summary?.average != null ? <StarRow rating={Math.round(summary.average)} /> : null}
        />
        <StatCard
          icon={<MessageSquareText className="h-4 w-4" />}
          label="Responses"
          tone="primary"
          value={summary?.total ?? 0}
          sub={summary ? `${summary.checkouts} checkouts in period` : null}
        />
        <StatCard
          icon={<Percent className="h-4 w-4" />}
          label="Response rate"
          tone="info"
          value={summary?.response_rate != null ? `${Math.round(summary.response_rate * 100)}%` : '--'}
          sub="of completed checkouts"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Low ratings (≤2)"
          tone={summary && summary.low > 0 ? 'danger' : 'muted'}
          value={summary?.low ?? 0}
          sub="need follow-up"
        />
      </div>

      {/* Distribution + filters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in-up stagger-2">
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-5">
          <h3 className="text-[15px] font-bold text-foreground mb-4" style={{ fontFamily: 'var(--font-display)' }}>Rating distribution</h3>
          <div className="space-y-2.5">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = summary?.distribution?.[String(n)] ?? 0;
              return (
                <div key={n} className="flex items-center gap-2.5">
                  <span className="w-10 shrink-0 text-[12px] font-semibold text-muted inline-flex items-center gap-1">
                    {n} <Star className="h-3 w-3 fill-[#D4A017] text-[#D4A017]" />
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-background overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', n <= 2 ? 'bg-danger/70' : 'bg-primary')}
                      style={{ width: `${(count / maxDist) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[12px] font-semibold text-foreground">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 bg-surface rounded-2xl border border-border shadow-sm p-5">
          <h3 className="text-[15px] font-bold text-foreground mb-4" style={{ fontFamily: 'var(--font-display)' }}>Filters</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Rating</span>
              <select value={rating} onChange={(e) => setRating(Number(e.target.value) as number | 0)} className={inputCls}>
                <option value={0}>All ratings</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}★ — {RATING_LABELS[n - 1]}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Directorate</span>
              <select value={directorateId} onChange={(e) => setDirectorateId(e.target.value)} className={inputCls}>
                <option value="">All directorates</option>
                {directorates.map((d) => <option key={d.id} value={d.id}>{d.abbreviation}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Responses */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-3">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Responses</h3>
          <span className="text-[12px] text-muted">{rows.length} of {total}</span>
        </div>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Loading feedback…</p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <MessageSquareText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-[15px] font-semibold text-foreground">No feedback yet</p>
            <p className="text-[13px] text-muted mt-1">Ratings collected at checkout will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li key={r.id} className={cn('px-5 py-4', r.rating <= 2 && 'bg-danger-light/40')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StarRow rating={r.rating} />
                      <span className="text-[13px] font-semibold text-foreground">{r.first_name} {r.last_name}</span>
                      {r.directorate_abbr && (
                        <span className="text-[11px] font-semibold text-muted bg-background px-1.5 py-0.5 rounded border border-border">
                          {r.directorate_abbr}
                        </span>
                      )}
                    </div>
                    {r.comment && <p className="text-[14px] text-foreground mt-1.5 leading-snug">“{r.comment}”</p>}
                    <p className="text-[12px] text-muted mt-1.5 flex items-center gap-2 flex-wrap">
                      {r.host_name && <span>Host: {r.host_name}</span>}
                      {r.wait_minutes != null && (
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> seen in {r.wait_minutes} min</span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] text-muted whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {formatTime(r.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full h-10 px-3 text-[13px] border border-border rounded-xl bg-surface text-foreground focus:border-primary focus:outline-none';

const TONES: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/15 text-accent-warm',
  info: 'bg-info/10 text-info',
  danger: 'bg-danger/10 text-danger',
  muted: 'bg-border/60 text-muted',
};

function StatCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-4">
      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center mb-2.5', TONES[tone] ?? TONES.muted)}>{icon}</div>
      <p className="text-[22px] font-bold text-foreground leading-tight" style={{ fontFamily: 'var(--font-display)' }}>{value}</p>
      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mt-0.5">{label}</p>
      {sub && <div className="mt-1.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('h-3.5 w-3.5', n <= rating ? 'fill-[#D4A017] text-[#D4A017]' : 'text-border-strong')} />
      ))}
    </span>
  );
}
