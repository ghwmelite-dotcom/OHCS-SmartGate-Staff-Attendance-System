import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Clock, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { attendanceTime, groupAttendance, personalAttendanceQueries } from '@/lib/personal-attendance';

export function PersonalAttendance({ userId, name }: { userId: string; name: string }) {
  const queries = personalAttendanceQueries(userId);
  const refresh = { refetchInterval: 60_000, refetchOnWindowFocus: 'always' as const, refetchOnReconnect: 'always' as const };
  const status = useQuery({ ...queries.status, ...refresh });
  const history = useQuery({ ...queries.history, ...refresh });
  const today = status.data?.data;
  const rows = groupAttendance(history.data?.data ?? []);
  const fetching = status.isFetching || history.isFetching;
  const failed = status.isError || history.isError;
  const updated = Math.min(status.dataUpdatedAt, history.dataUpdatedAt);
  const label = !today ? 'Status unavailable' : today.clocked_out ? 'Clock-out recorded' : today.clocked_in ? 'Clocked in' : 'No clock-in recorded today';
  return (
    <section aria-labelledby="personal-attendance-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-primary/5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your working day</p>
            <h1 id="personal-attendance-title" className="mt-2 text-2xl font-bold tracking-tight text-foreground">My attendance</h1>
            <p className="mt-1 text-sm text-muted">{name} · Your personal Staff Attendance records</p>
          </div>
          <a href="https://staff-attendance.ohcsghana.org" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Open Staff Attendance <ArrowUpRight aria-hidden="true" className="h-4 w-4" /><span className="sr-only"> (new tab)</span>
          </a>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3" aria-busy={status.isPending}>
          {[
            { title: 'Today · Ghana time', value: status.isPending ? 'Loading…' : label, Icon: Clock },
            { title: 'Clock in', value: status.isPending ? 'Loading…' : attendanceTime(today?.clock_in_time ?? null), Icon: LogIn },
            { title: 'Clock out', value: status.isPending ? 'Loading…' : attendanceTime(today?.clock_out_time ?? null), Icon: LogOut },
          ].map(({ title, value, Icon }) => <div key={title} className="rounded-xl border border-border bg-surface p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-muted"><Icon aria-hidden="true" className="h-4 w-4 text-primary" />{title}</p>
            <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">{value}</p>
          </div>)}
        </div>
      </div>
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-foreground">Recent activity</h2><p className="text-xs text-muted">Recorded events from the last 14 days · Ghana time</p></div>
          <button type="button" disabled={fetching} onClick={() => { void status.refetch(); void history.refetch(); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm text-foreground hover:bg-primary/5 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <RefreshCw aria-hidden="true" className="h-4 w-4" />{fetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {failed && <p role="alert" className="mt-4 rounded-xl border border-border p-3 text-sm text-foreground">Attendance could not be refreshed. Any records shown may be outdated. Check your connection and try Refresh.</p>}
        {history.isPending ? <p role="status" className="py-8 text-sm text-muted">Loading your attendance history…</p> : rows.length ? (
          <ul className="mt-4 divide-y divide-border">
            {rows.map((day) => <li key={day.date} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <time dateTime={day.date} className="text-sm font-medium text-foreground">{day.label}</time>
              <div className="flex flex-wrap gap-2">{day.records.map((event) => <span key={event.id} className="inline-flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-foreground">
                {event.type === 'clock_in' ? <LogIn aria-hidden="true" className="h-4 w-4 text-primary" /> : <LogOut aria-hidden="true" className="h-4 w-4 text-muted" />}
                {event.type === 'clock_in' ? 'In' : 'Out'} <time dateTime={event.timestamp} className="font-semibold tabular-nums">{attendanceTime(event.timestamp)}</time>
              </span>)}</div>
            </li>)}
          </ul>
        ) : !history.isError && <p className="py-8 text-sm text-muted">No attendance events recorded in this period. Missing records are not an absence determination.</p>}
        <p aria-live="polite" className="mt-4 text-xs text-muted">{updated > 0 ? `Last updated ${attendanceTime(new Date(updated).toISOString())} GMT. ` : ''}Refreshes every minute while open. Offline clock events appear after the Staff Attendance app syncs.</p>
      </div>
    </section>
  );
}
