import { describe, it, expect } from 'vitest';
import { requireRole } from './require-role';

// Minimal Hono context mock: requireRole only uses c.get('session') and c.json().
type Ctx = Parameters<typeof requireRole>[0];
function mockCtx(role: string): Ctx {
  return {
    get: (key: string) => (key === 'session' ? { role } : undefined),
    json: (body: unknown, status = 200) => ({ body, status }),
  } as unknown as Ctx;
}

describe('requireRole', () => {
  it('admits the hr role when allowed (visitor-read style allowlist)', () => {
    expect(requireRole(mockCtx('hr'), 'superadmin', 'admin', 'receptionist', 'director', 'hr')).toBeNull();
  });

  it('admits hr on an NSS-style allowlist', () => {
    expect(requireRole(mockCtx('hr'), 'superadmin', 'hr')).toBeNull();
  });

  it('rejects a non-allowed role with 403 FORBIDDEN', () => {
    const blocked = requireRole(mockCtx('staff'), 'superadmin', 'hr') as unknown as
      { body: { error: { code: string } }; status: number } | null;
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
    expect(blocked!.body.error.code).toBe('FORBIDDEN');
  });
});
