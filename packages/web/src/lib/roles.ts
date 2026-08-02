// Display-tier role labels. `display_role` rides on top of the access role
// ('client_service' ⇒ role='receptionist' under the hood — reception parity)
// and only re-labels the UI; access checks always use `role`.
export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  receptionist: 'Receptionist',
  it: 'IT Support',
  director: 'Director',
  staff: 'Staff',
  client_service: 'Client Service',
};

export function roleLabel(role: string | null | undefined, displayRole?: string | null): string {
  const key = displayRole || role || '';
  return ROLE_LABELS[key] ?? key;
}

// Module-level access gates — mirror the API's requireRole lists so the nav
// never offers a page the API would 403, and role-limited affordances (e.g.
// register-new-visitor on Check-In) hide for roles the mutation would reject.
export const MODULE_ROLES = {
  /** /analytics — analytics.ts requireRole('superadmin','admin','director') */
  analytics: ['superadmin', 'admin', 'director'],
  /** /reports — reports.ts requireRole(+'receptionist') */
  reports: ['superadmin', 'admin', 'director', 'receptionist'],
  /** Check-In, Visitors, Visit Log — visits/visitors/officers GETs */
  visits: ['superadmin', 'admin', 'receptionist', 'director', 'it'],
  /** Register new visitor — POST /visitors + visitor photo upload */
  visitorRegistration: ['superadmin', 'admin', 'receptionist'],
} as const;

export function hasRoleAccess(role: string | null | undefined, allowed: readonly string[]): boolean {
  return role != null && allowed.includes(role);
}
