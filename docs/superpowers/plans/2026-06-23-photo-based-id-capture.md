# Photo-based ID Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual ID-number text entry with a type-aware ID photo step — Ghana Card captures front + back, every other ID type captures a single photo — across the public Kiosk and the Reception check-in.

**Architecture:** The ID-type chooser stays in the details step (where `id_type` is already collected); a pure `idCaptureSteps(idType)` helper decides one shot vs. front+back; a new `IdDocumentCapture` component drives the sequence using the unchanged single-shot `PhotoCapture`. The back photo gets its own R2 key, DB column (`id_photo_back_url`), and upload/serve endpoints. The AI document gate is unchanged — it still runs on the front photo only.

**Tech Stack:** Cloudflare Workers + Hono + D1 + R2 (API, TypeScript), React 18 + react-hook-form + zod + Tailwind (web), vitest.

**Conventions:**
- Run API tests: `node node_modules/vitest/vitest.mjs run packages/api/src/<path>` from repo root.
- Run web tests: `node node_modules/vitest/vitest.mjs run packages/web/src/<path>` from repo root.
- Type-check (avoids the `.cmd` shim path bug from the spaced repo path — use direct node):
  `node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
  `node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
- Commit messages end with the Co-Authored-By trailer (see steps).
- All work happens on branch `feat/photo-based-id-capture` (already created).

---

## File Structure

**API (`packages/api/src`)**
- `lib/photo-key.ts` — add `visitorIdPhotoBackKey` (modify)
- `lib/photo-key.test.ts` — add a case (modify)
- `lib/photo-upload.ts` — widen `column` union (modify)
- `db/migration-visitor-id-photo-back.sql` — new migration (create)
- `db/migrations-index.ts` — register migration (modify)
- `db/schema.sql` — add column to `visitors` (modify)
- `routes/photos.ts` — reception back upload + serve endpoints (modify)
- `routes/kiosk.ts` — kiosk back upload endpoint (modify)
- `services/photo-purge.ts` — delete the back R2 key + null the column (modify)

**Web (`packages/web/src`)**
- `lib/id-capture.ts` — pure `idCaptureSteps` helper (create)
- `lib/id-capture.test.ts` — helper tests (create)
- `components/checkin/IdTypeChooser.tsx` — slim type-only chooser (create)
- `components/checkin/IdDocumentCapture.tsx` — front/back capture orchestrator (create)
- `components/checkin/SmartIdFields.tsx` — deleted once unused (delete, final task)
- `lib/kioskApi.ts` — add back-photo upload (modify)
- `pages/KioskPage.tsx` — wire chooser + capture, drop id_number (modify)
- `pages/CheckInPage.tsx` — wire chooser + capture, drop id_number (modify)

---

## Task 1: Back-photo R2 key (TDD)

**Files:**
- Modify: `packages/api/src/lib/photo-key.ts`
- Test: `packages/api/src/lib/photo-key.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/api/src/lib/photo-key.test.ts`:

```ts
import { visitorPhotoKey, visitorIdPhotoKey, visitorIdPhotoBackKey } from './photo-key';

describe('visitorIdPhotoBackKey', () => {
  it('builds the R2 key for a visitor ID-document BACK photo', () => {
    expect(visitorIdPhotoBackKey('abc123')).toBe('photos/visitors/abc123-id-back.jpg');
  });
});
```

