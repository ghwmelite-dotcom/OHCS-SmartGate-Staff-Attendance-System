# OHCS Staff E-Badge — Design Proposal

**Status:** Draft for review
**Author:** Engineering
**Date:** 2026-04-28
**Audience:** OHCS leadership / boss review

---

## Executive summary

Replace the physical staff ID card with a **digital badge** displayed inside the existing OHCS Staff Attendance PWA. Each badge contains the staff member's photo, name, role, directorate, badge number, and a **rotating QR code** that security or reception scans with any phone to instantly verify the badge is genuine, in date, and belongs to an active employee. Built on top of features the system already has (visitor badges, signed routes, staff photos), so most of the foundation already exists.

---

## What the staff member sees

A new tab in the staff app: **"My Badge"**.

- Full-screen ID card: photo, full name, role, directorate, badge number.
- Brightness auto-maxes when the screen opens, for outdoor scanning.
- A QR code at the bottom that visibly **refreshes every 30 seconds** (a small countdown ring).
- Works offline — once issued, the badge is cached on the phone, so a flat network signal at the gate doesn't lock anyone out.

That rotating QR is the security mechanism: a static screenshot of someone else's badge becomes useless within seconds.

## What security or reception sees

They scan the QR code with **any phone camera**. It opens a single public web page that shows one of two things:

- **Green ✓ — Verified.** Photo, name, directorate, badge number, time of scan. Held face-up to the staff member to confirm the photo matches.
- **Red ✗ — Not valid.** With the reason: *expired*, *revoked*, *staff inactive*, *tampered code*.

No app to install for the guard. No login. Just camera → page.

## What HR / admin gets

A new "Badges" tab in the admin portal:

- See every staff member with their badge status — *Active*, *Revoked*, *Not yet issued*.
- **Issue a badge** (or bulk-issue for everyone in the active roster).
- **Revoke** with a reason (e.g. *lost phone*, *staff exited*, *suspended*).
- **Regenerate** if a phone is lost — instantly invalidates any cached badge on the missing device.
- Self-service: staff can "Lock my badge" themselves from Settings if they lose their phone, then HR re-issues.

---

## How it stays secure (in plain English)

| Risk | How we handle it |
| --- | --- |
| Someone screenshots a colleague's badge | The QR rotates every 30 s — a screenshot expires before it can be re-used |
| Lost or stolen phone | Existing PIN/biometric on app login + admin revoke takes effect immediately |
| Forged QR | Each code is signed with a per-staff secret only the OHCS server knows; tampering fails the check |
| Photo doesn't match the person | The verify page shows the photo large and clear — the guard does the visual check |
| Faked verify page | Verify page lives on the official OHCS domain, with HTTPS, branded |

---

## Scope of work

Three rollout phases, each shippable independently:

**Phase 1 — Foundation** (~1 week)
Database table, badge issuance, the staff "My Badge" screen with a signed QR, the public verify page.

**Phase 2 — Rotation & admin** (~1 week)
Rotating QR (refresh every 30 s), admin Badges tab (issue / revoke / regenerate), self-service "Lock my badge".

**Phase 3 — Polish** (~3 days)
Bulk-issue from CSV, printable PDF fallback (in case a phone dies), audit log of who issued/revoked what, branded badge design pass.

Total: roughly the same size as one of the recent NSS phases, broken into 3 deploys.

---

## Decisions needed from you

Six small things that determine details of the build:

1. **Badge number format.** Auto-generated like `OHCS-2026-0042`, or do staff already have ID numbers we should encode?
2. **Validity period.** One year? Tied to contract end date for NSS personnel? Open-ended for permanent staff?
3. **Photo source.** Does HR have official ID photos for everyone, or should staff upload a selfie on first badge open?
4. **Verify URL.** Use the existing site (`smartgate.ohcsghana.org/v/...`) or set up a dedicated subdomain (`verify.ohcsghana.org`) for a more official feel? The latter is a 30-minute Cloudflare DNS task.
5. **Printable fallback.** Should the badge also be downloadable as a PDF? Useful if a phone dies; less secure than the rotating QR (no rotation on paper). Recommend: yes, with a clear *"Backup — present digital badge when possible"* watermark.
6. **Initial rollout.** Issue to all active staff at once via bulk script, or generate-on-first-open? Bulk is more dramatic but assumes everyone shows up; on-demand is gradual.

