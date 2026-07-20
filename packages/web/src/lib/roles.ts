// Display-tier role labels. `display_role` rides on top of the access role
// ('client_service' ⇒ role='admin' under the hood — admin parity) and only
// re-labels the UI; access checks always use `role`.
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
