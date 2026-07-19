# VMS Welcome Wizard Design
**Date:** 2026-07-19
**Status:** Approved (Loop protocol — async review)

## Problem

The VMS has grown fast (check-in, kiosk, appointments, watchlist, SLA,
evacuation roll, Telegram actions). New reception/admins get no orientation;
existing users never learn what landed. A welcome wizard gives a guided
tour — **openable and closable at any time**, never a one-shot gate.

## Behavior

- **Auto-open once per device per user** on first dashboard load
  (`localStorage` key `ohcs.vms.wizard.v1.seen:<userId>`), only when the
  dashboard renders. No server state.
- **Re-openable anytime** via a help button (HelpCircle icon) in the Header,
  next to the notification bell — always visible, every page.
- **Closable anytime**: × button, ESC key, backdrop click, or "Skip tour" —
  all equivalent; closing marks seen (auto-open won't nag again) but the
  header button always works.
- Keyboard: ESC close, ←/→ navigate. Focus stays in the dialog (aria-modal,
  role="dialog"). Respects `prefers-reduced-motion`.

## Design (Kente Executive, matching the app)

- Full-screen overlay: darkened backdrop (`#071A0F` at 70%) + backdrop-blur.
- Centered card (max-w-lg, rounded-3xl): deep green gradient
  (`#1A4D2E → #0F2E1B`), gold hairline border, Kente diagonal texture at 4%,
  Ghana-flag hairline at the bottom edge.
- Step content: lucide icon in a gold-ringed tile, Playfair Display title,
  DM Sans body (2–3 short lines), optional mini bullet list.
- Footer: gold progress dots (active dot elongated), Back / Next buttons,
  "Skip tour" ghost link; final step's Next becomes "Get started" (gold).
- Transition: 200ms fade+slide between steps (transform+opacity), none under
  reduced-motion.

## Steps (role-filtered; each lists `roles` it applies to)

1. **Welcome** — what SmartGate VMS does in one line. (all)
2. **Your dashboard** — live arrivals, wait-time colors (amber 15 / red 30),
   end-of-day sweep banner, Evacuation Roll button. (all)
3. **Check-in & kiosk** — stepped check-in with delegation; lobby kiosk with
   fast lane for returning visitors. (receptionist, admin, superadmin)
4. **Appointments** — public booking, approvals, read-only day view, email-QR
   arrival at the kiosk. (all)
5. **Visitors & watchlist** — records, VIP/banned flags (superadmin-managed).
   (receptionist, admin, superadmin)
6. **Reports, analytics & audit** — exports, charts, audit log. (admin,
   superadmin, director)
7. **Stay in the loop** — link Telegram (/link), answer arrivals with the
   action buttons, set your availability (/meeting). (all)
8. **You're set** — reopen this tour anytime from the ? button. (all)

## Implementation notes

- New `packages/web/src/components/WelcomeWizard.tsx` (self-contained: steps
  array, overlay, transitions, keyboard handling). No new dependencies.
- `AppLayout.tsx`: mount the wizard; auto-open effect (seen-key check);
  header help button in `Header.tsx` triggers it (lift open state to
  AppLayout or a tiny zustand store — match existing patterns).
- `user.role` from the auth store filters steps; if filtering leaves <2
  steps the wizard doesn't auto-open.
- Unit test (jsdom/node, repo patterns): step filtering per role, seen-key
  read/write helpers.

## Files Touched

| File | Change |
|------|--------|
| `packages/web/src/components/WelcomeWizard.tsx` | New |
| `packages/web/src/components/welcome-wizard.test.ts` (or lib test) | New |
| `packages/web/src/components/layout/AppLayout.tsx` | Mount + auto-open |
| `packages/web/src/components/layout/Header.tsx` | Help button |

## Verification

- `tsc --noEmit` + `vitest run` + `vite build`.
- Playwright screenshots (mocked `/api/auth/me`): auto-open over the
  dashboard at desktop + mobile widths; header re-open; ESC close.
