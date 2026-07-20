# Client Service Role — Implementation Plan

Date: 2026-07-20 · Spec: `docs/superpowers/specs/2026-07-20-client-service-role-design.md`

1. **Migration** — `packages/api/src/db/migration-users-display-role.sql`:
   `ALTER TABLE users ADD COLUMN display_role TEXT;` (whole-line comments only,
   one statement). Register LAST in `migrations-index.ts`; add matching column +
   explanatory comment to `schema.sql` users table.
2. **API types** — `types.ts`: `User.display_role: string | null`.
3. **API users routes** (`routes/users.ts`):
   - create/update zod schemas: `display_role: z.enum(['client_service'])`
     (`.nullish()` create / `.nullable().optional()` update; NULL clears).
   - INSERT includes `display_role`; update handler binds it when present.
   - list/get/create SELECTs return `u.display_role`; `existing`/`after`
     SELECTs include it and `AUDITED_USER_FIELDS` gains `display_role`.
4. **API auth** (`routes/auth.ts`): `/me` SELECT + payload include `display_role`.
5. **Web roles helper** — new `src/lib/roles.ts`: `ROLE_LABELS` (7 entries) +
   `roleLabel(role, displayRole?)`. Unit test in `lib/roles.test.ts`.
6. **Web theme** — `tokens.css`: `--color-service` in `@theme` + dark override.
7. **Web AdminPage** — `UserRecord.display_role?`; `ROLES` gains client_service
   (`bg-service/10 text-service`); badge lookup `display_role ?? role`; form
   zod role enums gain `'client_service'`; create mutation maps
   client_service → `{role:'admin', display_role:'client_service'}`,
   anything else → `display_role: null`; edit defaultValues map
   `user.display_role ?? user.role` into the select.
8. **Web Header/ProfilePage** — render `roleLabel(user.role, user.display_role)`;
   `stores/auth.ts` User gains `display_role?: string | null`.
9. **Verify** — `tsc --noEmit` + `vitest run` in `packages/api` and
   `packages/web`; Playwright screenshot: Admin users tab with a Client Service
   user badge + create modal open on the role dropdown.
10. **Ship** — conventional commit, push, watch CI.
11. **Prod sequencing (flag to user)** — after deploy, run the migration runner
    as superadmin (`POST /api/admin/migrations/run`) immediately; the users
    list/GET will 500 until `display_role` exists (same class of race as the
    2026-07-19 settings incident).
