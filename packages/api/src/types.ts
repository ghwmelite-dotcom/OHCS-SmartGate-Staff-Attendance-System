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
  // Transactional email (Resend) — welcome email on user creation. Email is
  // best-effort and skipped entirely when RESEND_API_KEY / EMAIL_FROM are unset.
  RESEND_API_KEY?: string;            // secret
  EMAIL_FROM?: string;                // e.g. "OHCS SmartGate <no-reply@ohcsghana.org>" — must be a Resend-verified sender
  STAFF_APP_URL?: string;             // staff attendance PWA base (default https://staff-attendance.ohcsghana.org)
  ADMIN_APP_URL?: string;             // admin/VMS portal base (default https://smartgate.ohcsghana.org)
  // Optional base64 (32-byte) AES-GCM key for at-rest encryption of D1→R2
  // backups. Unset → backups are written in plaintext (deploy-safe); legacy
  // plaintext backups remain restorable regardless. See services/backup-crypto.ts.
  BACKUP_ENCRYPTION_KEY?: string;     // secret
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
  // Session-revocation epoch captured at login. Optional so pre-existing sessions
  // (which lack it) read as 0 — matching the users.session_epoch default — and are
  // not force-logged-out on deploy. See middleware/auth.ts.
  epoch?: number;
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
  intern_code: string | null;
  institution: string | null;
  programme: string | null;
  supervisor_user_id: string | null;
  created_at: string;
  updated_at: string;
}
