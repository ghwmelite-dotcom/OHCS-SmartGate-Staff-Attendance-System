# Kiosk ⇄ VMS Form Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kiosk self-check-in form (`KioskPage.tsx`) adopt the VMS staff form's visual/interaction design by extracting the VMS form's reusable building blocks into shared components both pages consume.

**Architecture:** Lift `FieldWrapper`, `SmartIdFields`, `PurposeRoutingHint`, `StepIndicator`, and `suggestDirectorate` out of `CheckInPage.tsx` into `packages/web/src/components/checkin/` + `packages/web/src/lib/directorate-routing.ts`. `SmartIdFields` and `StepIndicator` are refactored from form-coupled to prop-based so both forms can use them. `CheckInPage` is rewired to import them (no visual change beyond pill height 40→44px). `KioskPage` is restyled to the VMS card system while keeping kiosk data rules (no search, no officer picker, required fields) and larger touch sizing.

**Tech Stack:** React 18, TypeScript (strict), react-hook-form + zod, Tailwind (semantic tokens), lucide-react, vitest (pure-function tests only — no jsdom).

**Reference spec:** `docs/superpowers/specs/2026-06-18-kiosk-vms-form-parity-design.md`

**Toolchain note (repo path has a space + `&`):** never use `npm run`; invoke binaries directly:
- Type-check web: `node ../../node_modules/typescript/bin/tsc --noEmit` (from `packages/web`)
- Vitest: `node ../../node_modules/vitest/vitest.mjs run` (from `packages/web`)
- Build web: `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` (from `packages/web`)

---

## File Structure

**Create:**
- `packages/web/src/components/checkin/FieldWrapper.tsx` — icon+label+error layout wrapper (presentation only).
- `packages/web/src/lib/directorate-routing.ts` — `ROUTING_KEYWORDS` + pure `suggestDirectorate()`.
- `packages/web/src/lib/directorate-routing.test.ts` — unit tests for `suggestDirectorate`.
- `packages/web/src/components/checkin/PurposeRoutingHint.tsx` — purpose→directorate suggestion hint.
- `packages/web/src/components/checkin/SmartIdFields.tsx` — prop-based ID-type pills + conditional ID-number field (+ `ID_TYPE_CONFIG`, `IdTypeValue`).
- `packages/web/src/components/checkin/StepIndicator.tsx` — generic `{steps, currentIdx}` progress row.

**Modify:**
- `packages/web/src/pages/CheckInPage.tsx` — remove the local definitions; import the shared ones; pass prop-based API to `SmartIdFields`/`StepIndicator`; remove now-unused imports.
- `packages/web/src/pages/KioskPage.tsx` — restyle `form`/`face`/`id`/`success` modes to the VMS card system using the shared components; add kiosk `fieldCls` (touch sizing), step indicator, purpose hint.

**Note on shared types:** `Directorate` and `Officer` come from `@/lib/api`; `cn` from `@/lib/utils`; `ID_TYPES` from `@/lib/constants`. Import these into the new files as needed.

---

### Task 1: Extract `FieldWrapper` into a shared component

**Files:**
- Create: `packages/web/src/components/checkin/FieldWrapper.tsx`
- Modify: `packages/web/src/pages/CheckInPage.tsx` (remove local `FieldWrapper` at ~612-633, add import)

- [ ] **Step 1: Create the shared component (verbatim move)**

`packages/web/src/components/checkin/FieldWrapper.tsx`:
```tsx
import type { ReactNode } from 'react';

export function FieldWrapper({
  icon,
  label,
  error,
  children,
}: {
  icon?: ReactNode;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1.5">
        {icon && <span className="text-muted">{icon}</span>}
        {label}
      </label>
      {children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Rewire `CheckInPage.tsx`**

Delete the local `function FieldWrapper({ ... }) { ... }` block (~lines 612-633). Add near the top with the other imports:
```tsx
import { FieldWrapper } from '@/components/checkin/FieldWrapper';
```

- [ ] **Step 3: Type-check (this is the refactor's test)**

Run (from `packages/web`): `node ../../node_modules/typescript/bin/tsc --noEmit`
Expected: PASS (0 errors). TS confirms every `FieldWrapper` usage still type-checks against the moved component.

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/components/checkin/FieldWrapper.tsx packages/web/src/pages/CheckInPage.tsx
git commit -m "refactor(web): extract FieldWrapper into shared checkin component"
```

