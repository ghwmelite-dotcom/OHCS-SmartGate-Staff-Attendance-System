# Visitor Self-Service Kiosk + Badge Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-free lobby kiosk for visitor self-check-in (face + ID photo capture, badge with working photo), and scan-to-checkout via the badge QR code.

**Architecture:** A new public, rate-limited `/api/kiosk/*` route group (mounted before the auth middleware) reuses shared check-in/check-out services. The web app gets a public `/kiosk` route outside the protected layout. The badge photo bug is fixed with a public badge-scoped photo endpoint. Shared, testable pure helpers (badge-code generation/parsing, R2 photo keys) are extracted and unit-tested; UI is verified manually.

**Tech Stack:** Hono v4 on Cloudflare Workers (D1, KV, R2); React 18 + React Router 7 + TanStack Query + Zustand; Vite; Zod; `jsqr` (new) for QR decoding; vitest for unit tests.

---

## Spec reference

Design: `docs/superpowers/specs/2026-06-17-visitor-self-service-kiosk-design.md`

## Conventions (read before starting)

- API responses use helpers from `packages/api/src/lib/response.ts`: `success(c, data, meta?)`, `created(c, data)`, `notFound(c, 'Thing')`, `error(c, CODE, message, status)`. All return `{ data, error, meta }` JSON.
- D1 access is always parameterized: `c.env.DB.prepare(sql).bind(...).first()/all()/run()`, and `c.env.DB.batch([...])` for multi-statement.
- The API has two **separate** `Role` unions that must stay in sync: `packages/api/src/types.ts` and `packages/api/src/lib/require-role.ts`.
- Test runners: `npm test -w packages/api` and (after Task 9) `npm test -w packages/web`. Type-check everything with `npm run type-check` from the repo root.
- IDs for new rows are generated with `crypto.randomUUID().replace(/-/g, '')` (see `visitors.ts:73`).
- `visits.created_by` is a FK to `users(id)`; kiosk check-ins use the seeded `user_kiosk` row.

---

## Task 1: Database migration — kiosk columns + seeded kiosk user

**Files:**
- Create: `packages/api/src/db/migration-kiosk-visitor.sql`
- Modify: `packages/api/src/db/migrations-index.ts`
- Modify: `packages/api/src/db/schema.sql` (fresh-DB parity)
- Modify: `packages/api/src/db/seed.sql` (kiosk user for local seed)

- [ ] **Step 1: Write the migration SQL**

Create `packages/api/src/db/migration-kiosk-visitor.sql`:

```sql
-- Visitor self-service kiosk — companion spec: 2026-06-17-visitor-self-service-kiosk-design.md
-- Adds:
--   * visitors.id_photo_url  — R2 path of the captured ID-document photo
--   * visits.check_in_source — 'staff' (default) or 'kiosk'
--   * a seeded system "kiosk" user for attributing self-service check-ins
--
-- NOTE: users.role is a free-text column (no CHECK constraint), so the new
-- 'visitor' role needs no schema change here — only the TypeScript Role unions.

ALTER TABLE visitors ADD COLUMN id_photo_url TEXT;

-- D1/SQLite ALTER TABLE ADD COLUMN cannot use a non-constant default; a string
-- literal default IS constant and is allowed here.
ALTER TABLE visits ADD COLUMN check_in_source TEXT NOT NULL DEFAULT 'staff';

INSERT OR IGNORE INTO users (id, name, email, role)
VALUES ('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'visitor');
```

- [ ] **Step 2: Register the migration**

In `packages/api/src/db/migrations-index.ts`, add the import after the `passiveLiveness` import (line 18):

```typescript
import kioskVisitor from './migration-kiosk-visitor.sql';
```

And add this as the **last** entry of the `MIGRATIONS` array (after the `migration-passive-liveness.sql` entry, line 38):

```typescript
  { filename: 'migration-kiosk-visitor.sql', sql: kioskVisitor },
```

- [ ] **Step 3: Update schema.sql for fresh-DB parity**

In `packages/api/src/db/schema.sql`, in the `visitors` table (after `photo_url     TEXT,` at line 89) add:

```sql
    id_photo_url  TEXT,
```

In the `visits` table (after the `status` line, line 118) add:

```sql
    check_in_source  TEXT NOT NULL DEFAULT 'staff',
```

- [ ] **Step 4: Seed the kiosk user for local dev**

In `packages/api/src/db/seed.sql`, after the receptionist insert (line 45), add:

```sql
-- Self-service kiosk system user (attributes kiosk check-ins)
INSERT OR IGNORE INTO users (id, name, email, role) VALUES
('user_kiosk', 'Self-Service Kiosk', 'kiosk@ohcs.gov.gh', 'visitor');
```

- [ ] **Step 5: Apply schema + seed locally to verify SQL is valid**

Run: `npm run db:migrate -w packages/api && npm run db:seed -w packages/api`
Expected: both commands complete with no SQL errors (the `db:migrate` script runs `schema.sql` against the local D1).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db/migration-kiosk-visitor.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql packages/api/src/db/seed.sql
git commit -m "feat(api): kiosk DB migration — id_photo_url, check_in_source, kiosk user"
```

---

## Task 2: Add the `visitor` role to both Role unions

**Files:**
- Modify: `packages/api/src/types.ts:18-25`
- Modify: `packages/api/src/lib/require-role.ts:5-12`

- [ ] **Step 1: Add `visitor` to the types.ts Role union**

In `packages/api/src/types.ts`, change the `Role` type (lines 18-25) to:

```typescript
export type Role =
  | 'superadmin'
  | 'admin'
  | 'receptionist'
  | 'it'
  | 'director'
  | 'staff'
  | 'f_and_a_admin'
  | 'visitor';
```

- [ ] **Step 2: Add `visitor` to the require-role.ts Role union**

In `packages/api/src/lib/require-role.ts`, change the `Role` type (lines 5-12) to:

```typescript
export type Role =
  | 'superadmin'
  | 'admin'
  | 'receptionist'
  | 'it'
  | 'director'
  | 'staff'
  | 'f_and_a_admin'
  | 'visitor';
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/types.ts packages/api/src/lib/require-role.ts
git commit -m "feat(api): add 'visitor' role to Role unions"
```

---

## Task 3: Pure R2 photo-key helpers (TDD)

**Files:**
- Create: `packages/api/src/lib/photo-key.ts`
- Test: `packages/api/src/lib/photo-key.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/lib/photo-key.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { visitorPhotoKey, visitorIdPhotoKey } from './photo-key';

describe('visitorPhotoKey', () => {
  it('builds the R2 key for a visitor face photo', () => {
    expect(visitorPhotoKey('abc123')).toBe('photos/visitors/abc123.jpg');
  });
});

