import { describe, it, expect } from 'vitest';
import { requireRole } from './require-role';

type Ctx = Parameters<typeof requireRole>[0];
function mockCtx(role: string, directorate_abbr: string | null = null): Ctx {
  return {
    get: (key: string) => (key === 'session' ? { role, directorate_abbr } : undefined),
    json: (body: unknown, status = 200) => ({ body, status }),
  } as unknown as Ctx;
}

type Blocked = { body: { error: { code: string } }; status: number } | null;

describe('requireRole', () => {
  it('admits admin on the visitor-record allowlist', () => {
    expect(requireRole(mockCtx('admin'), 'superadmin', 'admin', 'receptionist', 'director', 'it')).toBeNull();
  });

  it('admits it (IT) on the visitor-record allowlist', () => {
    expect(requireRole(mockCtx('it'), 'superadmin', 'admin', 'receptionist', 'director', 'it')).toBeNull();
  });

  it('admits admin on the NSS-admin allowlist', () => {
    expect(requireRole(mockCtx('admin'), 'superadmin', 'admin')).toBeNull();
  });

  it('rejects a non-allowed role with 403 FORBIDDEN', () => {
    const blocked = requireRole(mockCtx('staff'), 'superadmin', 'admin') as unknown as
      { body: { error: { code: string } }; status: number } | null;
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
    expect(blocked!.body.error.code).toBe('FORBIDDEN');
  });
});

describe('requireRole — RCU reception parity (effective tier)', () => {
  // Plan: docs/superpowers/plans/2026-08-03-role-display-appointments-rcu.md.
  // role 'staff' + directorate_abbr 'RCU' satisfies any role list containing
  // 'receptionist' — WITHOUT rewriting session.role (identity stays honest).

  it('admits RCU staff on a receptionist-containing gate', () => {
    expect(requireRole(mockCtx('staff', 'RCU'), 'superadmin', 'admin', 'receptionist')).toBeNull();
  });

  it('admits RCU staff on a receptionist-only gate', () => {
    expect(requireRole(mockCtx('staff', 'RCU'), 'receptionist')).toBeNull();
  });

  it('rejects RCU staff on a superadmin gate (parity is reception tier only)', () => {
    const blocked = requireRole(mockCtx('staff', 'RCU'), 'superadmin', 'admin') as unknown as Blocked;
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
    expect(blocked!.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects non-RCU staff on both reception and superadmin gates', () => {
    for (const abbr of ['RSIMD', null]) {
      const reception = requireRole(mockCtx('staff', abbr), 'superadmin', 'admin', 'receptionist') as unknown as Blocked;
      expect(reception).not.toBeNull();
      expect(reception!.status).toBe(403);
      const superGate = requireRole(mockCtx('staff', abbr), 'superadmin') as unknown as Blocked;
      expect(superGate).not.toBeNull();
      expect(superGate!.status).toBe(403);
    }
  });

  it('leaves real receptionist and superadmin untouched', () => {
    expect(requireRole(mockCtx('receptionist'), 'superadmin', 'admin', 'receptionist')).toBeNull();
    expect(requireRole(mockCtx('superadmin'), 'superadmin')).toBeNull();
    // A real receptionist still fails a superadmin gate.
    const blocked = requireRole(mockCtx('receptionist'), 'superadmin') as unknown as Blocked;
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
  });
});
