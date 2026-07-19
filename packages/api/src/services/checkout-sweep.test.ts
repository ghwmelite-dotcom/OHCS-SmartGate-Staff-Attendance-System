import { describe, it, expect } from 'vitest';
import { buildSweepMessages, shouldRunSweep, type OpenVisit } from './checkout-sweep';
import type { OfficeStatus } from './office-hours';

function visit(overrides: Partial<OpenVisit> = {}): OpenVisit {
  return {
    id: 'v1',
    first_name: 'Ama',
    last_name: 'Mensah',
    badge_code: 'SG-001',
    host_name: 'Kofi Boateng',
    check_in_at: '2026-07-19T09:00:00Z',
    ...overrides,
  };
}

function status(reason: OfficeStatus['reason']): OfficeStatus {
  return {
    open: reason === 'open',
    reason,
    holiday_name: reason === 'holiday' ? 'Founders Day' : null,
    work_start: '08:00',
    work_end: '17:00',
    date: '2026-07-19',
    weekday: 0,
    server_time: '2026-07-19T17:15:00.000Z',
  };
}

describe('buildSweepMessages', () => {
  it('returns null for zero open visits (silence means clean)', () => {
    expect(buildSweepMessages([])).toBeNull();
  });

  it('uses singular copy for one visit and lists name + badge', () => {
    const m = buildSweepMessages([visit()]);
    expect(m).not.toBeNull();
    expect(m!.title).toBe('1 visitor still in building');
    expect(m!.telegram).toContain('<b>1</b> visitor is still marked in building:');
    expect(m!.telegram).toContain('<b>Ama Mensah</b> — <code>SG-001</code>');
    expect(m!.telegram).toContain('Open the dashboard to check them out.');
    expect(m!.body).toContain('Ama Mensah — SG-001');
    expect(m!.body).toContain('Open the dashboard to check them out.');
  });

  it('omits the badge segment when the visit has no badge', () => {
    const m = buildSweepMessages([visit({ badge_code: null })])!;
    expect(m.telegram).toContain('<b>Ama Mensah</b>');
    expect(m.telegram).not.toContain('<code>');
  });

  it('lists at most 10 visits and summarizes the remainder', () => {
    const visits = Array.from({ length: 13 }, (_, i) =>
      visit({ id: `v${i + 1}`, first_name: `Visitor${String(i + 1).padStart(2, '0')}` }),
    );
    const m = buildSweepMessages(visits)!;
    expect(m.title).toBe('13 visitors still in building');
    expect(m.telegram).toContain('Visitor10');      // 10th is listed
    expect(m.telegram).not.toContain('Visitor11');  // 11th+ folded away
    expect(m.telegram).toContain('…and 3 more');
    expect(m.body).toContain('…and 3 more');
  });

  it('HTML-escapes visitor fields in the Telegram message', () => {
    const m = buildSweepMessages([
      visit({ first_name: '<b>Ama</b>', last_name: 'M & A', badge_code: 'SG<x>' }),
    ])!;
    expect(m.telegram).toContain('&lt;b&gt;Ama&lt;/b&gt;');
    expect(m.telegram).toContain('M &amp; A');
    expect(m.telegram).toContain('SG&lt;x&gt;');
    expect(m.telegram).not.toContain('<b>Ama</b> —');
  });
});

describe('shouldRunSweep', () => {
  it('skips on weekends and holidays', () => {
    expect(shouldRunSweep(status('weekend'))).toBe(false);
    expect(shouldRunSweep(status('holiday'))).toBe(false);
  });

  it('runs when open, before hours, and after hours (the 17:15 case)', () => {
    expect(shouldRunSweep(status('open'))).toBe(true);
    expect(shouldRunSweep(status('before_hours'))).toBe(true);
    expect(shouldRunSweep(status('after_hours'))).toBe(true);
  });
});
