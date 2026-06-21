import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { purgeExpiredVisitorPhotos } from '../services/photo-purge';
import { exportBackupToR2 } from '../services/backup';
import { verifyPin } from '../services/auth';
import { recordAudit, auditActorFromContext } from '../services/audit';

export const adminMaintenanceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// The system kiosk user is preserved across a go-live reset (it's the author of
// kiosk-sourced check-ins, not a demo account). Keep in sync with seed.sql.
const KIOSK_USER_ID = 'user_kiosk';

// Typed phrase the superadmin must enter, exactly, to authorise the wipe.
const RESET_PHRASE = 'RESET';

// Manual trigger (superadmin) — runs the visitor photo purge on demand and returns
// the counts, so the result can be verified before trusting the daily cron.
adminMaintenanceRoutes.post('/purge-photos', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const result = await purgeExpiredVisitorPhotos(c.env);
  return success(c, result);
});

// Manual trigger (superadmin) — runs the D1 -> R2 table backup on demand and
// returns the per-table row counts + pruned count, so backups can be verified
// without waiting for the daily cron.
adminMaintenanceRoutes.post('/run-backup', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const result = await exportBackupToR2(c.env);
  return success(c, result);
});

// ---------------------------------------------------------------------------
// Go-live reset (superadmin) — one-time clean-slate before the office goes live.
// Deletes the demo directory (officers + reception teams) and ALL test activity
// (visits, visitors, clock records, notifications, leave/absence, push subs,
// webauthn creds, audit log), keeping ONLY the real org config (directorates,
// visit categories, holidays, app settings), the acting superadmin's own login,
// and the system kiosk user. Irreversible — always takes an R2 backup first.
// Spec: docs/superpowers/specs/2026-06-21-go-live-reset-design.md
// ---------------------------------------------------------------------------
const goLiveResetSchema = z.object({
  confirm: z.literal(RESET_PHRASE),
  pin: z.string().min(4).max(12),
});

// The exact, ordered wipe. FK-safe (children before parents) with the circular
// officer references and the user self-reference nulled first. Exported so the
// integration test exercises the REAL statements (no copy/paste drift) — see
// go-live-reset.test.ts. `bindsKeep` statements take the two preserved user ids
// (acting superadmin, kiosk) so those rows survive.
export const GO_LIVE_RESET_STATEMENTS: { sql: string; bindsKeep?: boolean }[] = [
  { sql: 'UPDATE directorates SET reception_officer_id = NULL, head_officer_id = NULL' },
  { sql: 'UPDATE users SET supervisor_user_id = NULL' },
  { sql: 'DELETE FROM notifications' },
  { sql: 'DELETE FROM push_subscriptions' },
  { sql: 'DELETE FROM webauthn_credentials WHERE user_id NOT IN (?, ?)', bindsKeep: true },
  { sql: 'DELETE FROM leave_requests' },
  { sql: 'DELETE FROM absence_notices' },
  { sql: 'DELETE FROM clock_records' },
  { sql: 'DELETE FROM visits' },
  { sql: 'DELETE FROM visitors' },
  { sql: 'DELETE FROM directorate_receivers' },
  { sql: 'DELETE FROM officers' },
  { sql: 'DELETE FROM users WHERE id NOT IN (?, ?)', bindsKeep: true },
  { sql: 'DELETE FROM audit_log' },
];

adminMaintenanceRoutes.post('/go-live-reset', zValidator('json', goLiveResetSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const session = c.get('session');
  const { pin } = c.req.valid('json');

  // Re-authenticate: the acting superadmin must re-enter their own PIN. Never
  // reveal whether the failure was a missing hash vs. a wrong PIN.
  const me = await c.env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ pin_hash: string | null }>();
  if (!me?.pin_hash || !(await verifyPin(pin, me.pin_hash))) {
    return error(c, 'REAUTH_FAILED', 'PIN verification failed.', 401);
  }

  // Always back up first. If the backup fails, ABORT — never wipe without a
  // restore point. exportBackupToR2 itself is resilient per-table; a thrown
  // error here means the whole export couldn't run.
  let backup;
  try {
    backup = await exportBackupToR2(c.env);
  } catch (err) {
    return error(
      c,
      'BACKUP_FAILED',
      'Backup failed — reset aborted. No data was deleted.',
      500,
      { detail: err instanceof Error ? err.message : String(err) },
    );
  }

  // FK-safe, atomic wipe (D1 runs a batch in one implicit transaction; any
  // failure rolls the whole thing back). Order: null the circular / text-only
  // officer references first, null the user self-reference, then delete
  // children before parents. webauthn_credentials are deleted explicitly for
  // the removed users (they'd also cascade) so the kept users keep theirs.
  const keep: [string, string] = [session.userId, KIOSK_USER_ID];
  await c.env.DB.batch(
    GO_LIVE_RESET_STATEMENTS.map((s) =>
      s.bindsKeep
        ? c.env.DB.prepare(s.sql).bind(keep[0], keep[1])
        : c.env.DB.prepare(s.sql),
    ),
  );

  // New audit genesis (the chain was just wiped): record who reset, when, and
  // the backup that was taken, so the clean slate starts with a traceable entry.
  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'system.go_live_reset',
    entityType: 'system',
    entityId: null,
    summary:
      `Go-live reset: cleared demo officers, reception teams, all non-system users, ` +
      `and all test activity. Kept directorates, visit categories, holidays, settings, ` +
      `this superadmin, and the kiosk user. Backup taken at ${backup.date}.`,
  });

  return success(c, { ok: true, backup });
});
