# Lobby Kiosk — Tablet Setup

The visitor self-service kiosk runs in a browser at:

**https://smartgate.ohcsghana.org/kiosk**

It is public (no login) and rate-limited. A visitor fills in the form, takes a
face photo and an ID photo, and receives a QR badge. On the way out they choose
**Check Out** and scan their badge. Reception staff don't need to drive it.

## QR poster

A printable lobby poster that links to the kiosk is in this folder:

- **Poster (print this):** [`lobby-kiosk-poster.html`](./lobby-kiosk-poster.html)
  — open in any browser and **Print** (Ctrl/Cmd+P → A4/Letter, portrait). The QR
  is an inline SVG, so it prints crisp at any size and needs no network.
- **QR image only:** [`assets/kiosk-qr.svg`](./assets/kiosk-qr.svg) — the bare QR
  code (navy on white) if you want to drop it into your own signage.

Both encode `https://smartgate.ohcsghana.org/kiosk`. Mount the poster at the
reception desk so visitors can scan to check in on their own phones, or use it to
launch the kiosk on the lobby tablet.

> To regenerate the QR (e.g. if the URL changes), from the repo root:
> ```bash
> node -e "const Q=require('qrcode');Q.toString('https://smartgate.ohcsghana.org/kiosk',{type:'svg',errorCorrectionLevel:'M',margin:2,color:{dark:'#1B3A5C',light:'#FFFFFF'}},(e,s)=>require('fs').writeFileSync('docs/ops/assets/kiosk-qr.svg',s))"
> ```
> then paste the new `<svg>…</svg>` into `lobby-kiosk-poster.html` (replacing the
> one inside `<div class="qr">`).

## Tablet setup (one-time)

1. **Use a modern browser over HTTPS.** The kiosk needs the camera, and browsers
   only grant `getUserMedia` on a secure origin. `https://smartgate.ohcsghana.org`
   qualifies — do **not** use a plain-`http` or IP address.
2. **Open** `https://smartgate.ohcsghana.org/kiosk`.
3. **Grant camera permission** when prompted, and set it to *Allow* permanently
   for the site (Android Chrome: site settings → Camera → Allow; iPad Safari:
   Settings → Safari → Camera → Allow). Both the front camera (visitor face) and
   the rear camera (ID document) are used.
4. **Pin it for kiosk use:**
   - **Android:** Chrome menu → *Add to Home screen* to get a full-screen PWA
     launcher; optionally enable a kiosk/lockdown launcher to restrict the tablet
     to this one app.
   - **iPad:** Share → *Add to Home Screen*; optionally enable *Guided Access*
     (Settings → Accessibility → Guided Access) to lock the tablet to the kiosk.
5. **Stand the tablet** at the desk facing the visitor, with good lighting for the
   face/ID photos.

## Verify it works

- The page loads the **Check In / Check Out** welcome screen with no login prompt.
- Tapping **Check In** → fill name → the camera opens for the face photo, then the
  rear camera for the ID photo, then a badge with a QR is shown.
- Tapping **Check Out** opens the scanner; scanning a badge QR checks the visitor
  out after a confirm.

If the camera shows "Camera unavailable", re-check step 1 (HTTPS) and step 3
(camera permission).

## Related

- API/CORS: the custom domain is in the API's `PROD_ORIGINS` allowlist, so the
  kiosk's cross-origin calls to the Workers API are permitted.
- Deployment: pushes to `main` auto-deploy the Worker + both Pages projects via
  `.github/workflows/deploy.yml`.
