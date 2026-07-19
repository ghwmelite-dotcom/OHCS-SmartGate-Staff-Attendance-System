import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { resolveDirectorateScope } from '../lib/directorate-scope';
import { sendTelegramMessage } from '../services/telegram';
import { escapeHtml } from '../lib/html';
import { recordNotifyOutcome } from '../lib/notify-metrics';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const reportSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  directorate_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

reportRoutes.get('/visits', zValidator('query', reportSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'director', 'receptionist');
  if (blocked) return blocked;
  const { from, to, limit } = c.req.valid('query');
  // Directors are isolated to their own directorate — override any incoming filter.
  const directorScope = await resolveDirectorateScope(c);
  const directorate_id = directorScope ?? c.req.valid('query').directorate_id;

  let sql = `SELECT v.check_in_at, v.check_out_at, v.duration_minutes, v.status, v.badge_code,
                    v.purpose_raw, v.purpose_category,
                    vis.first_name, vis.last_name, vis.organisation, vis.phone,
                    o.name as host_name,
                    d.abbreviation as directorate_abbr, d.name as directorate_name
             FROM visits v
             JOIN visitors vis ON v.visitor_id = vis.id
             LEFT JOIN officers o ON v.host_officer_id = o.id
             LEFT JOIN directorates d ON v.directorate_id = d.id
             WHERE DATE(v.check_in_at) >= ? AND DATE(v.check_in_at) <= ?`;
  const params: unknown[] = [from, to];

  if (directorate_id) {
    sql += ' AND v.directorate_id = ?';
    params.push(directorate_id);
  }

  sql += ' ORDER BY v.check_in_at DESC LIMIT ?';
  params.push(limit);

  const results = await c.env.DB.prepare(sql).bind(...params).all();

  // Summary stats — scope by directorate when a filter is in effect
  // (including the director-isolation override above).
  const innerDirFilter = directorate_id ? ' AND v2.directorate_id = ?' : '';
  const outerDirFilter = directorate_id ? ' AND v.directorate_id = ?' : '';
  const summaryParams: unknown[] = [from, to];
  if (directorate_id) summaryParams.push(directorate_id);
  summaryParams.push(from, to);
  if (directorate_id) summaryParams.push(directorate_id);
  const summary = await c.env.DB.prepare(
    `SELECT COUNT(*) as total_visits,
            COUNT(DISTINCT v.visitor_id) as unique_visitors,
            ROUND(AVG(v.duration_minutes)) as avg_duration,
            (SELECT d2.abbreviation FROM visits v2 JOIN directorates d2 ON v2.directorate_id = d2.id
             WHERE DATE(v2.check_in_at) >= ? AND DATE(v2.check_in_at) <= ?${innerDirFilter}
             GROUP BY d2.id ORDER BY COUNT(*) DESC LIMIT 1) as busiest_directorate
     FROM visits v
     WHERE DATE(v.check_in_at) >= ? AND DATE(v.check_in_at) <= ?${outerDirFilter}`
  ).bind(...summaryParams).first<{
    total_visits: number;
    unique_visitors: number;
    avg_duration: number | null;
    busiest_directorate: string | null;
  }>();

  return success(c, {
    summary: {
      total_visits: summary?.total_visits ?? 0,
      unique_visitors: summary?.unique_visitors ?? 0,
      avg_duration: summary?.avg_duration ?? 0,
      busiest_directorate: summary?.busiest_directorate ?? 'N/A',
      from,
      to,
    },
    visits: results.results ?? [],
  });
});

// ---------------------------------------------------------------------------
// Evacuation roll (spec 2026-07-19-sla-and-evacuation-design §Feature B) —
// "who is in the building right now": checked-in visitors + clocked-in staff.

interface EvacuationVisitor {
  name: string;
  badge_code: string | null;
  host_name: string | null;
  directorate: string | null;
  since: string;
  party_size: number | null;
}

interface EvacuationStaff {
  name: string;
  staff_id: string | null;
  directorate: string | null;
  since: string;
}

interface EvacuationRoll {
  generated_at: string;
  visitors: EvacuationVisitor[];
  staff: EvacuationStaff[];
  counts: { visitors: number; staff: number; total: number };
}

