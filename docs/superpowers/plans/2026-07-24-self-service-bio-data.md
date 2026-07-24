# Self-Service Bio Data — Implementation Plan

Date: 2026-07-24
Spec: `docs/superpowers/specs/2026-07-24-self-service-bio-data-design.md`

1. **API** — `packages/api/src/routes/auth.ts`
   - `profileUpdateSchema`: add `name`; refine PIN requirement to `name || email`.
   - Handler: PIN-gate when name or email present; add `name = ?` update field;
     `recordAudit` (`profile.update`) for name/email changes; return updated row
     incl. name.
   - `/auth/me`: add `nss_number`, `intern_code` to the SELECT and response.
2. **API tests** — extend `packages/api/src/routes/auth-profile.test.ts`:
   name accepted; name <2 chars rejected; name without current_pin rejected;
   phone-only still passes without PIN.
3. **VMS** — `packages/web/src/pages/ProfilePage.tsx`: editable Full Name field;
   PIN input shown when name or email changed; store `updateProfile` patch type
   gains `name`.
4. **Staff PWA**
   - `stores/auth.ts`: extend `User`, add `updateProfile`.
   - New `components/ProfileModal.tsx` (PinChangeModal styling).
   - `components/BottomNav.tsx`: Profile button + modal mount.
5. **Verify** — tsc + vitest per package; Playwright screenshot of VMS profile.
6. **Docs** — update the relevant card in `packages/web/src/docs/content.ts`;
   AGENTS.md session log + feature table.
7. Commit (`feat(profile): …`), push, watch CI to green. No DB migration needed.
