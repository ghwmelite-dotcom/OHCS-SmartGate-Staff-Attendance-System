/**
 * Restore plan builder — turns a backup snapshot into an ordered list of SQL
 * statements that replace the live DB's contents with the snapshot, FK-safely.
 *
 * Why a pure builder: the plan is exercised by an integration test
 * (restore.test.ts) against real in-memory SQLite with `PRAGMA foreign_keys = ON`,
 * so the exact ordering the route runs in production is proven safe — same
 * discipline as the go-live reset.
 *
 * Ordering rules (D1 forces foreign_keys ON, no deferral available):
 *   WIPE  — children before parents; circular officer refs + user self-ref nulled first.
 *   INSERT — parents before children; the same circular/self refs are inserted
 *            NULL, then restored by a follow-up UPDATE once both sides exist.
 *
 * Column safety: each row's columns are intersected with the LIVE schema's
 * columns (passed in, from PRAGMA table_info) — a backup taken under an older or
 * newer schema still restores (unknown columns dropped; missing columns take
 * their defaults). Table + column identifiers are never user input (tables are a
 * fixed allowlist; columns are validated against the live schema).
 */

export type RestoreRow = Record<string, unknown>;
export type RestoreSnapshot = Record<string, RestoreRow[]>;
export type ColumnMap = Record<string, string[]>;

export interface RestoreStmt {
  sql: string;
  binds: unknown[];
}

// Total wipe, children → parents, circular/self refs nulled first. Clears
// notifications + push_subscriptions too (not in backups) so users can be
// replaced; those are not restored (transient).
export const RESTORE_WIPE_SQL: string[] = [
  'UPDATE directorates SET reception_officer_id = NULL, head_officer_id = NULL',
  'UPDATE users SET supervisor_user_id = NULL',
  'DELETE FROM notifications',
  'DELETE FROM push_subscriptions',
  'DELETE FROM webauthn_credentials',
  'DELETE FROM clock_records',
  'DELETE FROM leave_requests',
  'DELETE FROM absence_notices',
  'DELETE FROM visits',
  'DELETE FROM visitors',
  'DELETE FROM directorate_receivers',
  'DELETE FROM officers',
  'DELETE FROM users',
  'DELETE FROM visit_categories',
  'DELETE FROM app_settings',
  'DELETE FROM holidays',
  'DELETE FROM audit_log',
  'DELETE FROM directorates',
];

// Remaining child tables, parents-first. directorates / visit_categories /
// officers / users are inserted explicitly in buildRestorePlan (they carry the
// deferred circular + self references), so they're not listed here.
const INSERT_ORDER = [
  'visitors',
  'visits',
  'clock_records',
  'leave_requests',
  'absence_notices',
  'directorate_receivers',
  'webauthn_credentials',
  'app_settings',
  'holidays',
  'audit_log',
] as const;

function normalize(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0; // SQLite has no bool type
  return v; // string | number | null pass straight through to D1 binds
}

function quoteIdent(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}

// Append INSERT statements for `rows`, restricting columns to the live schema.
// `overrides` forces specific columns to a value (used to NULL deferred refs).
function pushInserts(
  out: RestoreStmt[],
  table: string,
  rows: RestoreRow[],
  columns: ColumnMap,
  overrides: Record<string, unknown> = {},
): void {
  const valid = new Set(columns[table] ?? []);
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => valid.has(c));
    if (cols.length === 0) continue;
    const binds = cols.map((c) => (c in overrides ? overrides[c] : normalize(row[c])));
    const placeholders = cols.map(() => '?').join(', ');
    out.push({
      sql: `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`,
      binds,
    });
  }
}

export function buildRestorePlan(snapshot: RestoreSnapshot, columns: ColumnMap): RestoreStmt[] {
  const out: RestoreStmt[] = [];

  // 1. Wipe everything (no binds).
  for (const sql of RESTORE_WIPE_SQL) out.push({ sql, binds: [] });

  // 2. directorates first, with the circular officer refs deferred (NULL).
  const directorates = snapshot.directorates ?? [];
  pushInserts(out, 'directorates', directorates, columns, {
    reception_officer_id: null,
    head_officer_id: null,
  });

  // 3. Tables that depend only on directorates (and each other, in order).
  // visit_categories + officers must exist before the directorate ref UPDATE and
  // before users/visits/etc. Insert visit_categories + officers, then the rest.
  pushInserts(out, 'visit_categories', snapshot.visit_categories ?? [], columns);
  pushInserts(out, 'officers', snapshot.officers ?? [], columns);

  // 4. Restore the deferred directorate officer refs now that officers exist.
  for (const d of directorates) {
    const recv = d.reception_officer_id ?? null;
    const head = d.head_officer_id ?? null;
    if (recv !== null || head !== null) {
      out.push({
        sql: 'UPDATE directorates SET reception_officer_id = ?, head_officer_id = ? WHERE id = ?',
        binds: [recv, head, d.id],
      });
    }
  }

  // 5. users next, with the self-reference deferred (NULL), then restore it.
  const users = snapshot.users ?? [];
  pushInserts(out, 'users', users, columns, { supervisor_user_id: null });
  for (const u of users) {
    if ((u.supervisor_user_id ?? null) !== null) {
      out.push({
        sql: 'UPDATE users SET supervisor_user_id = ? WHERE id = ?',
        binds: [u.supervisor_user_id, u.id],
      });
    }
  }

  // 6. Remaining child tables, parents-first per INSERT_ORDER.
  for (const t of INSERT_ORDER) {
    pushInserts(out, t, snapshot[t] ?? [], columns);
  }

  return out;
}
