# Session Revocation — Design Spec

**Date:** 2026-06-21  **Status:** Approved (build)

## Goal

Make access changes take effect promptly. Today `authMiddleware` trusts the KV
session and never re-checks the DB, so deactivating a user, changing their role,
or resetting their PIN has no effect until the session expires (up to 24h, or 30
days with "remember me"). Add a per-user **session epoch** so those events
invalidate existing sessions within ~30s.

## Decisions (locked)

1. **Triggers:** deactivate + role change + PIN reset → revoke. (Via a bumpable
   `users.session_epoch`; also enables a future admin "force log-out user".)
2. **Freshness:** ~30s per-isolate cache of per-user auth state → revocation
   effective within ~30s, negligible added DB load.

## Mechanism

- New column **`users.session_epoch INTEGER NOT NULL DEFAULT 0`** (migration +
  schema.sql + runner registration).
- At login, the issued session stores the user's current `session_epoch`.
- `authMiddleware`, after loading the KV session, reads the user's
  `{is_active, role, session_epoch}` (cached ~30s) and rejects (deletes the KV
  session, returns 401) when: user missing, `is_active = 0`, or
  `session.epoch !== current session_epoch`. Otherwise it attaches the **fresh
  role** to the request session.
- Any of {deactivate, role change, PIN reset} calls `bumpSessionEpoch(userId)`
  (`session_epoch = session_epoch + 1`), which invalidates that user's sessions.

Role changes and PIN resets force a re-login (clean: the new session carries the
new role / the user re-authenticates with the new PIN). Deactivation blocks both
the existing session and any re-login (`is_active` check at login).

## Changes

**API:**
- `migration-session-epoch.sql`: `ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;` (registered in `migrations-index.ts`; added to `schema.sql`).
- `types.ts` `SessionData`: add `epoch?: number` (optional — pre-existing sessions read as epoch 0, matching the default, so deploy does NOT log everyone out).
- `services/auth.ts`:
  - `createSession(..., epoch)` stores `epoch` in the session JSON.
  - `getUserAuthState(env, userId)` → `{is_active, role, session_epoch}` with a per-isolate memo cache (TTL 30s); `invalidateUserAuthState(userId)`.
  - `bumpSessionEpoch(env, userId)` → increments the column + invalidates the memo.
- `middleware/auth.ts`: re-validate via `getUserAuthState`; reject inactive / epoch-mismatch (delete session); attach fresh role.
- `routes/auth.ts`: both login paths (`/pin-login`, OTP `/verify`) select `session_epoch` and pass it to `createSession`.
- `routes/users.ts`: `bumpSessionEpoch` on deactivate (DELETE), and on PUT when role changed, PIN provided, or is_active set to 0.

**No UI change** (behaviour only). Affected users simply get signed out and must
log in again.

## Edge cases / notes

- **Cross-isolate staleness ≤30s** by design — the bump invalidates the acting
  isolate's cache immediately; others refresh within the TTL.
- **Existing live sessions** lack `epoch`; treated as 0 == default, so the deploy
  doesn't force a mass logout. They become revocable the first time their user's
  epoch is bumped.
- **Self-revocation:** an admin who changes their own role/PIN will be logged out
  too — expected.
- Deactivate/role/PIN events are **already audit-logged**; the bump needs no extra
  audit entry.

## Test plan

- Runtime: log in (session A). As admin, change that user's role → within ~30s,
  session A's next request returns 401 and they must re-login (new role applies).
  Deactivate a user with an active session → their next request 401s and they
  can't log back in. Reset a user's PIN → their session 401s. A normal user with
  no changes stays logged in across the window.
