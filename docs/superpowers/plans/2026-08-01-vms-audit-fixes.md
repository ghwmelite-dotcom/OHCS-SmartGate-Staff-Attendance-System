# VMS audit fixes — 2026-08-01

From the four-way VMS audit (public surface / authZ / injection-PII / data
integrity). Sequential commits, TDD, no disruption to working paths.

## Commit A — Telegram bot gates (HIGH)
1. Bare `/link <StaffID>` no longer writes `telegram_chat_id` — reply pointing
   to one-time links (officer-link / telegram-user-link flows); audit-log all
   link writes.
2. `/admin` gated: sender's chat must be linked (`telegram-chat:<chatId>`
   reverse key written at link time) to an admin/superadmin user. `/stop`
   only works for the registered admin chat.
3. Webhook secret compare → timing-safe (`timingSafeEqualStrings`).

## Commit B — injection & export hygiene
4. escapeHtml visitor/officer names in the 3 appointment Telegram sends
   (`appointments-public.ts:295,392,418`).
5. `web/lib/csv.ts`: escape embedded `"`; prefix-guard cells starting with
   `= + - @` (tab/CR too).
6. Remove double-escape of notification titles (`notifier.ts:516`).
7. Clock photo response → `Cache-Control: private` (`index.ts:110`).

## Commit C — auth hardening
8. `auth.ts` self-service routes (`PATCH /profile`, `POST /change-pin`,
   `GET /me`) go through the same is_active + session_epoch revalidation as
   authMiddleware.
9. Staff initial/reset PINs → random 6-digit (`generateInitialPin`, same as
   NSS) in `users.ts:247,294`, `admin-directorates.ts:268`,
   `bulk-import.ts:228`; enforce `pin_acknowledged` server-side (unacknow-
   ledged accounts limited to change-pin/me).
10. Shared reception override PIN → hashed storage with lazy upgrade
    (`services/override.ts`).

## Commit D — web offline queue + kiosk idempotency
11. Port staff SW hardening to `packages/web/public/sw.js` (classify
    delivered/retry/failed; mark-retain; `queue-failed` message) + a portal
    listener surfacing failed queued visits.
12. Kiosk check-in/createVisitor send idempotency keys; fix
    success-screen-on-error (`KioskPage.tsx:194`).
13. Offline visit replays carry capturedAt; server honors it within a
    validation window (mirror clock.ts approach).
14. `checkOutByPin` accepts visits from the last 24h, not just today.

## Commit E — integrity mediums
15. Visitor delete: include `visitor_surveys` in batch (FK fix) + recordAudit
    on DELETE and PUT (`visitors.ts`).
16. `/api/presence/current`: when `presence_qr_mode > 0`, require a display
    credential header (`PRESENCE_DISPLAY_KEY` env secret).
17. `/appointments/public/ref/:code`: per-IP rate limit + trimmed response
    (drop phone/email from payload).
18. Kiosk photo upload on existing visitors bound to a short-lived KV token
    minted by the `visitor-by-phone` lookup.
19. `/reports/visits`: `truncated` flag; ReportsPage surfaces it; dashboard
    visit fetch cap 100→500.
20. Evac roll lists party_names; survey denominator = kiosk checkouts only;
    visitor history limit 20→paginated/raised; kiosk `/officers` drops
    `availability_status` from public payload; backup fails closed when
    `BACKUP_ENCRYPTION_KEY` unset.

## Commit F — appointment arrivals join the visits pipeline
21. `/arrive` creates a `visits` row (host/purpose from the appointment) so
    appointment visitors appear in active visits, visit log, sweep, SLA and
    the evacuation roll. No schema change (no appointment_id column — noted
    for a future gated migration).

## Deferred (documented, not bugs to rush)
- Badge QR PII permanence (40-bit entropy, rate-limited; revisit with
  retention policy).
- KV rate-limiter atomicity (soft ceilings; keyspaces currently adequate).
- Session cookie parent-domain scoping (required for two-PWA SSO).
- Global-unique 6-digit checkout PIN space degradation over years.
