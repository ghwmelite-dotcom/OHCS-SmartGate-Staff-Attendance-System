# Client error classification

Malformed JSON on either login route throws Hono HTTPException(400). The
global handler currently converts it into a 500 and pages Telegram admins.

Preserve typed HTTPException statuses 400–499, return the standard JSON error
envelope with a safe generic message, and retain response headers such as
Retry-After. Remove stale Content-Length when replacing the body. Do not log
or page these expected request failures. Unexpected exceptions (including
internal SyntaxError) and server exceptions retain the existing 500/alert path.

Scope: shared handler only; no authentication, database, or credential changes.
Regression checks use the actual auth routes with malformed and empty JSON on
both login paths, plus client-error headers and server-error alert coverage.
Five regression cases failed before the fix (500 instead of 400/429).

Verification: API typecheck clean; full API suite 66 files / 549 tests passed,
including all eight new handler tests. Production release uses the existing
CI pipeline; no migrations or production data mutations are needed.
