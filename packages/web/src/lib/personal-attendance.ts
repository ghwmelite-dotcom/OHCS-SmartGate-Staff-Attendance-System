import { api } from './api';

export interface MyClockStatus {
  clocked_in: boolean;
  clocked_out: boolean;
  clock_in_time: string | null;
  clock_out_time: string | null;
}
export interface MyClockEvent { id: string; type: 'clock_in' | 'clock_out'; timestamp: string }

// The account partitions the cache; only the session cookie determines API identity.
export const personalAttendanceQueries = (id: string) => ({
  status: { queryKey: ['personal-attendance', id, 'status'], queryFn: () => api.get<MyClockStatus>('/clock/my-status') },
  history: { queryKey: ['personal-attendance', id, 'history'], queryFn: () => api.get<MyClockEvent[]>('/clock/my-history?days=14') },
});
export function attendanceTime(timestamp: string | null): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}
export function groupAttendance(events: MyClockEvent[]) {
  const days = new Map<string, MyClockEvent[]>();
  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.timestamp))) continue;
    const key = new Date(event.timestamp).toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  return [...days].sort(([a], [b]) => b.localeCompare(a)).map(([date, records]) => ({
    date,
    label: new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`)),
    records: records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
  }));
}