describe('visitorIdPhotoKey', () => {
  it('builds the R2 key for a visitor ID-document photo', () => {
    expect(visitorIdPhotoKey('abc123')).toBe('photos/visitors/abc123-id.jpg');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/api -- photo-key`
Expected: FAIL — cannot find module `./photo-key`.

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/lib/photo-key.ts`:

```typescript
// Centralised R2 object-key construction for visitor photos so the upload and
// serve paths can never drift apart.
export function visitorPhotoKey(visitorId: string): string {
  return `photos/visitors/${visitorId}.jpg`;
}

export function visitorIdPhotoKey(visitorId: string): string {
  return `photos/visitors/${visitorId}-id.jpg`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w packages/api -- photo-key`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/lib/photo-key.ts packages/api/src/lib/photo-key.test.ts
git commit -m "feat(api): add visitor photo-key helpers with tests"
```

---

## Task 4: Photo upload routes use helpers + add ID-photo upload

**Files:**
- Modify: `packages/api/src/routes/photos.ts`
- Modify: `packages/api/src/index.ts:75-83` (public photo serve uses helper)

- [ ] **Step 1: Refactor photos.ts to use the key helpers and add the ID-photo route**

Replace the entire contents of `packages/api/src/routes/photos.ts` with:

```typescript
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';
import { visitorPhotoKey, visitorIdPhotoKey } from '../lib/photo-key';

export const photoRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const MAX_PHOTO_BYTES = 500_000;

// Shared raw-JPEG upload handler. Stores to R2 under `key` and writes the
// resulting public URL into `column` on the visitor row.
async function uploadVisitorPhoto(
  env: Env,
  visitorId: string,
  body: ArrayBuffer,
  key: string,
  column: 'photo_url' | 'id_photo_url',
  publicUrl: string,
): Promise<void> {
  await env.STORAGE.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.DB.prepare(
    `UPDATE visitors SET ${column} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).bind(publicUrl, visitorId).run();
}

// Upload visitor face photo — accepts raw JPEG body
photoRoutes.post('/visitors/:id/photo', async (c) => {
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);

  const photoUrl = `/api/photos/visitors/${visitorId}`;
  await uploadVisitorPhoto(c.env, visitorId, body, visitorPhotoKey(visitorId), 'photo_url', photoUrl);
  return success(c, { photo_url: photoUrl });
});

// Upload visitor ID-document photo — accepts raw JPEG body
photoRoutes.post('/visitors/:id/id-photo', async (c) => {
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);

  const idPhotoUrl = `/api/photos/visitors/${visitorId}/id`;
  await uploadVisitorPhoto(c.env, visitorId, body, visitorIdPhotoKey(visitorId), 'id_photo_url', idPhotoUrl);
  return success(c, { id_photo_url: idPhotoUrl });
});

// Serve visitor face photo from R2 (auth-gated; mounted under /api/*)
photoRoutes.get('/visitors/:id', async (c) => {
  const object = await c.env.STORAGE.get(visitorPhotoKey(c.req.param('id')));
  if (!object) return notFound(c, 'Photo');
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});

// Serve visitor ID-document photo from R2 (auth-gated)
photoRoutes.get('/visitors/:id/id', async (c) => {
  const object = await c.env.STORAGE.get(visitorIdPhotoKey(c.req.param('id')));
  if (!object) return notFound(c, 'Photo');
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});
```

Note: `GET /api/photos/visitors/:id` (face) and `GET /api/photos/visitors/:id/id` are distinct routes; Hono matches `/visitors/:id/id` before `/visitors/:id` is not guaranteed, so the `/id` suffix route is declared and Hono's trie correctly disambiguates the extra segment.

- [ ] **Step 2: Make the eager public photo-serve handler in index.ts use the helper**

In `packages/api/src/index.ts`, replace the `app.get('/api/photos/visitors/:id', ...)` handler (lines 75-83) with:

```typescript
app.get('/api/photos/visitors/:id', async (c) => {
  const object = await c.env.STORAGE.get(`photos/visitors/${c.req.param('id')}.jpg`);
  if (!object) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Photo not found' } }, 404);
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});
```

(This handler is unchanged in behaviour — it sits *after* `authMiddleware` so it stays auth-gated for staff use. Leave it as-is; no edit needed if already matching. The public badge photo is handled in Task 6.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/photos.ts
git commit -m "feat(api): add ID-document photo upload + serve routes"
```

---

## Task 5: Shared check-out service (TDD with mock D1)

**Files:**
- Create: `packages/api/src/services/check-out.ts`
- Test: `packages/api/src/services/check-out.test.ts`
- Modify: `packages/api/src/routes/visits.ts:187-213`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/services/check-out.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { checkOutByBadgeCode } from './check-out';
import type { Env } from '../types';

// Minimal D1 mock: queue up `first()` return values in call order, record run() calls.
function mockEnv(firstResults: unknown[]) {
  const runCalls: { sql: string; binds: unknown[] }[] = [];
  let firstIdx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt = {
      _binds: [] as unknown[],
      bind(...b: unknown[]) { this._binds = b; return this; },
      first: vi.fn(async () => firstResults[firstIdx++] ?? null),
      run: vi.fn(async () => { runCalls.push({ sql, binds: stmt._binds }); return { success: true }; }),
    };
    return stmt;
  });
  const env = { DB: { prepare } } as unknown as Env;
  return { env, runCalls };
}

describe('checkOutByBadgeCode', () => {
  it('returns NOT_FOUND when the badge code matches no visit', async () => {
    const { env } = mockEnv([null]); // SELECT id by badge_code -> null
    const result = await checkOutByBadgeCode(env, 'SG-NOPE');
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('returns ALREADY_CHECKED_OUT when the visit is not checked_in', async () => {
    const { env } = mockEnv([
      { id: 'v1' },                                   // SELECT id by badge_code
      { id: 'v1', check_in_at: '2026-06-17T08:00:00Z', status: 'checked_out' }, // SELECT visit
    ]);
    const result = await checkOutByBadgeCode(env, 'SG-OLD');
    expect(result).toEqual({ ok: false, code: 'ALREADY_CHECKED_OUT' });
  });

  it('checks out an active visit and returns the updated row', async () => {
    const { env, runCalls } = mockEnv([
      { id: 'v1' },                                   // SELECT id by badge_code
      { id: 'v1', check_in_at: '2026-06-17T08:00:00Z', status: 'checked_in' }, // SELECT visit
      { id: 'v1', status: 'checked_out', first_name: 'Ama' }, // SELECT updated row
    ]);
    const result = await checkOutByBadgeCode(env, 'SG-LIVE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visit).toMatchObject({ status: 'checked_out' });
    expect(runCalls.length).toBe(1); // exactly one UPDATE ran
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/api -- check-out`
Expected: FAIL — cannot find module `./check-out`.

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/services/check-out.ts`:

```typescript
import type { Env } from '../types';

export type CheckOutOutcome =
  | { ok: true; visit: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CHECKED_OUT' };

const SELECT_VISIT_WITH_JOINS = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
        COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
 FROM visits v
 JOIN visitors vis ON v.visitor_id = vis.id
 LEFT JOIN officers o ON v.host_officer_id = o.id
 LEFT JOIN directorates d ON v.directorate_id = d.id
 WHERE v.id = ?`;

export async function checkOutById(env: Env, visitId: string): Promise<CheckOutOutcome> {
  const visit = await env.DB.prepare('SELECT id, check_in_at, status FROM visits WHERE id = ?')
    .bind(visitId)
    .first<{ id: string; check_in_at: string; status: string }>();
  if (!visit) return { ok: false, code: 'NOT_FOUND' };
  if (visit.status !== 'checked_in') return { ok: false, code: 'ALREADY_CHECKED_OUT' };

  const checkOutAt = new Date().toISOString();
  const durationMinutes = Math.round(
    (new Date(checkOutAt).getTime() - new Date(visit.check_in_at).getTime()) / 60000
  );

  await env.DB.prepare(
    `UPDATE visits SET status = 'checked_out', check_out_at = ?, duration_minutes = ? WHERE id = ?`
  ).bind(checkOutAt, durationMinutes, visitId).run();

  const updated = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(visitId).first();
  return { ok: true, visit: (updated ?? {}) as Record<string, unknown> };
}

export async function checkOutByBadgeCode(env: Env, badgeCode: string): Promise<CheckOutOutcome> {
  const row = await env.DB.prepare('SELECT id FROM visits WHERE badge_code = ?')
    .bind(badgeCode)
    .first<{ id: string }>();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  return checkOutById(env, row.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w packages/api -- check-out`
Expected: PASS (3 assertions).

- [ ] **Step 5: Refactor the visits.ts checkout route to use the service**

In `packages/api/src/routes/visits.ts`, replace the `visitRoutes.post('/:id/check-out', ...)` handler (lines 187-213) with:

```typescript
visitRoutes.post('/:id/check-out', async (c) => {
  const result = await checkOutById(c.env, c.req.param('id'));
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return notFound(c, 'Visit');
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
```

And add this import near the top of `visits.ts` (after line 8, the `requireRole` import):

```typescript
import { checkOutById } from '../services/check-out';
```

- [ ] **Step 6: Run API tests + type-check**

Run: `npm test -w packages/api && npm run type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/check-out.ts packages/api/src/services/check-out.test.ts packages/api/src/routes/visits.ts
git commit -m "feat(api): extract shared check-out service with tests"
```

---

## Task 6: Public badge-scoped photo endpoint + badge HTML fix

**Files:**
- Modify: `packages/api/src/routes/badges.ts`

- [ ] **Step 1: Add the public photo route and update the HTML `<img>`**

In `packages/api/src/routes/badges.ts`, add this new route immediately after the existing `badgeRoutes.get('/:code', ...)` handler (after line 54):

```typescript
// Public, badge-scoped photo — serves the visitor's face photo only when
// addressed via a valid badge code. Keeps the auth-gated /api/photos route
// untouched. Rate-limited to deter badge-code enumeration.
badgeRoutes.get('/:code/photo', async (c) => {
  const rl = await checkBadgeRateLimit(c);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
  }
  const code = c.req.param('code');
  const row = await c.env.DB.prepare(
    `SELECT vis.id as visitor_id
     FROM visits v JOIN visitors vis ON v.visitor_id = vis.id
     WHERE v.badge_code = ?`
  ).bind(code).first<{ visitor_id: string }>();
  if (!row) return notFound(c, 'Photo');

  const object = await c.env.STORAGE.get(`photos/visitors/${row.visitor_id}.jpg`);
  if (!object) return notFound(c, 'Photo');

  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});
```

- [ ] **Step 2: Point the badge HTML at the public photo endpoint**

In `packages/api/src/routes/badges.ts`, replace the photo block inside the HTML template (line 164) — change the `<img src>` from `visit.photo_url` to the badge-scoped endpoint. The new line 164 is:

```javascript
      ${visit.photo_url ? `<div style="width:80px;height:80px;border-radius:12px;overflow:hidden;margin:0 auto 12px;border:2px solid #E8DFC9"><img src="/api/badges/${encodeURIComponent(visit.badge_code)}/photo" style="width:100%;height:100%;object-fit:cover" alt=""></div>` : ''}
```

(The badge code is already URL-safe — `SG-` plus base36 — but `encodeURIComponent` is defensive. The `visit.photo_url` truthiness check stays so we only render the photo container when a photo exists.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Manual verification (badge photo now loads)**

Start the API + web locally (`npm run dev:api` and `npm run dev:web`), check in a visitor with a photo via the existing staff flow, open `http://localhost:8787/badge/<badge_code>` in a browser, and confirm the visitor photo is now visible. Also open `http://localhost:8787/api/badges/<badge_code>/photo` directly and confirm the JPEG loads without auth.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/badges.ts
git commit -m "fix(api): serve badge photo via public badge-scoped endpoint"
```

---

## Task 7: Shared check-in service + kiosk validation schema

**Files:**
- Create: `packages/api/src/services/check-in.ts`
- Test: `packages/api/src/services/check-in.test.ts`
- Modify: `packages/api/src/lib/validation.ts`
- Modify: `packages/api/src/routes/visits.ts`

- [ ] **Step 1: Write the failing test for the pure badge-code generator**

Create `packages/api/src/services/check-in.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateBadgeCode } from './check-in';

describe('generateBadgeCode', () => {
  it('formats SG-<base36 time><base36 suffix> in uppercase', () => {
    const code = generateBadgeCode(1718600000000, new Uint8Array([10, 200]));
    expect(code).toMatch(/^SG-[0-9A-Z]+$/);
    expect(code.startsWith('SG-')).toBe(true);
  });

  it('produces different codes for different random bytes', () => {
    const a = generateBadgeCode(1718600000000, new Uint8Array([1, 2]));
    const b = generateBadgeCode(1718600000000, new Uint8Array([3, 4]));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/api -- check-in`
Expected: FAIL — cannot find module `./check-in`.

- [ ] **Step 3: Write the check-in service**

Create `packages/api/src/services/check-in.ts`:

```typescript
import type { Env } from '../types';
import { classifyAndUpdate } from './classifier';
import { notifyOnCheckIn } from './notifier';

export interface CheckInParams {
  visitor_id: string;
  host_officer_id?: string | null;
  host_name_manual?: string | null;
  directorate_id?: string | null;
  purpose_raw?: string | null;
  purpose_category?: string | null;
  idempotency_key?: string | null;
  created_by: string | null;
  check_in_source: 'staff' | 'kiosk';
}

export type CheckInOutcome =
  | { ok: true; visit: Record<string, unknown>; deduped: boolean }
  | { ok: false; code: 'VISITOR_NOT_FOUND' };

// Pure, testable badge-code builder. `timestamp` is ms since epoch, `rand` is
// at least 2 random bytes.
export function generateBadgeCode(timestamp: number, rand: Uint8Array): string {
  const randomSuffix = Array.from(rand).map((b) => b.toString(36)).join('').slice(0, 4).toUpperCase();
  return `SG-${timestamp.toString(36).toUpperCase()}${randomSuffix}`;
}

const SELECT_VISIT_WITH_JOINS = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
        COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as directorate_abbr
 FROM visits v
 JOIN visitors vis ON v.visitor_id = vis.id
 LEFT JOIN officers o ON v.host_officer_id = o.id
 LEFT JOIN directorates d ON v.directorate_id = d.id
 WHERE v.id = ?`;

export async function performCheckIn(
  env: Env,
  ctx: ExecutionContext,
  params: CheckInParams,
): Promise<CheckInOutcome> {
  const visitor = await env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(params.visitor_id).first();
  if (!visitor) return { ok: false, code: 'VISITOR_NOT_FOUND' };

  // Idempotency: return the prior visit if this key was already used.
  if (params.idempotency_key) {
    const existing = await env.DB.prepare('SELECT id FROM visits WHERE idempotency_key = ? LIMIT 1')
      .bind(params.idempotency_key)
      .first<{ id: string }>();
    if (existing) {
      const dup = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(existing.id).first();
      return { ok: true, visit: (dup ?? {}) as Record<string, unknown>, deduped: true };
    }
  }

  const visitId = crypto.randomUUID().replace(/-/g, '');
  const badgeCode = generateBadgeCode(Date.now(), crypto.getRandomValues(new Uint8Array(2)));

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, host_name_manual, directorate_id, purpose_raw, purpose_category, badge_code, status, created_by, idempotency_key, check_in_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?, ?)`
    ).bind(
      visitId, params.visitor_id, params.host_officer_id || null, params.host_name_manual || null,
      params.directorate_id || null, params.purpose_raw || null, params.purpose_category || null,
      badgeCode, params.created_by, params.idempotency_key ?? null, params.check_in_source,
    ),
    env.DB.prepare(
      `UPDATE visitors SET total_visits = total_visits + 1, last_visit_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).bind(params.visitor_id),
  ]);

  const visit = await env.DB.prepare(SELECT_VISIT_WITH_JOINS).bind(visitId).first();

  if (params.purpose_raw) {
    ctx.waitUntil(classifyAndUpdate(visitId, params.purpose_raw, params.directorate_id || null, env));
  }

  if (params.host_officer_id && visit) {
    const v = visit as Record<string, unknown>;
    ctx.waitUntil(
      notifyOnCheckIn({
        visit_id: visitId,
        host_officer_id: params.host_officer_id,
        first_name: String(v.first_name ?? ''),
        last_name: String(v.last_name ?? ''),
        organisation: (v.organisation as string | null) ?? null,
        purpose_raw: params.purpose_raw || null,
        purpose_category: params.purpose_category || null,
        badge_code: badgeCode,
        check_in_at: String(v.check_in_at ?? ''),
        directorate_id: params.directorate_id || null,
        directorate_abbr: (v.directorate_abbr as string | null) ?? null,
      }, env)
    );
  }

  return { ok: true, visit: (visit ?? {}) as Record<string, unknown>, deduped: false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w packages/api -- check-in`
Expected: PASS (2 assertions).

- [ ] **Step 5: Refactor the visits.ts check-in route to use the service**

In `packages/api/src/routes/visits.ts`, replace the body of `visitRoutes.post('/check-in', ...)` (lines 104-185) with:

```typescript
visitRoutes.post('/check-in', zValidator('json', CheckInSchema), async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');

  const result = await performCheckIn(c.env, c.executionCtx, {
    visitor_id: body.visitor_id,
    host_officer_id: body.host_officer_id,
    host_name_manual: body.host_name_manual,
    directorate_id: body.directorate_id,
    purpose_raw: body.purpose_raw,
    purpose_category: body.purpose_category,
    idempotency_key: body.idempotency_key,
    created_by: session.userId,
    check_in_source: 'staff',
  });

  if (!result.ok) return notFound(c, 'Visitor');
  return created(c, result.visit);
});
```

Add this import to `visits.ts` (after the `checkOutById` import added in Task 5):

```typescript
import { performCheckIn } from '../services/check-in';
```

Remove the now-unused imports `classifyAndUpdate` and `notifyOnCheckIn` from `visits.ts` (lines 6-7) — they moved into the service. Keep all other imports.

- [ ] **Step 6: Add the kiosk check-out validation schema**

In `packages/api/src/lib/validation.ts`, append:

```typescript
export const KioskCheckOutSchema = z.object({
  badge_code: z.string().min(1).max(40),
});

export const KioskCheckInSchema = z.object({
  visitor_id: z.string().min(1),
  host_officer_id: z.string().optional(),
  host_name_manual: z.string().max(100).optional(),
  directorate_id: z.string().optional(),
  purpose_raw: z.string().max(500).optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
});
```

- [ ] **Step 7: Run API tests + type-check**

Run: `npm test -w packages/api && npm run type-check`
Expected: PASS. (If type-check flags `classifyAndUpdate`/`notifyOnCheckIn` as unused, confirm they were removed in Step 5.)

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/services/check-in.ts packages/api/src/services/check-in.test.ts packages/api/src/routes/visits.ts packages/api/src/lib/validation.ts
git commit -m "feat(api): extract shared check-in service + kiosk schemas"
```

---

## Task 8: Public kiosk route group

**Files:**
- Create: `packages/api/src/routes/kiosk.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Create the kiosk routes**

Create `packages/api/src/routes/kiosk.ts`:

```typescript
import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../types';
import { success, created, notFound, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';
import { CreateVisitorSchema, KioskCheckInSchema, KioskCheckOutSchema } from '../lib/validation';
import { visitorPhotoKey, visitorIdPhotoKey } from '../lib/photo-key';
import { performCheckIn } from '../services/check-in';
import { checkOutByBadgeCode } from '../services/check-out';

export const kioskRoutes = new Hono<{ Bindings: Env }>();

const KIOSK_USER_ID = 'user_kiosk';
const MAX_PHOTO_BYTES = 500_000;

// Per-IP rate limit for every kiosk action. Conservative: 40 writes / 60s.
async function kioskRateLimit(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `kiosk-ip:${ip}`, 40, 60);
  if (!rl.allowed) c.header('Retry-After', String(rl.retryAfter));
  return rl.allowed;
}

// Create a visitor (no search/list exposure on the kiosk surface).
kioskRoutes.post('/visitors', zValidator('json', CreateVisitorSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO visitors (id, first_name, last_name, phone, email, organisation, id_type, id_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.first_name, body.last_name, body.phone || null, body.email || null,
         body.organisation || null, body.id_type || null, body.id_number || null).run();
  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  return created(c, visitor);
});

// Raw-JPEG face photo upload.
kioskRoutes.post('/visitors/:id/photo', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  await c.env.STORAGE.put(visitorPhotoKey(visitorId), buf, { httpMetadata: { contentType: 'image/jpeg' } });
  const photoUrl = `/api/photos/visitors/${visitorId}`;
  await c.env.DB.prepare(
    "UPDATE visitors SET photo_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  ).bind(photoUrl, visitorId).run();
  return success(c, { photo_url: photoUrl });
});

// Raw-JPEG ID-document photo upload.
kioskRoutes.post('/visitors/:id/id-photo', async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const visitorId = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (buf.byteLength > MAX_PHOTO_BYTES) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);
  await c.env.STORAGE.put(visitorIdPhotoKey(visitorId), buf, { httpMetadata: { contentType: 'image/jpeg' } });
  const idPhotoUrl = `/api/photos/visitors/${visitorId}/id`;
  await c.env.DB.prepare(
    "UPDATE visitors SET id_photo_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  ).bind(idPhotoUrl, visitorId).run();
  return success(c, { id_photo_url: idPhotoUrl });
});

// Check in — attributed to the kiosk system user, source = 'kiosk'.
kioskRoutes.post('/check-in', zValidator('json', KioskCheckInSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const body = c.req.valid('json');
  const result = await performCheckIn(c.env, c.executionCtx, {
    ...body,
    created_by: KIOSK_USER_ID,
    check_in_source: 'kiosk',
  });
  if (!result.ok) return notFound(c, 'Visitor');
  return created(c, result.visit);
});

// Check out by scanned badge code.
kioskRoutes.post('/check-out', zValidator('json', KioskCheckOutSchema), async (c) => {
  if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
  const { badge_code } = c.req.valid('json');
  const result = await checkOutByBadgeCode(c.env, badge_code);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return notFound(c, 'Visit');
    return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);
  }
  return success(c, result.visit);
});
```

- [ ] **Step 2: Mount the kiosk routes before the auth middleware**

In `packages/api/src/index.ts`, add the import after the `badgeRoutes` import (line 11):

```typescript
import { kioskRoutes } from './routes/kiosk';
```

Then, in the "Public routes (no auth)" block (after line 70, `app.get('/badge/:code', serveBadgePage);`), add:

```typescript
app.route('/api/kiosk', kioskRoutes);
```

This MUST be above `app.use('/api/*', authMiddleware);` (line 74) so kiosk routes stay unauthenticated.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Manual verification (kiosk API works unauthenticated)**

With `npm run dev:api` running, from a separate shell:

```bash
curl -s -X POST http://localhost:8787/api/kiosk/visitors -H "Content-Type: application/json" -d '{"first_name":"Test","last_name":"Visitor"}'
```

Expected: a `201`-style JSON `{ data: { id, first_name, ... } }` with NO auth header sent. Then POST `/api/kiosk/check-in` with that `visitor_id` and confirm a `badge_code` comes back.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/kiosk.ts packages/api/src/index.ts
git commit -m "feat(api): public kiosk route group (check-in, photos, check-out)"
```

---

## Task 9: Add vitest to the web package + badge-code parser (TDD)

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/src/lib/badgeCode.ts`
- Test: `packages/web/src/lib/badgeCode.test.ts`

- [ ] **Step 1: Add the web test runner config + scripts**

In `packages/web/package.json`, add to `scripts`:

```json
    "test": "node ../../node_modules/vitest/vitest.mjs run --passWithNoTests",
    "test:watch": "node ../../node_modules/vitest/vitest.mjs"
```

And add to `devDependencies`:

```json
    "vitest": "^4.1.5",
    "@vitest/coverage-v8": "^4.1.5"
```

Then run: `npm install`
Expected: completes; `node_modules/vitest` resolvable from the repo root (it already exists from the api/staff packages).

- [ ] **Step 2: Create the vitest config**

Create `packages/web/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `packages/web/src/lib/badgeCode.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseBadgeCode } from './badgeCode';

describe('parseBadgeCode', () => {
  it('extracts the code from a full badge URL', () => {
    expect(parseBadgeCode('https://smartgate.ohcsghana.org/badge/SG-ABC123')).toBe('SG-ABC123');
  });

  it('extracts the code from a localhost badge URL with a trailing slash', () => {
    expect(parseBadgeCode('http://localhost:8787/badge/SG-XYZ789/')).toBe('SG-XYZ789');
  });

  it('returns a bare code unchanged', () => {
    expect(parseBadgeCode('SG-ABC123')).toBe('SG-ABC123');
  });

  it('is case-insensitive on the SG prefix and uppercases the result', () => {
    expect(parseBadgeCode('sg-abc123')).toBe('SG-ABC123');
  });

  it('returns null when there is no SG code present', () => {
    expect(parseBadgeCode('https://example.com/not-a-badge')).toBeNull();
    expect(parseBadgeCode('')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -w packages/web -- badgeCode`
Expected: FAIL — cannot find module `./badgeCode`.

- [ ] **Step 5: Write the implementation**

Create `packages/web/src/lib/badgeCode.ts`:

```typescript
// A badge QR encodes the full badge URL (e.g. https://host/badge/SG-ABC123).
// The scanner may also receive a bare code. Extract a canonical SG-code from
// either, or null if none is present.
const BADGE_CODE_RE = /SG-[0-9A-Z]+/i;

export function parseBadgeCode(scanned: string): string | null {
  if (!scanned) return null;
  const match = scanned.match(BADGE_CODE_RE);
  return match ? match[0].toUpperCase() : null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w packages/web -- badgeCode`
Expected: PASS (5 assertions).

- [ ] **Step 7: Commit**

```bash
git add packages/web/package.json packages/web/package-lock.json packages/web/vitest.config.ts packages/web/src/lib/badgeCode.ts packages/web/src/lib/badgeCode.test.ts
git commit -m "test(web): add vitest + badge-code parser with tests"
```

(If `package-lock.json` lives at the repo root rather than the package, add the root lockfile instead.)

---

## Task 10: Generalize PhotoCapture for face vs ID capture

**Files:**
- Modify: `packages/web/src/components/PhotoCapture.tsx`

- [ ] **Step 1: Add `facingMode`, `title`, and `mirror` props**

In `packages/web/src/components/PhotoCapture.tsx`, replace the `PhotoCaptureProps` interface (lines 6-10) and the component signature (line 12) with:

```typescript
interface PhotoCaptureProps {
  onCapture: (blob: Blob) => void;
  onSkip: () => void;
  existingPhotoUrl?: string | null;
  /** 'user' = front/selfie camera (default), 'environment' = rear camera (for IDs). */
  facingMode?: 'user' | 'environment';
  /** Heading shown above the camera. Defaults to a face-capture label. */
  title?: string;
  /** Mirror the preview/capture horizontally. Defaults true for selfies, set false for IDs. */
  mirror?: boolean;
}

export function PhotoCapture({
  onCapture,
  onSkip,
  existingPhotoUrl,
  facingMode = 'user',
  title,
  mirror = facingMode === 'user',
}: PhotoCaptureProps) {
```

- [ ] **Step 2: Use `facingMode` when starting the camera**

In the `startCamera` callback, change the `getUserMedia` call (lines 23-25) to:

```typescript
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 640 }, facingMode },
      });
```

And add `facingMode` to the `useCallback` dependency array (line 34): `}, [facingMode]);`

- [ ] **Step 3: Make mirroring conditional in `capture()`**

In the `capture()` function, replace the mirror block (lines 63-66) with:

```typescript
    if (mirror) {
      // Mirror horizontally for natural selfie feel
      ctx.translate(400, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 400, 400);
```

- [ ] **Step 4: Make the live-preview mirror class conditional**

In the `<video>` element's `className` (lines 138-142), replace the hard-coded `'scale-x-[-1]'` line with a conditional:

```typescript
              className={cn(
                'w-48 h-48 rounded-2xl object-cover bg-primary-deep',
                cameraReady ? 'opacity-100' : 'opacity-0',
                mirror && 'scale-x-[-1]' // Mirror only for selfies
              )}
```

- [ ] **Step 5: Use the `title` prop for the heading**

Replace the heading text (line 123) with:

```typescript
        {captured ? 'Photo Preview' : (title ?? 'Capture Visitor Photo')}
```

- [ ] **Step 6: Type-check + verify existing usage still compiles**

Run: `npm run type-check`
Expected: PASS. The existing `CheckInPage` usage (no new props) keeps the front-camera, mirrored, default-title behaviour.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/PhotoCapture.tsx
git commit -m "feat(web): parameterize PhotoCapture for face vs ID capture"
```

---

## Task 11: QrScanner component

**Files:**
- Modify: `packages/web/package.json` (add `jsqr`)
- Create: `packages/web/src/components/QrScanner.tsx`

- [ ] **Step 1: Add the jsqr dependency**

In `packages/web/package.json`, add to `dependencies`:

```json
    "jsqr": "^1.4.0"
```

Run: `npm install`
Expected: `jsqr` installed.

- [ ] **Step 2: Create the QrScanner component**

Create `packages/web/src/components/QrScanner.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, X } from 'lucide-react';
import { parseBadgeCode } from '@/lib/badgeCode';

interface QrScannerProps {
  /** Called with the parsed SG-code once a badge QR is decoded. */
  onScan: (code: string) => void;
  /** Called when the user cancels scanning. */
  onCancel: () => void;
}

export function QrScanner({ onScan, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          tick();
        }
      } catch {
        setCameraError(true);
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || doneRef.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(img.data, img.width, img.height);
        if (result) {
          const code = parseBadgeCode(result.data);
          if (code) {
            doneRef.current = true;
            onScan(code);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      doneRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [onScan]);

  return (
    <div className="text-center space-y-4">
      <p className="text-sm font-medium text-foreground">Scan the visitor's badge QR code</p>
      <div className="relative w-64 h-64 mx-auto rounded-2xl overflow-hidden bg-primary-deep">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-6 border-2 border-white/70 rounded-xl pointer-events-none" />
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background p-4">
            <Camera className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-xs text-muted text-center">Camera unavailable — enter the badge code manually.</p>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-muted border border-border rounded-xl hover:text-foreground transition-all"
      >
        <X className="h-4 w-4" />
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS. If TS complains about missing `jsqr` types, confirm `jsqr` ships its own `.d.ts` (it does as of 1.4.0); otherwise add `// @ts-expect-error` is NOT acceptable — instead add a `declare module 'jsqr'` ambient file. (Verify first; the package bundles types.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json packages/web/package-lock.json packages/web/src/components/QrScanner.tsx
git commit -m "feat(web): add QrScanner component using jsqr"
```

---

## Task 12: Kiosk API client helper

**Files:**
- Create: `packages/web/src/lib/kioskApi.ts`

- [ ] **Step 1: Create an unauthenticated kiosk fetch helper**

The shared `api` client (`packages/web/src/lib/api.ts`) sends the auth token and redirects to `/login` on 401 — wrong for the public kiosk. Create `packages/web/src/lib/kioskApi.ts`:

```typescript
import { API_BASE } from './constants';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

async function kioskRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/kiosk${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}

async function kioskUploadPhoto(visitorId: string, kind: 'photo' | 'id-photo', blob: Blob): Promise<void> {
  const buf = await blob.arrayBuffer();
  const res = await fetch(`${API_BASE}/kiosk/visitors/${visitorId}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: buf,
  });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
}

export interface KioskVisitor {
  id: string;
  first_name: string;
  last_name: string;
}

export interface KioskVisit {
  id: string;
  badge_code: string | null;
  visitor_name?: string;
}

export const kioskApi = {
  createVisitor: (body: Record<string, unknown>) => kioskRequest<KioskVisitor>('/visitors', body),
  uploadFacePhoto: (id: string, blob: Blob) => kioskUploadPhoto(id, 'photo', blob),
  uploadIdPhoto: (id: string, blob: Blob) => kioskUploadPhoto(id, 'id-photo', blob),
  checkIn: (body: Record<string, unknown>) => kioskRequest<KioskVisit>('/check-in', body),
  checkOut: (badgeCode: string) => kioskRequest<KioskVisit>('/check-out', { badge_code: badgeCode }),
};
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/kioskApi.ts
git commit -m "feat(web): kiosk API client helper (unauthenticated)"
```

---

## Task 13: KioskPage — self-service check-in + scan-to-checkout

**Files:**
- Create: `packages/web/src/pages/KioskPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create the KioskPage**

Create `packages/web/src/pages/KioskPage.tsx`:

```typescript
import { useState } from 'react';
import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { kioskApi, type KioskVisit } from '@/lib/kioskApi';
import { resolvePhotoUrl } from '@/lib/api';
import { API_BASE } from '@/lib/constants';
import { ID_TYPES } from '@/lib/constants';
import { PhotoCapture } from '@/components/PhotoCapture';
import { QrScanner } from '@/components/QrScanner';
import { CheckCircle2, LogIn, LogOut, Loader2 } from 'lucide-react';

const visitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone').or(z.literal('')).optional(),
  organisation: z.string().max(200).optional(),
  id_type: z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other']).optional(),
  id_number: z.string().max(50).optional(),
  purpose_raw: z.string().max(500).optional(),
});
type VisitorForm = z.infer<typeof visitorSchema>;

type Mode = 'welcome' | 'form' | 'face' | 'id' | 'submitting' | 'success' | 'checkout-scan' | 'checkout-confirm' | 'checkout-done';

const fieldCls = 'w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary';

export function KioskPage() {
  const [mode, setMode] = useState<Mode>('welcome');
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [createdVisit, setCreatedVisit] = useState<KioskVisit | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutBadge, setCheckoutBadge] = useState<string | null>(null);
  const [checkoutVisit, setCheckoutVisit] = useState<KioskVisit | null>(null);

  const form = useForm<VisitorForm>({
    resolver: zodResolver(visitorSchema),
    defaultValues: { first_name: '', last_name: '', phone: '', organisation: '', id_number: '', purpose_raw: '' },
  });

  async function onSubmitForm(data: VisitorForm) {
    setSubmitError(null);
    try {
      const visitor = await kioskApi.createVisitor({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone || '',
        organisation: data.organisation || '',
        id_type: data.id_type,
        id_number: data.id_number || '',
      });
      setVisitorId(visitor.id);
      setMode('face');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not register. Please try again.');
    }
  }

  async function handleFaceCapture(blob: Blob) {
    if (visitorId) { try { await kioskApi.uploadFacePhoto(visitorId, blob); } catch { /* continue */ } }
    setMode('id');
  }

  async function handleIdCapture(blob: Blob) {
    if (visitorId) { try { await kioskApi.uploadIdPhoto(visitorId, blob); } catch { /* continue */ } }
    await finishCheckIn();
  }

  async function finishCheckIn() {
    if (!visitorId) return;
    setMode('submitting');
    setSubmitError(null);
    try {
      const visit = await kioskApi.checkIn({
        visitor_id: visitorId,
        purpose_raw: form.getValues('purpose_raw') || '',
      });
      setCreatedVisit(visit);
      setMode('success');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Check-in failed. Please see reception.');
      setMode('success');
    }
  }

  function resetAll() {
    form.reset();
    setVisitorId(null);
    setCreatedVisit(null);
    setSubmitError(null);
    setCheckoutBadge(null);
    setCheckoutVisit(null);
    setMode('welcome');
  }

  async function handleScanned(code: string) {
    setCheckoutBadge(code);
    setMode('checkout-confirm');
  }

  async function confirmCheckout() {
    if (!checkoutBadge) return;
    try {
      const visit = await kioskApi.checkOut(checkoutBadge);
      setCheckoutVisit(visit);
      setMode('checkout-done');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Checkout failed. Please see reception.');
      setMode('checkout-done');
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-border shadow-lg p-6">
        <KioskHeader />

        {mode === 'welcome' && (
          <div className="space-y-3 mt-6">
            <button onClick={() => { form.reset(); setMode('form'); }} className="w-full h-14 bg-primary text-white text-base font-semibold rounded-xl inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <LogIn className="h-5 w-5" /> Check In
            </button>
            <button onClick={() => { setSubmitError(null); setMode('checkout-scan'); }} className="w-full h-14 bg-surface text-foreground text-base font-semibold rounded-xl border border-border inline-flex items-center justify-center gap-2 active:scale-[0.99]">
              <LogOut className="h-5 w-5" /> Check Out
            </button>
          </div>
        )}

        {mode === 'form' && (
          <form onSubmit={form.handleSubmit(onSubmitForm)} className="space-y-4 mt-6">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name" error={form.formState.errors.first_name?.message}>
                <input {...form.register('first_name')} className={fieldCls} autoFocus />
              </Field>
              <Field label="Last Name" error={form.formState.errors.last_name?.message}>
                <input {...form.register('last_name')} className={fieldCls} />
              </Field>
            </div>
            <Field label="Phone (optional)" error={form.formState.errors.phone?.message}>
              <input {...form.register('phone')} className={fieldCls} placeholder="0241234567" />
            </Field>
            <Field label="Organisation (optional)">
              <input {...form.register('organisation')} className={fieldCls} />
            </Field>
            <Field label="ID Type (optional)">
              <select {...form.register('id_type')} className={fieldCls}>
                <option value="">Select...</option>
                {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="ID Number (optional)">
              <input {...form.register('id_number')} className={fieldCls} />
            </Field>
            <Field label="Purpose of Visit (optional)">
              <textarea {...form.register('purpose_raw')} rows={2} className={`${fieldCls} h-auto py-2 resize-none`} />
            </Field>
            {submitError && <p className="text-danger text-xs">{submitError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={resetAll} className="h-11 px-4 text-sm text-muted">Cancel</button>
              <button type="submit" className="flex-1 h-11 bg-primary text-white text-sm font-semibold rounded-xl">Continue to Photo</button>
            </div>
          </form>
        )}

        {mode === 'face' && (
          <div className="mt-6">
            <PhotoCapture title="Take Your Photo" facingMode="user" onCapture={handleFaceCapture} onSkip={() => setMode('id')} />
          </div>
        )}

        {mode === 'id' && (
          <div className="mt-6">
            <PhotoCapture title="Photograph Your ID" facingMode="environment" mirror={false} onCapture={handleIdCapture} onSkip={finishCheckIn} />
          </div>
        )}

        {mode === 'submitting' && (
          <div className="mt-8 text-center"><Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" /></div>
        )}

        {mode === 'success' && (
          <div className="mt-6 text-center space-y-4">
            {createdVisit?.badge_code ? (
              <>
                <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">You're Checked In</h2>
                <p className="text-sm text-muted">Scan this code with your phone to keep your badge.</p>
                <KioskBadgeQr badgeCode={createdVisit.badge_code} />
                <p className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</p>
              </>
            ) : (
              <p className="text-danger text-sm">{submitError ?? 'Something went wrong. Please see reception.'}</p>
            )}
            <button onClick={resetAll} className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
          </div>
        )}

        {mode === 'checkout-scan' && (
          <div className="mt-6">
            <QrScanner onScan={handleScanned} onCancel={resetAll} />
          </div>
        )}

        {mode === 'checkout-confirm' && checkoutBadge && (
          <div className="mt-6 text-center space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Confirm Check Out</h2>
            <div className="w-24 h-24 rounded-2xl overflow-hidden mx-auto border-2 border-border">
              <img src={resolvePhotoUrl(`${API_BASE.replace(/\/api$/, '')}/api/badges/${checkoutBadge}/photo`) ?? undefined} alt="" className="w-full h-full object-cover" />
            </div>
            <p className="text-sm font-mono text-accent">{checkoutBadge}</p>
            {submitError && <p className="text-danger text-xs">{submitError}</p>}
            <div className="flex gap-3 justify-center">
              <button onClick={resetAll} className="h-11 px-4 text-sm text-muted">Cancel</button>
              <button onClick={confirmCheckout} className="h-11 px-6 bg-danger text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2">
                <LogOut className="h-4 w-4" /> Confirm Check Out
              </button>
            </div>
          </div>
        )}

        {mode === 'checkout-done' && (
          <div className="mt-6 text-center space-y-4">
            <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">{checkoutVisit ? 'Checked Out' : 'Could Not Check Out'}</h2>
            {submitError && !checkoutVisit && <p className="text-danger text-sm">{submitError}</p>}
            <button onClick={resetAll} className="h-11 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function KioskHeader() {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl overflow-hidden mx-auto mb-3 shadow">
        <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
      </div>
      <h1 className="text-base font-bold text-foreground">OHCS Visitor Check-In</h1>
      <p className="text-xs text-muted">Office of the Head of the Civil Service</p>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      {children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}

function KioskBadgeQr({ badgeCode }: { badgeCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const origin = API_BASE.replace(/\/api$/, '');
    QRCode.toCanvas(canvasRef.current, `${origin}/badge/${badgeCode}`, {
      width: 200, margin: 2, color: { dark: '#1B3A5C', light: '#FFFFFF' },
    });
  }, [badgeCode]);
  return <canvas ref={canvasRef} className="mx-auto rounded-lg" />;
}
```

- [ ] **Step 2: Register the public kiosk route**

In `packages/web/src/App.tsx`, add the import after the `BadgeCheckoutPage` import (line 10):

```typescript
import { KioskPage } from './pages/KioskPage';
```

Then add a public route alongside `/login` (after line 153, the `<Route path="/login" ... />`):

```typescript
          <Route path="/kiosk" element={<KioskPage />} />
```

(It sits OUTSIDE the `ProtectedRoute`/`AppLayout` wrapper so it needs no login and renders full-screen.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Manual verification (full kiosk E2E)**

With API + web running, open `http://localhost:5173/kiosk`. Use the `webapp-testing` skill to drive:
1. Tap **Check In** → fill name → Continue → take face photo → photograph ID → see "You're Checked In" with a QR + badge code.
2. Scan the QR (or open `/badge/<code>`) → confirm the visitor photo is visible on the badge.
3. Back on the kiosk, tap **Check Out** → scan the badge QR → confirm matched badge code → Confirm Check Out → "Checked Out".
4. Verify in the staff app's visit log that the visit shows checked-out.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/KioskPage.tsx packages/web/src/App.tsx
git commit -m "feat(web): kiosk self-check-in + scan-to-checkout page"
```

---

## Task 14: Staff CheckInPage — add ID photo step + scan-to-checkout

**Files:**
- Modify: `packages/web/src/pages/CheckInPage.tsx`
- Modify: `packages/web/src/pages/BadgeCheckoutPage.tsx`

- [ ] **Step 1: Add an `id-photo` step to the staff check-in flow**

In `packages/web/src/pages/CheckInPage.tsx`, extend the `Step` type (line 57):

```typescript
type Step = 'search' | 'new-visitor' | 'photo' | 'id-photo' | 'check-in' | 'success';
```

Change `handlePhotoCapture` (lines 159-174) so the face photo advances to the ID-photo step instead of jumping to check-in. Replace its final line `setStep('check-in');` with:

```typescript
    setStep('id-photo');
```

Add a new handler immediately after `handlePhotoCapture`:

```typescript
  /* ---- ID photo upload ---- */
  async function handleIdPhotoCapture(blob: Blob) {
    if (!selectedVisitor) { setStep('check-in'); return; }
    try {
      const arrayBuffer = await blob.arrayBuffer();
      await fetch(`${import.meta.env.PROD ? 'https://ohcs-smartgate-api.ohcsghana-main.workers.dev' : ''}/api/photos/visitors/${selectedVisitor.id}/id-photo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'image/jpeg' },
        body: arrayBuffer,
      });
    } catch {
      // ID photo upload failed silently — continue to check-in
    }
    setStep('check-in');
  }
```

- [ ] **Step 2: Render the ID-photo step**

In `CheckInPage.tsx`, immediately after the `{step === 'photo' && ...}` block (after line 389), add:

```typescript
      {/* STEP 2c: ID photo capture */}
      {step === 'id-photo' && selectedVisitor && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              ID Document Photo
            </h2>
            <p className="text-[14px] text-muted mt-0.5">
              Photograph {selectedVisitor.first_name}'s ID document
            </p>
          </div>
          <div className="bg-surface rounded-2xl border border-border shadow-sm p-6">
            <PhotoCapture
              title="Photograph the ID"
              facingMode="environment"
              mirror={false}
              onCapture={handleIdPhotoCapture}
              onSkip={() => setStep('check-in')}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 3: Add scan-to-checkout to the staff BadgeCheckoutPage**

In `packages/web/src/pages/BadgeCheckoutPage.tsx`, the page currently requires a `:code` URL param. Add an optional scanner entry so reception can scan instead of typing. Add the import:

```typescript
import { QrScanner } from '@/components/QrScanner';
import { useNavigate } from 'react-router-dom';
```

(`useNavigate` is already imported — keep one import.) Then, inside the component, when there is **no** `code` param yet, render the scanner. Add near the top of the component body, before the `useQuery` (line 23):

```typescript
  const [showScanner, setShowScanner] = useState(!code);
```

And add this early return after the existing early returns for loading/error (insert before `if (isLoading)` at line 44):

```typescript
  if (!code && showScanner) {
    return (
      <div className="max-w-sm mx-auto py-12">
        <QrScanner
          onScan={(scanned) => { setShowScanner(false); navigate(`/checkout/${scanned}`); }}
          onCancel={() => navigate('/')}
        />
      </div>
    );
  }
```

- [ ] **Step 4: Add a staff route for scanner-first checkout**

In `packages/web/src/App.tsx`, add a route inside the protected layout, next to the existing `checkout/:code` route (after line 160):

```typescript
            <Route path="checkout" element={<BadgeCheckoutPage />} />
```

This lets staff open `/checkout` (no code) to launch the scanner; scanning navigates to `/checkout/<code>` which runs the existing confirm-and-checkout flow.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Manual verification**

- Staff check-in: search/register a visitor → face photo → **ID photo step appears** → check-in completes.
- Staff checkout: navigate to `/checkout` → scanner opens → scan a badge → lands on the confirm screen → Confirm Check Out works.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/CheckInPage.tsx packages/web/src/pages/BadgeCheckoutPage.tsx packages/web/src/App.tsx
git commit -m "feat(web): staff ID-photo step + scan-to-checkout"
```

---

## Task 15: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `npm test -w packages/api && npm test -w packages/web`
Expected: all PASS.

- [ ] **Step 2: Type-check the whole repo**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Build the web app**

Run: `npm run build:web`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: End-to-end smoke (kiosk + badge + checkout)**

With `npm run dev:api` and `npm run dev:web`, walk the kiosk happy path and the negative paths from the spec's Testing section:
- Kiosk: check-in → 2 photos → badge QR with **visible photo** → scan → confirm → checked out.
- Camera-denied path on checkout falls back gracefully (scanner shows "Camera unavailable").
- Re-scanning an already-checked-out badge shows the "already ended" error.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification fixups for visitor self-service kiosk"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Role (`visitor`) → Task 2; public kiosk surface → Tasks 7-8, 12-13; face+ID two-photo capture → Tasks 4, 10, 13-14; scan-to-checkout → Tasks 5, 11, 13-14; badge photo fix → Task 6; data model → Task 1; privacy guard (no kiosk search) → Task 8 (kiosk exposes no `GET /visitors`); rate limiting → Tasks 6, 8.
- **Type consistency:** `performCheckIn`/`CheckInParams` (Task 7) and `checkOutById`/`checkOutByBadgeCode`/`CheckOutOutcome` (Task 5) are used verbatim by `kiosk.ts` (Task 8) and `visits.ts` (Tasks 5, 7). `parseBadgeCode` (Task 9) is used by `QrScanner` (Task 11). `visitorPhotoKey`/`visitorIdPhotoKey` (Task 3) are used by `photos.ts` (Task 4) and `kiosk.ts` (Task 8). `kioskApi` (Task 12) is used by `KioskPage` (Task 13).
- **Known follow-ups (out of scope):** OCR of the ID photo; visitor self-checkout from personal phone; printing hardware.
```
