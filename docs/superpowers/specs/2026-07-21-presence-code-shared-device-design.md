# Presence Code — Shared-Device Clock-In — Design

Date: 2026-07-21 · Status: implementing · Parent spec: `2026-07-19-presence-qr-design.md`

## Problem

Officers without a working phone (lost, broken, flat) cannot use the presence
QR — and if the clock-in PWA is installed on the *same reception tablet* that
shows the QR, they can't scan it either: same device, same screen.

## Design: one rotating secret, three renderings

The 45-second presence token stays the single secret. It is now presented
three ways, all validated against the same current + previous KV windows:

1. **QR** — camera scan (unchanged).
2. **Deep link** — "Clock in on this device" button on the display opens
   `https://staff-attendance.ohcsghana.org/clock?presence=<token>`; the clock
   flow's existing deep-link prefill consumes the stash (survives the login
   detour). Zero typing — the token hands itself off. On Android the installed
   PWA opens; on iPad the browser does — either way the officer logs in and
   taps Clock In.
3. **6-digit code** — `SHA-256("presence-code:" + token) mod 1e6`, shown under
   the QR (tap-to-copy), typed or pasted into the staff app's scan screen via
   "No phone? Enter the 6-digit code instead" (auto-submits on the 6th digit).
   Derivation is deterministic — no new storage, no cron; the code rotates
   with the token.

## Security analysis

- A code proves exactly what a scan proves — "you can see the reception
  display right now". Relay risk (texting the code / a QR photo) is equivalent
  and bounded by the 45s rotation; **geofence remains the real backstop**
  against remote relays, with liveness and re-auth behind it.
- The 6-digit space (1M) is online-brute-forceable in principle, so code
  attempts are per-user rate-limited (5 / 5 min), unlike UUID tokens.
- Server records `presence_method='code'` (plain TEXT column — no migration)
  so HR can distinguish shared-device clock-ins from camera scans in the
  attendance view (violet "Code" pill).
- Invalid/expired codes follow the token philosophy: classified
  `qr_pending`/`expired` for HR review, never rejected as forgery.
- Shared-device hygiene is social (sign out after clocking) reinforced at the
  point of behavior: a caption on the display ("Shared device — please sign
  out after clocking.") plus the ops-doc setup note. The per-clock PIN re-auth
  already protects the clock action itself if someone forgets.

## Surface changes

- **API**: `presence.ts` — `presenceCodeFromToken`, `validatePresenceCode`;
  `GET /api/presence/current` returns `code`; clock schema accepts
  `presence_code`; the presence gate validates it (rate-limited) and records
  `presence_method='code'`.
- **Staff app**: scan phase gains the code-entry form (typed or pasted);
  `presence_code` rides both submit paths (multipart + offline-queue JSON).
- **Display**: code strip (grouped digits, tap-to-copy) + "Clock in on this
  device" deep-link button + shared-device sign-out caption.
- **Admin**: attendance presence pill renders `code` (violet).
- **Ops**: `docs/ops/presence-display-setup.md` documents installing the staff
  PWA on the display tablet and the sign-out rule.
