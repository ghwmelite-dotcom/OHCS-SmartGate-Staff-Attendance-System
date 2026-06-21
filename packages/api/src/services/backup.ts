import type { Env } from '../types';
import { encryptText, decryptToText } from './backup-crypto';

/**
 * Daily D1 -> R2 table backup.
 *
 * Exports every row of a fixed allowlist of tables to JSON in R2 under
 * `backups/<YYYY-MM-DD>/<table>.json`, then prunes any backup older than
 * RETENTION_DAYS. Designed to run from the 02:00 UTC maintenance cron and
 * on-demand via POST /api/admin/maintenance/run-backup.
 *
 * Resilience by design:
 *   - The table list is a FIXED internal allowlist — table names are never
 *     accepted from user input, so interpolating them into SQL is safe.
 *   - Per-table export is wrapped in try/catch so one failing table can't
 *     abort the rest of the backup.
 *   - Logs report counts only — never any row data / PII.
 */

export interface BackupResult {
  date: string;
  tables: { name: string; rows: number }[];
  pruned: number;
}

// Fixed internal allowlist — verified against schema.sql. NOT user input.
// Includes visit_categories (config) + webauthn_credentials (passkey enrolments)
// so a restore recovers them; only transient notifications/push_subscriptions
// are intentionally excluded. See docs .../2026-06-21-backup-safety-design.md.
export const BACKUP_TABLES = [
  'users',
  'visitors',
  'visits',
  'clock_records',
  'officers',
  'directorates',
  'visit_categories',
  'webauthn_credentials',
  'app_settings',
  'leave_requests',
  'absence_notices',
  'directorate_receivers',
  'holidays',
  'audit_log',
] as const;

const RETENTION_DAYS = 30;
const BACKUP_PREFIX = 'backups/';
const DATE_KEY_RE = /^backups\/(\d{4}-\d{2}-\d{2})\//;

export async function exportBackupToR2(env: Env): Promise<BackupResult> {
  const date = new Date().toISOString().slice(0, 10);
  const tables: { name: string; rows: number }[] = [];
  const failed: string[] = [];

  if (!env.BACKUP_ENCRYPTION_KEY) {
    console.warn('[backup] BACKUP_ENCRYPTION_KEY not set — writing plaintext backup (PII at rest in R2).');
  }

  for (const t of BACKUP_TABLES) {
    try {
      // `t` is from the fixed BACKUP_TABLES allowlist — safe to interpolate.
      const rows = (await env.DB.prepare('SELECT * FROM ' + t).all()).results ?? [];
      const payload = await encryptText(JSON.stringify(rows), env.BACKUP_ENCRYPTION_KEY);
      await env.STORAGE.put(`${BACKUP_PREFIX}${date}/${t}.json`, payload);
      tables.push({ name: t, rows: rows.length });
    } catch (err) {
      failed.push(t);
      console.error(
        `[backup] table=${t} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const pruned = await pruneOldBackups(env);

  const result: BackupResult = { date, tables, pruned };

  console.log(
    `[backup] date=${date} tables_ok=${tables.length} failed=${failed.length} ` +
      `total_rows=${tables.reduce((s, t) => s + t.rows, 0)} pruned=${pruned}`,
  );

  return result;
}

export interface BackupVerification {
  date: string | null;
  ok: boolean;
  totalRows: number;
  tables: { name: string; rows: number; ok: boolean }[];
  missing: string[];
}

/**
 * Most recent backup date (YYYY-MM-DD) under `backups/`, or null if none.
 * Uses a delimited list so we read folder prefixes, not every object.
 */
export async function getLatestBackupDate(env: Env): Promise<string | null> {
  let latest: string | null = null;
  let cursor: string | undefined;
  do {
    const list = await env.STORAGE.list({ prefix: BACKUP_PREFIX, delimiter: '/', cursor });
    for (const p of list.delimitedPrefixes ?? []) {
      const m = /^backups\/(\d{4}-\d{2}-\d{2})\/$/.exec(p);
      if (m && (latest === null || m[1]! > latest)) latest = m[1]!;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return latest;
}

/**
 * "A backup you can't restore isn't a backup." Reads the latest backup's
 * objects, decrypts + parses each expected table, and reports per-table row
 * counts + an overall ok flag. ok === every expected table present and a valid
 * JSON array. Read-only. Run from the daily cron (alert on !ok) and exposed via
 * GET /api/admin/maintenance/backup-status.
 */
export async function verifyLatestBackup(env: Env): Promise<BackupVerification> {
  const date = await getLatestBackupDate(env);
  if (!date) return { date: null, ok: false, totalRows: 0, tables: [], missing: [...BACKUP_TABLES] };

  const tables: { name: string; rows: number; ok: boolean }[] = [];
  const missing: string[] = [];

  for (const t of BACKUP_TABLES) {
    const obj = await env.STORAGE.get(`${BACKUP_PREFIX}${date}/${t}.json`);
    if (!obj) { missing.push(t); continue; }
    try {
      const text = await decryptToText(await obj.text(), env.BACKUP_ENCRYPTION_KEY);
      const rows = JSON.parse(text);
      const okRow = Array.isArray(rows);
      tables.push({ name: t, rows: okRow ? rows.length : 0, ok: okRow });
    } catch {
      tables.push({ name: t, rows: 0, ok: false });
    }
  }

  const ok = missing.length === 0 && tables.every((t) => t.ok);
  const totalRows = tables.reduce((s, t) => s + t.rows, 0);
  return { date, ok, totalRows, tables, missing };
}

/**
 * Delete every backup object whose date segment is older than the retention
 * cutoff. Handles R2 list truncation by looping on the returned cursor.
 */
async function pruneOldBackups(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  let pruned = 0;
  let cursor: string | undefined;

  do {
    const list = await env.STORAGE.list({ prefix: BACKUP_PREFIX, cursor });
    for (const obj of list.objects) {
      const m = DATE_KEY_RE.exec(obj.key);
      const keyDate = m?.[1];
      if (!keyDate) continue; // unexpected key shape — leave it alone
      if (keyDate < cutoff) {
        try {
          await env.STORAGE.delete(obj.key);
          pruned += 1;
        } catch (err) {
          console.error(
            `[backup] prune failed key=${obj.key}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  return pruned;
}