(Update the existing top-of-file import line to include `visitorIdPhotoBackKey`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/api/src/lib/photo-key.test.ts`
Expected: FAIL — `visitorIdPhotoBackKey is not a function` / import error.

- [ ] **Step 3: Add the function**

In `packages/api/src/lib/photo-key.ts`, append after `visitorIdPhotoKey`:

```ts
export function visitorIdPhotoBackKey(visitorId: string): string {
  return `photos/visitors/${visitorId}-id-back.jpg`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/api/src/lib/photo-key.test.ts`
Expected: PASS (all 3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/lib/photo-key.ts packages/api/src/lib/photo-key.test.ts
git commit -m "feat(api): add visitorIdPhotoBackKey R2 key helper" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Widen uploadVisitorPhoto column union

**Files:**
- Modify: `packages/api/src/lib/photo-upload.ts:11`

- [ ] **Step 1: Widen the union**

In `packages/api/src/lib/photo-upload.ts`, change the `column` parameter type:

```ts
  column: 'photo_url' | 'id_photo_url' | 'id_photo_back_url',
```

(Only that one line changes; the body already interpolates `column` into the UPDATE.)

- [ ] **Step 2: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/lib/photo-upload.ts
git commit -m "feat(api): allow uploadVisitorPhoto to write id_photo_back_url" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: DB migration + schema column

**Files:**
- Create: `packages/api/src/db/migration-visitor-id-photo-back.sql`
- Modify: `packages/api/src/db/migrations-index.ts`
- Modify: `packages/api/src/db/schema.sql:110`

- [ ] **Step 1: Create the migration file**

Create `packages/api/src/db/migration-visitor-id-photo-back.sql`:

```sql
-- Add a back-of-ID photo URL for Ghana Card (front + back) capture.
ALTER TABLE visitors ADD COLUMN id_photo_back_url TEXT;
```

- [ ] **Step 2: Register the migration**

In `packages/api/src/db/migrations-index.ts`, add the import after line 33
(`import directorateOrgType ...`):

```ts
import visitorIdPhotoBack from './migration-visitor-id-photo-back.sql';
```

And append to the `MIGRATIONS` array, after the `migration-directorate-org-type.sql` entry (last item):

```ts
  { filename: 'migration-visitor-id-photo-back.sql', sql: visitorIdPhotoBack },
```

- [ ] **Step 3: Update schema.sql for fresh installs**

In `packages/api/src/db/schema.sql`, in the `visitors` table, add a line immediately
after `id_photo_url  TEXT,` (line 110):

```sql
    id_photo_back_url TEXT,
```

- [ ] **Step 4: Type-check (verifies the .sql import resolves via the sql-as-text plugin)**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/migration-visitor-id-photo-back.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(api): migration adding visitors.id_photo_back_url" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reception back-photo upload + serve endpoints

**Files:**
- Modify: `packages/api/src/routes/photos.ts`

- [ ] **Step 1: Import the back key**

In `packages/api/src/routes/photos.ts`, change the photo-key import (line 6) to add
`visitorIdPhotoBackKey`:

```ts
import { visitorPhotoKey, visitorIdPhotoKey, visitorIdPhotoBackKey } from '../lib/photo-key';
```

- [ ] **Step 2: Add the upload endpoint**

In `packages/api/src/routes/photos.ts`, immediately after the existing
`photoRoutes.post('/visitors/:id/id-photo', ...)` handler (ends at line 71), add:

```ts
// Upload visitor ID-document BACK photo (Ghana Card) — accepts raw JPEG body
photoRoutes.post('/visitors/:id/id-photo-back', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist');
  if (blocked) return blocked;
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');

  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(body))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);

  const idPhotoBackUrl = `/api/photos/visitors/${visitorId}/id-back`;
  await uploadVisitorPhoto(c.env, visitorId, body, visitorIdPhotoBackKey(visitorId), 'id_photo_back_url', idPhotoBackUrl);
  return success(c, { id_photo_back_url: idPhotoBackUrl });
});
```

- [ ] **Step 3: Add the serve endpoint**

In `packages/api/src/routes/photos.ts`, immediately after the existing
`photoRoutes.get('/visitors/:id/id', ...)` handler (ends at line 99), add:

```ts
// Serve visitor ID-document BACK photo from R2 (auth-gated)
photoRoutes.get('/visitors/:id/id-back', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director', 'it');
  if (blocked) return blocked;
  const visitorId = c.req.param('id');
  if (!(await canViewVisitorPhoto(c, visitorId))) return notFound(c, 'Photo');
  const object = await c.env.STORAGE.get(visitorIdPhotoBackKey(visitorId));
  if (!object) return notFound(c, 'Photo');
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(object.body, { headers });
});
```

- [ ] **Step 4: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/photos.ts
git commit -m "feat(api): reception endpoints for ID back photo upload+serve" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Kiosk back-photo upload endpoint

**Files:**
- Modify: `packages/api/src/routes/kiosk.ts`

- [ ] **Step 1: Import the back key**

In `packages/api/src/routes/kiosk.ts`, change the photo-key import (line 8) to add
`visitorIdPhotoBackKey`:

```ts
import { visitorPhotoKey, visitorIdPhotoKey, visitorIdPhotoBackKey } from '../lib/photo-key';
```

- [ ] **Step 2: Add the kiosk back-upload endpoint**

In `packages/api/src/routes/kiosk.ts`, immediately after the existing
`kioskRoutes.post('/visitors/:id/id-photo', ...)` handler (ends at line 127), add. Note:
no AI check on the back photo (the front already drove the gate):

```ts
// Raw-JPEG ID-document BACK photo upload (Ghana Card). No AI check — the front
// photo already drives the document gate.
kioskRoutes.post('/visitors/:id/id-photo-back', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  if (Number(c.req.header('content-length') ?? '0') > MAX_PHOTO_BYTES) {
    return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  if (!isJpeg(new Uint8Array(buf))) return error(c, 'INVALID_IMAGE', 'Photo must be a JPEG image', 400);
  const idPhotoBackUrl = `/api/photos/visitors/${visitorId}/id-back`;
  await uploadVisitorPhoto(c.env, visitorId, buf, visitorIdPhotoBackKey(visitorId), 'id_photo_back_url', idPhotoBackUrl);
  return success(c, { id_photo_back_url: idPhotoBackUrl });
});
```

- [ ] **Step 3: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/kiosk.ts
git commit -m "feat(api): kiosk endpoint for ID back photo upload" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Purge the back photo on retention

**Files:**
- Modify: `packages/api/src/services/photo-purge.ts`

- [ ] **Step 1: Import the back key**

In `packages/api/src/services/photo-purge.ts`, change the import (line 3) to add
`visitorIdPhotoBackKey`:

```ts
import { visitorPhotoKey, visitorIdPhotoKey, visitorIdPhotoBackKey } from '../lib/photo-key';
```

- [ ] **Step 2: Include the back column in the eligibility query**

In the `eligible` SQL (around line 42), widen the photo-presence check to include the
back column:

```sql
      WHERE (v.photo_url IS NOT NULL OR v.id_photo_url IS NOT NULL OR v.id_photo_back_url IS NOT NULL)
