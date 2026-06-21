import type { Context } from 'hono';
import type { Env, SessionData } from '../types';

/**
 * Directorate-level data isolation for directors.
 *
 * A director may only see visitor/visit data for their own directorate.
 * SessionData does not carry directorate_id, so we look it up from the
 * users table by session.userId (cached per-request is unnecessary — these
 * handlers run a single such query).
 *
 * Returns:
 *   - the director's directorate_id (string) when the caller is a director
 *     with a linked directorate — callers MUST override any incoming
 *     directorate_id filter with this value;
 *   - DIRECTORATE_SCOPE_NONE (a sentinel that matches no real directorate) when
 *     the caller is a director WITHOUT a linked directorate — this fails CLOSED
 *     (deny-all) instead of leaking all directorates' data;
 *   - null otherwise (non-director; no scoping — honour the caller filter).
 */

// Real directorate ids are 32 hex chars; this can never collide, so any filter
// `directorate_id = DIRECTORATE_SCOPE_NONE` returns zero rows.
export const DIRECTORATE_SCOPE_NONE = '__no_directorate__';

export async function resolveDirectorateScope(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>
): Promise<string | null> {
  const session = c.get('session');
  if (session.role !== 'director') return null;
  const row = await c.env.DB.prepare('SELECT directorate_id FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ directorate_id: string | null }>();
  // Director with no directorate → deny-all sentinel (NOT null/no-scope).
  return row?.directorate_id ?? DIRECTORATE_SCOPE_NONE;
}
