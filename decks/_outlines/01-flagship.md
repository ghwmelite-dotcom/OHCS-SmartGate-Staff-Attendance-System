## [cover]
title: OHCS SmartGate & Staff Attendance
subtitle: The story so far
tier: flagship
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Before SmartGate, OHCS knew who arrived only when someone signed a book.

## [toc]
- What we built and why
- What it does today
- What ongoing care looks like

## [statement]
headline: Two installable apps. One quiet system.
sub: SmartGate for visitors. Staff Attendance for officers. Both on every phone, both invisible until needed.

## [evidence]
title: The two apps, side by side
image: ../_assets/screenshots/S24-home-screen-icons.png
bullets:
    - Gold badge — SmartGate visitor management.
    - Green badge — Staff Attendance.
    - Distinct enough to find in two seconds.
caption: Both PWAs installed to the home screen, same device.

## [statement]
headline: Edge-delivered. Sub-100ms across West Africa.
sub: Cloudflare Workers, D1, KV, R2 — globally distributed, locally fast.

## [evidence]
title: Architecture in one diagram
image: ../_assets/screenshots/architecture-diagram.png
bullets:
    - Two PWAs on Cloudflare Pages.
    - One Hono-based Worker API.
    - D1 for data, KV for sessions, R2 for photos.
caption: docs/architecture overview.

## [wow]
hero: <N03>
label: Verified clock-ins recorded to date.

## [statement]
headline: Reception used to fill out a book. Now it's three taps.
sub: Visitor search, host selection, purpose tag — printable badge in under a minute.

## [evidence]
title: SmartGate in production
image: ../_assets/screenshots/S03-visitor-badge.png
bullets:
    - Host gets the alert before the visitor sits down.
    - Directorate leadership cc'd automatically.
    - Reports any director can pull in seconds.
caption: ohcs-smartgate.pages.dev, captured May 2026.

## [statement]
headline: Officers clock in from where they actually are.
sub: 75-metre GPS fence around OHCS HQ. Accuracy-aware. Honest about its margins.

## [evidence]
title: Staff Attendance, live
image: ../_assets/screenshots/S08-clockin-success.png
bullets:
    - Tap once. Camera opens. Inside the fence — done.
    - Streak counter ticks. Best-ever stays remembered.
    - Telegram summary to leadership at 9:00 AM sharp.
caption: staff-attendance.pages.dev, captured May 2026.

## [statement]
headline: When the Wi-Fi drops, the work doesn't.
sub: Both apps queue mutations locally and replay them on reconnect.

## [statement]
headline: Security shipped in writing.
sub: Twelve fixes. Constant-time PIN. Self-hosted Web Push. RBAC. Audited migrations.

## [statement]
headline: Designed in a civic register.
sub: Kente Executive — Playfair Display, gold deco, Ghanaian Kente texture. Cultural, not decorative.

## [statement]
headline: Care continues.
sub: Automated tests, bundle optimisation, manifest shortcuts, iOS startup images — stewardship, not unfinished work.

## [divider]
line: SmartGate isn't a product. It's how OHCS shows up for itself.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
    - ohcs-smartgate-api.ghwmelite.workers.dev
related:
    - Deck 02 · SmartGate Spotlight
    - Deck 03 · Staff Attendance Spotlight
    - Deck 13 · Roadmap
