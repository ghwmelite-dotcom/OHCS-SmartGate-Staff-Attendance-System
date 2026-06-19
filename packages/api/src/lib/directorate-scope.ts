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
 *   - null otherwise (no scoping; honour the caller-supplied filter).
 */
export async function resolveDirectorateScope(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>
): Promise<string | null> {
  const session = c.get('session');
  if (session.role !== 'director') return null;
  const row = await c.env.DB.prepare('SELECT directorate_id FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ directorate_id: string | null }>();
  return row?.directorate_id ?? null;
}
