-- Soft, non-authoritative AI verdict on the ID photo captured for a kiosk visit.
-- JSON: { verdict, detected_type?, confidence?, model?, checked_at? }
-- verdict ∈ 'document' | 'not_document' | 'indeterminate'. Never gates check-in.
ALTER TABLE visits ADD COLUMN id_photo_check TEXT;