---

### Task 2: Extract `suggestDirectorate` + `ROUTING_KEYWORDS` (TDD)

**Files:**
- Create: `packages/web/src/lib/directorate-routing.ts`
- Create: `packages/web/src/lib/directorate-routing.test.ts`
- Modify: `packages/web/src/pages/CheckInPage.tsx` (remove local `ROUTING_KEYWORDS` ~637-647 and `suggestDirectorate` ~649-659; import instead. Keep `ROUTING_KEYWORDS` exported because `PurposeRoutingHint` reads `route.room` — Task 3.)

- [ ] **Step 1: Write the failing test**

`packages/web/src/lib/directorate-routing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { suggestDirectorate } from './directorate-routing';
import type { Directorate } from '@/lib/api';

const dirs = [
  { id: 'd_fa', name: 'Finance & Administration', abbreviation: 'F&A' },
  { id: 'd_reg', name: 'Confidential Registry', abbreviation: 'REGISTRY' },
] as unknown as Directorate[];

describe('suggestDirectorate', () => {
  it('returns null for short/empty purpose', () => {
    expect(suggestDirectorate('', dirs)).toBeNull();
    expect(suggestDirectorate('hi', dirs)).toBeNull();
  });
  it('routes a budget/payment purpose to F&A', () => {
    expect(suggestDirectorate('here to make a payment', dirs)?.abbreviation).toBe('F&A');
  });
  it('routes a document-submission purpose to REGISTRY', () => {
    expect(suggestDirectorate('submit documents', dirs)?.abbreviation).toBe('REGISTRY');
  });
  it('returns null when no keyword matches', () => {
    expect(suggestDirectorate('just visiting a friend', dirs)).toBeNull();
  });
  it('returns null when the matched directorate is not in the list', () => {
    expect(suggestDirectorate('audit and risk review', dirs)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/web`): `node ../../node_modules/vitest/vitest.mjs run src/lib/directorate-routing.test.ts`
Expected: FAIL — cannot resolve `./directorate-routing`.

- [ ] **Step 3: Create the module (verbatim move)**

