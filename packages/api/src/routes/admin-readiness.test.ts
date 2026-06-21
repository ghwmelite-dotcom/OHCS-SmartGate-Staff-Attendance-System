import { describe, it, expect } from 'vitest';
import { buildReadinessChecks } from './admin-readiness';

// A fully-ready baseline; individual tests override single fields.
const READY = {
  superadmins: 1,
  directorates_active: 12,
  dir_no_reception: 0,
  officers_total: 40,
  officers_no_tg: 0,
  staff_users: 200,
  visits_total: 0,
  clock_total: 0,
  holidays_upcoming: 5,
  reauth: 1,
  liveness: 1,
  override_pin_set: 1,
  backup_key_set: 1,
};

function check(counts: typeof READY, key: string) {
  return buildReadinessChecks(counts).find((c) => c.key === key)!;
}

describe('buildReadinessChecks', () => {
  it('a fully-configured office has no warnings', () => {
    const checks = buildReadinessChecks(READY);
    expect(checks.some((c) => c.status === 'warn')).toBe(false);
  });

  it('warns when no superadmin exists', () => {
    expect(check({ ...READY, superadmins: 0 }, 'superadmins').status).toBe('warn');
  });

  it('warns when the reception override PIN is not set', () => {
    expect(check({ ...READY, override_pin_set: 0 }, 'reception_override_pin').status).toBe('warn');
  });

  it('warns when an active directorate has no reception team', () => {
    const c = check({ ...READY, dir_no_reception: 3 }, 'reception_teams');
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('3');
  });

  it('warns when no upcoming holidays are configured', () => {
    expect(check({ ...READY, holidays_upcoming: 0 }, 'holidays').status).toBe('warn');
  });

  it('warns when the backup encryption key is not set', () => {
    const c = check({ ...READY, backup_key_set: 0 }, 'backup_encryption');
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('plaintext');
    expect(check(READY, 'backup_encryption').status).toBe('ok');
  });

  it('flags lingering test activity as info with the counts', () => {
    const c = check({ ...READY, visits_total: 7, clock_total: 12 }, 'test_activity');
    expect(c.status).toBe('info');
    expect(c.detail).toContain('7 visits');
    expect(c.detail).toContain('12 clock records');
  });

  it('reports enforcement mode (shadow vs enforced) as info', () => {
    const shadow = check({ ...READY, reauth: 0, liveness: 0 }, 'clockin_enforcement');
    expect(shadow.status).toBe('info');
    expect(shadow.detail).toContain('Re-auth: shadow');
    expect(shadow.detail).toContain('Liveness: shadow');
    const enforced = check(READY, 'clockin_enforcement');
    expect(enforced.detail).toContain('Re-auth: ENFORCED');
  });

  it('officer Telegram gap is informational, not a blocker', () => {
    const c = check({ ...READY, officers_no_tg: 5 }, 'officer_telegram');
    expect(c.status).toBe('info');
    expect(c.detail).toContain('5');
  });
});
