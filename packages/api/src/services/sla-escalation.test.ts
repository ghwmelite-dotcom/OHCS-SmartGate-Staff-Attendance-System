import { describe, it, expect } from 'vitest';
import { buildSlaMessage, type SlaBreach } from './sla-escalation';

function breach(overrides: Partial<SlaBreach> = {}): SlaBreach {
  return {
    id: 'v1',
    first_name: 'Ama',
    last_name: 'Mensah',
    badge_code: 'SG-001',
    host_name: 'Kofi Boateng',
    directorate_id: 'd1',
    directorate_abbr: 'HRD',
    check_in_at: '2026-07-19T09:00:00Z',
    wait_minutes: 45,
    ...overrides,
  };
}

describe('buildSlaMessage', () => {
  it('returns null for zero breaches (silence means clean)', () => {
    expect(buildSlaMessage([])).toBeNull();
  });

  it('uses singular copy for one breach and lists name, badge, wait and host', () => {
    const m = buildSlaMessage([breach()]);
    expect(m).not.toBeNull();
    expect(m!.title).toBe('1 visitor waiting 30+ min');
    expect(m!.telegram).toContain('<b>1</b> visitor has waited 30+ min with no host response:');
    expect(m!.telegram).toContain('<b>Ama Mensah</b> — <code>SG-001</code>');
    expect(m!.telegram).toContain('waiting <b>45m</b> (host: Kofi Boateng) [HRD]');
    expect(m!.telegram).toContain('Open the dashboard to follow up.');
    expect(m!.body).toContain('Ama Mensah — SG-001 · waiting 45m (host: Kofi Boateng)');
    expect(m!.body).toContain('Open the dashboard to follow up.');
  });

  it('omits the badge, host and directorate segments when absent', () => {
    const m = buildSlaMessage([breach({ badge_code: null, host_name: null, directorate_abbr: null })])!;
    expect(m.telegram).toContain('<b>Ama Mensah</b>');
    expect(m.telegram).toContain('waiting <b>45m</b>');
    expect(m.telegram).not.toContain('<code>');
    expect(m.telegram).not.toContain('(host:');
    expect(m.telegram).not.toContain('[HRD]');
  });

  it('lists at most 10 breaches and summarizes the remainder', () => {
    const breaches = Array.from({ length: 13 }, (_, i) =>
      breach({ id: `v${i + 1}`, first_name: `Visitor${String(i + 1).padStart(2, '0')}` }),
    );
    const m = buildSlaMessage(breaches)!;
    expect(m.title).toBe('13 visitors waiting 30+ min');
    expect(m.telegram).toContain('Visitor10');      // 10th is listed
    expect(m.telegram).not.toContain('Visitor11');  // 11th+ folded away
    expect(m.telegram).toContain('…and 3 more');
    expect(m.body).toContain('…and 3 more');
  });

  it('HTML-escapes visitor fields in the Telegram message', () => {
    const m = buildSlaMessage([
      breach({ first_name: '<b>Ama</b>', last_name: 'M & A', badge_code: 'SG<x>', host_name: 'Kofi <script>', directorate_abbr: 'H&R' }),
    ])!;
    expect(m.telegram).toContain('&lt;b&gt;Ama&lt;/b&gt;');
    expect(m.telegram).toContain('M &amp; A');
    expect(m.telegram).toContain('SG&lt;x&gt;');
    expect(m.telegram).toContain('Kofi &lt;script&gt;');
    expect(m.telegram).toContain('H&amp;R');
    expect(m.telegram).not.toContain('<b>Ama</b> —');
  });
});
