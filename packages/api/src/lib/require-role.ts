import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { error } from './response';

export type Role =
  | 'superadmin'
  | 'admin'
  | 'receptionist'
  | 'it'
  | 'director'
  | 'staff';

// RCU reception parity (plan: docs/superpowers/plans/2026-08-03-role-display-appointments-rcu.md):
// staff posted to the RCU directorate act at reception tier. Org data is
// stable, so the abbreviation is a documented constant here — mirrored
// client-side in web/src/lib/roles.ts.
export const RCU_DIRECTORATE_ABBR = 'RCU';

/**
 * Effective-tier check: `session.role` itself is NOT rewritten (identity stays
 * honest in audit trails) — only the gate consults this rule. A role of
 * 'staff' with directorate_abbr 'RCU' satisfies 'receptionist'.
 */
export function hasEffectiveRole(session: SessionData, role: Role): boolean {
  if (session.role === role) return true;
  return (
    role === 'receptionist' &&
    session.role === 'staff' &&
    session.directorate_abbr === RCU_DIRECTORATE_ABBR
  );
}

export function requireRole(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>,
  ...roles: Role[]
): Response | null {
  const session = c.get('session');
  if (!roles.some((role) => hasEffectiveRole(session, role))) {
    return error(c, 'FORBIDDEN', 'You do not have access to this resource', 403);
  }
  return null;
}
