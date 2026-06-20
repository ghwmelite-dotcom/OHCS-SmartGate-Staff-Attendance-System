# Kiosk ID-Photo Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mandatory-capture + non-blocking AI "is this an ID document?" soft-flag to the kiosk ID-photo step, surfaced in real time to the supervising receptionist and persisted per-visit for audit — never blocking a genuine visitor.

**Architecture:** A pure verdict parser (`lib/id-check.ts`) + a Workers-AI service (`services/id-check.ts`, model `@cf/meta/llama-3.2-11b-vision-instruct`, raced ~5s). The kiosk `/id-photo` route runs the check inline, returns the verdict for the live UI nudge, and stashes it in KV keyed by visitor; `/check-in` reads KV and persists it onto the new `visits.id_photo_check` column. A client-side quality guard in `PhotoCapture` rejects blank/dark frames. The VMS shows a verdict badge.

**Tech Stack:** Cloudflare Workers (Hono), D1, KV, Workers AI (`env.AI`); React 18 + react-hook-form + zod; vitest (pure-function tests + mocked `env.AI`).

**Reference spec:** `docs/superpowers/specs/2026-06-18-kiosk-id-photo-verification-design.md`

**Toolchain note (repo path has a space + `&`):** never `npm run`; invoke binaries directly.
- API type-check (from `packages/api`): `node ../../node_modules/typescript/bin/tsc --noEmit`
- API tests (from `packages/api`): `node ../../node_modules/vitest/vitest.mjs run <file>`
- Web type-check / tests / build (from `packages/web`): `node ../../node_modules/typescript/bin/tsc --noEmit` · `node ../../node_modules/vitest/vitest.mjs run <file>` · `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`
- Wrangler (local D1) from `packages/api`: `node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=<sql>`

**Key codebase facts (verified):**
- `env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { prompt, image: number[], max_tokens })` → `{ response: string }`. Image bytes as `[...new Uint8Array(buf)]` (same shape as the existing `@cf/insightface/buffalo_s` call in `services/liveness/ai.ts`). One-time per-account license acceptance may be required before first real verdict (handled by degrading to `indeterminate`).
- `Env` has `AI: Ai`, `KV: KVNamespace`, `DB: D1Database`.
- Every visit read uses `SELECT v.*` (`services/visit-queries.ts:3`, `routes/visits.ts:29/91`, `routes/visitors.ts:59`), so a new nullable `visits` column is auto-returned — no query edits.
- The ONLY `INSERT INTO visits` is `services/check-in.ts:51`.
- Migrations are registered in `packages/api/src/db/migrations-index.ts` (`MIGRATIONS` array) and applied by `POST /api/admin/migrations/run` (`routes/admin-migrations.ts`).

---

## File Structure

**Create:**
- `packages/api/src/db/migration-id-photo-check.sql` — `ALTER TABLE visits ADD COLUMN id_photo_check TEXT;`
- `packages/api/src/lib/id-check.ts` — `IdCheckVerdict` type + pure `parseModelVerdict()`.
- `packages/api/src/lib/id-check.test.ts` — parser unit tests.
- `packages/api/src/services/id-check.ts` — `checkIdDocument(env, bytes, timeoutMs?)` (AI call + race + parse).
- `packages/api/src/services/id-check.test.ts` — service tests with mocked `env.AI`.
- `packages/web/src/lib/image-quality.ts` — pure `assessFrameQuality()`.
- `packages/web/src/lib/image-quality.test.ts` — quality-guard unit tests.
- `packages/web/src/components/IdCheckBadge.tsx` — VMS verdict badge.

**Modify:**
- `packages/api/src/db/migrations-index.ts` — register the migration.
- `packages/api/src/db/schema.sql` — add the column to `CREATE TABLE visits`.
- `packages/api/src/services/check-in.ts` — `CheckInParams.id_photo_check` + INSERT column.
- `packages/api/src/routes/kiosk.ts` — `/id-photo` runs the check + stashes KV + returns verdict; `/check-in` reads KV + passes through.
- `packages/web/src/components/PhotoCapture.tsx` — `qualityGuard` prop.
- `packages/web/src/lib/kioskApi.ts` — `uploadIdPhoto` returns the verdict; add `IdCheckVerdict` type.
- `packages/web/src/pages/KioskPage.tsx` — upload spinner, keep verdict, success-screen warning when flagged, ID step passes `qualityGuard`.
- `packages/web/src/pages/VisitorDetailPage.tsx` and `packages/web/src/pages/VisitLogPage.tsx` — render `IdCheckBadge`.

