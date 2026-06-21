import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { sha256Hex } from '../db/migrations-index';
import { alertAdminError } from '../lib/error-alert';

// ---------------------------------------------------------------------------
// Redaction — never store secret values in the audit log.
// ---------------------------------------------------------------------------
const SECRET_FIELD = /pin|password|secret|token|hash|api[_-]?key/i;
const REDACTED = '[redacted]';

function redactValue(field: string, value: unknown): unknown {
  return SECRET_FIELD.test(field) ? REDACTED : value;
}

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/**
 * Diff two records over the given fields (or the union of their keys), returning
 * only the fields whose value changed. Secret-named fields are redacted on both
 * sides. Values are compared by loose JSON equality.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields?: string[],
): FieldDiff {
  const b = before ?? {};
  const a = after ?? {};
  const keys = fields ?? Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  const out: FieldDiff = {};
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    if (JSON.stringify(bv ?? null) !== JSON.stringify(av ?? null)) {
      out[k] = { from: redactValue(k, bv ?? null), to: redactValue(k, av ?? null) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Actor / context
// ---------------------------------------------------------------------------
export interface AuditActor {
  userId: string | null;
  role: string | null;
  label: string | null;
}

export interface AuditContext {
  actor: AuditActor;
  ip: string | null;
}

/** Build the actor + IP from a Hono request context (authenticated routes). */
export function auditActorFromContext(c: Context<{ Bindings: Env; Variables: { session: SessionData } }>): AuditContext {
  let session: SessionData | undefined;
  try { session = c.get('session'); } catch { session = undefined; }
  return {
    actor: {
      userId: session?.userId ?? null,
      role: session?.role ?? null,
      label: session?.name ?? null,
    },
    ip: c.req.header('cf-connecting-ip') ?? null,
  };
}

/** Fixed context for unauthenticated/system actors (kiosk, cron). */
export function systemActor(label: string, ip: string | null = null): AuditContext {
  return { actor: { userId: null, role: null, label }, ip };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
export interface AuditInput {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  changes?: FieldDiff | null;
}

const MAX_RETRIES = 5;

// Stable-key canonical form that the hash covers. Includes actor_label + ip so
// those forensic fields are also tamper-evident (not just actor_user_id/role).
function canonicalize(row: {
  seq: number; at: string; actor_user_id: string | null; actor_role: string | null;
  actor_label: string | null; action: string; entity_type: string | null; entity_id: string | null;
  summary: string | null; changes: string | null; ip: string | null;
}): string {
  return JSON.stringify([
    row.seq, row.at, row.actor_user_id, row.actor_role, row.actor_label, row.action,
    row.entity_type, row.entity_id, row.summary, row.changes, row.ip,
  ]);
}

/**
 * Append one entry to the audit log. Awaited so the hash chain stays correctly
 * ordered, but NON-FATAL: a failure is logged + admin-alerted and swallowed so it
 * never fails the underlying mutation (a miss leaves a gap, not a broken chain).
 */
export async function recordAudit(env: Env, ctx: AuditContext, input: AuditInput): Promise<void> {
  const at = new Date().toISOString();
  const changesJson = input.changes && Object.keys(input.changes).length > 0
    ? JSON.stringify(input.changes)
    : null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const last = await env.DB.prepare(
        'SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1'
      ).first<{ seq: number; hash: string }>();
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? '';

      const row = {
        seq, at,
        actor_user_id: ctx.actor.userId,
        actor_role: ctx.actor.role,
        actor_label: ctx.actor.label,
        action: input.action,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        summary: input.summary ?? null,
        changes: changesJson,
        ip: ctx.ip,
      };
      const hash = await sha256Hex(canonicalize(row) + prevHash);
      const id = crypto.randomUUID().replace(/-/g, '');

      await env.DB.prepare(
        `INSERT INTO audit_log
           (id, seq, at, actor_user_id, actor_role, actor_label, action, entity_type, entity_id, summary, changes, ip, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, seq, at, row.actor_user_id, row.actor_role, ctx.actor.label,
        row.action, row.entity_type, row.entity_id, row.summary, row.changes,
        ctx.ip, prevHash, hash,
      ).run();
      return; // success
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Lost the seq race — another writer took this seq. Retry with a fresh read.
      if (/UNIQUE/i.test(msg) && attempt < MAX_RETRIES - 1) continue;
      // Final failure (or a non-conflict error): never fail the caller's action.
      console.error(JSON.stringify({ kind: 'audit', ok: false, action: input.action, detail: msg.slice(0, 120) }));
      try { await alertAdminError(env, `audit:${input.action}`, err); } catch { /* alerting is itself best-effort */ }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Read + verify
// ---------------------------------------------------------------------------
export interface AuditRow {
  id: string; seq: number; at: string;
  actor_user_id: string | null; actor_role: string | null; actor_label: string | null;
  action: string; entity_type: string | null; entity_id: string | null;
  summary: string | null; changes: string | null; ip: string | null;
}

export interface AuditFilters {
  entityType?: string; action?: string; actorUserId?: string;
  from?: string; to?: string; q?: string;
  beforeSeq?: number; limit?: number;
}

/** Cursor-paginated list (newest first), filtered. */
export async function listAudit(env: Env, f: AuditFilters): Promise<{ rows: AuditRow[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.beforeSeq) { where.push('seq < ?'); params.push(f.beforeSeq); }
  if (f.entityType) { where.push('entity_type = ?'); params.push(f.entityType); }
  if (f.action) { where.push('action = ?'); params.push(f.action); }
  if (f.actorUserId) { where.push('actor_user_id = ?'); params.push(f.actorUserId); }
  if (f.from) { where.push('at >= ?'); params.push(f.from); }
  if (f.to) { where.push('at <= ?'); params.push(f.to); }
  if (f.q) { where.push('summary LIKE ?'); params.push(`%${f.q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const res = await env.DB.prepare(
    `SELECT id, seq, at, actor_user_id, actor_role, actor_label, action, entity_type, entity_id, summary, changes, ip
     FROM audit_log ${clause} ORDER BY seq DESC LIMIT ?`
  ).bind(...params, limit + 1).all<AuditRow>();

  const rows = res.results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.seq : null };
}

export interface ChainVerifyResult { ok: boolean; checked: number; brokenAtSeq: number | null }

/** Re-walk the chain in order and confirm each hash + prev_hash link. */
export async function verifyChain(env: Env): Promise<ChainVerifyResult> {
  const res = await env.DB.prepare(
    `SELECT seq, at, actor_user_id, actor_role, actor_label, action, entity_type, entity_id, summary, changes, ip, prev_hash, hash
     FROM audit_log ORDER BY seq ASC`
  ).all<{
    seq: number; at: string; actor_user_id: string | null; actor_role: string | null;
    actor_label: string | null; action: string; entity_type: string | null; entity_id: string | null;
    summary: string | null; changes: string | null; ip: string | null; prev_hash: string; hash: string;
  }>();
  const rows = res.results ?? [];

  let prevHash = '';
  let checked = 0;
  for (const r of rows) {
    if (r.prev_hash !== prevHash) return { ok: false, checked, brokenAtSeq: r.seq };
    const recomputed = await sha256Hex(canonicalize({
      seq: r.seq, at: r.at, actor_user_id: r.actor_user_id, actor_role: r.actor_role,
      actor_label: r.actor_label, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
      summary: r.summary, changes: r.changes, ip: r.ip,
    }) + r.prev_hash);
    if (recomputed !== r.hash) return { ok: false, checked, brokenAtSeq: r.seq };
    prevHash = r.hash;
    checked++;
  }
  return { ok: true, checked, brokenAtSeq: null };
}
