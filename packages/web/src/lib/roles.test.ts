import { describe, it, expect } from 'vitest';
import { roleLabel, roleBadge, MODULE_ROLES, hasRoleAccess, OVERSIGHT_DISPLAY_ROLES, isOversightUser } from './roles';

describe('roleLabel', () => {
  it('maps the six access roles to their labels', () => {
    expect(roleLabel('superadmin')).toBe('Super Admin');
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('receptionist')).toBe('Receptionist');
    expect(roleLabel('it')).toBe('IT Support');
    expect(roleLabel('director')).toBe('Director');
    expect(roleLabel('staff')).toBe('Staff');
  });

  it('display_role wins when set (client_service over admin)', () => {
    expect(roleLabel('admin', 'client_service')).toBe('Client Service');
  });

  it('maps the oversight display roles (CD / HoS over director)', () => {
    expect(roleLabel('director', 'chief_director')).toBe('Chief Director');
    expect(roleLabel('director', 'head_of_service')).toBe('Head of Service');
  });

  it('falls back to the role label when display_role is null/empty', () => {
    expect(roleLabel('admin', null)).toBe('Admin');
    expect(roleLabel('admin', '')).toBe('Admin');
  });

  it('passes through unknown values and empty input', () => {
    expect(roleLabel('something_new')).toBe('something_new');
    expect(roleLabel(null)).toBe('');
    expect(roleLabel(undefined)).toBe('');
  });
});

describe('roleBadge', () => {
  it('CD and HoS badges are distinct from each other and from Client Service', () => {
    const cs = roleBadge('receptionist', 'client_service');
    const cd = roleBadge('director', 'chief_director');
    const hos = roleBadge('director', 'head_of_service');
    expect(cs).not.toBe(cd);
    expect(cd).not.toBe(hos);
    expect(cs).not.toBe(hos);
  });

  it('falls back to a neutral badge for unknown roles', () => {
    expect(roleBadge('something_new')).toBe('bg-foreground/5 text-muted');
    expect(roleBadge(null)).toBe('bg-foreground/5 text-muted');
  });
});

describe('OVERSIGHT_DISPLAY_ROLES / isOversightUser', () => {
  it('contains exactly the two oversight display roles', () => {
    expect(OVERSIGHT_DISPLAY_ROLES).toEqual(['chief_director', 'head_of_service']);
  });

  it('directors and CD/HoS get the oversight home; others do not', () => {
    expect(isOversightUser('director', null)).toBe(true);
    expect(isOversightUser('director', 'chief_director')).toBe(true);
    expect(isOversightUser('director', 'head_of_service')).toBe(true);
    expect(isOversightUser('admin', null)).toBe(false);
    expect(isOversightUser('receptionist', 'client_service')).toBe(false);
    expect(isOversightUser(null, null)).toBe(false);
  });
});

describe('MODULE_ROLES / hasRoleAccess', () => {
  it('analytics is superadmin/admin/director only (mirrors the API requireRole)', () => {
    expect(MODULE_ROLES.analytics).toEqual(['superadmin', 'admin', 'director']);
    expect(hasRoleAccess('director', MODULE_ROLES.analytics)).toBe(true);
    expect(hasRoleAccess('receptionist', MODULE_ROLES.analytics)).toBe(false);
    expect(hasRoleAccess('it', MODULE_ROLES.analytics)).toBe(false);
  });

  it('reports adds receptionist', () => {
    expect(MODULE_ROLES.reports).toEqual(['superadmin', 'admin', 'director', 'receptionist']);
    expect(hasRoleAccess('receptionist', MODULE_ROLES.reports)).toBe(true);
    expect(hasRoleAccess('it', MODULE_ROLES.reports)).toBe(false);
  });

  it('visits (check-in/visitors/visit log) is the five-role set', () => {
    expect(MODULE_ROLES.visits).toEqual(['superadmin', 'admin', 'receptionist', 'director', 'it']);
    expect(hasRoleAccess('it', MODULE_ROLES.visits)).toBe(true);
    expect(hasRoleAccess('staff', MODULE_ROLES.visits)).toBe(false);
  });

  it('visitor registration excludes director and it (POST /visitors would 403)', () => {
    expect(MODULE_ROLES.visitorRegistration).toEqual(['superadmin', 'admin', 'receptionist']);
    expect(hasRoleAccess('director', MODULE_ROLES.visitorRegistration)).toBe(false);
    expect(hasRoleAccess('it', MODULE_ROLES.visitorRegistration)).toBe(false);
  });

  it('null/undefined roles never have access', () => {
    expect(hasRoleAccess(null, MODULE_ROLES.visits)).toBe(false);
    expect(hasRoleAccess(undefined, MODULE_ROLES.analytics)).toBe(false);
  });
});
