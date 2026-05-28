## [cover]
title: Offline-First Resilience
subtitle: When the Wi-Fi drops, the work doesn't
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Most apps tell you to try again later. SmartGate gets on with it.

## [toc]
- What the user sees when offline
- What the system does behind the glass
- Why nothing is ever lost

## [statement]
headline: The banner is honest. The work is unbroken.
sub: A persistent indicator tells the user we're offline. A queue keeps accepting their actions anyway.

## [evidence]
title: Offline banner, staff app
image: ../_assets/screenshots/S21-offline-banner.png
bullets:
    - Subtle, persistent, dismissible.
    - Mutations queued silently in the background.
    - User keeps clocking, keeps checking in visitors.
caption: staff-attendance.pages.dev, airplane mode.

## [statement]
headline: IndexedDB is the buffer.
sub: Every action that would mutate the server is staged locally first.

## [evidence]
title: The queue in action
image: ../_assets/screenshots/S22-queue-replay.png
bullets:
    - Mutations stored in IndexedDB with a unique idempotency key.
    - Background Sync API triggers replay on reconnect.
    - iOS falls back to a flush-queue message.
caption: Chrome DevTools — Application → IndexedDB.

## [statement]
headline: Replay is idempotent.
sub: Same request twice produces the same result. No duplicate clock-ins, ever.

## [wow]
hero: <N10>
label: Offline-queued mutations replayed successfully. Zero losses.

## [statement]
headline: Installable. Updatable. Distinct.
sub: Both apps install to the home screen with branded icons that don't look alike.

## [evidence]
title: Two icons, instantly recognisable
image: ../_assets/screenshots/S24-home-screen-icons.png
bullets:
    - Green clock badge for Staff Attendance.
    - Gold user-plus badge for SmartGate.
    - One glance to the right app.
caption: iOS home screen with both PWAs installed.

## [statement]
headline: Service worker, hand-rolled.
sub: No PWA framework. Just the platform — for control and clarity.

## [divider]
line: Offline isn't a feature. It's the default state of a building you can't always reach.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
related:
    - Deck 02 · SmartGate Spotlight
    - Deck 12 · The Build Discipline
