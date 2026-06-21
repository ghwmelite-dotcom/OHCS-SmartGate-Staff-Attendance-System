-- Corrects the seeded 2026 holidays for the Public Holidays and Commemorative Days
-- (Amendment) Act, 2025 (passed June 2025), which:
--   * RESTORED 1 July as Republic Day (already seeded — no change),
--   * REPEALED 4 August (Founders' Day) as a public holiday, and
--   * reinstated 21 September as "Founder's Day" (honouring Dr. Kwame Nkrumah).
-- Idempotent: safe whether or not the original seed rows are present.
DELETE FROM holidays WHERE date = '2026-08-04';
UPDATE holidays SET name = 'Founder''s Day' WHERE date = '2026-09-21';
