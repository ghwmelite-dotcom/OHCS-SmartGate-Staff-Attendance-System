import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { purgeExpiredVisitorPhotos } from '../services/photo-purge';
import { exportBackupToR2, verifyLatestBackup, loadBackupSnapshot, BACKUP_TABLES } from '../services/backup';
import { buildRestorePlan, type ColumnMap } from '../services/restore';
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

// Read-only — latest backup's date, per-table row counts, and whether it's
// readable + restorable (decrypts + parses). Powers the Settings "last backup"
// line so backups can be trusted without waiting for the verify cron to alert.
adminMaintenanceRoutes.get('/backup-status', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  return success(c, await verifyLatestBackup(c.env));
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

// Read-only impact preview: exactly what the wipe WOULD delete vs. keep, computed
// against live data WITHOUT changing anything. Lets a superadmin verify scope on
// real data (they can't run the destructive action just to "check"). One round
// trip. Bind order: keep,keep (users_deleted), keep,keep (webauthn_deleted),
// keep,keep (users_kept) — 6 binds. Exported so its test shares the source.
export const GO_LIVE_RESET_PREVIEW_SQL = `
  SELECT
    (SELECT COUNT(*) FROM officers)                              AS officers,
    (SELECT COUNT(*) FROM directorate_receivers)                 AS reception_links,
    (SELECT COUNT(*) FROM visits)                                AS visits,
    (SELECT COUNT(*) FROM visitors)                              AS visitors,
    (SELECT COUNT(*) FROM clock_records)                         AS clock_records,
    (SELECT COUNT(*) FROM notifications)                         AS notifications,
    (SELECT COUNT(*) FROM push_subscriptions)                    AS push_subscriptions,
    (SELECT COUNT(*) FROM leave_requests)                        AS leave_requests,
    (SELECT COUNT(*) FROM absence_notices)                       AS absence_notices,
    (SELECT COUNT(*) FROM audit_log)                             AS audit_entries,
    (SELECT COUNT(*) FROM users WHERE id NOT IN (?, ?))          AS users_deleted,
    (SELECT COUNT(*) FROM webauthn_credentials WHERE user_id NOT IN (?, ?)) AS webauthn_deleted,
    (SELECT COUNT(*) FROM users WHERE id IN (?, ?))              AS users_kept,
    (SELECT COUNT(*) FROM directorates)                          AS directorates_kept,
    (SELECT COUNT(*) FROM visit_categories)                      AS categories_kept,
    (SELECT COUNT(*) FROM holidays)                              AS holidays_kept
`;

// Read-only — safe to call anytime. Returns the counts the destructive endpoint
// WOULD act on, so the impact can be reviewed before arming the reset.
adminMaintenanceRoutes.get('/go-live-reset/preview', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const session = c.get('session');
  const k = session.userId;
  const counts = await c.env.DB.prepare(GO_LIVE_RESET_PREVIEW_SQL)
    .bind(k, KIOSK_USER_ID, k, KIOSK_USER_ID, k, KIOSK_USER_ID)
    .first<Record<string, number>>();
  return success(c, counts);
});

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

// ---------------------------------------------------------------------------
// Restore from backup (superadmin) — replace ALL live data with a chosen R2
// snapshot. Disaster recovery / undo a mistaken go-live reset. Backs up the
// CURRENT state first (so a restore is itself reversible), then atomically
// wipes + re-inserts the snapshot FK-safely. notifications + push subscriptions
// are NOT in backups and are cleared (transient). visit_categories + passkeys
// ARE restored. Spec: docs/superpowers/specs/2026-06-21-backup-safety-design.md
// ---------------------------------------------------------------------------
const RESTORE_PHRASE = 'RESTORE';
const restoreSchema = z.object({
  confirm: z.literal(RESTORE_PHRASE),
  pin: z.string().min(4).max(12),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Live-schema column names per backed-up table (PRAGMA table_info). Lets the
// plan drop columns a snapshot has but the current schema doesn't (and rely on
// defaults for new ones). Table names come from the fixed BACKUP_TABLES list.
async function liveColumnMap(env: Env): Promise<ColumnMap> {
  const map: ColumnMap = {};
  for (const t of BACKUP_TABLES) {
    const r = await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>();
    map[t] = (r.results ?? []).map((row) => row.name);
  }
  return map;
}

adminMaintenanceRoutes.post('/restore', zValidator('json', restoreSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const session = c.get('session');
  const { pin, date } = c.req.valid('json');

  // Re-auth (same as reset): verify the acting superadmin's own PIN.
  const me = await c.env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ pin_hash: string | null }>();
  if (!me?.pin_hash || !(await verifyPin(pin, me.pin_hash))) {
    return error(c, 'REAUTH_FAILED', 'PIN verification failed.', 401);
  }

  // Load the chosen snapshot (decrypts). 404 if that date has no backup.
  let snapshot;
  try {
    snapshot = await loadBackupSnapshot(c.env, date);
  } catch (err) {
    return error(c, 'RESTORE_READ_FAILED', 'Could not read/decrypt that backup.', 500, {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (!snapshot) return error(c, 'BACKUP_NOT_FOUND', `No backup found for ${date}.`, 404);

  // Back up the CURRENT state first so the restore is itself reversible.
  let safetyBackup;
  try {
    safetyBackup = await exportBackupToR2(c.env);
  } catch (err) {
    return error(c, 'BACKUP_FAILED', 'Pre-restore backup failed — restore aborted. No data changed.', 500, {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Build + run the FK-safe wipe+reinsert as one atomic batch.
  const columns = await liveColumnMap(c.env);
  const plan = buildRestorePlan(snapshot, columns);
  await c.env.DB.batch(plan.map((s) => c.env.DB.prepare(s.sql).bind(...s.binds)));

  const restored = Object.fromEntries(Object.entries(snapshot).map(([t, rows]) => [t, rows.length]));

  await recordAudit(c.env, auditActorFromContext(c), {
    action: 'system.restore',
    entityType: 'system',
    entityId: date,
    summary:
      `Restored from backup ${date} (current state first backed up at ${safetyBackup.date}). ` +
      `Replaced all live data; notifications + push subscriptions cleared (not in backups).`,
  });

  return success(c, { ok: true, date, safetyBackup, restored });
});
