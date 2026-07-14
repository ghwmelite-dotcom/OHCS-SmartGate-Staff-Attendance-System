import appliedMigrations from './migration-applied-migrations.sql';
import attendance from './migration-attendance.sql';
import grade from './migration-grade.sql';
import hostManual from './migration-host-manual.sql';
import phase2 from './migration-phase2.sql';
import photos from './migration-photos.sql';
import pinAuth from './migration-pin-auth.sql';
import pinAcknowledged from './migration-pin-acknowledged.sql';
import pushSubscriptions from './migration-push-subscriptions.sql';
import clockIdempotency from './migration-clock-idempotency.sql';
import visitsIdempotency from './migration-visits-idempotency.sql';
import absenceNotices from './migration-absence-notices.sql';
import notificationsIndex from './migration-notifications-index.sql';
import appSettings from './migration-app-settings.sql';
import webauthn from './migration-webauthn.sql';
import nssFoundation from './migration-nss-foundation.sql';
import clockinReauth from './migration-clockin-reauth.sql';
import passiveLiveness from './migration-passive-liveness.sql';
import kioskVisitor from './migration-kiosk-visitor.sql';
import idPhotoCheck from './migration-id-photo-check.sql';
import receptionOfficer from './migration-reception-officer.sql';
import directorateReceivers from './migration-directorate-receivers.sql';
import internFoundation from './migration-intern-foundation.sql';
import idempotencyUnique from './migration-idempotency-unique.sql';
import receptionOverridePin from './migration-reception-override-pin.sql';
import visitorPhotoRetention from './migration-visitor-photo-retention.sql';
import holidays from './migration-holidays.sql';
import holidays2026Amendment from './migration-holidays-2026-amendment.sql';
import auditLog from './migration-audit-log.sql';
import auditLogReset from './migration-audit-log-reset.sql';
import sessionEpoch from './migration-session-epoch.sql';
import officerOverridePin from './migration-officer-override-pin.sql';
import directorateOrgType from './migration-directorate-org-type.sql';
import visitorIdPhotoBack from './migration-visitor-id-photo-back.sql';
import annexOrgEntities from './migration-annex-org-entities.sql';

export const MIGRATIONS: Array<{ filename: string; sql: string }> = [
  { filename: 'migration-applied-migrations.sql', sql: appliedMigrations },
  { filename: 'migration-attendance.sql', sql: attendance },
  { filename: 'migration-grade.sql', sql: grade },
  { filename: 'migration-host-manual.sql', sql: hostManual },
  { filename: 'migration-phase2.sql', sql: phase2 },
  { filename: 'migration-photos.sql', sql: photos },
  { filename: 'migration-pin-auth.sql', sql: pinAuth },
  { filename: 'migration-pin-acknowledged.sql', sql: pinAcknowledged },
  { filename: 'migration-push-subscriptions.sql', sql: pushSubscriptions },
  { filename: 'migration-clock-idempotency.sql', sql: clockIdempotency },
  { filename: 'migration-visits-idempotency.sql', sql: visitsIdempotency },
  { filename: 'migration-absence-notices.sql', sql: absenceNotices },
  { filename: 'migration-notifications-index.sql', sql: notificationsIndex },
  { filename: 'migration-app-settings.sql', sql: appSettings },
  { filename: 'migration-webauthn.sql', sql: webauthn },
  { filename: 'migration-nss-foundation.sql', sql: nssFoundation },
  { filename: 'migration-clockin-reauth.sql', sql: clockinReauth },
  { filename: 'migration-passive-liveness.sql', sql: passiveLiveness },
  { filename: 'migration-kiosk-visitor.sql', sql: kioskVisitor },
  { filename: 'migration-id-photo-check.sql', sql: idPhotoCheck },
  { filename: 'migration-reception-officer.sql', sql: receptionOfficer },
  { filename: 'migration-directorate-receivers.sql', sql: directorateReceivers },
  { filename: 'migration-intern-foundation.sql', sql: internFoundation },
  { filename: 'migration-idempotency-unique.sql', sql: idempotencyUnique },
  { filename: 'migration-reception-override-pin.sql', sql: receptionOverridePin },
  { filename: 'migration-visitor-photo-retention.sql', sql: visitorPhotoRetention },
  { filename: 'migration-holidays.sql', sql: holidays },
  { filename: 'migration-holidays-2026-amendment.sql', sql: holidays2026Amendment },
  { filename: 'migration-audit-log.sql', sql: auditLog },
  { filename: 'migration-audit-log-reset.sql', sql: auditLogReset },
  { filename: 'migration-session-epoch.sql', sql: sessionEpoch },
  { filename: 'migration-officer-override-pin.sql', sql: officerOverridePin },
  { filename: 'migration-directorate-org-type.sql', sql: directorateOrgType },
  { filename: 'migration-visitor-id-photo-back.sql', sql: visitorIdPhotoBack },
  { filename: 'migration-annex-org-entities.sql', sql: annexOrgEntities },
];

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
