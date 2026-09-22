# Personal attendance on VMS home

Every authenticated user sees their own attendance first on the VMS home page. Reuse the shared API's session-scoped `/clock/my-status` and `/clock/my-history?days=14`; never match names or accept a target user ID. Query caches are keyed by account ID. No database or login changes.

Show today's recorded clock-in/out, an explicit status, and the last 14 days of recorded events, grouped by Ghana date. Missing records are not absence. Do not infer paid hours or punctuality. Explain that offline submissions appear after Staff Attendance syncs. Provide a link to Staff Attendance; no VMS clock action bypasses attendance controls.

Refresh every 60 seconds in foreground and on focus/reconnect, with manual refresh and last-updated text. Handle loading, empty, partial failure and stale-data states explicitly. Use semantic tokens, responsive cards and keyboard-accessible controls.

Preserve leadership Overview and reception Dashboard below the personal section, gated by existing role helpers (including RCU parity). Ordinary staff must not mount visitor queries.

Verification: time/date grouping tests, account-scoped query tests, TypeScript, web test suite, mocked browser checks for staff/operations/leadership, responsive layout and failure states. Update system docs. No production migration required.
