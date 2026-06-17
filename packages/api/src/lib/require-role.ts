import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { error } from './response';

export type Role =
  | 'superadmin'
  | 'admin'
  | 'receptionist'
  | 'it'
  | 'director'
  | 'staff'
  | 'f_and_a_admin'
  | 'visitor';

export function requireRole(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>,
  ...roles: Role[]
): Response | null {
  const session = c.get('session');
  if (!roles.includes(session.role as Role)) {
    return error(c, 'FORBIDDEN', 'You do not have access to this resource', 403);
  }
  return null;
}
