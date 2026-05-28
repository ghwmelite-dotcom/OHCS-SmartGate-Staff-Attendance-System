## [cover]
title: Security & Trust
subtitle: How SmartGate keeps OHCS data safe — by design, not by hope
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Trust isn't a feature. It's a side-effect of a hundred small decisions made carefully.

## [toc]
- The twelve-fix hardening pass
- Self-hosted Web Push — no third party in the loop
- Role-based access, constant-time secrets, audited migrations

## [statement]
headline: Twelve security fixes. One quarter.
sub: Logged together as a single hardening sweep across OTP exposure, PIN timing, CORS, photo auth, RBAC, and rate limits.

## [evidence]
title: The hardening sweep at a glance
image: ../_assets/screenshots/S19-security-fixes-list.png
bullets:
    - Each fix has a written spec and a tested fix.
    - The list is in the repo — not a slide deck.
    - Every fix shipped within 30 days of being filed.
caption: Source — docs/superpowers/specs/2026-04-18-security-hardening-design.md

## [statement]
headline: PIN verification runs in constant time.
sub: No length leaks. No timing oracles. Byte-wise XOR comparison.

## [evidence]
title: Constant-time PIN compare
image: ../_assets/screenshots/S20-rbac-middleware.png
bullets:
    - PINs are SHA-256 hashed at rest.
    - Comparison cannot short-circuit on first mismatch.
    - Same time to fail whether your PIN is right or wrong.
caption: packages/api/src/services/auth — verifyPin()

## [statement]
headline: Web Push, self-hosted from scratch.
sub: VAPID JWT signing, RFC 8291 aes128gcm encryption — via Web Crypto API in a Worker.

## [evidence]
title: Zero third-party push dependencies
image: ../_assets/screenshots/S18-webpush-code.png
bullets:
    - No FCM, no OneSignal, no proxy.
    - VAPID private key is a Worker secret.
    - Push payload encrypted end-to-end per subscription.
caption: packages/api/src/lib/webpush.ts

## [wow]
hero: 0
label: Third-party push services in the delivery path. Zero.

## [statement]
headline: Role-based access, centralised.
sub: One requireRole guard. Six roles. Every authenticated endpoint passes through it.

## [evidence]
title: Six roles, one guard
image: ../_assets/screenshots/S20-rbac-middleware.png
bullets:
    - superadmin, admin, director, receptionist, it, staff.
    - Routes declare required role inline.
    - Drift is detectable — every endpoint exercises the guard.
caption: packages/api/src/lib/require-role.ts

## [statement]
headline: Login attempts are rate-limited at the edge.
sub: KV-backed counters per email, per IP, per staff ID. Brute force has nowhere to land.

## [evidence]
title: Rate-limit hit, surfaced to the user
image: ../_assets/screenshots/S33-ratelimit-hit.png
bullets:
    - /auth/login, /auth/verify, /auth/pin-login all gated.
    - Cloudflare KV stores hit counts with TTL.
    - Counters reset cleanly — no false lockouts.
caption: Captured from staff-attendance.pages.dev DevTools

## [statement]
headline: Migrations are tracked, not whispered.
sub: An applied_migrations table records every schema change. The runner is superadmin-only.

## [divider]
line: Security shipped in the dark is security that erodes. SmartGate's was shipped in writing.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System
related:
    - Deck 06 · The Notifications Engine
    - Deck 12 · The Build Discipline
