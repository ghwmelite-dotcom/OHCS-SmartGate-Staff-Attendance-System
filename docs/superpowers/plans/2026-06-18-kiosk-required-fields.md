# Stricter Kiosk Form (Required Fields + Host) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lobby kiosk form capture a complete, useful visit — require phone, purpose, directorate, host name, ID type, and both photos; add the missing directorate/host capture — enforced at the web form and the API via kiosk-specific schemas, leaving staff flows unchanged.

**Architecture:** New public `GET /api/kiosk/directorates` feeds a required directorate dropdown; a new `KioskCreateVisitorSchema` + tightened `KioskCheckInSchema` enforce required fields server-side; a `required` prop on `PhotoCapture` removes the Skip button for the kiosk's face/ID steps.

**Tech Stack:** Hono on Cloudflare Workers (D1), React + Vite, Zod, vitest.

---

## Spec reference

`docs/superpowers/specs/2026-06-18-kiosk-required-fields-design.md`

## Conventions / ENVIRONMENT

- API type-check (repo root): `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json`.
- Web type-check: `node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json`.
- API tests: `npm test -w packages/api -- <pattern>` / full `npm test -w packages/api`.
- Web build: `node "node_modules/vite/bin/vite.js" build packages/web`.
- Do NOT use `npm run type-check`/`build:web`. Branch: `feat/kiosk-required-fields`.

---

## Task 1: API — kiosk schemas + directorates endpoint (TDD)

**Files:** `packages/api/src/lib/validation.ts`, `packages/api/src/lib/validation.test.ts` (create), `packages/api/src/routes/kiosk.ts`.

- [ ] **Step 1: Write the failing schema tests.** Create `packages/api/src/lib/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { KioskCreateVisitorSchema, KioskCheckInSchema } from './validation';

describe('KioskCreateVisitorSchema', () => {
  const ok = { first_name: 'Ama', last_name: 'B', phone: '0241234567', id_type: 'ghana_card' };
  it('accepts a valid payload (organisation + id_number optional)', () => {
    expect(KioskCreateVisitorSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects missing phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ first_name: 'Ama', last_name: 'B', id_type: 'ghana_card' }).success).toBe(false);
  });
  it('rejects empty phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, phone: '' }).success).toBe(false);
  });
  it('rejects a malformed phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, phone: '12345' }).success).toBe(false);
  });
  it('rejects missing id_type', () => {
    expect(KioskCreateVisitorSchema.safeParse({ first_name: 'Ama', last_name: 'B', phone: '0241234567' }).success).toBe(false);
  });
});

describe('KioskCheckInSchema', () => {
  const base = { visitor_id: 'v1', directorate_id: 'd1', host_name_manual: 'Mr X', purpose_raw: 'meeting' };
  it('accepts a complete payload', () => {
    expect(KioskCheckInSchema.safeParse(base).success).toBe(true);
  });
  it('rejects missing directorate_id', () => {
    expect(KioskCheckInSchema.safeParse({ visitor_id: 'v1', host_name_manual: 'Mr X', purpose_raw: 'meeting' }).success).toBe(false);
  });
  it('rejects missing host_name_manual', () => {
    expect(KioskCheckInSchema.safeParse({ visitor_id: 'v1', directorate_id: 'd1', purpose_raw: 'meeting' }).success).toBe(false);
  });
  it('rejects missing purpose_raw', () => {
    expect(KioskCheckInSchema.safeParse({ visitor_id: 'v1', directorate_id: 'd1', host_name_manual: 'Mr X' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npm test -w packages/api -- validation` → fails (`KioskCreateVisitorSchema` not exported; tightened `KioskCheckInSchema` not yet rejecting).

- [ ] **Step 3: Add/tighten the schemas.** In `packages/api/src/lib/validation.ts`, add `KioskCreateVisitorSchema` (after `CreateVisitorSchema`) and REPLACE the existing `KioskCheckInSchema` with the tightened version:

