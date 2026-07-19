import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Visit, type Directorate } from '@/lib/api';
import { cn, formatDate, formatTime } from '@/lib/utils';
import { VISIT_STATUS } from '@/lib/constants';
import { IdCheckBadge } from '@/components/IdCheckBadge';
import { HostResponseChip } from '@/components/HostResponseChip';
import { Search, Filter, X, ChevronDown } from 'lucide-react';

export function VisitLogPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [directorateId, setDirectorateId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();

  const hasFilters = search || from || to || status || directorateId;

  const { data: dirData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    if (directorateId) params.set('directorate_id', directorateId);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '50');
    return `/visits?${params.toString()}`;
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['visit-log', search, from, to, status, directorateId, cursor],
    queryFn: () => api.get<Visit[]>(buildUrl()),
    placeholderData: (prev) => prev,
  });

  const visits = data?.data ?? [];
  const hasMore = data?.meta?.hasMore;
  const directorates = dirData?.data ?? [];

  function clearFilters() {
    setSearch(''); setFrom(''); setTo(''); setStatus(''); setDirectorateId(''); setCursor(undefined);
  }

  return (
    <div className="space-y-5">
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Visit Log
        </h1>
        <p className="text-[15px] text-muted mt-0.5">Search and filter all visit records</p>
      </div>

      {/* Filter bar */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm p-4 space-y-3 animate-fade-in-up stagger-1">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCursor(undefined); }}
              placeholder="Search visitor, organisation, badge code..."
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>

          {/* Date range */}
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setCursor(undefined); }}
            className="h-10 px-3 rounded-xl border border-border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="From"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setCursor(undefined); }}
            className="h-10 px-3 rounded-xl border border-border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="To"
          />

          {/* Status */}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setCursor(undefined); }}
            className="h-10 px-3 rounded-xl border border-border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Status</option>
            <option value="checked_in">Checked In</option>
            <option value="checked_out">Checked Out</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Directorate */}
          <select
            value={directorateId}
            onChange={(e) => { setDirectorateId(e.target.value); setCursor(undefined); }}
            className="h-10 px-3 rounded-xl border border-border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Directorates</option>
            {directorates.map(d => (
              <option key={d.id} value={d.id}>{d.abbreviation}</option>
            ))}
          </select>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="h-10 px-4 rounded-xl text-[13px] font-medium text-muted hover:text-foreground border border-border hover:border-danger/30 transition-all flex items-center gap-1.5"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {isFetching && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <div className="h-3 w-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            Searching...
          </div>
        )}
      </div>

      {/* Results table */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-2">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />

        {isLoading ? (
          <div className="p-10 text-center">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading visits...</p>
          </div>
        ) : visits.length === 0 ? (
          <div className="p-10 text-center">
            <Filter className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-[15px] text-muted font-medium">
              {hasFilters ? 'No visits match your filters' : 'No visits recorded yet'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-background/50">
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Date</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Visitor</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Organisation</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Host</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dir</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">In</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Out</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dur</th>
                    <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visits.map((v) => {
                    const statusCfg = VISIT_STATUS[v.status];
                    return (
                      <tr key={v.id} className="hover:bg-background-warm/50 transition-colors">
                        <td className="px-5 py-3 text-[14px] text-foreground whitespace-nowrap">
                          {formatDate(v.check_in_at)}
                        </td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => navigate(`/visitors/${v.visitor_id}`)}
                            className="text-[14px] font-semibold text-primary hover:underline"
                          >
                            {v.first_name} {v.last_name}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-[14px] text-muted truncate max-w-[160px]">
                          {v.organisation ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-[14px] text-muted truncate max-w-[140px]">
                          <span className="inline-flex items-center gap-1.5">
                            {v.host_name ?? '—'}
                            <HostResponseChip value={v.host_response} />
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {v.directorate_abbr ? (
                            <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-lg">
                              {v.directorate_abbr}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-5 py-3 text-[13px] text-foreground whitespace-nowrap">
                          {formatTime(v.check_in_at)}
                        </td>
                        <td className="px-5 py-3 text-[13px] text-foreground whitespace-nowrap">
                          {v.check_out_at ? formatTime(v.check_out_at) : '—'}
                        </td>
                        <td className="px-5 py-3 text-[13px] text-foreground whitespace-nowrap">
                          {v.duration_minutes ? `${v.duration_minutes}m` : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn(
                              'inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full',
                              statusCfg.color
                            )}>
                              {statusCfg.label}
                            </span>
                            <IdCheckBadge value={v.id_photo_check} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="px-5 py-4 border-t border-border text-center">
                <button
                  onClick={() => {
                    const last = visits[visits.length - 1];
                    if (last) setCursor(last.check_in_at);
                  }}
                  className="inline-flex items-center gap-1.5 text-[14px] font-medium text-primary hover:underline"
                >
                  <ChevronDown className="h-4 w-4" />
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
