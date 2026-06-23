# Photo-based ID capture (front/back for Ghana Card) — Design

Date: 2026-06-23
Status: Approved

## Problem

The visitor check-in forms collect an ID **type** plus a **manually typed ID number**.
Typing a number at a kiosk or reception desk is slow and error-prone, and the number
is unverifiable. We want the captured photo(s) to be the record of the visitor's ID
instead of a hand-typed string.

## Behavior change

- The **ID-type chooser stays** (Ghana Card / Passport / Driver's License / Staff ID / Other).
- The **manual ID-number text input is removed** from both forms.
- The existing **ID-photo step becomes type-aware**:
  - `ghana_card` → capture **front**, then **back** (two sequential rear-camera shots).
  - any other type → **single** rear-camera shot (today's behavior, unchanged).
- The chooser remains in the *details* step, where `id_type` is already captured at
  visitor-create time; the photo step reads it to decide one shot vs. two. This is the
  smallest change to the existing `form → face → id` flow.

## Scope

Both forms (decided):
- Public **Kiosk** — `packages/web/src/pages/KioskPage.tsx`
- Reception **Check-in** — `packages/web/src/pages/CheckInPage.tsx`

## Frontend

### `SmartIdFields` → `IdTypeChooser`
`packages/web/src/components/checkin/SmartIdFields.tsx` is slimmed to a type-only
chooser:
- Drop the number `<input>` and the `ID_TYPE_CONFIG` number-formatting map.
- Render only the type button-grid (the existing grid markup).
- Props reduce to `{ idType, onIdTypeChange, idTypeError }`.
- Renamed to `IdTypeChooser` (file `IdTypeChooser.tsx`); both pages updated to import it.

### New `IdDocumentCapture` component
`packages/web/src/components/checkin/IdDocumentCapture.tsx`. Wraps the existing
single-shot `PhotoCapture` (which stays single-purpose and **unchanged**):
- Given `idType`, orchestrates the capture sequence:
  - `ghana_card`: shot 1 titled "Front of Ghana Card" → shot 2 titled "Back of Ghana Card".
  - else: one shot titled "Photograph the ID".
- Collects blobs and calls `onComplete(front: Blob, back?: Blob)`.
- Switching ID type before completion resets collected blobs.
- For the kiosk, the front shot keeps `required` + `qualityGuard`; the back shot keeps
  `qualityGuard` (best-effort, no hard block — see Edge cases).

### Page wiring
- Kiosk `handleIdCapture` → becomes `handleIdComplete(front, back?)`: upload front
  (returns AI `id_check`), then upload back when present; then `finishCheckIn`.
- Reception `handleIdPhotoCapture` → `handleIdComplete(front, back?)`: POST front, then
  POST back when present; then advance to `check-in`.

## Backend / storage

### Migration
Add `id_photo_back_url TEXT` to `visitors`. New flat migration file
`packages/api/src/db/migration-visitor-id-photo-back.sql` containing
`ALTER TABLE visitors ADD COLUMN id_photo_back_url TEXT;`, imported and appended to the
`MIGRATIONS` array in `packages/api/src/db/migrations-index.ts` (matching the existing
pattern). Applied in prod via the existing `POST /api/admin/migrations/run` Settings
button. `schema.sql` `visitors` table updated to match for fresh installs.

### R2 key
`packages/api/src/lib/photo-key.ts`:
```
export function visitorIdPhotoBackKey(visitorId: string): string {
  return `photos/visitors/${visitorId}-id-back.jpg`;
}
```

### New endpoints (mirror the existing front-photo endpoints)
JPEG-validated, 500KB cap, same auth + rate-limit as their front counterparts:
- Reception (`packages/api/src/routes/photos.ts`):
  - `POST /api/photos/visitors/:id/id-photo-back` → writes back key, sets `id_photo_back_url`.
  - `GET  /api/photos/visitors/:id/id-back` → serves back image (same role gate as `/id`).
- Kiosk (`packages/api/src/routes/kiosk.ts`):
  - `POST /api/kiosk/visitors/:id/id-photo-back` → writes back key, sets `id_photo_back_url`.
    No AI check on the back.

`uploadVisitorPhoto(... 'id_photo_back_url', backUrl)` reuses the existing helper.

### AI gate — unchanged
`checkIdDocument` runs on the **front** only. The block / reception-override /
`id_photo_check` persistence logic in `kiosk.ts` `check-in` is untouched.

### Backup / restore / purge completeness
- `id_photo_back_url` column flows through backup/restore automatically (full-row export),
  but verify the visitors backup/restore covers all columns.
- `packages/api/src/services/photo-purge.ts`: add the back R2 key so purge removes
  front, back, and face together (keeps the backup-safety invariant intact).

## Edge cases

- Back-photo upload is **best-effort**, like the front today: a failed back upload does
  not block check-in. The front photo + AI gate still govern admission.
- Changing the ID type after capturing resets collected blobs in `IdDocumentCapture`.
- The non-Ghana-Card path is byte-identical to today (single shot).
- `id_number` column stays in the DB (left null for new records); existing records keep
  their numbers. The VisitorDetailPage "ID Number" row already renders only when present,
  so it simply disappears for new visitors. No data migration.

## Out of scope (YAGNI)

- No UI to *view* the stored ID images. None exists today (the front `id_photo_url` is
  stored + AI-checked but never rendered), so the back is storage-only, matching the front.

## Testing

- **API (vitest)**: new back-photo endpoints — happy path, non-JPEG reject, oversize
  reject, visitor-not-found; migration registered in `migrations-index`.
- **Web**: `IdDocumentCapture` — two-shot sequencing for `ghana_card`, single shot for
  others, type-change reset; `IdTypeChooser` — selection and clear.