---

### Task 1: DB migration — `visits.id_photo_check`

**Files:**
- Create: `packages/api/src/db/migration-id-photo-check.sql`
- Modify: `packages/api/src/db/migrations-index.ts`, `packages/api/src/db/schema.sql`

- [ ] **Step 1: Create the migration file**

`packages/api/src/db/migration-id-photo-check.sql`:
```sql
-- Soft, non-authoritative AI verdict on the ID photo captured for a kiosk visit.
-- JSON: { verdict, detected_type?, confidence?, model?, checked_at? }
-- verdict ∈ 'document' | 'not_document' | 'indeterminate'. Never gates check-in.
ALTER TABLE visits ADD COLUMN id_photo_check TEXT;
```

- [ ] **Step 2: Register it in `migrations-index.ts`**

Add the import after the last existing migration import (the `kioskVisitor` import near line 19):
```ts
import idPhotoCheck from './migration-id-photo-check.sql';
```
Add as the LAST entry of the `MIGRATIONS` array:
```ts
  { filename: 'migration-id-photo-check.sql', sql: idPhotoCheck },
```

- [ ] **Step 3: Add the column to `schema.sql`**

In `packages/api/src/db/schema.sql`, in `CREATE TABLE IF NOT EXISTS visits (...)`, add a line immediately after `notes             TEXT,`:
```sql
    id_photo_check   TEXT,
```

- [ ] **Step 4: Apply to LOCAL D1 and verify**

From `packages/api`:
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=src/db/migration-id-photo-check.sql
```
Then verify:
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM pragma_table_info('visits') WHERE name='id_photo_check'"
```
Expected: one row, `id_photo_check`.
(REMOTE apply is a confirmed deploy-time step — see "Deployment" at the end. Do NOT touch remote here.)

- [ ] **Step 5: Type-check + commit**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS (the `.sql` import resolves via the existing `?raw`/text rule used by the other migrations).
```
git add packages/api/src/db/migration-id-photo-check.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): add visits.id_photo_check column + migration"
```

---

### Task 2: Pure verdict type + parser (`lib/id-check.ts`) — TDD

**Files:**
- Create: `packages/api/src/lib/id-check.ts`, `packages/api/src/lib/id-check.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/api/src/lib/id-check.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseModelVerdict } from './id-check';

describe('parseModelVerdict', () => {
  it('parses a clean document JSON', () => {
    const v = parseModelVerdict('{"is_document": true, "type": "ghana_card", "confidence": 0.92}');
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBe('ghana_card');
    expect(v.confidence).toBe(0.92);
  });
  it('maps is_document false to not_document', () => {
    const v = parseModelVerdict('{"is_document": false, "type": "none", "confidence": 0.8}');
    expect(v.verdict).toBe('not_document');
    expect(v.detected_type).toBe('none');
  });
  it('extracts JSON embedded in prose', () => {
    const v = parseModelVerdict('Sure! Here is the result: {"is_document":true,"type":"passport","confidence":0.7} hope that helps');
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBe('passport');
  });
  it('returns indeterminate for non-JSON garbage', () => {
    expect(parseModelVerdict('I cannot tell from this image.').verdict).toBe('indeterminate');
  });
  it('returns indeterminate for empty input', () => {
    expect(parseModelVerdict('').verdict).toBe('indeterminate');
  });
  it('clamps an out-of-range confidence and drops an unknown type', () => {
    const v = parseModelVerdict('{"is_document": true, "type": "banana", "confidence": 5}');
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBeUndefined();
    expect(v.confidence).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/lib/id-check.test.ts`
