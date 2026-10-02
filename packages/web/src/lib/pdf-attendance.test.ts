import { describe, it, expect, vi } from 'vitest';
import autoTable from 'jspdf-autotable';
import { generateAttendancePdf, generateAttendanceRangePdf } from './pdf';

vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));
const times = {
  clock_in_time: '2026-10-02T08:00:00Z', clock_out_time: '2026-10-02T14:15:00Z',
  clock_out_self_reported: 1, clock_out_submitted_at: '2026-10-02T16:00:00Z',
};
describe('attendance PDF self-reports', () => {
  it('daily and range cells label the declaration and retain submission time', async () => {
    await generateAttendancePdf('2026-10-02', [{ ...times, user_id: 'qa', name: 'QA Officer', staff_id: 'QA', directorate_abbr: 'RSIMD', clock_in_photo: null, is_late: 0, is_early_departure: 1, current_streak: 1 }], { total_staff: 1, clocked_in: 1, late_arrivals: 0, early_departures: 1, attendance_rate: 100 });
    generateAttendanceRangePdf({ from: '2026-10-02', to: '2026-10-02', rows: [{ ...times, date: '2026-10-02', user_id: 'qa', name: 'QA Officer', identifier: 'QA', directorate_abbr: 'RSIMD', is_late: 0, is_early_departure: 1, presence_method: null, absence_reason: null, absence_note: null, has_photo: 0 }] });
    expect(autoTable).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(autoTable).mock.calls) {
      const body = JSON.stringify(call[1]?.body);
      expect(body).toContain('Self-reported');
      expect(body).toContain('Submitted: 2026-10-02T16:00:00Z');
    }
  });
});