`packages/web/src/lib/directorate-routing.ts`:
```ts
import type { Directorate } from '@/lib/api';

export const ROUTING_KEYWORDS: Array<{ keywords: string[]; abbreviation: string; room: string }> = [
  { keywords: ['document', 'submit', 'filing', 'registry', 'confidential'], abbreviation: 'REGISTRY', room: 'Room 4, 2nd Floor' },
  { keywords: ['salary', 'e-spar', 'espar', 'spar', 'ict', 'it system', 'computer', 'software', 'technology', 'research', 'data', 'statistics', 'survey', 'database', 'e-governance'], abbreviation: 'RSIMD', room: 'Room 19 & 21, 1st Floor' },
  { keywords: ['recruit', 'job', 'application', 'hiring', 'training', 'workshop', 'study leave', 'scholarship', 'capacity', 'induction', 'gimpa', 'entrance exam'], abbreviation: 'RTDD', room: 'Deputy: Room 9, 2nd Floor' },
  { keywords: ['promotion', 'posting', 'transfer', 'career', 'succession', 'welfare', 'occupational health'], abbreviation: 'CMD', room: 'Deputy: Room 34, 1st Floor' },
  { keywords: ['budget', 'payment', 'finance', 'account', 'procurement', 'stores', 'transport', 'vehicle', 'estate', 'maintenance', 'asset', 'personnel'], abbreviation: 'F&A', room: 'Deputy: Room 35, 1st Floor' },
  { keywords: ['performance', 'appraisal', 'monitoring', 'evaluation', 'service delivery', 'client service', 'development plan'], abbreviation: 'PBMED', room: 'Deputy: Room 31, 1st Floor' },
  { keywords: ['complaint', 'petition', 'disciplinary', 'council', 'civil service council'], abbreviation: 'CSC', room: 'Rooms 24, 44' },
  { keywords: ['reform', 'anti-corruption', 'nacap', 'right to information', 'rti'], abbreviation: 'RCU', room: '' },
  { keywords: ['audit', 'fraud', 'internal audit', 'compliance', 'risk'], abbreviation: 'IAU', room: '' },
];

export function suggestDirectorate(purpose: string, directorates: Directorate[]): Directorate | null {
  if (!purpose || purpose.length < 3) return null;
  const lower = purpose.toLowerCase();
  for (const route of ROUTING_KEYWORDS) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      return directorates.find((d) => d.abbreviation === route.abbreviation) ?? null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Rewire `CheckInPage.tsx`**

Delete the local `ROUTING_KEYWORDS` and `suggestDirectorate`. Add import:
```tsx
import { ROUTING_KEYWORDS, suggestDirectorate } from '@/lib/directorate-routing';
```
(`ROUTING_KEYWORDS` is still referenced by the local `PurposeRoutingHint` until Task 3.)

- [ ] **Step 5: Run tests + type-check**

Run: `node ../../node_modules/vitest/vitest.mjs run src/lib/directorate-routing.test.ts` → Expected: PASS (5 tests).
Run: `node ../../node_modules/typescript/bin/tsc --noEmit` → Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/web/src/lib/directorate-routing.ts packages/web/src/lib/directorate-routing.test.ts packages/web/src/pages/CheckInPage.tsx
git commit -m "refactor(web): extract suggestDirectorate + routing keywords with tests"
```

---

### Task 3: Extract `PurposeRoutingHint` into a shared component

**Files:**
- Create: `packages/web/src/components/checkin/PurposeRoutingHint.tsx`
- Modify: `packages/web/src/pages/CheckInPage.tsx` (remove local `PurposeRoutingHint` ~661-702, add import; drop the `ROUTING_KEYWORDS` import if no longer used directly in CheckInPage)

- [ ] **Step 1: Create the shared component (verbatim move)**

`packages/web/src/components/checkin/PurposeRoutingHint.tsx`:
```tsx
import { CheckCircle2, Building2 } from 'lucide-react';
import type { Directorate } from '@/lib/api';
import { ROUTING_KEYWORDS, suggestDirectorate } from '@/lib/directorate-routing';

export function PurposeRoutingHint({ purpose, directorates, currentDirectorateId, onAccept }: {
  purpose: string;
  directorates: Directorate[];
  currentDirectorateId: string;
  onAccept: (id: string) => void;
}) {
  const suggestion = suggestDirectorate(purpose, directorates);
  if (!suggestion) return null;

  const route = ROUTING_KEYWORDS.find((r) => r.abbreviation === suggestion.abbreviation);
  const alreadySelected = currentDirectorateId === suggestion.id;

  if (alreadySelected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-success/8 border border-success/15 rounded-xl text-[13px] animate-fade-in">
        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
        <span className="text-success font-medium">
          Routing to {suggestion.abbreviation}{route?.room ? ` — ${route.room}` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-accent/8 border border-accent/15 rounded-xl animate-fade-in">
      <div className="flex items-center gap-2 text-[13px]">
        <Building2 className="h-4 w-4 text-accent-warm shrink-0" />
        <span className="text-foreground">
          Suggested: <strong>{suggestion.abbreviation}</strong> — {suggestion.name}
          {route?.room ? <span className="text-muted"> ({route.room})</span> : ''}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onAccept(suggestion.id)}
        className="h-7 px-3 text-[12px] font-semibold bg-accent text-white rounded-lg hover:brightness-110 transition-all shrink-0"
      >
        Accept
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Rewire `CheckInPage.tsx`**

Delete local `PurposeRoutingHint`. Add import:
```tsx
import { PurposeRoutingHint } from '@/components/checkin/PurposeRoutingHint';
```
Now change the Task 2 import to only what CheckInPage still uses directly. CheckInPage still calls `suggestDirectorate` inline (the purpose `onChange` at ~471), so keep:
```tsx
import { suggestDirectorate } from '@/lib/directorate-routing';
```
Remove `ROUTING_KEYWORDS` from CheckInPage's import (now only used inside `PurposeRoutingHint`).

- [ ] **Step 3: Type-check**

Run: `node ../../node_modules/typescript/bin/tsc --noEmit`
Expected: PASS. (If TS reports an unused import, remove it — tsconfig may have `noUnusedLocals`.)

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/components/checkin/PurposeRoutingHint.tsx packages/web/src/pages/CheckInPage.tsx
git commit -m "refactor(web): extract PurposeRoutingHint into shared checkin component"
```

