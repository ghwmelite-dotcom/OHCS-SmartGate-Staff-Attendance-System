import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';

export const analyticsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Today's summary
analyticsRoutes.get('/today', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'director');
  if (blocked) return blocked;
  const today = new Date().toISOString().slice(0, 10);

  const [totalResult, activeResult, avgResult, byDirectorate, byHour] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'checked_out' THEN 1 ELSE 0 END) as checked_out
       FROM visits WHERE DATE(check_in_at) = ?`
    ).bind(today).first<{ total: number; checked_out: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM visits WHERE status = 'checked_in' AND DATE(check_in_at) = ?`
    ).bind(today).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT ROUND(AVG(duration_minutes)) as avg FROM visits WHERE duration_minutes IS NOT NULL AND DATE(check_in_at) = ?`
    ).bind(today).first<{ avg: number | null }>(),

    c.env.DB.prepare(
      `SELECT d.abbreviation, d.name, COUNT(*) as count
       FROM visits v JOIN directorates d ON v.directorate_id = d.id
       WHERE DATE(v.check_in_at) = ?
       GROUP BY d.id ORDER BY count DESC`
    ).bind(today).all(),

    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', check_in_at) AS INTEGER) as hour, COUNT(*) as count
       FROM visits WHERE DATE(check_in_at) = ?
       GROUP BY hour ORDER BY count DESC LIMIT 1`
    ).bind(today).first<{ hour: number; count: number }>(),
  ]);

  const directorates = byDirectorate.results ?? [];

  return success(c, {
    total_today: totalResult?.total ?? 0,
    in_building: activeResult?.count ?? 0,
    checked_out: totalResult?.checked_out ?? 0,
    avg_duration_minutes: avgResult?.avg ?? 0,
    peak_hour: byHour?.hour ?? null,
    busiest_directorate: directorates.length > 0
      ? { abbreviation: directorates[0]!.abbreviation, count: directorates[0]!.count }
      : null,
    by_directorate: directorates,
  });
});

// Trends over period
const trendsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

analyticsRoutes.get('/trends', zValidator('query', trendsSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'director');
  if (blocked) return blocked;
  const { days } = c.req.valid('query');
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const [dailyVolumes, byDayOfWeek, byHour, byCategory] = await Promise.all([
    c.env.DB.prepare(
      `SELECT DATE(check_in_at) as date, COUNT(*) as count
       FROM visits WHERE DATE(check_in_at) >= ?
       GROUP BY date ORDER BY date ASC`
    ).bind(fromDate).all(),

    c.env.DB.prepare(
      `SELECT CAST(strftime('%w', check_in_at) AS INTEGER) as day, COUNT(*) as total
       FROM visits WHERE DATE(check_in_at) >= ?
       GROUP BY day ORDER BY day`
    ).bind(fromDate).all(),

    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', check_in_at) AS INTEGER) as hour, COUNT(*) as total
       FROM visits WHERE DATE(check_in_at) >= ?
       GROUP BY hour ORDER BY hour`
    ).bind(fromDate).all(),

    c.env.DB.prepare(
      `SELECT COALESCE(purpose_category, 'other') as category, COUNT(*) as count
       FROM visits WHERE DATE(check_in_at) >= ?
       GROUP BY category ORDER BY count DESC`
    ).bind(fromDate).all(),
  ]);

  // Calculate weeks for averaging
  const weeks = Math.max(1, Math.ceil(days / 7));
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const categoryLabels: Record<string, string> = {
    official_meeting: 'Official Meeting', document_submission: 'Document Submission',
    job_inquiry: 'Job Inquiry', complaint: 'Complaint', personal_visit: 'Personal Visit',
    delivery: 'Delivery', scheduled_appointment: 'Appointment', consultation: 'Consultation',
    inspection: 'Inspection', training: 'Training', interview: 'Interview', other: 'Other',
  };

  return success(c, {
    daily_volumes: dailyVolumes.results ?? [],
    by_day_of_week: (byDayOfWeek.results ?? []).map((r: Record<string, unknown>) => ({
      day: r.day,
      label: dayLabels[r.day as number] ?? '?',
      avg_count: Math.round((r.total as number) / weeks),
    })),
    by_hour: (byHour.results ?? []).map((r: Record<string, unknown>) => ({
      hour: r.hour,
      avg_count: Math.round((r.total as number) / weeks),
    })),
    by_category: (byCategory.results ?? []).map((r: Record<string, unknown>) => ({
      category: r.category,
      label: categoryLabels[r.category as string] ?? String(r.category),
      count: r.count,
    })),
  });
});

// Top visitors
const topVisitorsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

analyticsRoutes.get('/top-visitors', zValidator('query', topVisitorsSchema), async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'director');
  if (blocked) return blocked;
  const { days, limit } = c.req.valid('query');
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const results = await c.env.DB.prepare(
    `SELECT vis.first_name, vis.last_name, vis.organisation, COUNT(*) as visit_count,
            MAX(v.check_in_at) as last_visit_at
     FROM visits v JOIN visitors vis ON v.visitor_id = vis.id
     WHERE DATE(v.check_in_at) >= ?
     GROUP BY vis.id ORDER BY visit_count DESC LIMIT ?`
  ).bind(fromDate, limit).all();

  return success(c, results.results ?? []);
});
