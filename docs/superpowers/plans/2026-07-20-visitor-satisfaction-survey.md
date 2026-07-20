# Visitor Satisfaction Survey — Implementation Plan

Date: 2026-07-20 · Spec: `docs/superpowers/specs/2026-07-20-visitor-satisfaction-survey-design.md`

One deviation from the spec table: CSV export is **client-side** (house pattern —
`lib/csv.ts` builds CSV from fetched JSON), so there is no
`GET /api/surveys/export`; the list endpoint takes `page_size` up to 500 for the
export fetch instead.

## API

1. `db/migration-visitor-surveys.sql` — `visitor_surveys` table + 3 indexes
   (unique on `visit_id`, `created_at`, `directorate_id+created_at`). Whole-line
   comments only, one statement per blank-line block. Register LAST in
   `migrations-index.ts`; add the same table to `schema.sql`.
2. `services/survey-token.ts` — `mintSurveyToken(env, visitId)` (UUID in KV,
   `survey_token:<uuid>` → visitId, TTL 600s) and `consumeSurveyToken(env, token)`
   (get + delete = single-use; null on miss).
3. `routes/kiosk.ts`:
   - `check-out` + `check-out-by-pin` handlers: on success mint a token and
     return `{ ...visit, survey_token }`.
   - `POST /survey` (exported `kioskSurveySchema`: `{token uuid, rating 1-5,
     comment ≤500}`): rate-limit → consume token (400 `SURVEY_TOKEN_INVALID`) →
     load visit (badge, directorate, host, check_in_at, host_response_at →
     `wait_minutes`) → `INSERT OR IGNORE` (409 `SURVEY_EXISTS` on 0 changes) →
     `rating<=2` → `waitUntil(notifyLowSurveyRating)` → `created`.
4. `services/notifier.ts` — `notifyLowSurveyRating(env, {visitId, rating,
   comment})`: resolves visitor/directorate context, in-app `survey_low_rating`
   to `role IN ('receptionist','admin','superadmin')`, url `/feedback`.
5. `routes/surveys.ts` — `GET /` (paginated list + filters: from/to/rating/
   directorate_id, joins visitors/officers/directorates) and `GET /summary`
   (average, total, low count, distribution, completed checkouts in period,
   response rate). All `requireRole(c, 'superadmin','admin','receptionist')`.
6. `index.ts` — `app.route('/api/surveys', surveyRoutes)` after reports.

## API tests (`routes/surveys.test.ts`)

- `kioskSurveySchema` valid/invalid payloads (rating bounds, token uuid, comment cap).
- `survey-token` mint/consume with a Map-backed KV stub: round-trip, single-use,
  unknown token → null.
- Source-scan guards: survey routes carry `requireRole`; both kiosk checkouts
  mint `survey_token`; migration registered LAST in `migrations-index.ts`.

## Web

7. `lib/kioskApi.ts` — `KioskVisit.survey_token?: string | null`;
   `kioskApi.submitSurvey({token, rating, comment?})` → `POST /survey`.
8. `pages/KioskPage.tsx` — modes `'survey' | 'survey-comment' | 'survey-thanks'`;
   state `surveyToken/surveyRating/surveyComment/surveySubmitting`; checkout
   success stores the token; `checkout-done` shows the rate panel (5 large
   stars + Skip) when a token exists (else unchanged Done screen); star tap →
   comment step (Submit / Skip submits rating-only); submit → thanks screen →
   `resetAll` after 4s. Survey screens auto-reset to welcome after 20s idle.
   `resetAll` clears survey state.
9. `pages/FeedbackPage.tsx` — stat strip (avg + stars, responses, response
   rate, low count), CSS distribution bars, filters (from/to/rating/
   directorate), comments feed (stars, comment, visitor, host, directorate,
   date; ≤2 tinted danger), CSV export (`generateCSV`-style local helper).
10. `App.tsx` route `/feedback`; `Sidebar.tsx` + `BottomNav.tsx` — "Feedback"
    (Star icon) gated `['receptionist','admin','superadmin']` like Appointments.

## Verify & ship

11. `tsc --noEmit` + `vitest run` in `packages/api` and `packages/web`; vite
    build; Playwright screenshots: kiosk survey rate step + comment step +
    thanks, Feedback page with mocked data.
12. Conventional commit `feat(surveys): …`, push, watch CI.
13. Flag to user: run the migration runner as superadmin immediately after
    deploy (users-hot-code race class — kiosk checkout responses include
    `survey_token` only after the table exists... actually token mint is KV-only
    and submit is the only table writer, but the Feedback endpoints read it —
    run migration right after deploy regardless).