async function buildEvacuationRoll(env: Env): Promise<EvacuationRoll> {
  // Same UTC "today" as the attendance overview (Ghana is UTC+0 year-round).
  const today = new Date().toISOString().slice(0, 10);

  // Visitors still in the building. counts.visitors weights each visit by its
  // party size (a delegation counts as its size), defaulting to 1.
  const [visitorRows, visitorCount, staffRows] = await Promise.all([
    env.DB.prepare(
      `SELECT (vis.first_name || ' ' || vis.last_name) AS name, v.badge_code,
              COALESCE(o.name, v.host_name_manual) AS host_name,
              d.abbreviation AS directorate,
              v.check_in_at AS since, v.party_size
       FROM visits v
       JOIN visitors vis ON v.visitor_id = vis.id
       LEFT JOIN officers o ON v.host_officer_id = o.id
       LEFT JOIN directorates d ON v.directorate_id = d.id
       WHERE v.status = 'checked_in'
       ORDER BY v.check_in_at`
    ).all<EvacuationVisitor>(),

    env.DB.prepare(
      `SELECT COALESCE(SUM(COALESCE(v.party_size, 1)), 0) AS n
       FROM visits v WHERE v.status = 'checked_in'`
    ).first<{ n: number }>(),

    // Staff still in: today's latest clock-in per user with no clock-out at or
    // after it — the same "who is in" set the attendance /today overview
    // counts (clocked_in minus clocked_out). NSS/interns included.
    env.DB.prepare(
      `SELECT u.name, u.staff_id, d.abbreviation AS directorate,
              MAX(ci.timestamp) AS since
       FROM users u
       JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
       LEFT JOIN directorates d ON u.directorate_id = d.id
       WHERE u.is_active = 1
         AND NOT EXISTS (
           SELECT 1 FROM clock_records co
           WHERE co.user_id = u.id AND co.type = 'clock_out' AND DATE(co.timestamp) = ?
             AND co.timestamp >= ci.timestamp
         )
       GROUP BY u.id
       ORDER BY since`
    ).bind(today, today).all<EvacuationStaff>(),
  ]);

  const visitors = visitorRows.results ?? [];
  const staff = staffRows.results ?? [];
  const visitorTotal = visitorCount?.n ?? 0;
  return {
    generated_at: new Date().toISOString(),
    visitors,
    staff,
    counts: { visitors: visitorTotal, staff: staff.length, total: visitorTotal + staff.length },
  };
}

// Telegram copy of the roll. Lists are capped so the message stays under
// Telegram's limit; the counts are always the full picture.
const EVAC_MAX_LISTED = 20;

function buildEvacuationTelegram(roll: EvacuationRoll): string {
  const visitorLines = roll.visitors.slice(0, EVAC_MAX_LISTED).map((v) => {
    const size = (v.party_size ?? 1) > 1 ? ` ×${v.party_size}` : '';
    return `• <b>${escapeHtml(v.name)}</b>${size}${v.badge_code ? ` — <code>${escapeHtml(v.badge_code)}</code>` : ''}${v.host_name ? ` (host: ${escapeHtml(v.host_name)})` : ''}${v.directorate ? ` [${escapeHtml(v.directorate)}]` : ''}`;
  });
  if (roll.visitors.length > EVAC_MAX_LISTED) visitorLines.push(`• …and ${roll.visitors.length - EVAC_MAX_LISTED} more`);
  if (roll.visitors.length === 0) visitorLines.push('• none');

  const staffLines = roll.staff.slice(0, EVAC_MAX_LISTED).map((s) =>
    `• <b>${escapeHtml(s.name)}</b>${s.staff_id ? ` — <code>${escapeHtml(s.staff_id)}</code>` : ''}${s.directorate ? ` [${escapeHtml(s.directorate)}]` : ''}`,
  );
  if (roll.staff.length > EVAC_MAX_LISTED) staffLines.push(`• …and ${roll.staff.length - EVAC_MAX_LISTED} more`);
  if (roll.staff.length === 0) staffLines.push('• none');

  return [
    `\u{1F6A8} <b>Evacuation Roll — OHCS</b>`,
    '',
    `<b>${roll.counts.total}</b> people in building — ${roll.counts.visitors} visitor${roll.counts.visitors === 1 ? '' : 's'}, ${roll.counts.staff} staff`,
    '',
    `<b>Visitors (${roll.counts.visitors})</b>`,
    ...visitorLines,
    '',
    `<b>Staff (${roll.counts.staff})</b>`,
    ...staffLines,
    '',
    `Generated ${escapeHtml(roll.generated_at)}`,
    '',
    `\u2014 OHCS VMS`,
  ].join('\n');
}

reportRoutes.get('/evacuation', async (c) => {
  const blocked = requireRole(c, 'receptionist', 'admin', 'superadmin', 'it');
  if (blocked) return blocked;
  return success(c, await buildEvacuationRoll(c.env));
});

reportRoutes.post('/evacuation/notify', async (c) => {
  const blocked = requireRole(c, 'receptionist', 'admin', 'superadmin', 'it');
  if (blocked) return blocked;

  const adminChatId = await c.env.KV.get('telegram-admin-chat-id');
  if (!adminChatId || !c.env.TELEGRAM_BOT_TOKEN) {
    return error(c, 'TELEGRAM_NOT_CONFIGURED', 'Telegram admin chat is not configured', 503);
  }

  const roll = await buildEvacuationRoll(c.env);
  const ok = await sendTelegramMessage({
    chatId: adminChatId,
    text: buildEvacuationTelegram(roll),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
  await recordNotifyOutcome(c.env, 'telegram', ok);
  if (!ok) return error(c, 'TELEGRAM_FAILED', 'Failed to send the evacuation roll to Telegram', 502);
  return success(c, { sent: true });
});
