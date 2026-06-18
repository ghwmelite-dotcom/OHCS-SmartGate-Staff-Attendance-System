import { describe, it, expect } from 'vitest';
import { requireRole } from './require-role';

type Ctx = Parameters<typeof requireRole>[0];
function mockCtx(role: string): Ctx {
  return {
    get: (key: string) => (key === 'session' ? { role } : undefined),
    json: (body: unknown, status = 200) => ({ body, status }),
  } as unknown as Ctx;
}

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
