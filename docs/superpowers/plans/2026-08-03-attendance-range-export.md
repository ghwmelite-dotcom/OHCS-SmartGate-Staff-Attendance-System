# Attendance range export + admin-role access — 2026-08-03

## Contract (api ↔ web)
- `GET /api/attendance/export?from=YYYY-MM-DD&to=YYYY-MM-DD[&directorate_id][&user_type]`
  - Roles: superadmin | admin | director (force-scoped) | cd/hos (org-wide) — same `requireOversight` + `oversightScope` as /records.
  - Span cap 366 days (400 `BAD_RANGE`); from ≤ to (400); `user_type` segment same parser as /records (staff default… DEFAULT: **all** for exports — analysis wants everyone).
  - Rows: one per **user × day** for users active in the span (or with a clock row / notice), each: `date, user_id, name, identifier (staff_id|nss_number|intern_code), directorate_abbr, clock_in_time, clock_out_time, is_late, is_early_departure, presence_method, absence_reason, absence_note, has_photo (0|1)`.
  - Clock matching uses the shared effective-date SQL; late/early vs settings thresholds; `has_photo` = clock-in photo present.
- Single-date `/records` response unchanged (portal single-date PDF keeps embedded photos).

## API (`packages/api`)
1. `/attendance/export` route in `attendance.ts`: validation, span cap, scope
   forcing. Implementation: users CROSS JOIN a recursive-date-CTE range, LEFT
   JOIN clock rows per (user, day) via the effective-date expression, LEFT
   JOIN latest applicable notice per (user, day) (mirror the /records
   correlated subquery). If the recursive CTE misbehaves on D1, assemble in JS
   (users + clock rows + notices in range) — pick one, document why.
2. Tests (node:sqlite shim): row per user×day incl. absent days; late/early
   flags vs thresholds; has_photo 1/0; notice fields populated (latest wins on
   overlap); span cap + from>to 400s; director forced scope; cd/hos all;
   staff 403; effective-date attribution (capturedDate row lands on capture
   day); user_type filter.

## Web (`packages/web` — AttendanceTab)
3. Open the Attendance tab to `admin` (AdminPage tab gate; tab bar label
   stays). Verify every endpoint the tab calls allows admin (they do —
   requireOversight covers superadmin|admin|director; settings modal GET is
   superadmin|admin, PUT superadmin — the tab already handles canEdit=false).
4. Range UI: pills **Today / This week / This month / This year / Custom**
   (custom = two date inputs) beside the existing directorate select +
   segment pills. Table view unchanged for Today; for ranges show the same
   columns + a Date column (grouped or flat — flat is fine for analysis).
5. Exports: single-date keeps current behavior EXCEPT the CSV photo column
   becomes `has_photo` (Y/N) instead of the URL. Range exports build from the
   export endpoint: CSV (all contract columns) and PDF (summary header:
   range, directorate, generated-at, totals + tabular rows, no photos) —
   extend `lib/pdf.ts` with a `generateAttendanceRangePdf`.
6. Tests: lib-level for CSV/pdf builders if extractable; typecheck + suites.

## Non-goals
- Photos embedded in range PDFs (size); photo viewing stays in the portal.
- Server-side CSV/PDF generation (client-side matches existing pattern).
