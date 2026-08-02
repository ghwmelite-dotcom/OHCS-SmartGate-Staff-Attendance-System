// Display-tier role labels. `display_role` rides on top of the access role
// ('client_service' ⇒ role='receptionist' under the hood — reception parity;
// 'chief_director'/'head_of_service' ⇒ role='director' — org-wide oversight)
// and only re-labels the UI; access checks always use `role`.
export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  receptionist: 'Receptionist',
  it: 'IT Support',
  director: 'Director',
  staff: 'Staff',
  client_service: 'Client Service',
  chief_director: 'Chief Director',
  head_of_service: 'Head of Service',
};

// Badge classes per display/access role — Client Service violet, CD gold,
// HoS emerald (distinct from each other and from the access-role colors).
export const ROLE_BADGES: Record<string, string> = {
  client_service: 'bg-service/10 text-service',
  chief_director: 'bg-accent/15 text-accent-warm',
  head_of_service: 'bg-primary/10 text-primary',
};

export function roleBadge(role: string | null | undefined, displayRole?: string | null): string {
  const key = displayRole || role || '';
  return ROLE_BADGES[key] ?? 'bg-foreground/5 text-muted';
}

// Oversight display roles (spec 2026-08-02-oversight-roles-cd-hos-design):
// users with either display_role get the org-wide Overview home instead of
// the reception Dashboard. Base access role stays 'director'.
export const OVERSIGHT_DISPLAY_ROLES = ['chief_director', 'head_of_service'] as const;

export function isOversightUser(role: string | null | undefined, displayRole?: string | null): boolean {
  return role === 'director' || (displayRole != null && (OVERSIGHT_DISPLAY_ROLES as readonly string[]).includes(displayRole));
}

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
  /** /appointments — GET /appointments/admin: oversight module (product decision 2026-08-03) — admin tier + director (force-scoped) + CD/HoS (org-wide). NOT reception-tier; RCU parity does not grant it */
  appointments: ['superadmin', 'admin', 'director'],
  /** /feedback — surveys.ts SURVEY_ROLES: superadmin/admin/receptionist (RCU parity grants it) */
  feedback: ['superadmin', 'admin', 'receptionist'],
} as const;

// RCU reception parity (plan 2026-08-03-role-display-appointments-rcu) — client
// mirror of the server's require-role rule: a user whose access role is 'staff'
// but whose directorate abbreviation is RCU is treated as receptionist-tier for
// module gating. The stored role is never rewritten — only the gate consults
// the rule. Org data is stable, so the abbreviation is a documented constant
// here and on the API side; the match is exact (case-sensitive), as on the server.
export const RCU_DIRECTORATE_ABBR = 'RCU';

export function hasRoleAccess(
  role: string | null | undefined,
  allowed: readonly string[],
  directorateAbbr?: string | null,
): boolean {
  const effective = role === 'staff' && directorateAbbr === RCU_DIRECTORATE_ABBR ? 'receptionist' : role;
  return effective != null && allowed.includes(effective);
}
