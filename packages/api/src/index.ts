import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { visitorRoutes } from './routes/visitors';
import { visitRoutes } from './routes/visits';
import { officerRoutes } from './routes/officers';
import { directorateRoutes } from './routes/directorates';
import { notificationRoutes } from './routes/notifications';
import { telegramWebhook, telegramLinkRoute } from './routes/telegram';
import { badgeRoutes, serveBadgePage } from './routes/badges';
import { kioskRoutes } from './routes/kiosk';
import { presenceRoutes } from './routes/presence';
import { appointmentsPublicRoutes } from './routes/appointments-public';
import { appointmentsAdminRoutes } from './routes/appointments-admin';
import { assistantRoutes } from './routes/assistant';
import { userRoutes } from './routes/users';
import { analyticsRoutes } from './routes/analytics';
import { reportRoutes } from './routes/reports';
import { adminDirectorateRoutes } from './routes/admin-directorates';
import { adminHolidayRoutes } from './routes/admin-holidays';
import { adminAuditRoutes } from './routes/admin-audit';
import { adminMigrationsRoutes } from './routes/admin-migrations';
import { adminHealthRoutes } from './routes/admin-health';
import { adminSettingsRoutes } from './routes/admin-settings';
import { adminEvalAssistantRoutes } from './routes/admin-eval-assistant';
import { adminMaintenanceRoutes } from './routes/admin-maintenance';
import { adminReadinessRoutes } from './routes/admin-readiness';
import { authWebAuthnPublicRoutes, authWebAuthnAuthedRoutes } from './routes/auth-webauthn';
import { photoRoutes } from './routes/photos';
import { bulkImportRoutes } from './routes/bulk-import';
import { adminNssRoutes } from './routes/admin-nss';
import { adminInternRoutes } from './routes/admin-interns';
import { adminTelegramRoutes } from './routes/admin-telegram';
import { clockRoutes } from './routes/clock';
import { notificationsPushRoutes } from './routes/notifications-push';
import { attendanceRoutes } from './routes/attendance';
import { surveyRoutes } from './routes/surveys';
import { sendDailySummary as sendDailySummaryFn } from './services/daily-summary';
import { sendClockReminders, sendMonthlyReportReady } from './services/reminders';
import { runNssEndOfServiceCheck } from './services/nss-eos';
import { runCheckoutSweep } from './services/checkout-sweep';
import { runSlaEscalation } from './services/sla-escalation';
import { purgeExpiredVisitorPhotos } from './services/photo-purge';
import { exportBackupToR2, verifyLatestBackup } from './services/backup';
import { alertAdminError } from './lib/error-alert';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';

const app = new Hono<{ Bindings: Env; Variables: { session: import('./types').SessionData } }>();

const PROD_ORIGINS = new Set([
  'https://staff-attendance.pages.dev',
  'https://ohcs-smartgate.pages.dev',
  'https://smartgate.ohcsghana.org',
  'https://www.smartgate.ohcsghana.org',
  'https://staff-attendance.ohcsghana.org',
  'https://www.staff-attendance.ohcsghana.org',
]);

const DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:8788',
]);

app.use('*', async (c, next) => {
  const allowed = c.env.ENVIRONMENT === 'production'
    ? PROD_ORIGINS
    : new Set([...PROD_ORIGINS, ...DEV_ORIGINS]);
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next);
});

app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes (no auth)
app.route('/api/auth', authRoutes);
app.route('/api/auth/webauthn', authWebAuthnPublicRoutes);
app.route('/api/badges', badgeRoutes);
app.get('/badge/:code', serveBadgePage);
app.route('/api/kiosk', kioskRoutes);
app.route('/api/presence', presenceRoutes);
app.route('/api/appointments/public', appointmentsPublicRoutes);
app.post('/api/telegram/webhook', telegramWebhook);

