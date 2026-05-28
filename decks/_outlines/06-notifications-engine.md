## [cover]
title: The Notifications Engine
subtitle: Three channels, one promise
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A notification that doesn't arrive isn't a feature. It's a failure with a logo.

## [toc]
- The three channels
- The five scheduled jobs
- How we know they actually arrived

## [statement]
headline: One event. Three channels. Whichever the user reads first.
sub: In-app bell, Telegram, Web Push. Redundancy by design, not by accident.

## [evidence]
title: Telegram — the surface leadership uses
image: ../_assets/screenshots/S14-daily-summary.png
bullets:
    - 9:00 AM daily summary, weekday cadence.
    - Per-directorate clocked/not-clocked counts.
    - HTML-escaped to neutralise injection from user input.
caption: Daily summary, real morning.

## [evidence]
title: Web Push — for hosts on the move
image: ../_assets/screenshots/S15-late-clock-push.png
bullets:
    - VAPID signed, aes128gcm encrypted.
    - Five whitelisted push types only.
    - Delivered even when the app is closed.
caption: Late-clock alert, lockscreen.

## [statement]
headline: Five scheduled jobs run themselves.
sub: 08:30 weekday clock-reminders, 09:00 daily summary, 16:00 Friday weekly digest, 09:00 monthly report, 09:00 yearly recap.

## [evidence]
title: Cloudflare cron triggers
image: ../_assets/screenshots/S31-wrangler-cron.png
bullets:
    - Schedules are configuration, not code.
    - Each cron writes a log line.
    - Failures route to the health endpoint.
caption: packages/api/wrangler.toml.

## [wow]
hero: <N09>
label: Push delivery success rate over the last 7 days.

## [statement]
headline: Five push types. Whitelisted. Auditable.
sub: visitor_arrival, clock_reminder, late_clock_alert, monthly_report_ready, absence_notice. No surprise pushes, ever.

## [statement]
headline: When push fails, we see it the same day.
sub: A 7-day KV-backed counter buckets responses by HTTP status.

## [evidence]
title: Push health endpoint
image: ../_assets/screenshots/S35-push-health.png
bullets:
    - GET /api/admin/health/push — superadmin-gated.
    - 7-day rolling window, per-status counts.
    - Silent breakage becomes visible breakage.
caption: /api/admin/health/push.

## [statement]
headline: Telegram messages are HTML-safe.
sub: Every user-supplied field is escaped. The bot never renders attacker-controlled HTML.

## [divider]
line: Notifications are how the system speaks. We made it speak carefully.

## [appendix]
links:
    - /api/admin/health/push
    - ohcs-smartgate-api.ghwmelite.workers.dev
related:
    - Deck 04 · Security & Trust
    - Deck 11 · Director Visibility
