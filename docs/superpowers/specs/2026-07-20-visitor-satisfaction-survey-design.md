# Visitor Satisfaction Survey — Design

Date: 2026-07-20 · Status: scoped, not yet implemented

## Problem / intent

OHCS wants a lightweight satisfaction survey for visitors, with responses flowing
**primarily to the Client Service unit** (the new `client_service` display-tier
role). The survey must be effortless enough that visitors actually complete it —
the kiosk checkout is the one moment every self-service visitor already touches.

## Design summary

A **post-checkout micro-survey on the kiosk** (one rating tap + optional comment,
< 10 seconds, fully skippable), a **Feedback page** in the VMS web app for the
Client Service tier, and **low-rating alerts** so poor experiences get a human
follow-up. Nothing about check-in/check-out itself changes — the survey rides on
the completed checkout.

## Collection point: kiosk checkout (v1)

The survey is inserted **after** the checkout is committed server-side — it can
never block or break checkout, and skipping it costs nothing.

1. Kiosk checkout succeeds (`checkout-done` mode in `KioskPage.tsx` — today it
   shows "Checked Out" + Done).
2. The checkout response carries a one-time **survey token** (UUID in KV,
   `survey_token:<uuid>` → `visit_id`, TTL 10 min — same pattern as presence
   tokens). Minted only on *kiosk* checkouts in v1.
3. Kiosk shows: **"How was your visit today?"** — five large stars (fill on
   tap, haptic-scale animation, one-word label under the selection:
   Poor / Fair / Good / Very good / Excellent). `Skip` link top-right; 20s of
   inactivity auto-returns to the welcome screen.
4. After a rating: an **optional** comment step ("Anything you'd like us to
   know?") — large textarea, on-screen keyboard friendly, `Skip` / `Submit`.
   Then a thank-you screen (gold-check animation, ~4s) → welcome.
5. Reception-driven checkouts (`BadgeCheckoutPage`) do **not** prompt — staff
   handing back a badge is not a survey moment. (Phase 2 covers those visitors
   via SMS link.)

Anti-spam: the token is required, single-use (consumed on submit), and expires
in 10 minutes — there is no unauthenticated way to inject rows. Submit is also
rate-limited per IP via the existing `rateLimit` util. Token validation failure
silently drops to the thank-you screen (never shows an error to a leaving
visitor).

## Data model (additive migration, registered LAST)

```sql
CREATE TABLE IF NOT EXISTS visitor_surveys (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  visit_id        TEXT NOT NULL REFERENCES visits(id),
  badge_code      TEXT,
  rating          INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment         TEXT,
  wait_minutes    INTEGER,        -- denormalized at submit: check_in → first host response
  directorate_id  TEXT,           -- denormalized from the visit for cheap reporting
  host_officer_id TEXT,
  source          TEXT NOT NULL DEFAULT 'kiosk',   -- 'kiosk' | 'link' (phase 2)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- One survey per visit (token is single-use; this is the belt-and-braces).
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_surveys_visit ON visitor_surveys(visit_id);
CREATE INDEX IF NOT EXISTS idx_visitor_surveys_created ON visitor_surveys(created_at);
CREATE INDEX IF NOT EXISTS idx_visitor_surveys_dir ON visitor_surveys(directorate_id, created_at);
```

`wait_minutes` / `directorate_id` / `host_officer_id` are copied from the visit
at submit time so Feedback queries never join through visits on the hot path.
`schema.sql` updated to match, per convention.

## API

| Endpoint | Access | Notes |
|---|---|---|
| `POST /api/kiosk/survey` | Public + survey token, rate-limited | Body: `{token, rating, comment?}`. Consumes token; inserts row; fires low-rating alert when `rating <= 2`. |
| `GET /api/surveys/summary?from&to&directorate_id` | receptionist, admin, superadmin | avg rating, count, response rate (surveys / completed checkouts in period), star distribution, low-rating count. |
| `GET /api/surveys?from&to&rating&directorate_id&page` | receptionist, admin, superadmin | Paginated responses with visitor name + visit date + comment for follow-up. |
| `GET /api/surveys/export?...` | receptionist, admin, superadmin | CSV via the existing export pattern. |

**Access model.** The nav item and routes gate on
`role IN ('receptionist','admin','superadmin')` — Client Service is included by
reception parity, and reception sees it too (they act on feedback at the desk).
If OHCS later wants responses *exclusive* to Client Service, that needs a
`display_role`-aware gate (one indexed users lookup per request — `SessionData`
carries only `role` today); deliberately not done in v1 to keep the session
schema untouched.

## Feedback page (web app)

New `FeedbackPage` + nav item ("Feedback", star icon) in `Sidebar`/`BottomNav`
under the same role gate as Appointments.

- **Stat strip** — average rating (period), responses, response rate, low-rating
  count (amber when > 0).
- **Distribution** — five horizontal bars (CSS, matching `AnalyticsPage` idiom —
  no chart library).
- **Filters** — date range, directorate, rating band.
- **Recent comments** — newest first: stars, comment, visitor name, host
  officer, directorate, visit date. Low ratings (≤2) get a danger-tinted row.
- **Export** — CSV button (existing `lib/csv.ts` pattern).
- Optional dashboard widget (average this week) — cheap once summary exists;
  include only if it stays visually quiet.

## Low-rating alerts

On `rating <= 2`: in-app notification to
`role IN ('receptionist','admin','superadmin')` (existing `notifier.ts`
recipient pattern), type `survey_low_rating`, carrying visitor name, rating,
comment excerpt, and visit link — the actionable loop for Client Service.
Telegram admin-chat alert: phase 2.

## What v1 deliberately excludes

- SMS/email post-visit links (visitors leave a phone number at check-in — a
  `?s=<token>` link page is the natural phase 2, `source='link'`).
- NPS 0–10 scale, multi-question flows, per-officer scorecards, trend charts.
- Any gating on `display_role` (see access model).

## Success measure

Response rate ≥ 40% of kiosk checkouts in the first month; every ≤2 rating gets
a human follow-up. Both are readable directly off the summary endpoint.

## Build order (when scheduled)

1. Migration + `schema.sql` (+ register LAST).
2. Survey-token mint on kiosk checkout + `POST /api/kiosk/survey` (+ tests).
3. Kiosk survey UI step (stars → comment → thanks, auto-reset) — Playwright
   screenshots.
4. Summary/list/export endpoints (+ tests).
5. Feedback page + nav + role gates — Playwright screenshots.
6. Low-rating notifier (+ tests).
7. Deploy → run migration runner immediately (users-hot-code race class).
