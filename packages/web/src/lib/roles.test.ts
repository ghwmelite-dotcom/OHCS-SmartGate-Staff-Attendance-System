import { describe, it, expect } from 'vitest';
import { roleLabel } from './roles';

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
