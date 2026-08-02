import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Directorate } from '@/lib/api';
import { generatePDF } from '@/lib/pdf';
import { generateCSV, downloadCSV } from '@/lib/csv';
import { FileText, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

function getDateRange(preset: PeriodPreset, customFrom: string, customTo: string) {
  const today = new Date().toISOString().slice(0, 10);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      return { from: weekAgo, to: today };
    }
    case 'month': {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      return { from: monthAgo, to: today };
    }
    case 'custom':
      return { from: customFrom || today, to: customTo || today };
  }
}

export function ReportsPage() {
  const [preset, setPreset] = useState<PeriodPreset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [directorateId, setDirectorateId] = useState('');
  const [generating, setGenerating] = useState<'pdf' | 'csv' | null>(null);

  const { from, to } = getDateRange(preset, customFrom, customTo);

  const { data: dirData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });

  const { data: reportData, isLoading, refetch } = useQuery({
    queryKey: ['report', from, to, directorateId],
    queryFn: () => {
      let url = `/reports/visits?from=${from}&to=${to}&limit=500`;
      if (directorateId) url += `&directorate_id=${directorateId}`;
      return api.get<{ summary: Record<string, unknown>; visits: Array<Record<string, unknown>>; truncated?: boolean }>(url);
    },
    enabled: false,
  });

  const directorates = dirData?.data ?? [];

  async function handleGenerate(type: 'pdf' | 'csv') {
    setGenerating(type);
    try {
      const result = await refetch();
      const data = result.data?.data;
      if (!data) return;

      const summary = data.summary as {
        total_visits: number; unique_visitors: number; avg_duration: number;
        busiest_directorate: string; from: string; to: string;
      };
      const visits = data.visits as Array<{
        check_in_at: string; check_out_at: string | null; duration_minutes: number | null;
        status: string; badge_code: string | null; purpose_raw: string | null;
        first_name: string; last_name: string; organisation: string | null;
        host_name: string | null; directorate_abbr: string | null;
      }>;
      // Never let a partial export masquerade as a complete one — the note
      // goes on screen AND into the PDF/CSV itself.
      const truncationNote = data.truncated
        ? `Export shows first ${visits.length} of ${summary.total_visits} visits — narrow the date range`
        : undefined;

      if (type === 'pdf') {
        const doc = generatePDF(summary, visits, truncationNote);
        doc.save(`OHCS-VMS-Report-${from}.pdf`);
      } else {
        const csv = generateCSV(visits, truncationNote);
        downloadCSV(csv, `OHCS-VMS-Export-${from}.csv`);
      }
    } finally {
      setGenerating(null);
    }
  }

  const previewSummary = reportData?.data?.summary as {
    total_visits?: number; unique_visitors?: number;
  } | undefined;
  const previewTruncated = reportData?.data?.truncated === true;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Reports
        </h1>
        <p className="text-[15px] text-muted mt-0.5">Generate and export visitor reports</p>
      </div>

      {/* Configuration card */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-1">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />

        <div className="p-6 space-y-5">
          {/* Period */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-2">
              Report Period
            </label>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'today', label: 'Today' },
                { value: 'week', label: 'This Week' },
                { value: 'month', label: 'This Month' },
                { value: 'custom', label: 'Custom Range' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPreset(opt.value)}
                  className={cn(
                    'h-10 px-5 rounded-xl text-[14px] font-medium transition-all border',
                    preset === opt.value
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-surface text-foreground border-border hover:border-primary/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {preset === 'custom' && (
              <div className="flex gap-3 mt-3">
                <div>
                  <label className="block text-[11px] text-muted mb-1">From</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted mb-1">To</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Directorate filter */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-2">
              Directorate (Optional)
            </label>
            <select
              value={directorateId}
              onChange={e => setDirectorateId(e.target.value)}
              className="w-full max-w-xs h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Directorates</option>
              {directorates.map(d => (
                <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
              ))}
            </select>
          </div>

          {/* Preview info */}
          <div className="bg-background-warm rounded-xl p-4 border border-border-subtle">
            <p className="text-[13px] text-muted">
              Report period: <strong className="text-foreground">
                {new Date(from).toLocaleDateString('en-GB')} — {new Date(to).toLocaleDateString('en-GB')}
              </strong>
              {previewSummary && (
                <> &middot; {previewSummary.total_visits} visits, {previewSummary.unique_visitors} unique visitors</>
              )}
            </p>
            {previewTruncated && previewSummary?.total_visits != null && (
              <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                Export shows first {reportData?.data?.visits.length ?? 0} of {previewSummary.total_visits} visits — narrow the date range
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={() => handleGenerate('pdf')}
              disabled={generating !== null}
              className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15 active:scale-[0.98]"
            >
              {generating === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download PDF
            </button>
            <button
              onClick={() => handleGenerate('csv')}
              disabled={generating !== null}
              className="inline-flex items-center gap-2 h-11 px-6 bg-surface text-foreground text-[14px] font-semibold rounded-xl border border-border hover:border-accent/40 hover:shadow-sm transition-all disabled:opacity-50"
            >
              {generating === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 text-accent-warm" />}
              Export CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