Expected: FAIL — cannot resolve `./id-check`.

- [ ] **Step 3: Implement `lib/id-check.ts`**

```ts
export type IdVerdict = 'document' | 'not_document' | 'indeterminate';
export type IdDetectedType =
  | 'ghana_card' | 'passport' | 'drivers_license' | 'staff_id' | 'other' | 'none';

export interface IdCheckVerdict {
  verdict: IdVerdict;
  detected_type?: IdDetectedType;
  confidence?: number;
  model?: string;
  checked_at?: string;
}

const DETECTED_TYPES: ReadonlySet<string> = new Set([
  'ghana_card', 'passport', 'drivers_license', 'staff_id', 'other', 'none',
]);

// Defensive: vision models return loose text. Extract the first {...} block,
// parse it, and coerce into a verdict. Any failure → indeterminate (never throws).
export function parseModelVerdict(text: string): IdCheckVerdict {
  if (!text) return { verdict: 'indeterminate' };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: 'indeterminate' };

  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { verdict: 'indeterminate' };
  }
  if (typeof obj !== 'object' || obj === null || !('is_document' in obj)) {
    return { verdict: 'indeterminate' };
  }

  const rec = obj as Record<string, unknown>;
  const isDoc = rec.is_document;
  if (typeof isDoc !== 'boolean') return { verdict: 'indeterminate' };

  const result: IdCheckVerdict = { verdict: isDoc ? 'document' : 'not_document' };

  if (typeof rec.type === 'string' && DETECTED_TYPES.has(rec.type)) {
    result.detected_type = rec.type as IdDetectedType;
  }
  if (typeof rec.confidence === 'number' && rec.confidence >= 0 && rec.confidence <= 1) {
    result.confidence = rec.confidence;
  }
  return result;
}
```

- [ ] **Step 4: Run tests — PASS (6)**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/lib/id-check.test.ts` → 6 pass.

- [ ] **Step 5: Commit**
```
git add packages/api/src/lib/id-check.ts packages/api/src/lib/id-check.test.ts
git commit -m "feat(api): add ID-check verdict type + defensive parser with tests"
```

---

### Task 3: AI document-check service (`services/id-check.ts`) — TDD

**Files:**
- Create: `packages/api/src/services/id-check.ts`, `packages/api/src/services/id-check.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/api/src/services/id-check.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { checkIdDocument } from './id-check';
import type { Env } from '../types';

function envWith(run: (model: unknown, input: unknown) => Promise<unknown>): Env {
  return { AI: { run } } as unknown as Env;
}
const bytes = new Uint8Array([1, 2, 3]).buffer;

