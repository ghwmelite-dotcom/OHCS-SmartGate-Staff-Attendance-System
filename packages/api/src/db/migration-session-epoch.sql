-- Session revocation: a per-user epoch. Bumped on deactivate / role change /
-- PIN reset; authMiddleware rejects any session whose stored epoch is stale, so
-- access changes take effect within ~30s instead of waiting out the session TTL.
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
