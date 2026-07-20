-- Client Service role (display tier) — companion spec: 2026-07-20-client-service-role-design.md
-- users.display_role is the UI-facing role label; access still keys off users.role.
-- 'client_service' rides on role='receptionist' (reception parity by construction).
-- A display tier is needed because prod users.role has a CHECK permitting only the
-- six original roles, and D1's FK enforcement blocks the users-table rebuild that
-- dropping it would require (attempted and abandoned 2026-06-17/18 — see 52bff16/4af0036).

ALTER TABLE users ADD COLUMN display_role TEXT;
