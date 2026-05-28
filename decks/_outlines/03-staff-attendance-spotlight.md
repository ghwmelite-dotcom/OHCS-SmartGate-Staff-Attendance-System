## [cover]
title: Staff Attendance
subtitle: Clocking in, honestly
tier: staff
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A paper sheet records that you were here. Staff Attendance records that you arrived.

## [toc]
- The first-login moment
- The clock-in that respects your GPS
- The streak, the absence, the badge

## [statement]
headline: First login is a moment, not a friction point.
sub: Enforced PIN change with clear language, gentle motion, no jargon.

## [evidence]
title: Enforced PIN change
image: ../_assets/screenshots/S11-first-login-pin.png
bullets:
    - Triggered automatically on default PIN.
    - Validates length + character variety.
    - Confirmation reduces silent re-entry.
caption: First login, fresh account.

## [statement]
headline: The 75-metre circle isn't a circle.
sub: It's a circle plus your phone's reported GPS accuracy.

## [evidence]
title: Clock-in, GPS clean
image: ../_assets/screenshots/S08-clockin-success.png
bullets:
    - Accuracy ≤15m, inside fence — instant approval.
    - Camera-verified selfie on capture.
    - Streak counter ticks.
caption: Typical clock-in, captured live.

## [evidence]
title: Clock-in, weak GPS at boundary
image: ../_assets/screenshots/S09-clockin-weak-gps.png
bullets:
    - Accuracy ~40m at the edge — accepted.
    - Buffer scales with reported accuracy.
    - Real users in real buildings get through.
caption: Edge case, validated.

## [evidence]
title: Clock-in rejected, clearly
image: ../_assets/screenshots/S10-clockin-rejected.png
bullets:
    - 200m+ outside — clear distance shown.
    - GPS accuracy shown alongside.
    - User knows exactly why and where.
caption: Honest rejection, captured.

## [wow]
hero: <N04>
label: First-try success rate inside the geofence.

## [statement]
headline: Streaks turn habit into recognition.
sub: Consecutive working-day counter. "Best-ever" stays remembered.

## [evidence]
title: Streak banner
image: ../_assets/screenshots/S12-streak-banner.png
bullets:
    - Yesterday counts. Today builds. Tomorrow continues.
    - Best-ever displayed alongside current.
    - Quietly celebratory, not gamified-to-death.
caption: Clock page hero — streak module.

## [statement]
headline: Absence is a flow, not a phone call.
sub: Sick, family emergency, transport, other. Optional note. Optional return date.

## [evidence]
title: Absence notice
image: ../_assets/screenshots/S13-absence-modal.png
bullets:
    - One self-service flow.
    - Directors notified immediately.
    - Morning clock-reminder suppressed automatically.
caption: Absence modal, in-progress.

## [statement]
headline: Leadership reads the summary, not the spreadsheet.
sub: Telegram message at 9:00 AM weekdays. Per-directorate breakdown. One screen.

## [evidence]
title: 9:00 AM daily summary
image: ../_assets/screenshots/S14-daily-summary.png
bullets:
    - Sent every weekday at 9:00 sharp.
    - Per-directorate counts of clocked/not-clocked.
    - Outlier names surfaced — no scrolling.
caption: Daily summary, captured today.

## [statement]
headline: One staff voice on what's changed.
sub: "<Q05>"

## [statement]
headline: The eBadge — staff identity, in the pocket.
sub: Digital, scannable, refreshable. The paper card retires.

## [divider]
line: Attendance is dignity. SmartGate treats it that way.

## [appendix]
links:
    - staff-attendance.pages.dev
related:
    - Deck 07 · GPS Geofence Precision
    - Deck 10 · The Staff Experience
    - Deck 11 · Director Visibility
