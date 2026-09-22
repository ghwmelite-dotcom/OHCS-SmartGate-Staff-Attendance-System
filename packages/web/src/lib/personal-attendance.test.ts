import { describe, expect, it, vi } from 'vitest';
import { attendanceTime, groupAttendance, personalAttendanceQueries } from './personal-attendance';
import { api } from './api';

describe('personal attendance', () => {
  it('formats timestamps in Ghana time and handles missing values', () => {
    expect(attendanceTime('2026-09-22T09:30:00+02:00')).toBe('07:30');
    expect(attendanceTime(null)).toBe('—');
    expect(attendanceTime('bad')).toBe('—');
  });
  it('groups by Ghana date, preserves all events and sorts newest days first', () => {
    const days = groupAttendance([
      { id: 'out', type: 'clock_out', timestamp: '2026-09-22T17:00:00Z' },
      { id: 'old', type: 'clock_in', timestamp: '2026-09-22T00:30:00+02:00' },
      { id: 'in', type: 'clock_in', timestamp: '2026-09-22T08:00:00Z' },
      { id: 'bad', type: 'clock_in', timestamp: 'invalid' },
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-09-22', '2026-09-21']);
    expect(days[0]?.records.map((e) => e.id)).toEqual(['in', 'out']);
    expect(groupAttendance([])).toEqual([]);
  });
  it('partitions accounts without sending a user ID to the API', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: null, error: null });
    const a = personalAttendanceQueries('account-a');
    const b = personalAttendanceQueries('account-b');
    expect(a.status.queryKey).not.toEqual(b.status.queryKey);
    expect(a.history.queryKey).not.toEqual(b.history.queryKey);
    await a.status.queryFn();
    await a.history.queryFn();
    expect(get.mock.calls).toEqual([['/clock/my-status'], ['/clock/my-history?days=14']]);
    get.mockRestore();
  });
});
