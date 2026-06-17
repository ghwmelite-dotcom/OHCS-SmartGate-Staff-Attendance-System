-- Merge the f_and_a_admin role into hr — companion spec:
-- 2026-06-17-hr-role-merge-design.md
-- No-op on current data (no users hold f_and_a_admin), but guarantees any stray
-- row (e.g. from a past bulk import) keeps access under the new role name.
UPDATE users SET role = 'hr' WHERE role = 'f_and_a_admin';
