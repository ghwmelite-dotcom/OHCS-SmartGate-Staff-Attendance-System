import type { Env } from '../types';

export type CheckOutOutcome =
  | { ok: true; visit: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CHECKED_OUT' };

const SELECT_VISIT_WITH_JOINS = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
        COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
 FROM visits v
 JOIN visitors vis ON v.visitor_id = vis.id
 LEFT JOIN officers o ON v.host_officer_id = o.id
 LEFT JOIN directorates d ON v.directorate_id = d.id
 WHERE v.id = ?`;

export async function checkOutById(env: Env, visitId: string): Promise<CheckOutOutcome> {
  const visit = await env.DB.prepare('SELECT id, check_in_at, status FROM visits WHERE id = ?')
    .bind(visitId)
    .first<{ id: string; check_in_at: string; status: string }>();
  if (!visit) return { ok: false, code: 'NOT_FOUND' };
  if (visit.status !== 'checked_in') return { ok: false, code: 'ALREADY_CHECKED_OUT' };

  const checkOutAt = new Date().toISOString();
  const durationMinutes = Math.round(
    (new Date(checkOutAt).getTime() - new Date(visit.check_in_at).getTime()) / 60000
  );

  const res = await env.DB.prepare(
    `UPDATE visits SET status = 'checked_out', check_out_at = ?, duration_minutes = ? WHERE id = ? AND status = 'checked_in'`
  ).bind(checkOutAt, durationMinutes, visitId).run();

  // Lost a concurrent checkout race — another request already checked this visit out.
  if (res.meta?.changes === 0) return { ok: false, code: 'ALREADY_CHECKED_OUT' };

  const updated = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(visitId).first();
  return { ok: true, visit: (updated ?? {}) as Record<string, unknown> };
}

export async function checkOutByBadgeCode(env: Env, badgeCode: string): Promise<CheckOutOutcome> {
  const row = await env.DB.prepare('SELECT id FROM visits WHERE badge_code = ?')
    .bind(badgeCode)
    .first<{ id: string }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  return checkOutById(env, row.id);
}