// Protected routes
app.use('/api/*', authMiddleware);
app.get('/api/photos/clock/:id', async (c) => {
  const clockId = c.req.param('id');
  const session = c.get('session');
  const record = await c.env.DB.prepare('SELECT user_id FROM clock_records WHERE id = ?').bind(clockId).first<{ user_id: string }>();
  if (!record) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Photo not found' } }, 404);
  const isAdmin = session.role === 'superadmin' || session.role === 'admin';
  if (!isAdmin && session.userId !== record.user_id) {
    return c.json({ data: null, error: { code: 'FORBIDDEN', message: 'You do not have access to this resource' } }, 403);
  }
  const object = await c.env.STORAGE.get(`photos/clock/${clockId}.jpg`);
  if (!object) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Photo not found' } }, 404);
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});
app.route('/api/visitors', visitorRoutes);
app.route('/api/visits', visitRoutes);
app.route('/api/officers', officerRoutes);
app.route('/api/directorates', directorateRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/notifications/push', notificationsPushRoutes);
app.route('/api/assistant', assistantRoutes);
app.route('/api/users', userRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/surveys', surveyRoutes);
app.route('/api/admin/directorates', adminDirectorateRoutes);
app.route('/api/admin/import', bulkImportRoutes);
app.route('/api/admin/nss', adminNssRoutes);
app.route('/api/admin/interns', adminInternRoutes);
app.route('/api/admin/migrations', adminMigrationsRoutes);
app.route('/api/admin/health', adminHealthRoutes);
app.route('/api/admin/settings', adminSettingsRoutes);
app.route('/api/admin/holidays', adminHolidayRoutes);
app.route('/api/admin/audit', adminAuditRoutes);
app.route('/api/admin/eval-assistant', adminEvalAssistantRoutes);
app.route('/api/admin/maintenance', adminMaintenanceRoutes);
app.route('/api/admin/readiness', adminReadinessRoutes);
app.route('/api/admin/telegram', adminTelegramRoutes);
app.route('/api/appointments/admin', appointmentsAdminRoutes);
app.route('/api/auth/webauthn', authWebAuthnAuthedRoutes);
app.route('/api/clock', clockRoutes);
app.route('/api/attendance', attendanceRoutes);
app.route('/api/photos', photoRoutes);
app.post('/api/telegram/link', telegramLinkRoute);

// Manual trigger for daily summary (superadmin only)
app.post('/api/admin/send-daily-summary', async (c) => {
  const session = c.get('session');
  if (session.role !== 'superadmin') return c.json({ error: 'Forbidden' }, 403);
  await sendDailySummaryFn(c.env);
  return c.json({ data: { message: 'Daily summary sent' }, error: null });
});

// Cron trigger handler for daily attendance summary

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // Production guard: DEV_BYPASS_REAUTH bypasses WebAuthn signature
    // verification for clock-in re-auth. Must never be true in production.
    if (env.ENVIRONMENT === 'production' && env.DEV_BYPASS_REAUTH === 'true') {
      return new Response('DEV_BYPASS_REAUTH must not be true in production', { status: 500 });
    }
    return app.fetch(req, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      switch (event.cron) {
        case '*/15 7-9 * * 1-5':
          try {
            await sendClockReminders(env);
          } catch (err) {
            console.error(`[scheduled] clock-reminders failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:clock-reminders', err);
          }
          break;
        case '0 9 1 * *':
          try {
            await sendDailySummaryFn(env);
            await sendMonthlyReportReady(env);
          } catch (err) {
            console.error(`[scheduled] monthly-summary failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:monthly-summary', err);
          }
          break;
        case '0 9 * * 1-5':
        case '0 16 * * 5':
        case '0 9 1 1 *':
          try {
            await sendDailySummaryFn(env);
          } catch (err) {
            console.error(`[scheduled] daily-summary failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:daily-summary', err);
          }
          break;
        case '30 0 * * *':
          try {
            await runNssEndOfServiceCheck(env);
          } catch (err) {
            console.error(`[scheduled] nss-eos failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:nss-eos', err);
          }
          break;
        case '15 17 * * 1-5':
          try {
            await runCheckoutSweep(env);
          } catch (err) {
            console.error(`[scheduled] checkout-sweep failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:checkout-sweep', err);
          }
          break;
        case '*/15 8-17 * * 1-5':
          try {
            await runSlaEscalation(env);
          } catch (err) {
            console.error(`[scheduled] sla-escalation failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:sla-escalation', err);
          }
          break;
        case '0 2 * * *':
          // Daily maintenance window. Purge expired visitor photos, then run the
          // D1 -> R2 table backup. Each job has its own try/catch so a failure in
          // one does not skip the other, and each failure surfaces to admins via
          // a throttled Telegram alert (so silent cron failures don't go unseen).
          try {
            await purgeExpiredVisitorPhotos(env);
          } catch (err) {
            console.error(`[scheduled] photo-purge failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:photo-purge', err);
          }
          try {
            await exportBackupToR2(env);
            // Immediately verify what we just wrote is readable + restorable. A
            // backup that silently can't be parsed is worse than no backup.
            const v = await verifyLatestBackup(env);
            if (!v.ok) {
              await alertAdminError(
                env,
                'cron:backup-verify',
                new Error(`Backup ${v.date ?? '(none)'} failed verification — missing=[${v.missing.join(',')}] bad=[${v.tables.filter((t) => !t.ok).map((t) => t.name).join(',')}]`),
              );
            }
          } catch (err) {
            console.error(`[scheduled] backup failed: ${err instanceof Error ? err.message : String(err)}`);
            await alertAdminError(env, 'cron:backup', err);
          }
          break;
        default:
          console.warn(`[scheduled] unknown cron: ${event.cron}`);
      }
    })());
  },
};