---

## What this does NOT do (intentionally)

These are bigger projects to consider once the basic e-badge is proven in the field:

- **Door access / turnstile control.** Would require NFC reader integration with each door — separate hardware and integration project.
- **Apple Wallet / Google Wallet pass.** Nicer UX (badge appears in the OS wallet without opening the app), but adds Apple Developer + Google Wallet API setup. Worth doing once #1 above shows real demand.
- **Replacement of biometric/PIN login.** The badge is for *showing identity to others*; it doesn't replace how staff log into the app.

---

## Recommendation

Build Phase 1 + Phase 2 in the next sprint. That gives a real, useful e-badge with the security guarantees that justify the project — every other variation is either a polish item or a future expansion. We can take Phase 3 + Wallet/NFC after staff have actually used it for a couple of weeks and we know what's friction.

---

## Technical appendix (for the engineering team)

<details>
<summary>Click to expand — implementation details</summary>

### Data model

```sql
CREATE TABLE staff_badges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  badge_number  TEXT NOT NULL UNIQUE,
  issued_at     INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER,
  revoke_reason TEXT
);
```

Per-staff signing secret stored in KV (`badge-secret:<userId>`, 32 bytes). DB row holds metadata + secret hash for tamper detection. Worker env holds a global pepper.

### Token shape

`base64url( payload ) . base64url( hmacSha256(payload, secret + pepper) )`

Payload: `{ uid, bid, iat, exp }` where `exp = iat + 30s`. Verifier checks signature + clock skew (±10 s) + revocation + active flag + replay cache (KV `badge-jti:<uid>:<iat>`, 60 s TTL).

### Routes

Staff (authed):
- `GET /api/badges/me` — once on `/badge` mount; returns metadata + ephemeral secret for client-side rotation.

Public (rate-limited):
- `GET /v/:token` — HTML verify page (mirrors `serveBadgePage` style).
- `GET /api/badges/verify/:token` — JSON for the page.

Admin (`superadmin`, `f_and_a_admin`, plus a new `hr_admin` role if needed):
- `POST /api/admin/badges/issue` — single or bulk.
- `POST /api/admin/badges/:id/revoke` — body `{ reason }`.
- `POST /api/admin/badges/:id/regenerate-secret` — bumps secret and KV entry.

### PWA pieces

- New page `packages/staff/src/pages/BadgePage.tsx`.
- Add a "My Badge" tile/route accessible from the clock screen.
- Client computes a fresh HMAC every 30 s using the secret cached in IndexedDB (encrypted at rest with a key in KV-backed session).
- Brightness boost via `screen.brightness` API where supported; fallback to a light-themed full-screen overlay.

### Reuse opportunities

- **Visitor `serveBadgePage`** is the obvious template for `/v/:token`.
- **R2 photo handling** for visitors maps directly to staff photos.
- **`requireRole`** middleware already supports the role gates we'd need.
- **Existing CORS + RP allowlist** covers the verify page on the same custom domain.

### Risk notes

- Rotating QR requires the client clock to be roughly correct. Skew tolerance of ±10 s is comfortable for ordinary phone drift; only matters if a phone clock is wildly wrong. Ship a "Your phone clock looks off" warning if `Date.now()` differs from the server `Date` header by more than a minute on `/badges/me` response.
- Replay window during the 30 s validity is theoretically exploitable in a race-condition sense; the KV `jti` cache makes a re-scan show the same staff so it's actually a feature, not a bug.
- Photo theft if R2 bucket misconfigured: photos are already served via authenticated routes, so the verify page should embed photos with a short-lived signed R2 URL rather than a public link.

</details>
