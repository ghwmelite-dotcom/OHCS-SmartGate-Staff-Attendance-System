export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ENVIRONMENT: string;
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
  // Dev/staging only — accept any webauthn_assertion at clock-in for testing.
  // Production refuses to start with this set to "true".
  DEV_BYPASS_REAUTH?: string;
}

export type Role =
  | 'superadmin'
  | 'admin'
  | 'receptionist'
  | 'it'
  | 'director'
  | 'staff';

export type UserType = 'staff' | 'nss';

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  name: string;
}

/**
 * Shared user shape used across routes/services.
 * NSS fields are populated only when `user_type === 'nss'`.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  role: Role;
  grade: string | null;
  is_active: 0 | 1;
  directorate_id: string | null;
  user_type: UserType;
  nss_number: string | null;
  nss_start_date: string | null;
  nss_end_date: string | null;
  created_at: string;
  updated_at: string;
}
