# Presence Display — Reception Tablet Setup

The presence display runs in a browser at:

**https://smartgate.ohcsghana.org/presence-display**

It is public (no login) and read-only — the tablet only *shows* the rotating
QR code; it never submits anything. Staff scan the code with the Staff
Attendance app as part of clock-in. The code rotates every ~45 seconds, so a
photograph of it is useless a minute later.

> This page ships with the presence-QR feature. If the URL 404s, the feature
> has not been deployed yet — see
> `docs/superpowers/specs/2026-07-19-presence-qr-design.md`.

## Hardware

- **Tablet:** any mid-range Android tablet (Samsung Galaxy Tab A-class or
  better). It renders one QR and a clock — no camera, no performance demands.
- **Mount:** secure desk stand on the reception counter, angled toward staff
  as they pass reception on entry. A wall mount beside the desk at ~1.4 m
  works equally well.
- **Power:** permanent power via the counter outlet; enable auto-boot on
  power restore in the tablet's settings so it recovers from outages
  unattended.

> Keep this tablet **separate** from the visitor kiosk tablet. The kiosk is
> for visitors; the presence display is for staff. One device cannot serve
> both at the 08:15–08:30 rush.

## Tablet setup (one-time)

1. **Connect to the office Wi-Fi.** The page polls the API every ~20 s; any
   stable connection is fine.
2. **Open** `https://smartgate.ohcsghana.org/presence-display` in Chrome.
3. **Pin it for unattended use:**
   - **Android:** Chrome menu → *Add to Home screen*, then enable a
     kiosk/lockdown launcher (or Android's built-in *App pinning*:
     Settings → Security → App pinning) so the tablet is restricted to this
     one page.
   - **iPad:** Share → *Add to Home Screen*; optionally enable *Guided
     Access* (Settings → Accessibility → Guided Access).
4. **Keep the screen awake:** set screen timeout to *Never* (Android:
   Settings → Display → Screen timeout; on Samsung, *Keep screen on while
   viewing* also works). The page shifts the QR position slightly (a couple
   of percent) on each rotation to protect the panel, but it must never
   sleep.
5. **Disable updates/prompts that steal focus:** turn off Chrome update
   nags and OS update notifications where possible — anything that pops over
   the QR interrupts clock-ins.

## Verify it works

- The page shows a **large QR**, the current time/date, and an
  **Office open/closed** line, with no login prompt.
- The QR visibly changes roughly every 45 seconds, with a small countdown
  ring showing time to next rotation.
- Scan the code with a phone camera: it resolves to
  `https://staff-attendance.ohcsghana.org/clock?presence=...`.
- Unplug Wi-Fi briefly: the page must switch to the explicit
  **"QR unavailable — see reception"** state, never show a stale code.

## Daily operation

Nothing. Reception staff do not drive this tablet — it runs unattended.
If a staff member reports the code "not scanning":

1. Check the tablet shows a live QR (not the unavailable state).
2. Check the staff member is on the latest Staff Attendance app version.

## Shared-device clock-in (officers without a phone)

Since 2026-07-21 the display also carries a **6-digit code** under the QR and
a **"Clock in on this device"** button, so an officer without a working phone
can clock in on the display tablet itself (spec:
`docs/superpowers/specs/2026-07-21-presence-code-shared-device-design.md`).

One-time extra setup:

1. **Install the Staff Attendance PWA on the same tablet:**
   `https://staff-attendance.ohcsghana.org` → Chrome menu → *Add to Home
   screen*. Keep it as a separate icon from the display — the display keeps
   running in its own tab/app so everyone else can still scan.
2. **If the tablet is in a lockdown launcher**, whitelist both the display
   page and the staff PWA.

How an officer uses it:

1. Tap **Clock in on this device** on the display (opens the staff app with
   the presence token pre-filled — no typing), or open the staff app manually
   and use **"No phone? Enter the 6-digit code instead"** on the scan screen
   with the code shown under the QR (tap the code to copy it).
2. Log in with staff ID + PIN, tap Clock In / Clock Out as usual.
3. **Sign out afterwards (Settings → Sign Out).** This is a shared device —
   the per-clock PIN re-auth protects the clock action itself, but the open
   session shows the previous officer's details to the next person. A small
   printed reminder at the tablet is recommended.

The code rotates with the QR every ~45 seconds and only ever works at the
building (the geofence still applies), so a photographed code is as useless
as a photographed QR.
3. If the tablet is down, reception handles the clock-in manually via the
   existing **override PIN** path.

## Related

- Design spec: `docs/superpowers/specs/2026-07-19-presence-qr-design.md`
- Visitor kiosk tablet (separate device): `docs/ops/lobby-kiosk-setup.md`
- Deployment: pushes to `main` auto-deploy the Worker + both Pages projects
  via `.github/workflows/deploy.yml`; the presence display ships with the
  VMS Pages build.
