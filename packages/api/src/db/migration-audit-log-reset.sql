-- ONE-TIME genesis reset of the audit log.
-- The hash-chain canonical form was hardened (PR #51) to cover actor_label + ip,
-- which invalidates the few PRE-hardening TEST entries written during bring-up.
-- This clears them so the chain restarts clean; runs exactly once (recorded in
-- applied_migrations). The audit_log is append-only in normal operation — this is
-- a deliberate, in-repo, pre-launch reset, not a routine operation.
DELETE FROM audit_log;
