// System documentation content — the superadmin docs page (/docs) renders this.
// MAINTENANCE RULE (AGENTS.md conventions): every shipped feature adds or
// updates its entry here in the same commit, with the correct status badge.
// Statuses: 'live' = in production · 'shadow' = shipped dark (record-only
// mode, not enforced) · 'design' = spec exists, not built.

export const DOCS_LAST_UPDATED = '2026-07-20';

export type DocStatus = 'live' | 'shadow' | 'design';

export interface DocFeature {
  name: string;
  status: DocStatus;
  /** One or two plain sentences — what it is and why it exists. */
  summary: string;
  /** Hard specifics: endpoints, flags, modes, file pointers, gotchas. */
  details?: string[];
}

export interface DocSection {
  id: string;
  title: string;
  tagline: string;
  /** Hex accent — icon chip, section rule, pill highlight. */
  color: string;
  /** Lucide icon key, mapped in DocsPage. */
  icon: string;
  features: DocFeature[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'platform',
    title: 'Platform Overview',
    tagline: 'Two apps, one API, fully serverless on Cloudflare',
    color: '#1A4D8B',
    icon: 'layers',
    features: [
      {
        name: 'Two PWAs, one Worker API',
        status: 'live',
        summary: 'Staff Attendance and SmartGate VMS are separate PWAs on Cloudflare Pages, backed by a single shared Hono API on Cloudflare Workers.',
        details: [
          'staff-attendance.ohcsghana.org · smartgate.ohcsghana.org',
          'API Worker: ohcs-smartgate-api.ohcsghana-main.workers.dev',
          'Both PWAs hard-redirect away from *.pages.dev to the branded domains (first-party cookie requirement)',
        ],
      },
      {
        name: 'Data plane',
        status: 'live',
        summary: 'D1 holds the relational core; KV carries the ephemeral; R2 stores binaries; Workers AI does the vision work.',
        details: [
          'D1 — users, visits, clock records, appointments, surveys, audit',
          'KV — sessions, rate limits, presence & survey tokens, push counters, notify stats, Telegram mappings',
          'R2 — visitor/clock photos + nightly backups (optional AES-GCM at rest)',
          'Workers AI — liveness verification, ID-document check, VMS assistant',
        ],
      },
      {
        name: 'Auth model',
        status: 'live',
        summary: 'HttpOnly session cookie is primary; the API also accepts Authorization: Bearer <sessionId>. Client apps deliberately never store tokens.',
        details: [
          'tokenStore.ts in both apps is intentionally inert',
          'Session epoch (users.session_epoch) revokes on role change, PIN reset, deactivation',
          '30-day remember-device option at login',
        ],
      },
      {
        name: 'Offline-first mutations',
        status: 'live',
        summary: 'Clock events and visit check-ins queue in IndexedDB when connectivity drops and replay through the service worker.',
        details: [
          'Queues: clock-queue (staff app), visit-queue (VMS)',
          'Every mutation carries a crypto.randomUUID() idempotency key',
          'Server dedupes via partial unique indexes — replay can never double-write',
        ],
      },
      {
        name: 'Cron suite',
        status: 'live',
        summary: 'A fleet of scheduled jobs keeps the system tidy and the right people informed.',
        details: [
          'Clock reminders · daily/weekly/monthly/yearly summaries · NSS end-of-service',
          'SLA escalation every 15 min (8–17, Mon–Fri) · auto-checkout sweep 17:15 weekdays',
          'Nightly maintenance: photo retention purge + D1→R2 backup',
        ],
      },
    ],
  },
  {
    id: 'staff-clock',
    title: 'Staff Clock-In',
    tagline: 'Five gates between a tap and a timestamp',
    color: '#1A7A3A',
    icon: 'fingerprint',
    features: [
      {
        name: 'Scan-first clock flow',
        status: 'live',
        summary: 'One tap runs the full pipeline: presence scan first (GPS warming in parallel), geofence check, liveness challenge, biometric/PIN re-auth, submit.',
        details: [
          'Scan step and GPS rendezvous via refs — whichever finishes first waits on the other',
          'Failures surface as plain-language screens (poor GPS, outside geofence, wrong PIN)',
          'Optimistic Today card updates before the server confirms',
        ],
      },
      {
        name: 'Geofence',
        status: 'live',
        summary: 'The true OHCS footprint (~34×76m polygon) with an accuracy-aware buffer, checked on the device for instant feedback and re-validated on the server for truth.',
        details: [
          'Buffer = 8m + full reported GPS accuracy (indoor multipath routinely exceeds the ± estimate)',
          'Hard accuracy cap: fixes worse than ±30m are rejected outright',
          'Worst-case buffer (38m) stays short of the neighbouring ministries',
        ],
      },
      {
        name: 'Passive liveness',
        status: 'live',
        summary: 'A MediaPipe challenge (blink/turn) captures a 3-frame burst; Workers AI verifies it against the challenge. Prevents photo-of-a-photo clock-ins.',
        details: [
          'Enforcement is a three-way app_settings mode: 0 off · 1 shadow · 2 enforce',
          'Shadow mode defers verification to a background task so the response stays fast',
          'Manual-review escape valve caps at a daily quota',
        ],
      },
      {
        name: 'Re-authentication',
        status: 'live',
        summary: 'Every clock event re-proves identity — WebAuthn biometric when enrolled, staff PIN as fallback.',
        details: [
          'The WebAuthn challenge is the single-use prompt id shown in the liveness frame',
          'Wrong-PIN rate limit locks until the next day',
          'Same 0/1/2 enforcement mode as liveness',
        ],
      },
      {
        name: 'Default PIN convention',
        status: 'live',
        summary: 'New and reset PINs are the last 4 digits of the staff ID, zero-left-padded when the ID has fewer than 4 digits.',
        details: [
          'Staff ID "123" → PIN 0123 · "OHCS-45" → 0045',
          'Welcome email carries the actual PIN — staff never guess the padding',
          'First login forces a PIN change (pin_acknowledged flag)',
        ],
      },
      {
        name: 'Streaks & status',
        status: 'live',
        summary: 'Day streaks and longest-streak tracking give the clock screen its daily pull.',
        details: ['GET /clock/my-status — clocked_in/out, times, streaks (30s poll)'],
      },
    ],
  },
  {
    id: 'presence-risk',
    title: 'Presence & Risk',
    tagline: 'Proof-of-presence and scored trust, shipped dark first',
    color: '#2A9D8F',
    icon: 'shield-check',
    features: [
      {
        name: 'Presence QR',
        status: 'shadow',
        summary: 'A rotating QR on the reception display proves physical presence at clock time. Enforced on clock-in; flag-only on clock-out so nobody is ever trapped by a blocked checkout.',
        details: [
          'Display at /presence-display (reception tablet); tokens rotate in KV',
          'Deep-link prefill (?presence=…) counts as the scan; fresh in-app scan wins',
          'presence_qr_mode: 0 off · 1 shadow (record-only) · 2 enforce — reception override PIN is the escape valve',
          'Expired/replayed tokens classify as qr_pending for HR review, never as forgery',
        ],
      },
      {
        name: 'Attendance risk fusion',
        status: 'shadow',
        summary: 'Every clock event is scored across weighted factors — geofence margin, device novelty, presence, liveness, re-auth — and the score + factors persist for calibration.',
        details: [
          'risk_fusion_mode: 0 off · 1 shadow · 2 enforce; blocking is a SEPARATE flag (risk_fusion_block_enabled)',
          'Distribution + disposition endpoints feed the review dashboard',
          'Tune WEIGHTS in services/risk-score.ts after ~2 weeks of shadow data',
        ],
      },
      {
        name: 'Device novelty',
        status: 'live',
        summary: 'A stable per-install device id rides every clock submission as a risk signal — no PII, just "have we seen this device before".',
        details: ['Sent on both the multipart and offline-queue paths; replays carry the original device_id'],
      },
      {
        name: 'Face-match (enrolled reference)',
        status: 'design',
        summary: 'Matching the liveness frame against an enrolled reference photo. Specs exist from 2026-04; not yet implemented.',
        details: ['Stays an optional risk-fusion input until it ships as its own project'],
      },
    ],
  },
  {
    id: 'kiosk',
    title: 'Kiosk Experience',
    tagline: 'The reception tablet visitors actually touch',
    color: '#D4A017',
    icon: 'monitor',
    features: [
      {
        name: 'Welcome actions',
        status: 'live',
        summary: 'Four plain-language doors: New Visitor Check In, Visitor Check Out, Been Here Before?, and I Have an Appointment.',
        details: ['Office-hours banner when closed; check-in needs a reception override PIN outside hours, checkout stays open'],
      },
      {
        name: 'New visitor check-in',
        status: 'live',
        summary: 'Details → face photo → done. The badge carries a QR and a 6-digit checkout PIN; a "Where to Go" card shows host, directorate, floor and wing.',
        details: [
          'Host picker searches the officer directory; availability dots warn when the host is busy',
          'ID-photo check (Workers AI) gates when enabled; reception override bypasses with audit',
        ],
      },
      {
        name: 'Returning-visitor fast lane',
        status: 'live',
        summary: 'Phone number pulls up the saved identity — locked fields, just purpose and host. The photo on file is reused instead of forcing a retake.',
        details: [
          'GET /kiosk/visitor-by-phone — no-oracle 404, rate-limited',
          'Photo step shows the stored photo with Update/Continue; a forced retake would overwrite the reference photo',
        ],
      },
      {
        name: 'Checkout + satisfaction survey',
        status: 'live',
        summary: 'Badge scan or 6-digit PIN ends the visit, then a ten-second micro-survey: five stars, optional comment, thank-you.',
        details: [
          'Single-use KV survey token minted at checkout (10-min TTL) gates the public submit',
          'Responses land on the Feedback page; ≤2★ fires survey_low_rating alerts to the Client Service tier',
          'Survey never blocks checkout — skippable, idle auto-reset',
        ],
      },
      {
        name: 'Appointment arrival',
        status: 'live',
        summary: 'Reference code typed or QR-scanned — both converge on the same lookup, then a confirm screen with directions.',
        details: ['The confirmed-appointment email carries an email-safe HTML-table QR of the ref code'],
      },
    ],
  },
  {
    id: 'reception',
    title: 'Reception & Visits',
    tagline: 'The desk that sees everything at once',
    color: '#1A4D2E',
    icon: 'users',
    features: [
      {
        name: 'Live dashboard',
        status: 'live',
        summary: 'Real-time in-building roster with wait-time colors, waiting-first sort, and the post-close bulk-checkout banner.',
        details: ['Auto-refresh; evacuation roll opens as a printable modal'],
      },
      {
        name: 'Reception check-in',
        status: 'live',
        summary: 'Staff-driven check-in with the smart officer combobox, host availability warnings, and delegation party capture (+N chips on badge, log and detail).',
        details: ['Watchlisted banned visitors stay poker-face at the desk — the alert goes silently to reception/admin'],
      },
      {
        name: 'Visit log & visitor profiles',
        status: 'live',
        summary: 'Full visit history per visitor, returning-visit context, and superadmin watchlist management (VIP/banned) on the profile.',
        details: [],
      },
      {
        name: 'Host availability',
        status: 'live',
        summary: 'Officers broadcast available / in-meeting / out-of-office — set via Telegram bot or the profile page, surfaced in the combobox, kiosk and Telegram fanout.',
        details: ['officers.availability_status; NULL reads as available'],
      },
      {
        name: 'Reports & analytics',
        status: 'live',
        summary: 'Daily snapshots, period trends, busiest directorates and peak hours, top visitors, CSV export.',
        details: ['/analytics/* (admin + director) · /reports/*'],
      },
    ],
  },
  {
    id: 'telegram',
    title: 'Telegram & Notifications',
    tagline: 'The alert channel officers actually read',
    color: '#7C3AED',
    icon: 'send',
    features: [
      {
        name: 'Arrival alerts with actions',
        status: 'live',
        summary: 'The host gets a photo message (text fallback) with the visitor, party line and purpose — plus inline buttons: Coming down / Waiting area / Reschedule. First response wins and is audited.',
        details: [
          'Fanout receivers get "Visitor for {host}" with a host-status line when covering',
          '≤2★ survey ratings and SLA breaches notify through the same plumbing',
        ],
      },
      {
        name: 'Thread close-out',
        status: 'live',
        summary: 'When the visitor checks out, every arrival message rewrites itself to "✅ Visit ended · duration" and drops its keyboard. The host\'s chat is a clean open/closed timeline.',
        details: ['Message ids tracked in KV (tg-arrival:<visitId>, 36h); photo messages edit via caption'],
      },
      {
        name: 'Bot commands',
        status: 'live',
        summary: '/link, /unlink, /status, /available, /meeting, /out, /admin, /stop, /help — linking works for officers and user accounts alike.',
        details: ['Command set published via POST /api/admin/telegram/sync-commands (superadmin)'],
      },
      {
        name: 'Escalations & digests',
        status: 'live',
        summary: 'SLA breach (30-min unanswered → directorate receivers, KV-deduped), 17:15 checkout sweep, VIP → leadership + admin chat, banned → silent reception alert, opt-in daily summaries.',
        details: [],
      },
      {
        name: 'In-app + web push',
        status: 'live',
        summary: 'The notification bell mirrors everything, and a per-type whitelist decides what also fires web push. Dead push subscriptions clean themselves up.',
        details: ['Whitelisted types include visitor_arrival, sla_breach, checkout_sweep, watchlist_alert, survey_low_rating'],
      },
      {
        name: 'Comms (announcements / chat)',
        status: 'design',
        summary: 'Broadcast announcements and in-app chat. Plans exist (2026-04-28 series); chat has policy prerequisites to settle first.',
        details: [],
      },
    ],
  },
  {
    id: 'appointments',
    title: 'Appointments',
    tagline: 'Pre-booked visits that skip the queue',
    color: '#1A4D8B',
    icon: 'calendar',
    features: [
      {
        name: 'Public booking',
        status: 'live',
        summary: 'The /book page lets a visitor request a slot with a host; confirmation issues a reference code.',
        details: [],
      },
      {
        name: 'Confirmation email + QR',
        status: 'live',
        summary: 'The confirmed appointment email carries an email-safe HTML-table QR of the reference code — scannable straight from the phone at the kiosk.',
        details: [],
      },
      {
        name: 'Administration',
        status: 'live',
        summary: 'Superadmin/admin manage appointments in the Admin portal tab; reception gets a read-only day view.',
        details: [],
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety & Compliance',
    tagline: 'Watchlists, escalations and a clean audit trail',
    color: '#8B1A1A',
    icon: 'shield-alert',
    features: [
      {
        name: 'Visitor watchlist',
        status: 'live',
        summary: 'visitors.flag marks VIP or banned. VIP pings leadership and the admin chat; banned triggers a silent reception alert while the desk stays poker-faced.',
        details: [],
      },
      {
        name: 'Waiting-time SLA',
        status: 'live',
        summary: 'Unanswered visits older than 30 minutes escalate to directorate receivers every 15 minutes during the workday, deduped in KV.',
        details: ['Cron */15 8-17 * * 1-5 · notification type sla_breach'],
      },
      {
        name: 'Auto-checkout sweep',
        status: 'live',
        summary: 'At 17:15 on weekdays, open visits are swept to checked-out; reception and the admin chat get the alert, and the dashboard shows the amber banner.',
        details: ['Skips weekends and holidays · POST /visits/bulk-checkout'],
      },
      {
        name: 'Evacuation roll',
        status: 'live',
        summary: 'One tap produces the printable in-building roster for fire drills and real evacuations, plus a notify action.',
        details: ['GET /reports/evacuation · dashboard modal with print stylesheet'],
      },
      {
        name: 'Audit log',
        status: 'live',
        summary: 'Append-only, hash-chained audit of sensitive mutations — role changes, overrides, flag edits, settings — inspectable in the Admin portal.',
        details: ['recordAudit on every sensitive mutation; chain verifiable'],
      },
    ],
  },
  {
    id: 'roles',
    title: 'Roles & Access',
    tagline: 'Six database roles plus a display tier',
    color: '#C4920F',
    icon: 'key',
    features: [
      {
        name: 'The six roles',
        status: 'live',
        summary: 'superadmin (everything) · admin (NSS/interns, appointments, analytics — no user management) · receptionist (front desk) · it (support) · director (analytics + FYI alerts) · staff (self-service attendance).',
        details: ['Route guards use requireRole; nav hides what the role cannot use'],
      },
      {
        name: 'Client Service (display tier)',
        status: 'live',
        summary: 'users.display_role re-labels a user without changing access. Client Service rides on receptionist — reception parity with a violet badge across admin, header and profile.',
        details: [
          'Exists because prod users.role has a CHECK capping DB values at six roles and D1 FK enforcement blocks the rebuild',
          'roleLabel() in web/lib/roles.ts renders the display label everywhere',
        ],
      },
      {
        name: 'Provisioning',
        status: 'live',
        summary: 'Accounts are created individually, batch-provisioned from the officer roster, or bulk-imported by CSV. Welcome emails carry the temporary PIN.',
        details: ['Reset-PIN returns to the staff-ID default and forces a change at next login'],
      },
      {
        name: 'Session revocation',
        status: 'live',
        summary: 'Role changes, PIN resets and deactivation bump the session epoch, invalidating every live session for that user immediately.',
        details: [],
      },
    ],
  },
  {
    id: 'operations',
    title: 'Operations & Conventions',
    tagline: 'How this system changes safely',
    color: '#6B6352',
    icon: 'settings',
    features: [
      {
        name: 'Settings flags graduate',
        status: 'live',
        summary: 'New enforcement ships as an app_settings integer mode — 0 off, 1 shadow (record-only), 2 enforce — with a three-way toggle in Settings. Nothing new ever goes straight to enforce.',
        details: ['presence_qr_mode · risk_fusion_mode (+ separate block flag) · clockin reauth & liveness enforce'],
      },
      {
        name: 'Additive-only migrations',
        status: 'live',
        summary: 'Migrations are ALTER-ADD style files registered LAST in migrations-index.ts; schema.sql mirrors the same end state. The superadmin migration runner applies them on prod, tracked by filename + SHA-256.',
        details: [
          'Whole-line comments only — the runner splits statements on semicolons',
          'Deploy → run the runner immediately when hot tables gain columns',
        ],
      },
      {
        name: 'Deploy pipeline',
        status: 'live',
        summary: 'Push to main runs typecheck + tests, deploys the Worker and both Pages, then smoke-checks the API (kiosk status canary).',
        details: ['CI curls the workers.dev host — bot protection 403s the branded domain from CI'],
      },
      {
        name: 'Nightly maintenance',
        status: 'live',
        summary: 'Cron purges visitor photos past the retention setting and exports a D1 backup to R2 (optionally AES-GCM encrypted).',
        details: [],
      },
      {
        name: 'The documentation rule',
        status: 'live',
        summary: 'This page is a maintained artifact: every shipped feature adds or updates its entry in packages/web/src/docs/content.ts in the same commit, with the correct status badge.',
        details: ['The AGENTS.md feature-state table is the internal mirror of this page'],
      },
    ],
  },
];