describe('checkIdDocument', () => {
  it('returns a document verdict from the model response, tagging model + checked_at', async () => {
    const env = envWith(async () => ({ response: '{"is_document":true,"type":"ghana_card","confidence":0.9}' }));
    const v = await checkIdDocument(env, bytes);
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBe('ghana_card');
    expect(v.model).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(typeof v.checked_at).toBe('string');
  });
  it('returns not_document when the model says so', async () => {
    const env = envWith(async () => ({ response: '{"is_document":false,"type":"none","confidence":0.6}' }));
    expect((await checkIdDocument(env, bytes)).verdict).toBe('not_document');
  });
  it('degrades to indeterminate when the model throws (e.g. license/agreement error)', async () => {
    const env = envWith(async () => { throw new Error('license required'); });
    expect((await checkIdDocument(env, bytes)).verdict).toBe('indeterminate');
  });
  it('degrades to indeterminate on timeout', async () => {
    const env = envWith(() => new Promise(() => { /* never resolves */ }));
    const v = await checkIdDocument(env, bytes, 20);
    expect(v.verdict).toBe('indeterminate');
  });
  it('passes the image as a byte array and a prompt', async () => {
    let received: Record<string, unknown> = {};
    const env = envWith(async (_m, input) => { received = input as Record<string, unknown>; return { response: '{"is_document":true}' }; });
    await checkIdDocument(env, bytes);
    expect(Array.isArray(received.image)).toBe(true);
    expect(typeof received.prompt).toBe('string');
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/services/id-check.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `services/id-check.ts`**

```ts
import type { Env } from '../types';
import { parseModelVerdict, type IdCheckVerdict } from '../lib/id-check';

const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DEFAULT_TIMEOUT_MS = 5000;

const PROMPT =
  'You are verifying a photo taken at a building reception desk. Decide whether the image ' +
  'shows a government-issued identity document (a Ghana Card, passport, driver\'s licence, or ' +
  'staff ID card). Reply with ONLY a compact JSON object and no other text: ' +
  '{"is_document": true|false, "type": "ghana_card"|"passport"|"drivers_license"|"staff_id"|"other"|"none", "confidence": 0.0-1.0}';

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`id_check_timeout_${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// Best-effort, non-blocking ID-document check. NEVER throws — any failure
// (timeout, model error, unparseable output, missing license agreement) yields
// an `indeterminate` verdict so the caller can proceed unimpeded.
export async function checkIdDocument(
  env: Env,
  bytes: ArrayBuffer,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<IdCheckVerdict> {
  const checked_at = new Date().toISOString();
  try {
    const res = await raceWithTimeout(
      env.AI.run(MODEL as never, {
        prompt: PROMPT,
        image: [...new Uint8Array(bytes)],
        max_tokens: 100,
      } as never) as Promise<{ response?: string }>,
      timeoutMs,
    );
    return { ...parseModelVerdict(res?.response ?? ''), model: MODEL, checked_at };
  } catch {
    return { verdict: 'indeterminate', model: MODEL, checked_at };
  }
}
```

- [ ] **Step 4: Run tests — PASS (5)**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/services/id-check.test.ts` → 5 pass.

- [ ] **Step 5: Commit**
```
git add packages/api/src/services/id-check.ts packages/api/src/services/id-check.test.ts
git commit -m "feat(api): add Workers-AI ID-document check service (raced, non-blocking)"
```

---

### Task 4: Wire the check into the kiosk routes + persist on the visit

**Files:**
- Modify: `packages/api/src/services/check-in.ts`, `packages/api/src/routes/kiosk.ts`

- [ ] **Step 1: Add `id_photo_check` to `CheckInParams` + the INSERT**

In `packages/api/src/services/check-in.ts`, add to the `CheckInParams` interface (after `idempotency_key`):
```ts
  id_photo_check?: string | null;
```
Change the visits INSERT (lines ~51-58) to include the column and a bind. New column list ends `..., check_in_source, id_photo_check)` with one extra `?`, and append the bind at the end:
```ts
    env.DB.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, host_name_manual, directorate_id, purpose_raw, purpose_category, badge_code, status, created_by, idempotency_key, check_in_source, id_photo_check)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?, ?, ?)`
    ).bind(
      visitId, params.visitor_id, params.host_officer_id || null, params.host_name_manual || null,
      params.directorate_id || null, params.purpose_raw || null, params.purpose_category || null,
      badgeCode, params.created_by, params.idempotency_key ?? null, params.check_in_source,
      params.id_photo_check ?? null,
    ),
```
(Staff check-in passes no `id_photo_check` → NULL, unchanged behaviour.)

- [ ] **Step 2: `/id-photo` route — run the check, stash KV, return the verdict**

In `packages/api/src/routes/kiosk.ts`, add the import at the top:
```ts
import { checkIdDocument } from '../services/id-check';
```
Replace the body of `kioskRoutes.post('/visitors/:id/id-photo', ...)` (after the existing size checks + `uploadVisitorPhoto`) so it runs the check inline and returns it. The handler becomes:
```ts
kioskRoutes.post('/visitors/:id/id-photo', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  const idPhotoUrl = `/api/photos/visitors/${visitorId}/id`;
  await uploadVisitorPhoto(c.env, visitorId, buf, visitorIdPhotoKey(visitorId), 'id_photo_url', idPhotoUrl);

  // Non-blocking soft-flag: run the AI document check inline (raced ~5s), return
  // it for the live receptionist nudge, and stash it for the check-in to persist.
  const idCheck = await checkIdDocument(c.env, buf);
  await c.env.KV.put(`idcheck:${visitorId}`, JSON.stringify(idCheck), { expirationTtl: 900 });

  return success(c, { id_photo_url: idPhotoUrl, id_check: idCheck });
});
```

- [ ] **Step 3: `/check-in` route — read KV, pass through**

Replace the `kioskRoutes.post('/check-in', ...)` handler body so it reads + clears the stashed verdict and forwards it:
```ts
kioskRoutes.post('/check-in', zValidator('json', KioskCheckInSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const idCheckRaw = await c.env.KV.get(`idcheck:${body.visitor_id}`);
  if (idCheckRaw !== null) await c.env.KV.delete(`idcheck:${body.visitor_id}`);
  const result = await performCheckIn(c.env, c.executionCtx, {
    ...body,
    created_by: KIOSK_USER_ID,
    check_in_source: 'kiosk',
    id_photo_check: idCheckRaw ?? JSON.stringify({ verdict: 'indeterminate' }),
  });
  if (!result.ok) return notFound(c, 'Visitor');
  return created(c, result.visit);
});
```

- [ ] **Step 4: Type-check**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
Also run the existing api tests to confirm no regression: `node ../../node_modules/vitest/vitest.mjs run` → all PASS.

- [ ] **Step 5: Commit**
```
git add packages/api/src/services/check-in.ts packages/api/src/routes/kiosk.ts
git commit -m "feat(kiosk): run ID-document check on upload, persist verdict per-visit via KV"
```

---

### Task 5: Client quality guard (`lib/image-quality.ts` + PhotoCapture) — TDD

**Files:**
- Create: `packages/web/src/lib/image-quality.ts`, `packages/web/src/lib/image-quality.test.ts`
- Modify: `packages/web/src/components/PhotoCapture.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/src/lib/image-quality.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assessFrameQuality } from './image-quality';

// Build a w*h RGBA buffer filled with one grey level.
function solid(level: number, w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = level; data[i + 1] = level; data[i + 2] = level; data[i + 3] = 255; }
  return { data, width: w, height: h };
}
// Half black, half white → high variance.
function highContrast(w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = p < (w * h) / 2 ? 0 : 255;
    data[p * 4] = v; data[p * 4 + 1] = v; data[p * 4 + 2] = v; data[p * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('assessFrameQuality', () => {
  it('rejects a near-black frame', () => {
    expect(assessFrameQuality(solid(4)).ok).toBe(false);
  });
  it('rejects a near-white frame', () => {
    expect(assessFrameQuality(solid(252)).ok).toBe(false);
  });
  it('rejects a flat mid-grey frame (no detail)', () => {
    expect(assessFrameQuality(solid(128)).ok).toBe(false);
  });
  it('accepts a high-contrast frame (has detail at usable brightness)', () => {
    expect(assessFrameQuality(highContrast()).ok).toBe(true);
  });
  it('returns a reason string when rejected', () => {
    expect(typeof assessFrameQuality(solid(4)).reason).toBe('string');
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL**

From `packages/web`: `node ../../node_modules/vitest/vitest.mjs run src/lib/image-quality.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/image-quality.ts`**

```ts
// A structural subset of ImageData so this is testable without a DOM canvas.
export interface FramePixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export interface QualityResult {
  ok: boolean;
  reason?: string;
}

// Reject frames that clearly contain no usable subject: too dark, blown-out, or
// flat (a blank wall / lens covered). Uses mean luminance + luminance stdev on a
// subsampled set of pixels. Pure + deterministic.
export function assessFrameQuality(frame: FramePixels): QualityResult {
  const { data, width, height } = frame;
  const pixelCount = width * height;
  if (pixelCount === 0) return { ok: false, reason: 'Empty frame — please retake.' };

  // Subsample up to ~1024 pixels for speed.
  const step = Math.max(1, Math.floor(pixelCount / 1024));
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let p = 0; p < pixelCount; p += step) {
    const i = p * 4;
    // Rec. 601 luma.
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const stdev = Math.sqrt(variance);

  if (mean < 25) return { ok: false, reason: 'Image too dark — please retake in better light.' };
  if (mean > 235) return { ok: false, reason: 'Image too bright — please retake.' };
  if (stdev < 12) return { ok: false, reason: 'Image looks blank — make sure the ID fills the frame.' };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests — PASS (5)**

From `packages/web`: `node ../../node_modules/vitest/vitest.mjs run src/lib/image-quality.test.ts` → 5 pass.

- [ ] **Step 5: Add the `qualityGuard` prop to `PhotoCapture`**

In `packages/web/src/components/PhotoCapture.tsx`:
- Add import: `import { assessFrameQuality } from '@/lib/image-quality';`
- Add to `PhotoCaptureProps`:
```ts
  /** When true, reject blank/too-dark/too-bright captures and prompt a retake. */
  qualityGuard?: boolean;
```
- Add to the destructured props (with the others): `qualityGuard = false,`
- Add a state near the other `useState`s: `const [qualityError, setQualityError] = useState<string | null>(null);`
- In `capture()`, AFTER `ctx.drawImage(...)` and BEFORE `canvas.toBlob(...)`, insert the guard:
```ts
    if (qualityGuard) {
      const { ok, reason } = assessFrameQuality(ctx.getImageData(0, 0, 400, 400));
      if (!ok) { setQualityError(reason ?? 'Please retake the photo.'); return; }
    }
    setQualityError(null);
```
- In `retake()`, add `setQualityError(null);`
- Render the message: directly above the actions `<div className="flex items-center justify-center gap-3">`, add:
```tsx
      {qualityError && <p className="text-[12px] text-danger">{qualityError}</p>}
```
Staff usage omits `qualityGuard` → unchanged.

- [ ] **Step 6: Type-check + commit**

From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
```
git add packages/web/src/lib/image-quality.ts packages/web/src/lib/image-quality.test.ts packages/web/src/components/PhotoCapture.tsx
git commit -m "feat(web): add capture quality guard (opt-in) with tests"
```

---

### Task 6: Kiosk wiring — return verdict, upload spinner, success warning

**Files:**
- Modify: `packages/web/src/lib/kioskApi.ts`, `packages/web/src/pages/KioskPage.tsx`

- [ ] **Step 1: `kioskApi` — type the verdict + return it from `uploadIdPhoto`**

In `packages/web/src/lib/kioskApi.ts`:
- Add the type (mirrors the API shape):
```ts
export interface IdCheckVerdict {
  verdict: 'document' | 'not_document' | 'indeterminate';
  detected_type?: 'ghana_card' | 'passport' | 'drivers_license' | 'staff_id' | 'other' | 'none';
  confidence?: number;
  model?: string;
  checked_at?: string;
}
export interface IdPhotoResult { id_photo_url: string; id_check?: IdCheckVerdict; }
```
- Replace `kioskUploadPhoto` so it returns the parsed `data` (and keep face-upload callers working by returning the data generically):
```ts
async function kioskUploadPhoto<T>(visitorId: string, kind: 'photo' | 'id-photo', blob: Blob): Promise<T> {
  const buf = await blob.arrayBuffer();
  const res = await fetch(`${API_BASE}/kiosk/visitors/${visitorId}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: buf,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Photo upload failed (${res.status})`);
  return json.data as T;
}
```
- Update the `kioskApi` methods:
```ts
  uploadFacePhoto: (id: string, blob: Blob) => kioskUploadPhoto<{ photo_url: string }>(id, 'photo', blob),
  uploadIdPhoto: (id: string, blob: Blob) => kioskUploadPhoto<IdPhotoResult>(id, 'id-photo', blob),
```

- [ ] **Step 2: `KioskPage` — keep the verdict, show a spinner during the ID upload, warn on the success screen**

In `packages/web/src/pages/KioskPage.tsx`:
- Import the type: add `type IdCheckVerdict` to the existing kioskApi import, e.g. `import { kioskApi, type KioskVisit, type KioskDirectorate, type IdCheckVerdict } from '@/lib/kioskApi';`
- Add state near the others: `const [idCheck, setIdCheck] = useState<IdCheckVerdict | null>(null);`
- Replace `handleIdCapture` so it shows the submitting spinner during the (up-to-5s) upload+check and keeps the verdict:
```tsx
  async function handleIdCapture(blob: Blob) {
    setMode('submitting');
    let verdict: IdCheckVerdict | undefined;
    if (visitorId) {
      try { verdict = (await kioskApi.uploadIdPhoto(visitorId, blob)).id_check; } catch { /* continue */ }
    }
    setIdCheck(verdict ?? null);
    await finishCheckIn();
  }
```
- In `resetAll`, add `setIdCheck(null);`
- Pass the guard on the ID `PhotoCapture` (the `mode === 'id'` step): add `qualityGuard` to its props.
- On the success card (the `createdVisit?.badge_code` branch), compute and render the receptionist warning. Just before the `Done` button inside that card, add:
```tsx
        {(() => {
          const declared = form.getValues('id_type');
          const flagged = idCheck && (
            idCheck.verdict === 'not_document' ||
            (idCheck.detected_type && idCheck.detected_type !== 'none' && declared && idCheck.detected_type !== declared)
          );
          return flagged ? (
            <p className="text-[13px] text-accent-warm bg-accent/10 border border-accent/20 rounded-xl px-3 py-2">
              ⚠ ID photo looks unclear or doesn’t match the chosen ID type — please verify with reception.
            </p>
          ) : null;
        })()}
```

- [ ] **Step 3: Type-check + build + commit**

From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; then `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.
```
git add packages/web/src/lib/kioskApi.ts packages/web/src/pages/KioskPage.tsx
git commit -m "feat(kiosk): surface ID-check verdict (spinner + receptionist warning), guard ID capture"
```

---

### Task 7: VMS surfacing — `IdCheckBadge`

**Files:**
- Create: `packages/web/src/components/IdCheckBadge.tsx`
- Modify: `packages/web/src/pages/VisitorDetailPage.tsx`, `packages/web/src/pages/VisitLogPage.tsx`

- [ ] **Step 1: Create the badge component**

`packages/web/src/components/IdCheckBadge.tsx`:
```tsx
// Renders a small badge from a visit's `id_photo_check` JSON. Read-only audit
// signal; absent/unparseable → nothing. Never throws.
export function IdCheckBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  let verdict: string | undefined;
  try { verdict = (JSON.parse(value) as { verdict?: string }).verdict; } catch { return null; }

  if (verdict === 'document') {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-success/10 text-success">ID ✓</span>;
  }
  if (verdict === 'not_document') {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-danger/10 text-danger">ID ⚠</span>;
  }
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-border text-muted">ID ?</span>;
}
```

- [ ] **Step 2: Surface in `VisitorDetailPage.tsx`**

- Add import: `import { IdCheckBadge } from '@/components/IdCheckBadge';`
- The visit history rows map over `visitor.visits`. Add `id_photo_check?: string | null` to that page's visit type (find the `visits` array's item type/interface in this file and add the optional field).
- In the row JSX (the status cell area, ~line 195-210), render the badge next to the status — e.g. inside the status `<td>`: `<IdCheckBadge value={visit.id_photo_check} />` after the existing status pill.

- [ ] **Step 3: Surface in `VisitLogPage.tsx`**

- Add import: `import { IdCheckBadge } from '@/components/IdCheckBadge';`
- Add `id_photo_check?: string | null` to this page's `Visit` type (find the local `interface Visit`/type and extend it).
- In the row rendering (~line 202, the status column), render `<IdCheckBadge value={v.id_photo_check} />` alongside the status pill.

- [ ] **Step 4: Type-check + build + commit**

From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.
```
git add packages/web/src/components/IdCheckBadge.tsx packages/web/src/pages/VisitorDetailPage.tsx packages/web/src/pages/VisitLogPage.tsx
git commit -m "feat(vms): show ID-photo check badge in visit detail + log"
```

---

### Task 8: Full verification (static)

**Files:** none.

- [ ] **Step 1: API — tests + type-check**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run` → ALL pass (includes `id-check.test.ts`, `id-check` service test, existing `validation.test.ts`). `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 2: Web — tests + type-check + build**

From `packages/web`: `node ../../node_modules/vitest/vitest.mjs run` → ALL pass (adds `image-quality.test.ts`). `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS. `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.

- [ ] **Step 3: Confirm local D1 has the column** (from Task 1 Step 4 — re-verify):
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM pragma_table_info('visits') WHERE name='id_photo_check'"
```
Expected: one row.

- [ ] **Step 4: No commit** — report results.

---

## Deployment (controller-run, after merge — NOT a subagent task)

These steps touch production and need explicit confirmation (per the project rule "confirm before prod DB writes"):

1. **Remote D1 migration.** Apply the column to prod:
   `node "<repo>\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --remote --file=src/db/migration-id-photo-check.sql`
   Then record it so the migration runner stays a no-op (matches the prior backfill approach):
   `... d1 execute smartgate-db --remote --command "INSERT OR IGNORE INTO applied_migrations (filename, hash) VALUES ('migration-id-photo-check.sql','manual')"`
   Verify the column exists remotely with a `pragma_table_info('visits')` query.
2. **Deploy** via the normal merge-to-main → `deploy.yml` flow; confirm the run goes green.
3. **Workers AI license (one-time).** The first real verdict may come back `indeterminate` until the `@cf/meta/llama-3.2-11b-vision-instruct` model's license is accepted for the account (accept in the Cloudflare dashboard, or it auto-resolves after the first agreement). This is non-blocking by design.
4. **Live check (browser-less env caveat):** confirm `POST /api/kiosk/visitors/:id/id-photo` returns `{ id_photo_url, id_check }` (the verdict shape) against a test visitor; the on-device tablet run confirms the quality guard + the success-screen warning visually.

---

## Self-Review

**Spec coverage** (vs `2026-06-18-kiosk-id-photo-verification-design.md`):
- A. Migration `visits.id_photo_check` + schema + register → Task 1. ✓
- B. Client quality guard (`assessFrameQuality` + opt-in `PhotoCapture` prop) → Task 5. ✓
- C. Server AI check (`@cf/meta/llama-3.2-11b-vision-instruct`, raced ~5s, indeterminate on failure) + route wiring + KV stash → Tasks 3, 4. ✓
- C. Verdict typing + defensive parser → Task 2. ✓
- Sequencing solution (id-photo computes + returns + KV-stashes; check-in reads KV + persists per-visit; missing → indeterminate) → Task 4. ✓
- D/E. Kiosk real-time warning (verdict ≠ document or type mismatch) → Task 6; VMS audit badge → Task 7. ✓
- Rate-limit on the public AI-triggering endpoint → reuses existing `kioskRateLimit` (Task 4, unchanged guard at top of handler). ✓
- Never blocks check-in; server-authoritative verdict → Task 4 (verdict from server, KV-stashed, not client-trusted). ✓
- Tests: parser, service (mocked AI incl. timeout + throw), quality guard → Tasks 2, 3, 5. ✓
- Out-of-scope honored: no hard gate, no KYC vendor, no face-liveness, no backfill. ✓

**Placeholder scan:** No "TBD"/vague steps; every code step has full code; commands have expected output. The two UI "find the visit type and add the field" steps (Task 7) reference real files with line ranges from the exploration; the field name (`id_photo_check`) and type (`string | null`) are explicit.

**Type consistency:** `IdCheckVerdict` (api `lib/id-check.ts`) and the web mirror (`kioskApi.ts`) share field names `verdict`/`detected_type`/`confidence`/`model`/`checked_at`; `verdict` union identical (`document|not_document|indeterminate`). `checkIdDocument(env, bytes, timeoutMs?)` signature matches its tests. `parseModelVerdict` returns `IdCheckVerdict` minus `model`/`checked_at` (added by the service) — consistent. `CheckInParams.id_photo_check?: string | null` matches the INSERT bind and the kiosk route's pass-through (always a JSON string). `assessFrameQuality(FramePixels)` matches its tests (structural ImageData).
