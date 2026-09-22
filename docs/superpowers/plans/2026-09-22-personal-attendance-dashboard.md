# Implementation plan

1. Add typed self-attendance query helpers and pure Ghana date/time grouping utilities with regression tests.
2. Build PersonalAttendance panel: today cards, 14-day history, refresh/feedback and Staff Attendance link.
3. Mount above role-appropriate home content; suppress visitor dashboard for ordinary staff.
4. Update docs; run typecheck, tests and mocked responsive browser checks.
5. Review scoped diff, commit, push and verify CI deployment. Do not mutate production data.

## Verification

- Web TypeScript check passed; all 114 tests across 14 files passed.
- Production Vite build passed (existing large-chunk and mixed-import warnings remain).
- Mocked system Chrome checks passed for mobile staff, desktop admin and director; ordinary staff made no visitor requests. Manual and one-minute refresh, stale-data warning, empty records and no horizontal page overflow checked.
- Screenshot review: mobile personal panel uses stacked cards and wrapping event chips. Service-worker cache version bumped for installed clients.
- Tests use synthetic records only. No production database mutation or authentication change.
