import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';

export const adminReadinessRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

export type ReadinessStatus = 'ok' | 'warn' | 'info';
export interface ReadinessCheck {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

interface ReadinessCounts {
  superadmins: number;
  directorates_active: number;
  dir_no_reception: number;
  officers_total: number;
  officers_no_tg: number;
  staff_users: number;
  visits_total: number;
  clock_total: number;
  holidays_upcoming: number;
  reauth: number | null;
  liveness: number | null;
  override_pin_set: number;
}

// One round trip: every signal the readiness panel reports. `?` binds today
// (YYYY-MM-DD) for the upcoming-holidays count.
const READINESS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM users WHERE role = 'superadmin' AND is_active = 1)                       AS superadmins,
    (SELECT COUNT(*) FROM directorates WHERE is_active = 1)                                        AS directorates_active,
    (SELECT COUNT(*) FROM directorates d WHERE d.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM directorate_receivers r WHERE r.directorate_id = d.id))       AS dir_no_reception,
    (SELECT COUNT(*) FROM officers)                                                                AS officers_total,
    (SELECT COUNT(*) FROM officers WHERE telegram_chat_id IS NULL OR telegram_chat_id = '')        AS officers_no_tg,
    (SELECT COUNT(*) FROM users WHERE is_active = 1
       AND (staff_id IS NOT NULL OR nss_number IS NOT NULL OR intern_code IS NOT NULL))            AS staff_users,
    (SELECT COUNT(*) FROM visits)                                                                  AS visits_total,
    (SELECT COUNT(*) FROM clock_records)                                                           AS clock_total,
    (SELECT COUNT(*) FROM holidays WHERE date >= ?)                                                AS holidays_upcoming,
    (SELECT clockin_reauth_enforce FROM app_settings WHERE id = 1)                                 AS reauth,
    (SELECT clockin_passive_liveness_enforce FROM app_settings WHERE id = 1)                       AS liveness,
    (SELECT CASE WHEN reception_override_pin IS NOT NULL AND reception_override_pin <> ''
            THEN 1 ELSE 0 END FROM app_settings WHERE id = 1)                                      AS override_pin_set
`;

// Pure: turn the raw counts into a labelled, status-tagged checklist. Exported
// for unit testing without a DB.
export function buildReadinessChecks(c: ReadinessCounts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  checks.push({
    key: 'superadmins',
    label: 'Superadmin account',
    status: c.superadmins >= 1 ? 'ok' : 'warn',
    detail: c.superadmins >= 1
      ? `${c.superadmins} active superadmin${c.superadmins === 1 ? '' : 's'}.`
      : 'No active superadmin — you would be locked out of admin functions.',
  });

  checks.push({
    key: 'reception_override_pin',
    label: 'Reception override PIN',
    status: c.override_pin_set ? 'ok' : 'warn',
    detail: c.override_pin_set
      ? 'Set — reception can approve flagged or after-hours check-ins.'
      : 'Not set — reception cannot override a flagged ID or an after-hours check-in.',
  });

  checks.push({
    key: 'directorates',
    label: 'Active directorates',
    status: c.directorates_active >= 1 ? 'ok' : 'warn',
    detail: `${c.directorates_active} active.`,
  });

  checks.push({
    key: 'reception_teams',
    label: 'Reception teams',
    status: c.dir_no_reception === 0 ? 'ok' : 'warn',
    detail: c.dir_no_reception === 0
      ? 'Every active directorate has at least one reception officer.'
      : `${c.dir_no_reception} active directorate${c.dir_no_reception === 1 ? '' : 's'} have no reception team — visitors there cannot be routed to anyone.`,
  });

  checks.push({
    key: 'officers',
    label: 'Officers',
    status: c.officers_total >= 1 ? 'ok' : 'warn',
    detail: `${c.officers_total} officer${c.officers_total === 1 ? '' : 's'} in the directory.`,
  });

  checks.push({
    key: 'officer_telegram',
    label: 'Officer Telegram links',
    status: 'info',
    detail: c.officers_no_tg === 0
      ? 'All officers have linked Telegram (will receive DM alerts).'
      : `${c.officers_no_tg} officer${c.officers_no_tg === 1 ? '' : 's'} have not linked Telegram — they get in-app alerts only, no DM.`,
  });

  checks.push({
    key: 'staff',
    label: 'Staff / NSS / interns',
    status: c.staff_users >= 1 ? 'ok' : 'info',
    detail: `${c.staff_users} active personnel can clock in.`,
  });

  checks.push({
    key: 'holidays',
    label: 'Public holidays',
    status: c.holidays_upcoming >= 1 ? 'ok' : 'warn',
    detail: c.holidays_upcoming >= 1
      ? `${c.holidays_upcoming} upcoming holiday${c.holidays_upcoming === 1 ? '' : 's'} configured.`
      : 'No upcoming holidays configured — the kiosk will treat every weekday as open.',
  });

  const reauthOn = c.reauth === 1;
  const livenessOn = c.liveness === 1;
  checks.push({
    key: 'clockin_enforcement',
    label: 'Clock-in enforcement',
    status: 'info',
    detail: `Re-auth: ${reauthOn ? 'ENFORCED' : 'shadow'} · Liveness: ${livenessOn ? 'ENFORCED' : 'shadow'}. `
      + 'Review shadow data before enforcing — enforcing can block legitimate clock-ins.',
  });

  const testActivity = c.visits_total + c.clock_total;
  checks.push({
    key: 'test_activity',
    label: 'Test / demo activity',
    status: testActivity === 0 ? 'ok' : 'info',
    detail: testActivity === 0
      ? 'No visits or clock records — a clean slate.'
      : `${c.visits_total} visits and ${c.clock_total} clock records present. If this is demo/test data, run the go-live reset to clear it.`,
  });

  return checks;
}

// Read-only — safe anytime. Aggregates the go-live setup signals into a
// labelled checklist so a superadmin can see what still needs doing before
// launch, without hunting through every tab.
adminReadinessRoutes.get('/', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const today = new Date().toISOString().slice(0, 10);
  const counts = await c.env.DB.prepare(READINESS_SQL).bind(today).first<ReadinessCounts>();
  if (!counts) return success(c, { checks: [], generatedAt: new Date().toISOString() });

  return success(c, {
    checks: buildReadinessChecks(counts),
    generatedAt: new Date().toISOString(),
  });
});
