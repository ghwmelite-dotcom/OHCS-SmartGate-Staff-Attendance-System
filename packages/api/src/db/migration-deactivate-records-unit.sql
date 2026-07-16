-- Deactivate the Records Unit (dir_rec) — no reception receivers configured;
-- visitors are directed to P-REG or REGISTRY instead.
UPDATE directorates SET is_active = 0 WHERE id = 'dir_rec';
