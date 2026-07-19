import { describe, it, expect } from 'vitest';
import {
  WELCOME_STEPS,
  MIN_AUTO_OPEN_STEPS,
  stepsForRole,
  wizardSeenKey,
  hasSeenWizard,
  markWizardSeen,
  shouldAutoOpenWizard,
  type WizardStorage,
} from './welcome-wizard';

function fakeStorage(): WizardStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  };
}

describe('stepsForRole', () => {
  it('gives admin and superadmin every step', () => {
    const all = WELCOME_STEPS.map((s) => s.id);
    expect(stepsForRole('superadmin').map((s) => s.id)).toEqual(all);
    expect(stepsForRole('admin').map((s) => s.id)).toEqual(all);
  });

  it('keeps kiosk/watchlist but drops reports for receptionist', () => {
    const ids = stepsForRole('receptionist').map((s) => s.id);
    expect(ids).toContain('check-in');
    expect(ids).toContain('watchlist');
    expect(ids).not.toContain('reports');
  });

  it('keeps reports but drops kiosk/watchlist for director', () => {
    const ids = stepsForRole('director').map((s) => s.id);
    expect(ids).toContain('reports');
    expect(ids).not.toContain('check-in');
    expect(ids).not.toContain('watchlist');
  });

  it('gives staff, it and unknown roles only the all-role steps', () => {
    const allRole = ['welcome', 'dashboard', 'appointments', 'telegram', 'done'];
    expect(stepsForRole('staff').map((s) => s.id)).toEqual(allRole);
    expect(stepsForRole('it').map((s) => s.id)).toEqual(allRole);
    expect(stepsForRole('unknown-role').map((s) => s.id)).toEqual(allRole);
  });

  it('treats a missing role like an unknown role', () => {
    const allRole = ['welcome', 'dashboard', 'appointments', 'telegram', 'done'];
    expect(stepsForRole(null).map((s) => s.id)).toEqual(allRole);
    expect(stepsForRole(undefined).map((s) => s.id)).toEqual(allRole);
  });

  it('preserves the declared step order for every role', () => {
    const all = WELCOME_STEPS.map((s) => s.id);
    for (const role of ['superadmin', 'receptionist', 'director', 'staff']) {
      const filtered = stepsForRole(role).map((s) => s.id);
      expect(filtered).toEqual(all.filter((id) => filtered.includes(id)));
    }
  });
});

describe('seen-key helpers', () => {
  it('builds the per-device per-user key', () => {
    expect(wizardSeenKey('u123')).toBe('ohcs.vms.wizard.v1.seen:u123');
  });

  it('reads unseen by default and seen after marking', () => {
    const storage = fakeStorage();
    expect(hasSeenWizard('u1', storage)).toBe(false);
    markWizardSeen('u1', storage);
    expect(hasSeenWizard('u1', storage)).toBe(true);
    expect(storage.data.get('ohcs.vms.wizard.v1.seen:u1')).toBe('1');
  });

  it('scopes the seen flag per user', () => {
    const storage = fakeStorage();
    markWizardSeen('u1', storage);
    expect(hasSeenWizard('u2', storage)).toBe(false);
  });

  it('survives a throwing storage', () => {
    const throwing: WizardStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(hasSeenWizard('u1', throwing)).toBe(false);
    expect(() => markWizardSeen('u1', throwing)).not.toThrow();
  });

  it('survives a null storage', () => {
    expect(hasSeenWizard('u1', null)).toBe(false);
    expect(() => markWizardSeen('u1', null)).not.toThrow();
  });
});

describe('shouldAutoOpenWizard', () => {
  it('opens when unseen with enough steps', () => {
    expect(shouldAutoOpenWizard(stepsForRole('staff'), false)).toBe(true);
    expect(shouldAutoOpenWizard(stepsForRole('superadmin'), false)).toBe(true);
  });

  it('does not open once seen', () => {
    expect(shouldAutoOpenWizard(stepsForRole('superadmin'), true)).toBe(false);
  });

  it('does not open when filtering leaves too few steps', () => {
    expect(shouldAutoOpenWizard([], false)).toBe(false);
    expect(shouldAutoOpenWizard([WELCOME_STEPS[0]], false)).toBe(false);
    expect(shouldAutoOpenWizard(Array(MIN_AUTO_OPEN_STEPS).fill(WELCOME_STEPS[0]), false)).toBe(true);
  });
});
