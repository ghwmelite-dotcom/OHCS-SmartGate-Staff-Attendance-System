import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Visitor } from '@/lib/api';
import { getInitials, formatDate } from '@/lib/utils';
import { Search, Users, ArrowRight, ChevronRight, ChevronDown } from 'lucide-react';

const PAGE_SIZE = 30;

export function VisitorsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // Cursor pagination — the API returns meta.cursor (last row's created_at)
  // + meta.hasMore; "Load more" appends the next page (visit-log pattern).
  const {
    data,
    isLoading,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['visitors', 'list', search],
    queryFn: ({ pageParam }) =>
      api.get<Visitor[]>(
        `/visitors?q=${encodeURIComponent(search)}&limit=${PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.meta?.hasMore && last.meta.cursor ? last.meta.cursor : undefined),
  });

  const visitors = data?.pages.flatMap((p) => p.data ?? []) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Visitors</h2>
          <p className="text-sm text-muted">Search and manage visitor records</p>
        </div>
        <button
          onClick={() => navigate('/check-in')}
          className="inline-flex items-center gap-2 h-9 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors self-start"
        >
          <Users className="h-4 w-4" />
          New Check-In
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or organisation..."
          className="w-full h-11 pl-10 pr-4 rounded-lg border border-border bg-surface text-base focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
        />
        {isFetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted text-sm">Loading visitors...</div>
        ) : visitors.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted">
              {search ? `No visitors found for "${search}"` : 'No visitors registered yet'}
            </p>
            {search && (
              <button
                onClick={() => navigate('/check-in')}
                className="inline-flex items-center gap-1 text-sm text-primary font-medium mt-2 hover:underline"
              >
                Register a new visitor <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {visitors.map((visitor) => (
              <button
                key={visitor.id}
                onClick={() => navigate(`/visitors/${visitor.id}`)}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-background/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                  {getInitials(visitor.first_name, visitor.last_name)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {visitor.first_name} {visitor.last_name}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {[visitor.organisation, visitor.phone].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                </div>

                <div className="hidden sm:block text-right shrink-0">
                  <p className="text-sm font-medium text-foreground">{visitor.total_visits}</p>
                  <p className="text-xs text-muted">visits</p>
                </div>

                {visitor.last_visit_at && (
                  <div className="hidden md:block text-right shrink-0">
                    <p className="text-xs text-muted">Last visit</p>
                    <p className="text-xs text-foreground">{formatDate(visitor.last_visit_at)}</p>
                  </div>
                )}

                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
            </div>

            {hasNextPage && (
              <div className="px-5 py-4 border-t border-border text-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-50"
                >
                  <ChevronDown className="h-4 w-4" />
                  {isFetchingNextPage ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
