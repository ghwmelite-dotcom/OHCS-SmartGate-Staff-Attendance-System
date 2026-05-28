## [cover]
title: GPS Geofence Precision
subtitle: A circle that respects your signal
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: The hardest part of a geofence is being right when the GPS isn't.

## [toc]
- The OHCS HQ fence
- The accuracy-aware buffer
- The precision retrace fix

## [statement]
headline: A 75-metre fence around OHCS HQ.
sub: Centre at 5.55269 N, -0.19752 E. Tight enough to mean something, wide enough to be fair.

## [evidence]
title: The fence on a map
image: ../_assets/screenshots/S16-hq-map-fence.png
bullets:
    - Centre point at the main building.
    - 75-metre radius.
    - Covers reception, courtyard, parking.
caption: Google Maps with the fence drawn for reference.

## [statement]
headline: GPS lies. Honestly.
sub: Every reading comes with a reported accuracy in metres. We use it.

## [evidence]
title: Clock-in, weak signal at the boundary — accepted
image: ../_assets/screenshots/S09-clockin-weak-gps.png
bullets:
    - Reading 70m from centre, 40m accuracy.
    - Buffer scales — fence becomes effective 115m.
    - Real user, real building, real result.
caption: Edge case validated in production.

## [evidence]
title: Clock-in, clearly outside — rejected with reasons
image: ../_assets/screenshots/S10-clockin-rejected.png
bullets:
    - Reading 250m from centre.
    - Even with worst-case accuracy, still outside.
    - User sees distance + accuracy + why.
caption: Honest rejection at a coffee shop nearby.

## [wow]
hero: <N04>
label: First-try success rate, inside the geofence.

## [statement]
headline: The retrace fix that turned approximation into precision.
sub: Replaced a 3-building rectangle hack with proper Haversine + accuracy buffer logic.

## [evidence]
title: Commit 59b564a — the precision retrace
image: ../_assets/screenshots/S17-geofence-commit.png
bullets:
    - Before — a 3-building approximation, brittle and unfair.
    - After — Haversine distance + reported-accuracy buffer.
    - Specced, planned, executed — same week.
caption: github.com — commit 59b564a.

## [statement]
headline: Honest rejections beat clever workarounds.
sub: Users trust the system because the system tells them the truth.

## [divider]
line: Geofences fail when they pretend GPS is perfect. Ours assumes it isn't.

## [appendix]
links:
    - staff-attendance.pages.dev
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System/commit/59b564a
related:
    - Deck 03 · Staff Attendance Spotlight
    - Deck 12 · The Build Discipline