---

### Task 4: Refactor `SmartIdFields` to a prop-based shared component

**Files:**
- Create: `packages/web/src/components/checkin/SmartIdFields.tsx`
- Modify: `packages/web/src/pages/CheckInPage.tsx` (remove local `ID_TYPE_CONFIG` ~800-839 and `SmartIdFields` ~841-891; import; pass prop-based API)

**Why a refactor, not a move:** the local `SmartIdFields` takes the whole `form` object typed to `NewVisitorForm`. The kiosk's form type differs (`VisitorForm`). Decouple via plain props so both pages use it.

- [ ] **Step 1: Create the prop-based component**

`packages/web/src/components/checkin/SmartIdFields.tsx`:
```tsx
import { CreditCard } from 'lucide-react';
import { ID_TYPES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { FieldWrapper } from './FieldWrapper';

export type IdTypeValue = typeof ID_TYPES[number]['value'];

export const ID_TYPE_CONFIG: Record<string, { label: string; placeholder: string; hint: string; format?: (v: string) => string }> = {
  ghana_card: {
    label: 'Ghana Card Number',
    placeholder: 'GHA-XXXXXXXXX-X',
    hint: 'Format: GHA-000000000-0',
    format: (v: string) => {
      const digits = v.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (digits.length <= 3) return digits;
      if (digits.length <= 12) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
      return `${digits.slice(0, 3)}-${digits.slice(3, 12)}-${digits.slice(12, 13)}`;
    },
  },
  passport: {
    label: 'Passport Number',
    placeholder: 'G0123456',
    hint: 'Ghana passport number',
    format: (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9),
  },
  drivers_license: {
    label: 'License Number',
    placeholder: 'DL-00000000-00',
    hint: "DVLA driver's license number",
    format: (v: string) => {
      const clean = v.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (clean.length <= 2) return clean;
      if (clean.length <= 10) return `${clean.slice(0, 2)}-${clean.slice(2)}`;
      return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10, 12)}`;
    },
  },
  staff_id: { label: 'Staff ID Number', placeholder: '12345', hint: 'Government staff identification' },
  other: { label: 'ID Number', placeholder: 'Enter ID number', hint: 'Enter the identification number' },
};

const DEFAULT_INPUT_CLS =
  'w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