```typescript
export const KioskCreateVisitorSchema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone number (e.g. 0241234567 or +233241234567)'),
  organisation: z.string().max(200).optional().or(z.literal('')),
  id_type: idTypeSchema,
  id_number: z.string().max(50).optional().or(z.literal('')),
});
```

Replace `KioskCheckInSchema` (lines ~51-58) with:

```typescript
export const KioskCheckInSchema = z.object({
  visitor_id: z.string().min(1),
  directorate_id: z.string().min(1),
  host_name_manual: z.string().min(1).max(100),
  purpose_raw: z.string().min(1).max(500),
  idempotency_key: z.string().min(1).max(100).optional(),
});
```

- [ ] **Step 4: Run, expect PASS.** `npm test -w packages/api -- validation` → all pass.

- [ ] **Step 5: Switch the kiosk visitor-create to the kiosk schema + add the directorates endpoint.** In `packages/api/src/routes/kiosk.ts`:
  - Change the import on line 7 to include the new schema:
    ```typescript
    import { KioskCreateVisitorSchema, KioskCheckInSchema, KioskCheckOutSchema } from '../lib/validation';
    ```
    (remove `CreateVisitorSchema` — it's no longer used here.)
  - Change the `/visitors` route validator from `CreateVisitorSchema` to `KioskCreateVisitorSchema`:
    ```typescript
    kioskRoutes.post('/visitors', zValidator('json', KioskCreateVisitorSchema), async (c) => {
    ```
  - Add the directorates endpoint after the `/visitors` POST handler:
    ```typescript
    // Public directorate list for the kiosk form (id/name/abbreviation only — no PII).
    kioskRoutes.get('/directorates', async (c) => {
      if (!(await kioskRateLimit(c))) return error(c, 'RATE_LIMITED', 'Too many requests', 429);
      const rows = await c.env.DB.prepare(
        "SELECT id, name, abbreviation FROM directorates WHERE is_active = 1 ORDER BY name"
      ).all();
      return success(c, rows.results ?? []);
    });
    ```
  - The `/check-in` handler is unchanged in code: it already spreads `...body` (now `{visitor_id, directorate_id, host_name_manual, purpose_raw, idempotency_key}`) into `performCheckIn`, which accepts those (the dropped `host_officer_id` is optional in `CheckInParams`).

- [ ] **Step 6: Type-check + full tests.** `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json` → PASS (confirms `CreateVisitorSchema` removal from kiosk.ts left no dangling use). `npm test -w packages/api` → all pass.

- [ ] **Step 7: Commit.**
```bash
git add packages/api/src/lib/validation.ts packages/api/src/lib/validation.test.ts packages/api/src/routes/kiosk.ts
git commit -m "feat(api): kiosk required-field schemas + public directorates endpoint"
```

---

## Task 2: `PhotoCapture` — `required` prop (hide Skip)

**Files:** `packages/web/src/components/PhotoCapture.tsx`.

- [ ] **Step 1: Add the prop.** In `PhotoCaptureProps`, add:
```typescript
  /** When true, the visitor must capture — the Skip button is hidden. */
  required?: boolean;
```
And add `required = false` to the destructured params in the component signature (alongside `facingMode`, `title`, `mirror`).

- [ ] **Step 2: Hide the Skip button when required.** In the non-captured actions block, the "Skip Photo" button is rendered as:
```typescript
            <button
              onClick={onSkip}
              className="h-10 px-4 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            >
              Skip Photo
            </button>
```
Wrap it so it only renders when not required:
```typescript
            {!required && (
              <button
                onClick={onSkip}
                className="h-10 px-4 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
              >
                Skip Photo
              </button>
            )}
```

- [ ] **Step 3: Type-check.** `node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json` → PASS (existing `CheckInPage` usage omits `required` → defaults false → unchanged).

- [ ] **Step 4: Commit.**
```bash
git add packages/web/src/components/PhotoCapture.tsx
git commit -m "feat(web): PhotoCapture required prop (hide Skip)"
```

---

## Task 3: `kioskApi` — `getDirectorates()`

**Files:** `packages/web/src/lib/kioskApi.ts`.

- [ ] **Step 1: Add a GET helper + type + method** in `packages/web/src/lib/kioskApi.ts`:
  - Add an unauthenticated GET helper after `kioskUploadPhoto`:
    ```typescript
    async function kioskGet<T>(path: string): Promise<T> {
      const res = await fetch(`${API_BASE}/kiosk${path}`);
      const json = (await res.json()) as ApiResponse<T>;
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      }
      return json.data as T;
    }
    ```
  - Add the type (near `KioskVisit`):
    ```typescript
    export interface KioskDirectorate {
      id: string;
      name: string;
      abbreviation: string;
    }
    ```
  - Add the method to the `kioskApi` object:
    ```typescript
      getDirectorates: () => kioskGet<KioskDirectorate[]>('/directorates'),
    ```

- [ ] **Step 2: Type-check.** Web type-check → PASS.

- [ ] **Step 3: Commit.**
```bash
git add packages/web/src/lib/kioskApi.ts
git commit -m "feat(web): kioskApi.getDirectorates (public directorate list)"
```

---

## Task 4: Kiosk form — required fields + directorate/host

**Files:** `packages/web/src/pages/KioskPage.tsx`.

- [ ] **Step 1: Tighten the client schema + defaults.** Replace the `visitorSchema` (lines ~15-21) with:
```typescript
const visitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'A valid Ghana phone is required'),
  organisation: z.string().max(200).optional(),
  directorate_id: z.string().min(1, 'Select a directorate'),
  host_name: z.string().min(1, 'Enter who you are visiting').max(100),
  id_type: z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other'], {
    errorMap: () => ({ message: 'Select an ID type' }),
  }),
  id_number: z.string().max(50).optional(),
  purpose_raw: z.string().min(1, 'Purpose of visit is required').max(500),
});
```
Update `defaultValues` (line ~40) to include the new fields:
```typescript
    defaultValues: { first_name: '', last_name: '', phone: '', organisation: '', directorate_id: '', host_name: '', id_number: '', purpose_raw: '' },
```

- [ ] **Step 2: Fetch directorates + import the type.** Add to the kioskApi import: `import { kioskApi, type KioskVisit, type KioskDirectorate } from '@/lib/kioskApi';`. Add state + effect near the other hooks (after the `form` definition, ~line 41):
```typescript
  const [directorates, setDirectorates] = useState<KioskDirectorate[]>([]);
  useEffect(() => {
    if (mode === 'form' && directorates.length === 0) {
      kioskApi.getDirectorates().then(setDirectorates).catch(() => { /* leave empty; reception assists */ });
    }
  }, [mode, directorates.length]);
```
(`useState`/`useEffect` are already imported at the top of the file.)

- [ ] **Step 3: Update the form fields.** In the `mode === 'form'` block, replace the Phone field label, add Directorate + Host fields, and make ID Type / Purpose required (drop "(optional)"). Specifically:
  - Phone field label `"Phone (optional)"` → `"Phone"`.
  - After the Organisation field, insert the directorate + host fields:
    ```typescript
            <Field label="Directorate" error={form.formState.errors.directorate_id?.message}>
              <select {...form.register('directorate_id')} className={fieldCls}>
                <option value="">Select directorate...</option>
                {directorates.map((d) => (
                  <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Who are you visiting?" error={form.formState.errors.host_name?.message}>
              <input {...form.register('host_name')} className={fieldCls} placeholder="e.g. Mr. Mensah" />
            </Field>
    ```
  - ID Type field label `"ID Type (optional)"` → `"ID Type"`; keep its `setValueAs` register and show its error:
    ```typescript
            <Field label="ID Type" error={form.formState.errors.id_type?.message}>
              <select {...form.register('id_type', { setValueAs: (v) => v || undefined })} className={fieldCls}>
                <option value="">Select...</option>
                {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
    ```
  - Purpose field label `"Purpose of Visit (optional)"` → `"Purpose of Visit"`, add error:
    ```typescript
            <Field label="Purpose of Visit" error={form.formState.errors.purpose_raw?.message}>
              <textarea {...form.register('purpose_raw')} rows={2} className={`${fieldCls} h-auto py-2 resize-none`} />
            </Field>
    ```
  - Leave Organisation as `"Organisation (optional)"` and ID Number as `"ID Number (optional)"`.

- [ ] **Step 4: Require the photos.** In the `mode === 'face'` and `mode === 'id'` blocks, add `required` to the `PhotoCapture` (and keep the `onSkip` props as-is — they're now unreachable since the Skip button is hidden):
```typescript
            <PhotoCapture title="Take Your Photo" facingMode="user" required onCapture={handleFaceCapture} onSkip={() => setMode('id')} />
```
```typescript
            <PhotoCapture title="Photograph Your ID" facingMode="environment" mirror={false} required onCapture={handleIdCapture} onSkip={finishCheckIn} />
```

- [ ] **Step 5: Send directorate + host on check-in.** In `finishCheckIn` (lines ~77-80), expand the `checkIn` body:
```typescript
      const visit = await kioskApi.checkIn({
        visitor_id: visitorId,
        directorate_id: form.getValues('directorate_id'),
        host_name_manual: form.getValues('host_name'),
        purpose_raw: form.getValues('purpose_raw'),
      });
```

- [ ] **Step 6: Type-check + build.** Web type-check → PASS. `node "node_modules/vite/bin/vite.js" build packages/web` → `✓ built`.

- [ ] **Step 7: Commit.**
```bash
git add packages/web/src/pages/KioskPage.tsx
git commit -m "feat(web): kiosk form requires phone/purpose/directorate/host/id + non-skippable photos"
```

---

## Task 5: Verify + finish

- [ ] **Step 1: Full verification.** From repo root:
  - `node "node_modules/typescript/bin/tsc" --noEmit -p packages/api/tsconfig.json` → PASS
  - `node "node_modules/typescript/bin/tsc" --noEmit -p packages/web/tsconfig.json` → PASS
  - `npm test -w packages/api` → all pass (new validation tests included)
  - `node "node_modules/vite/bin/vite.js" build packages/web` → `✓ built`

- [ ] **Step 2: Local smoke (optional but recommended).** With `wrangler dev` + `vite`, open `/kiosk`: the form should block submission until phone/directorate/host/ID-type/purpose are filled; the face and ID photo steps should have **no Skip button**. (Directorate dropdown is populated from `GET /api/kiosk/directorates`.)

- [ ] **Step 3: Finish the branch.** Use `superpowers:finishing-a-development-branch`: push, PR, merge to `main`. CI auto-deploys. Confirm the deploy run is green. No prod data changes are needed (new endpoint + form only).

---

## Self-Review notes (for the implementer)

- **Spec coverage:** new `GET /api/kiosk/directorates` → Task 1 Step 5; kiosk-specific `KioskCreateVisitorSchema` (phone+id_type required) + tightened `KioskCheckInSchema` (directorate+host+purpose required) → Task 1 Steps 3; `PhotoCapture` `required` prop → Task 2; `kioskApi.getDirectorates` → Task 3; form required fields + directorate/host + non-skippable photos + check-in payload → Task 4; staff flows untouched (separate schemas; PhotoCapture default skippable; shared `CreateVisitorSchema`/`CheckInSchema` unchanged).
- **Type consistency:** `KioskDirectorate { id, name, abbreviation }` matches the endpoint's `SELECT id, name, abbreviation`. The form field is `host_name`; it's sent to the API as `host_name_manual` (Task 4 Step 5) which `KioskCheckInSchema` requires. `directorate_id`/`purpose_raw` names match across form, schema, and `performCheckIn`.
- **Out of scope (unchanged):** server-side enforcement that a visit has photos; staff requirement tightening; officer picker.