```

- [ ] **Step 3: Delete the back object + null the column**

In the per-visitor loop (around lines 57-62), add the back-key delete and the column to
the UPDATE:

```ts
      await env.STORAGE.delete(visitorPhotoKey(id));
      await env.STORAGE.delete(visitorIdPhotoKey(id));
      await env.STORAGE.delete(visitorIdPhotoBackKey(id));
      photosDeleted += 3;
      await env.DB.prepare(
        'UPDATE visitors SET photo_url = NULL, id_photo_url = NULL, id_photo_back_url = NULL WHERE id = ?'
      ).bind(id).run();
```

(Note `photosDeleted += 3` replaces the previous `+= 2`.)

- [ ] **Step 4: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/photo-purge.ts
git commit -m "feat(api): purge ID back photo with the other visitor photos" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Capture-sequence helper (TDD)

**Files:**
- Create: `packages/web/src/lib/id-capture.ts`
- Test: `packages/web/src/lib/id-capture.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/id-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { idCaptureSteps } from './id-capture';

describe('idCaptureSteps', () => {
  it('returns front + back for a Ghana Card', () => {
    const steps = idCaptureSteps('ghana_card');
    expect(steps.map((s) => s.side)).toEqual(['front', 'back']);
    expect(steps[0].title).toBe('Front of Ghana Card');
    expect(steps[1].title).toBe('Back of Ghana Card');
  });

  it('returns a single step for a passport', () => {
    const steps = idCaptureSteps('passport');
    expect(steps).toHaveLength(1);
    expect(steps[0].side).toBe('single');
  });

  it('returns a single step when the type is undefined', () => {
    expect(idCaptureSteps(undefined).map((s) => s.side)).toEqual(['single']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/web/src/lib/id-capture.test.ts`
Expected: FAIL — cannot resolve `./id-capture`.

- [ ] **Step 3: Create the helper**

Create `packages/web/src/lib/id-capture.ts`:

```ts
// Pure decision for the ID-photo capture sequence. Ghana Card needs front + back;
// every other ID type (and an unset type) needs a single shot. Kept pure so it can be
// unit-tested without a DOM/camera harness.
export type IdCaptureSide = 'single' | 'front' | 'back';

export interface IdCaptureStep {
  side: IdCaptureSide;
  title: string;
}

export function idCaptureSteps(idType: string | undefined): IdCaptureStep[] {
  if (idType === 'ghana_card') {
    return [
      { side: 'front', title: 'Front of Ghana Card' },
      { side: 'back', title: 'Back of Ghana Card' },
    ];
  }
  return [{ side: 'single', title: 'Photograph the ID' }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/web/src/lib/id-capture.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/id-capture.ts packages/web/src/lib/id-capture.test.ts
git commit -m "feat(web): idCaptureSteps helper for ID front/back sequencing" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: IdTypeChooser component (type-only chooser)

**Files:**
- Create: `packages/web/src/components/checkin/IdTypeChooser.tsx`

This is the type-grid extracted from `SmartIdFields`, with the number input removed.
`SmartIdFields` is left in place for now (deleted in Task 13 once both pages stop using it).

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/checkin/IdTypeChooser.tsx`:

```tsx
import { CreditCard } from 'lucide-react';
import { ID_TYPES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { FieldWrapper } from './FieldWrapper';

export type IdTypeValue = typeof ID_TYPES[number]['value'];

export function IdTypeChooser({
  idType,
  onIdTypeChange,
  idTypeError,
}: {
  idType: IdTypeValue | '' | undefined;
  onIdTypeChange: (v: IdTypeValue | undefined) => void;
  idTypeError?: string;
}) {
  return (
    <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label="ID Type" error={idTypeError}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ID_TYPES.map((t) => {
          const isSelected = idType === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onIdTypeChange(isSelected ? undefined : t.value)}
              className={cn(
                'h-11 px-3 rounded-xl text-[13px] font-medium border transition-all text-left',
                isSelected
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-background border-border text-foreground hover:border-primary/20'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </FieldWrapper>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS (component is unused so far, but must compile).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/checkin/IdTypeChooser.tsx
git commit -m "feat(web): IdTypeChooser (type-only, no manual ID number)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: IdDocumentCapture component

**Files:**
- Create: `packages/web/src/components/checkin/IdDocumentCapture.tsx`

Orchestrates the capture sequence from `idCaptureSteps`, reusing the unchanged
`PhotoCapture`. Calls `onComplete({ front, back })` once all steps are captured (the
`'single'` blob is returned as `front`, `back` undefined). When the capture is optional
(`required={false}`): skipping the FIRST step calls `onSkip()`; skipping a later step
completes with what was already captured.

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/checkin/IdDocumentCapture.tsx`:

```tsx
import { useState } from 'react';
import { PhotoCapture } from '@/components/PhotoCapture';
import { idCaptureSteps } from '@/lib/id-capture';

export interface IdDocumentResult {
  front: Blob;
  back?: Blob;
}

export function IdDocumentCapture({
  idType,
  onComplete,
  onSkip,
  required = false,
  qualityGuard = false,
}: {
  idType: string | undefined;
  onComplete: (result: IdDocumentResult) => void;
  onSkip: () => void;
  required?: boolean;
  qualityGuard?: boolean;
}) {
  const steps = idCaptureSteps(idType);
  const [index, setIndex] = useState(0);
  const [front, setFront] = useState<Blob | null>(null);
  const step = steps[index];

  function finish(frontBlob: Blob, backBlob?: Blob) {
    onComplete({ front: frontBlob, back: backBlob });
  }

  function handleCapture(blob: Blob) {
    // Single-shot, or the first shot of the Ghana Card pair.
    if (step.side === 'single' || step.side === 'front') {
      if (index + 1 < steps.length) {
        setFront(blob);
        setIndex(index + 1);
      } else {
        finish(blob); // single-shot path
      }
      return;
    }
    // Back of the Ghana Card — front must already be captured.
    if (front) finish(front, blob);
  }

  function handleSkip() {
    // Skipping the first step cancels the whole ID capture.
    if (index === 0) { onSkip(); return; }
    // Skipping a later (back) step completes with whatever was captured.
    if (front) finish(front);
    else onSkip();
  }

  return (
    <PhotoCapture
      // Remount cleanly when the step changes so the camera restarts for each shot.
      key={`${idType ?? 'none'}-${index}`}
      title={step.title}
      facingMode="environment"
      mirror={false}
      required={required}
      qualityGuard={qualityGuard}
      onCapture={handleCapture}
      onSkip={handleSkip}
    />
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/checkin/IdDocumentCapture.tsx
git commit -m "feat(web): IdDocumentCapture orchestrates front/back ID shots" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Kiosk API client — back-photo upload

**Files:**
- Modify: `packages/web/src/lib/kioskApi.ts:38,113`

- [ ] **Step 1: Widen the upload-kind union and add the API method**

In `packages/web/src/lib/kioskApi.ts`, change the `kioskUploadPhoto` signature (line 38)
to allow the new kind:

```ts
async function kioskUploadPhoto<T>(visitorId: string, kind: 'photo' | 'id-photo' | 'id-photo-back', blob: Blob): Promise<T> {
```

Then in the `kioskApi` object (after the `uploadIdPhoto` line, line 113), add:

```ts
  uploadIdPhotoBack: (id: string, blob: Blob) => kioskUploadPhoto<{ id_photo_back_url: string }>(id, 'id-photo-back', blob),
```

- [ ] **Step 2: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/kioskApi.ts
git commit -m "feat(web): kioskApi.uploadIdPhotoBack" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Wire the Kiosk page

**Files:**
- Modify: `packages/web/src/pages/KioskPage.tsx`

- [ ] **Step 1: Swap the import**

In `packages/web/src/pages/KioskPage.tsx`, replace the `SmartIdFields` import (line 11):

```ts
import { IdTypeChooser } from '@/components/checkin/IdTypeChooser';
import { IdDocumentCapture } from '@/components/checkin/IdDocumentCapture';
```

- [ ] **Step 2: Drop id_number from schema + defaults**

Remove `id_number: z.string().max(50).optional(),` (line 27) from `visitorSchema`. In the
`useForm` defaults (line 67), remove `id_number: ''` from the `defaultValues` object.
(`id_type` stays required.)

- [ ] **Step 3: Drop id_number from createVisitor**

In `onSubmitForm` (lines 88-95), remove the `id_number: data.id_number || '',` line from
the `kioskApi.createVisitor({...})` call. Leave `id_type: data.id_type,`.

- [ ] **Step 4: Replace SmartIdFields with IdTypeChooser in the form**

Replace the `<SmartIdFields ... />` block (lines 326-338) with:

```tsx
              <IdTypeChooser
                idType={form.watch('id_type')}
                onIdTypeChange={(v) => {
                  form.setValue('id_type', v as never);
                  if (v) form.clearErrors('id_type');
                }}
                idTypeError={form.formState.errors.id_type?.message}
              />
```

- [ ] **Step 5: Replace the ID-photo step's PhotoCapture with IdDocumentCapture**

Replace the line in the non-blocked branch (line 436):

```tsx
                <PhotoCapture title="Photograph Your ID" facingMode="environment" mirror={false} required qualityGuard onCapture={handleIdCapture} onSkip={() => { /* ID photo is mandatory — no skip */ }} />
```

with:

```tsx
                <IdDocumentCapture idType={form.getValues('id_type')} required qualityGuard onComplete={handleIdComplete} onSkip={() => { /* ID photo is mandatory — no skip */ }} />
```

- [ ] **Step 6: Replace handleIdCapture with handleIdComplete**

Replace the `handleIdCapture` function (lines 108-117) with:

```tsx
  async function handleIdComplete({ front, back }: { front: Blob; back?: Blob }) {
    setMode('submitting');
    let verdict: IdCheckVerdict | undefined;
    if (visitorId) {
      try { verdict = (await kioskApi.uploadIdPhoto(visitorId, front)).id_check; } catch { /* continue */ }
      if (back) { try { await kioskApi.uploadIdPhotoBack(visitorId, back); } catch { /* best-effort */ } }
    }
    const captured = verdict ?? null;
    setIdCheck(captured);
    await finishCheckIn(undefined, captured);
  }
```

- [ ] **Step 7: Type-check (catches any leftover SmartIdFields/PhotoCapture/id_number reference)**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS. If `PhotoCapture` is now unused in this file, remove its import (line 8);
if it's still used by the `face` step, keep it. (The `face` step at line 357 still uses
`PhotoCapture`, so keep the import.)

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/KioskPage.tsx
git commit -m "feat(web): kiosk uses IdTypeChooser + front/back ID capture" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire the Reception check-in page

**Files:**
- Modify: `packages/web/src/pages/CheckInPage.tsx`

- [ ] **Step 1: Swap the import**

In `packages/web/src/pages/CheckInPage.tsx`, replace the `SmartIdFields` import (line 14):

```ts
import { IdTypeChooser } from '@/components/checkin/IdTypeChooser';
import { IdDocumentCapture } from '@/components/checkin/IdDocumentCapture';
```

- [ ] **Step 2: Drop id_number from schema + defaults + reset**

In `newVisitorSchema`, remove `id_number: z.string().max(50).optional(),` (line 47).
In the `useForm` defaults (line 99), remove `id_number: ''`. In `goToNewVisitor`
(lines 199-207), remove the `id_number: ''` line from `newVisitorForm.reset({...})`.

- [ ] **Step 3: Replace SmartIdFields with IdTypeChooser**

Replace the `<SmartIdFields ... />` block (lines 374-383) with:

```tsx
            <IdTypeChooser
              idType={newVisitorForm.watch('id_type')}
              onIdTypeChange={(v) => newVisitorForm.setValue('id_type', v as never)}
            />
```

- [ ] **Step 4: Replace the id-photo step's PhotoCapture with IdDocumentCapture**

Replace the `<PhotoCapture ... />` in the `id-photo` step (lines 441-447) with:

```tsx
            <IdDocumentCapture
              idType={newVisitorForm.getValues('id_type')}
              onComplete={handleIdComplete}
              onSkip={() => setStep('check-in')}
            />
```

- [ ] **Step 5: Replace handleIdPhotoCapture with handleIdComplete**

Replace the `handleIdPhotoCapture` function (lines 180-194) with:

```tsx
  /* ---- ID photo upload (front, optional back for Ghana Card) ---- */
  async function handleIdComplete({ front, back }: { front: Blob; back?: Blob }) {
    if (!selectedVisitor) { setStep('check-in'); return; }
    try {
      await fetch(`/api/photos/visitors/${selectedVisitor.id}/id-photo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'image/jpeg' },
        body: await front.arrayBuffer(),
      });
      if (back) {
        await fetch(`/api/photos/visitors/${selectedVisitor.id}/id-photo-back`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'image/jpeg' },
          body: await back.arrayBuffer(),
        });
      }
    } catch {
      // ID photo upload failed silently — continue to check-in
    }
    setStep('check-in');
  }
```

- [ ] **Step 6: Type-check**

Run: `node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS. The reception page no longer uses `PhotoCapture` directly only if the
`photo` (face) step also changed — it did NOT, so the `PhotoCapture` import (line 12) is
still used by the `photo` step. Keep it.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/CheckInPage.tsx
git commit -m "feat(web): reception uses IdTypeChooser + front/back ID capture" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Delete SmartIdFields + full verification

**Files:**
- Delete: `packages/web/src/components/checkin/SmartIdFields.tsx`

- [ ] **Step 1: Confirm nothing imports SmartIdFields**

Grep for remaining references across `packages/web/src` for the string `SmartIdFields`
(via the Grep tool or `git grep SmartIdFields -- packages/web/src`). Expected: zero
matches after Tasks 11-12.

- [ ] **Step 2: Delete the file**

Delete `packages/web/src/components/checkin/SmartIdFields.tsx`.

- [ ] **Step 3: Type-check both packages**

Run:
`node ./node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
`node ./node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS for both.

- [ ] **Step 4: Run the full test suites**

Run:
`node node_modules/vitest/vitest.mjs run packages/api/src`
`node node_modules/vitest/vitest.mjs run packages/web/src`
Expected: all green, including the new `photo-key` and `id-capture` cases.

- [ ] **Step 5: Manual verification (Playwright kiosk)**

Using the verify-kiosk-form practice (type() not fill(); wait for the directorate
`<select>` to populate):
- Ghana Card path: choose Ghana Card → details → face → **Front of Ghana Card** →
  **Back of Ghana Card** → success. Confirm two ID objects exist
  (`/api/photos/visitors/:id/id` and `/id-back` both 200 when authed).
- Passport path: choose Passport → single ID shot → success (no back).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): remove SmartIdFields (replaced by IdTypeChooser)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done

After Task 13: branch `feat/photo-based-id-capture` holds the full feature. Before merge,
remember the prod D1 column is added by `POST /api/admin/migrations/run` (Settings →
Run migrations) — the new `migration-visitor-id-photo-back.sql` must be applied in prod
after deploy, before the new UI writes `id_photo_back_url`.

**Backup completeness:** no change needed. `services/backup.ts` exports each table with
`SELECT * FROM visitors`, so `id_photo_back_url` is captured automatically once the
column exists; restore re-inserts all columns dynamically. The only backup-relevant code
is the purge (Task 6), which now removes the back R2 object too.