export function SmartIdFields({
  idType,
  idNumber,
  onIdTypeChange,
  onIdNumberChange,
  idTypeError,
  idNumberError,
  inputClassName = DEFAULT_INPUT_CLS,
}: {
  idType: IdTypeValue | '' | undefined;
  idNumber: string;
  onIdTypeChange: (v: IdTypeValue | undefined) => void;
  onIdNumberChange: (v: string) => void;
  idTypeError?: string;
  idNumberError?: string;
  inputClassName?: string;
}) {
  const config = idType ? ID_TYPE_CONFIG[idType] : null;

  return (
    <div className="space-y-4">
      <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label="ID Type" error={idTypeError}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ID_TYPES.map((t) => {
            const isSelected = idType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  if (isSelected) { onIdTypeChange(undefined); onIdNumberChange(''); }
                  else onIdTypeChange(t.value);
                }}
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

      {config && (
        <div className="animate-fade-in-up">
          <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label={config.label} error={idNumberError}>
            <input
              value={idNumber}
              className={inputClassName}
              placeholder={config.placeholder}
              onChange={(e) => onIdNumberChange(config.format ? config.format(e.target.value) : e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">{config.hint}</p>
          </FieldWrapper>
        </div>
      )}
    </div>
  );
}
```
Note: pill height is `h-11` (44px) for accessible touch targets on both forms — a deliberate 40→44px bump from the VMS original, the one intentional visual change to the VMS form.

- [ ] **Step 2: Rewire `CheckInPage.tsx`**

Delete local `ID_TYPE_CONFIG` and `SmartIdFields`. Add import:
```tsx
import { SmartIdFields } from '@/components/checkin/SmartIdFields';
```
Replace the `<SmartIdFields form={...} />` usage in the new-visitor step with the prop-based API, wiring it to the existing react-hook-form instance (the new-visitor form variable — confirm its name in context, e.g. `newVisitorForm`/`form`):
```tsx
<SmartIdFields
  idType={newVisitorForm.watch('id_type')}
  idNumber={newVisitorForm.watch('id_number') ?? ''}
  onIdTypeChange={(v) => {
    newVisitorForm.setValue('id_type', v as never);
    if (!v) newVisitorForm.setValue('id_number', '');
  }}
  onIdNumberChange={(v) => newVisitorForm.setValue('id_number', v)}
  idNumberError={newVisitorForm.formState.errors.id_number?.message}
/>
```
Remove the now-unused `ID_TYPES` import from CheckInPage if TS flags it.

- [ ] **Step 3: Type-check**

Run: `node ../../node_modules/typescript/bin/tsc --noEmit`
Expected: PASS. (Resolve any unused-import errors by removing them.)

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/components/checkin/SmartIdFields.tsx packages/web/src/pages/CheckInPage.tsx
git commit -m "refactor(web): extract prop-based SmartIdFields shared component"
```

---

### Task 5: Refactor `StepIndicator` to a generic shared component

**Files:**
- Create: `packages/web/src/components/checkin/StepIndicator.tsx`
- Modify: `packages/web/src/pages/CheckInPage.tsx` (remove local `StepIndicator` ~910-944; import; compute and pass `steps`+`currentIdx`)

- [ ] **Step 1: Create the generic component**

`packages/web/src/components/checkin/StepIndicator.tsx`:
```tsx
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StepIndicator({ steps, currentIdx }: {
  steps: { key: string; label: string }[];
  currentIdx: number;
}) {
  return (
    <div className="flex items-center gap-1 ml-auto">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold',
              i < currentIdx
                ? 'bg-success text-white'
                : i === currentIdx
                  ? 'bg-primary text-white'
                  : 'bg-border text-muted'
            )}
          >
            {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={cn('text-xs', i === currentIdx ? 'text-foreground font-medium' : 'text-muted')}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-border-strong mx-1">—</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rewire `CheckInPage.tsx`**

Delete local `StepIndicator`. Add import:
```tsx
import { StepIndicator } from '@/components/checkin/StepIndicator';
```
Replace the `<StepIndicator current={step} />` usage. Define the steps + index inline where it was rendered (preserving the `new-visitor → 0` mapping):
```tsx
{(() => {
  const indicatorSteps = [
    { key: 'search', label: 'Find' },
    { key: 'photo', label: 'Photo' },
    { key: 'check-in', label: 'Check In' },
    { key: 'success', label: 'Done' },
  ];
  const idx = step === 'new-visitor' ? 0 : indicatorSteps.findIndex((s) => s.key === step);
  return <StepIndicator steps={indicatorSteps} currentIdx={idx} />;
})()}
```

- [ ] **Step 3: Type-check**

Run: `node ../../node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/components/checkin/StepIndicator.tsx packages/web/src/pages/CheckInPage.tsx
git commit -m "refactor(web): extract generic StepIndicator shared component"
```

---

### Task 6: Restyle the kiosk form to the VMS design language

**Files:**
- Modify: `packages/web/src/pages/KioskPage.tsx`

Keep ALL existing logic: the `Mode` state machine, `visitorSchema` (all required-field rules), `onSubmitForm`/`handleFaceCapture`/`handleIdCapture`/`finishCheckIn`/checkout handlers, `KioskBadgeQr`, `BADGE_BASE`. Restyle only, and add the shared components.

- [ ] **Step 1: Add imports + a kiosk touch field class**

At the top of `KioskPage.tsx` add:
```tsx
import { User, Phone, Briefcase, Building2 } from 'lucide-react';
import { FieldWrapper } from '@/components/checkin/FieldWrapper';
import { SmartIdFields } from '@/components/checkin/SmartIdFields';
import { PurposeRoutingHint } from '@/components/checkin/PurposeRoutingHint';
import { StepIndicator } from '@/components/checkin/StepIndicator';
import { suggestDirectorate } from '@/lib/directorate-routing';
```
(Keep existing imports for `CheckCircle2, LogIn, LogOut, Loader2, X`, `kioskApi`, `API_BASE`, `BADGE_BASE`, `PhotoCapture`, `QrScanner`. `ID_TYPES` is no longer used directly here — remove it from the constants import if TS flags it.)

Replace the existing `fieldCls` constant with a kiosk touch-sized one:
```tsx
const fieldCls = 'w-full h-12 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary';
```

- [ ] **Step 2: Add a kiosk step indicator above the active flow**

Inside the card, right under `<KioskHeader />`, render an indicator for the in-flow modes only:
```tsx
{(mode === 'form' || mode === 'face' || mode === 'id' || mode === 'submitting' || mode === 'success') && (
  <div className="mt-4 flex">
    <StepIndicator
      steps={[
        { key: 'form', label: 'Details' },
        { key: 'face', label: 'Photo' },
        { key: 'id', label: 'ID' },
        { key: 'success', label: 'Done' },
      ]}
      currentIdx={mode === 'form' ? 0 : mode === 'face' ? 1 : mode === 'id' || mode === 'submitting' ? 2 : 3}
    />
  </div>
)}
```

- [ ] **Step 3: Rewrite the `form` mode block with FieldWrapper, SmartIdFields, and the purpose hint**

Replace the entire `{mode === 'form' && ( ... )}` block (current ~152-199) with:
```tsx
{mode === 'form' && (
  <form onSubmit={form.handleSubmit(onSubmitForm)} className="space-y-4 mt-6">
    <div>
      <h2 className="text-lg font-semibold text-foreground">Your Details</h2>
      <p className="text-sm text-muted mt-0.5">Tell us who you are and who you're visiting</p>
    </div>
    <div className="bg-surface rounded-xl border border-border shadow-sm p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <FieldWrapper icon={<User className="h-4 w-4" />} label="First Name" error={form.formState.errors.first_name?.message}>
          <input {...form.register('first_name')} className={fieldCls} autoFocus />
        </FieldWrapper>
        <FieldWrapper icon={<User className="h-4 w-4" />} label="Last Name" error={form.formState.errors.last_name?.message}>
          <input {...form.register('last_name')} className={fieldCls} />
        </FieldWrapper>
      </div>
      <FieldWrapper icon={<Phone className="h-4 w-4" />} label="Phone" error={form.formState.errors.phone?.message}>
        <input {...form.register('phone')} className={fieldCls} placeholder="0241234567" inputMode="tel" />
      </FieldWrapper>
      <FieldWrapper icon={<Briefcase className="h-4 w-4" />} label="Organisation (optional)">
        <input {...form.register('organisation')} className={fieldCls} />
      </FieldWrapper>
      <FieldWrapper icon={<Building2 className="h-4 w-4" />} label="Directorate" error={form.formState.errors.directorate_id?.message}>
        <select {...form.register('directorate_id')} className={fieldCls}>
          <option value="">Select directorate...</option>
          {directorates.map((d) => (
            <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
          ))}
        </select>
      </FieldWrapper>
      <FieldWrapper icon={<User className="h-4 w-4" />} label="Who are you visiting?" error={form.formState.errors.host_name?.message}>
        <input {...form.register('host_name')} className={fieldCls} placeholder="e.g. Mr. Mensah" />
      </FieldWrapper>
      <SmartIdFields
        idType={form.watch('id_type')}
        idNumber={form.watch('id_number') ?? ''}
        onIdTypeChange={(v) => {
          form.setValue('id_type', v as never);
          if (v) form.clearErrors('id_type');
          else form.setValue('id_number', '');
        }}
        onIdNumberChange={(v) => form.setValue('id_number', v)}
        idTypeError={form.formState.errors.id_type?.message}
        idNumberError={form.formState.errors.id_number?.message}
        inputClassName={fieldCls}
      />
      <FieldWrapper label="Purpose of Visit" error={form.formState.errors.purpose_raw?.message}>
        <textarea {...form.register('purpose_raw')} rows={2} className={`${fieldCls} h-auto py-2 resize-none`} placeholder="e.g. Submit documents, salary enquiry, training..." />
      </FieldWrapper>
      <PurposeRoutingHint
        purpose={form.watch('purpose_raw') ?? ''}
        directorates={directorates}
        currentDirectorateId={form.watch('directorate_id') ?? ''}
        onAccept={(id) => form.setValue('directorate_id', id)}
      />
    </div>
    {submitError && <p className="text-danger text-xs">{submitError}</p>}
    <div className="flex gap-3">
      <button type="button" onClick={resetAll} className="h-14 px-4 text-sm text-muted">Cancel</button>
      <button type="submit" disabled={form.formState.isSubmitting} className="flex-1 h-14 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
        {form.formState.isSubmitting ? 'Registering…' : 'Continue to Photo'}
      </button>
    </div>
  </form>
)}
```
Note: `suggestDirectorate` is imported for parity with the VMS (available if auto-fill-on-type is wanted later); the visible hint is driven by `PurposeRoutingHint`. If TS flags `suggestDirectorate` as unused, either remove the import or add the same auto-suggest-on-change the VMS uses; keep it simple — remove the unused import.

- [ ] **Step 4: Wrap the `face` and `id` photo steps in VMS-style cards**

Replace the `{mode === 'face' && (...)}` and `{mode === 'id' && (...)}` blocks with:
```tsx
{mode === 'face' && (
  <div className="mt-6 space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-foreground">Take Your Photo</h2>
      <p className="text-sm text-muted mt-0.5">Look at the camera and capture a clear photo</p>
    </div>
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-6">
      <PhotoCapture title="Take Your Photo" facingMode="user" required onCapture={handleFaceCapture} onSkip={() => setMode('id')} />
    </div>
  </div>
)}

{mode === 'id' && (
  <div className="mt-6 space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-foreground">Photograph Your ID</h2>
      <p className="text-sm text-muted mt-0.5">Place your ID in the frame and capture it</p>
    </div>
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-6">
      <PhotoCapture title="Photograph Your ID" facingMode="environment" mirror={false} required onCapture={handleIdCapture} onSkip={finishCheckIn} />
    </div>
  </div>
)}
```

- [ ] **Step 5: Restyle the `success` block to the VMS success card**

Replace the success-state inner markup (keep the `createdVisit?.badge_code` conditional logic) with VMS-style framing:
```tsx
{mode === 'success' && (
  <div className="mt-6">
    {createdVisit?.badge_code ? (
      <div className="bg-surface rounded-2xl border border-border shadow-sm p-8 text-center space-y-4">
        <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">You're Checked In</h2>
          <p className="text-sm text-muted mt-1">Scan this code with your phone to keep your badge</p>
        </div>
        <KioskBadgeQr badgeCode={createdVisit.badge_code} />
        <p className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</p>
        <button onClick={resetAll} className="h-12 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
      </div>
    ) : (
      <div className="text-center space-y-4">
        <p className="text-danger text-sm">{submitError ?? 'Something went wrong. Please see reception.'}</p>
        <button onClick={resetAll} className="h-12 px-6 bg-primary text-white text-sm font-semibold rounded-xl">Done</button>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: Type-check + build**

Run (from `packages/web`):
- `node ../../node_modules/typescript/bin/tsc --noEmit` → Expected: PASS.
- `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → Expected: build succeeds (`✓ built`).

- [ ] **Step 7: Commit**
```bash
git add packages/web/src/pages/KioskPage.tsx
git commit -m "feat(kiosk): adopt VMS visual design via shared check-in components"
```

---

### Task 7: Full verification (static + runtime, no regression)

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test + type-check + build**

From `packages/web`:
- `node ../../node_modules/vitest/vitest.mjs run` → Expected: all tests PASS (includes `directorate-routing.test.ts`, `badgeCode.test.ts`).
- `node ../../node_modules/typescript/bin/tsc --noEmit` → Expected: PASS.
- `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → Expected: `✓ built`.

- [ ] **Step 2: Runtime render check (verify skill)**

Use the `verify` skill / Playwright against the dev server. Drive:
1. Kiosk `/kiosk` → Check In → confirm: step indicator (Details→Photo→ID→Done), `FieldWrapper` icons, **pill-button ID type**, purpose textarea + routing hint, VMS card styling, larger touch controls. Submit with a missing required field → inline errors show. Fill valid → advances to the face photo step (VMS card), then ID step.
2. VMS `/check-in` (staff, authenticated) → confirm **no regression**: new-visitor pill ID type still works, purpose routing hint still appears/accepts, step indicator renders, check-in completes.
Capture screenshots of both forms as evidence.

- [ ] **Step 3: No commit** (verification only). Report results.

---

## Self-Review

**Spec coverage:**
- Shared component extraction (FieldWrapper, SmartIdFields, PurposeRoutingHint, StepIndicator, suggestDirectorate) → Tasks 1-5. ✓
- Kiosk adopts VMS card system, pill ID type, purpose hint, step indicator, styled photo + success screens → Task 6. ✓
- Kiosk keeps free-text host, directorate dropdown, no search, required fields, larger touch sizing → Task 6 (logic untouched; `fieldCls` h-12, buttons h-14). ✓
- VMS form unchanged except deliberate pill 40→44px bump → Tasks 1-5 (verbatim moves; SmartIdFields noted). ✓
- No API/DB change → confirmed; all tasks are web-only. ✓
- Testing: pure-function TDD for suggestDirectorate; type-check as the refactor contract test; runtime render verification → Tasks 2, 7. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/vague steps; every code step shows full code; commands have expected output. The two "remove the import if TS flags it" notes are concrete conditional cleanups, not placeholders.

**Type consistency:** `IdTypeValue` defined in Task 4 and used consistently; `SmartIdFields` prop names (`idType`, `idNumber`, `onIdTypeChange`, `onIdNumberChange`, `idTypeError`, `idNumberError`, `inputClassName`) identical in definition (Task 4) and both call sites (Tasks 4, 6); `StepIndicator` props (`steps`, `currentIdx`) identical in definition (Task 5) and both call sites (Tasks 5, 6); `suggestDirectorate`/`ROUTING_KEYWORDS` signatures match across Tasks 2, 3.

**Note for the implementer:** confirm the exact variable name of the VMS new-visitor react-hook-form instance when wiring Task 4 Step 2 (the plan uses `newVisitorForm` as a placeholder name for that existing variable — read the file and use the real name).
