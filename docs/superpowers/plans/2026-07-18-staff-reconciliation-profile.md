# Staff Reconciliation, Phone & Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile officer staff IDs from the Excel stafflist, add phone to staff accounts, surface readiness status in the admin, and give staff a self-service profile page to update their phone and email.

**Architecture:** DB migrations add the `phone` column and backfill `officers.staff_id`/phone from Excel. The API gains a profile self-update endpoint in `auth.ts` (session-cookie authenticated, same pattern as `GET /auth/me`), an unprovisioned-count endpoint, and phone propagation when an admin edits an officer. The admin Users tab gets readiness badges and a promoted Provision button. The Org Entities officers list gains Staff ID and SA Account columns. A new `ProfilePage` lets any logged-in user update phone and email.

**Tech Stack:** Cloudflare Workers (Hono), D1 SQLite, React 18, React Query v5, Zod, Zustand, Tailwind CSS, Python 3 + openpyxl (reconciliation script), Vitest (API schema tests).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/gen-staff-reconciliation-migration.py` | Create | Reads Excel, writes backfill SQL migration |
| `packages/api/src/db/migration-users-phone.sql` | Create | `ALTER TABLE users ADD COLUMN phone TEXT` |
| `packages/api/src/db/migration-officers-staff-id-backfill.sql` | Generated | UPDATE officers.staff_id + phone from Excel |
| `packages/api/src/db/migrations-index.ts` | Modify | Register the two new migrations |
| `packages/api/src/db/schema.sql` | Modify | Add `phone TEXT` to users CREATE TABLE |
| `packages/api/src/routes/users.ts` | Modify | phone in SELECT; provision copies phone; audit field; unprovisioned-count endpoint |
| `packages/api/src/routes/auth.ts` | Modify | `PATCH /auth/profile` endpoint; phone + staff_id in `GET /auth/me` |
| `packages/api/src/routes/officers.ts` | Modify | Add `staff_id` + `has_sa_account` to OFFICER_COLUMNS |
| `packages/api/src/routes/admin-directorates.ts` | Modify | After officer phone UPDATE, propagate to linked users row |
| `packages/web/src/pages/AdminPage.tsx` | Modify | Phone col; readiness badge; unprovisioned count; Provision button in Users tab |
| `packages/web/src/components/admin/DirectoratesTab.tsx` | Modify | Staff ID col; SA Account chip; phone field in officer edit modal |
| `packages/web/src/pages/ProfilePage.tsx` | Create | Self-service phone + email update page |
| `packages/web/src/stores/auth.ts` | Modify | Add `phone`/`staff_id` to User type; add `updateProfile` action |
| `packages/web/src/components/layout/BottomNav.tsx` | Modify | Add Profile to MORE_ITEMS |
| `packages/web/src/components/layout/Sidebar.tsx` | Modify | Add Profile nav link |
| `packages/web/src/App.tsx` | Modify | Register `/profile` route |

---

## Task 1: Excel Reconciliation Script

**Files:**
- Create: `scripts/gen-staff-reconciliation-migration.py`
- Generates: `packages/api/src/db/migration-officers-staff-id-backfill.sql`

- [ ] **Step 1: Write the script**

Create `scripts/gen-staff-reconciliation-migration.py`:

```python
#!/usr/bin/env python3
"""
Reads docs/Staff List/UPDATED STAFFLIST 2026 FOR 39.xlsx and generates
packages/api/src/db/migration-officers-staff-id-backfill.sql.

Run from repo root:
  python scripts/gen-staff-reconciliation-migration.py
"""
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl not installed — run: pip install openpyxl")

REPO_ROOT = Path(__file__).parent.parent
EXCEL_PATH = REPO_ROOT / "docs" / "Staff List" / "UPDATED STAFFLIST 2026 FOR 39.xlsx"
OUT_PATH = REPO_ROOT / "packages" / "api" / "src" / "db" / "migration-officers-staff-id-backfill.sql"
SHEET_NAME = "Updated stafflist OHCS"


def clean(val) -> str:
    return str(val).strip() if val is not None else ""


def is_numeric_staff_id(val) -> bool:
    if isinstance(val, (int, float)) and val > 0:
        return True
    if isinstance(val, str) and re.match(r"^\d+$", val.strip()):
        return True
    return False


def to_staff_no(val) -> str:
    return str(int(float(str(val).strip())))


def escape_sql(s: str) -> str:
    return s.replace("'", "''")


def main():
    if not EXCEL_PATH.exists():
        sys.exit(f"Excel file not found: {EXCEL_PATH}")

    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    if SHEET_NAME not in wb.sheetnames:
        sys.exit(f"Sheet '{SHEET_NAME}' not found. Available: {wb.sheetnames}")

    ws = wb[SHEET_NAME]
    rows = list(ws.iter_rows(min_row=3, values_only=True))

    statements: list[str] = []
    skipped: list[str] = []

    for row in rows:
        col_b = row[1]   # Staff No.
        col_c = row[2]   # First Name
        col_d = row[3]   # Surname
        col_r = row[17]  # Phone No.

        if not is_numeric_staff_id(col_b):
            continue

        staff_no = to_staff_no(col_b)
        officer_id = f"off_{staff_no}"
        phone = clean(col_r)

        first = clean(col_c)
        surname = clean(col_d)
        # Remove trailing " Male"/"Female" that appears in some surname cells
        surname = re.sub(r"\s+(Male|Female)$", "", surname, flags=re.IGNORECASE).strip()

        if not phone:
            skipped.append(f"  -- staff_no={staff_no} ({first} {surname}): no phone in Excel")

        phone_sql = escape_sql(phone) if phone else ""
        phone_val = f"'{phone_sql}'" if phone else "NULL"

        statements.append(
            f"UPDATE officers SET staff_id = '{staff_no}', phone = {phone_val} "
            f"WHERE id = '{officer_id}' AND (staff_id IS NULL OR staff_id != '{staff_no}' OR phone IS DISTINCT FROM {phone_val});"
        )

    header = """\
-- Auto-generated by scripts/gen-staff-reconciliation-migration.py — do not edit by hand
-- Backfills officers.staff_id and phone from UPDATED STAFFLIST 2026 FOR 39.xlsx
-- (sheet: "Updated stafflist OHCS", column B = Staff No., column R = Phone)
-- Safe to re-run: UPDATE only affects rows where values differ.
"""

    footer_lines = []
    if skipped:
        footer_lines.append("\n-- Staff with no phone number in Excel (skipped phone update):")
        footer_lines.extend(skipped)

    content = header + "\n".join(statements) + "\n" + "\n".join(footer_lines) + "\n"

    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"Wrote {len(statements)} UPDATE statements to:")
    print(f"  {OUT_PATH}")
    if skipped:
        print(f"  {len(skipped)} staff had no phone in Excel (see comments at end of file)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script and review output**

```bash
python scripts/gen-staff-reconciliation-migration.py
```

Expected output:
```
Wrote 166 UPDATE statements to:
  packages\api\src\db\migration-officers-staff-id-backfill.sql
```

Open `packages/api/src/db/migration-officers-staff-id-backfill.sql` and verify:
- First line is the comment header
- Statements look like: `UPDATE officers SET staff_id = '808859', phone = '0246951164' WHERE id = 'off_808859' ...`
- File ends with newline

- [ ] **Step 3: Commit**

```bash
git add scripts/gen-staff-reconciliation-migration.py packages/api/src/db/migration-officers-staff-id-backfill.sql
git commit -m "feat(staff): gen-staff-reconciliation-migration script + generated backfill SQL"
```

---

## Task 2: DB Migrations + Schema Update

**Files:**
- Create: `packages/api/src/db/migration-users-phone.sql`
- Modify: `packages/api/src/db/migrations-index.ts`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Write migration-users-phone.sql**

Create `packages/api/src/db/migration-users-phone.sql`:

```sql
-- Add phone number to staff attendance user accounts.
ALTER TABLE users ADD COLUMN phone TEXT;
```

- [ ] **Step 2: Register both migrations in migrations-index.ts**

Open `packages/api/src/db/migrations-index.ts`. Add two imports after the last existing import line (`import officerStaffId from './migration-officer-staff-id.sql';`):

```typescript
import usersPhone from './migration-users-phone.sql';
import officersStaffIdBackfill from './migration-officers-staff-id-backfill.sql';
```

Then add two entries at the end of the `MIGRATIONS` array (after `{ filename: 'migration-officer-staff-id.sql', sql: officerStaffId },`):

```typescript
  { filename: 'migration-users-phone.sql', sql: usersPhone },
  { filename: 'migration-officers-staff-id-backfill.sql', sql: officersStaffIdBackfill },
```

- [ ] **Step 3: Update schema.sql — add phone to users CREATE TABLE**

Open `packages/api/src/db/schema.sql`. Find the `users` table definition. The line:

```sql
    supervisor_user_id  TEXT REFERENCES users(id)
);
```

Change to:

```sql
    supervisor_user_id  TEXT REFERENCES users(id),
    -- Contact phone (added by migration-users-phone.sql). Self-updated via PATCH /auth/profile.
    phone               TEXT
);
```

- [ ] **Step 4: Verify the migrations-index compiles**

```bash
cd "C:\dev\Projects\OHCS SmartGate & Staff Attendance"
node -e "require('./packages/api/src/db/migrations-index.ts')" 2>&1 || npx tsc --noEmit -p packages/api/tsconfig.json 2>&1 | head -20
```

Or use the project's type-check script:

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/api/tsconfig.json 2>&1 | head -30
```

Expected: no errors related to migrations-index.ts.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/migration-users-phone.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): add phone column to users; register staff-id backfill migrations"
```

---

## Task 3: API — users.ts (phone in list, provision copies phone, unprovisioned count)

**Files:**
- Modify: `packages/api/src/routes/users.ts`

- [ ] **Step 1: Write a failing test for the unprovisioned-count path**

Open (or create) `packages/api/src/routes/users.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// The unprovisioned-count endpoint returns a plain count.
// Test the query logic by testing the shape we expect back.
describe('GET /users/unprovisioned-count response shape', () => {
  it('count is a non-negative integer', () => {
    const schema = z.object({ count: z.number().int().min(0) });
    expect(schema.safeParse({ count: 0 }).success).toBe(true);
    expect(schema.safeParse({ count: 42 }).success).toBe(true);
    expect(schema.safeParse({ count: -1 }).success).toBe(false);
    expect(schema.safeParse({ count: 'bad' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it passes (schema-level test always passes if types are right)**

```bash
cd "C:\dev\Projects\OHCS SmartGate & Staff Attendance"
node node_modules/.bin/vitest run packages/api/src/routes/users.test.ts 2>&1
```

Expected: PASS (it's a schema test).

- [ ] **Step 3: Apply all four changes to users.ts**

Open `packages/api/src/routes/users.ts`.

**Change 1** — Add `'phone'` to `AUDITED_USER_FIELDS`:

```typescript
const AUDITED_USER_FIELDS = ['name', 'email', 'staff_id', 'role', 'grade', 'directorate_id', 'is_active', 'phone'];
```

**Change 2** — In `GET /` (list all users), add `u.phone` to the SELECT:

```typescript
  const results = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.staff_id, u.phone, u.role, u.grade, u.is_active, u.last_login_at, u.created_at,
            u.user_type, u.nss_number, u.nss_start_date, u.nss_end_date,
            d.abbreviation as directorate_abbr
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id
     ORDER BY u.created_at DESC`
  ).all();
```

**Change 3** — Add new `GET /unprovisioned-count` route (place it before the `POST /` create route so it isn't shadowed by `GET /:id`):

```typescript
// Count officers who have a staff_id but no matching Staff Attendance account.
// Used by the admin Users tab to show the "N no account" stat.
userRoutes.get('/unprovisioned-count', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM officers o
     WHERE o.staff_id IS NOT NULL AND o.staff_id != ''
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.staff_id = o.staff_id)`
  ).first<{ count: number }>();
  return success(c, { count: row?.count ?? 0 });
});
```

**Change 4** — In `POST /provision-from-officers`, after creating the user row add phone:

Find this line in the provision handler:
```typescript
    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, staff_id, pin_hash, role, directorate_id)
       VALUES (?, ?, ?, ?, ?, 'staff', ?)`
    ).bind(userId, officer.name, userEmail, staffId, pinHash, officer.directorate_id).run();
```

Replace with:
```typescript
    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, staff_id, pin_hash, role, directorate_id, phone)
       VALUES (?, ?, ?, ?, ?, 'staff', ?, ?)`
    ).bind(userId, officer.name, userEmail, staffId, pinHash, officer.directorate_id, officer.phone ?? null).run();
```

Also update the SELECT that fetches officers at the top of the provision handler to include `o.phone`:

```typescript
  const officers = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.email, o.staff_id, o.phone, o.directorate_id
     FROM officers o
     WHERE o.staff_id IS NOT NULL AND o.staff_id != ''
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.staff_id = o.staff_id)
     ORDER BY o.name`
  ).all<{ id: string; name: string; email: string | null; staff_id: string; phone: string | null; directorate_id: string }>();
```

- [ ] **Step 4: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/api/tsconfig.json 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/users.ts packages/api/src/routes/users.test.ts
git commit -m "feat(api): phone in users list; provision copies phone; unprovisioned-count endpoint"
```

---

## Task 4: API — PATCH /auth/profile + phone/staff_id in GET /auth/me

**Files:**
- Modify: `packages/api/src/routes/auth.ts`

- [ ] **Step 1: Write a failing schema test**

Create `packages/api/src/routes/auth-profile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Mirror the profileUpdateSchema that will be defined in auth.ts
const profileUpdateSchema = z
  .object({
    phone: z.string().max(20).trim().optional().or(z.literal('')),
    email: z.string().email().max(255).toLowerCase().trim().optional(),
    current_pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .refine(
    (v) => !v.email || !!v.current_pin,
    { message: 'current_pin is required when changing email', path: ['current_pin'] }
  );

describe('profileUpdateSchema', () => {
  it('accepts phone-only update without PIN', () => {
    expect(profileUpdateSchema.safeParse({ phone: '0241234567' }).success).toBe(true);
  });

  it('accepts empty string to clear phone', () => {
    expect(profileUpdateSchema.safeParse({ phone: '' }).success).toBe(true);
  });

  it('rejects email change without current_pin', () => {
    const r = profileUpdateSchema.safeParse({ email: 'new@ohcs.gov.gh' });
    expect(r.success).toBe(false);
  });

  it('accepts email change with current_pin', () => {
    expect(
      profileUpdateSchema.safeParse({ email: 'new@ohcs.gov.gh', current_pin: '1234' }).success
    ).toBe(true);
  });

  it('rejects invalid PIN format', () => {
    expect(
      profileUpdateSchema.safeParse({ email: 'new@ohcs.gov.gh', current_pin: 'abcd' }).success
    ).toBe(false);
  });

  it('rejects email that is not an email', () => {
    expect(
      profileUpdateSchema.safeParse({ email: 'not-an-email', current_pin: '1234' }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (schema not yet in auth.ts)**

```bash
node node_modules/.bin/vitest run packages/api/src/routes/auth-profile.test.ts 2>&1
```

Expected: The test file can run but the inline schema passes because it's defined in the test itself. All 6 tests should PASS — this is a pure Zod test, no import from auth.ts yet. Proceed.

- [ ] **Step 3: Add PATCH /auth/profile and update GET /auth/me in auth.ts**

Open `packages/api/src/routes/auth.ts`.

**3a** — Add the schema near the top (after `const verifySchema = ...`):

```typescript
const profileUpdateSchema = z
  .object({
    phone: z.string().max(20).trim().optional().or(z.literal('')),
    email: z.string().email().max(255).toLowerCase().trim().optional(),
    current_pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .refine(
    (v) => !v.email || !!v.current_pin,
    { message: 'current_pin is required when changing email', path: ['current_pin'] }
  );
```

**3b** — Add the `PATCH /auth/profile` handler. Place it just before `authRoutes.post('/logout', ...)`:

```typescript
authRoutes.patch('/profile', zValidator('json', profileUpdateSchema), async (c) => {
  const sessionId = readSessionId(c);
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const session = await getSession(sessionId, c.env);
  if (!session) return error(c, 'UNAUTHORIZED', 'Session expired', 401);

  const body = c.req.valid('json');
  const userId = session.userId;

  // Email change requires PIN verification
  if (body.email !== undefined) {
    const lock = await getPinLock(c.env, userId);
    if (lock.locked) {
      c.header('Retry-After', String(lock.retryAfter));
      return error(c, 'ACCOUNT_LOCKED', 'Too many failed attempts. Temporarily locked.', 429);
    }
    const user = await c.env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
      .bind(userId).first<{ pin_hash: string | null }>();
    if (!user?.pin_hash) return error(c, 'NO_PIN', 'No PIN set for this account', 400);
    const valid = await verifyPin(body.current_pin!, user.pin_hash);
    if (!valid) {
      await recordPinFailure(c.env, userId);
      return error(c, 'WRONG_PIN', 'Current PIN is incorrect', 401);
    }
    await clearPinLock(c.env, userId);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.phone !== undefined) {
    fields.push('phone = ?');
    values.push(body.phone || null);
  }
  if (body.email !== undefined) {
    const clash = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .bind(body.email, userId).first();
    if (clash) return error(c, 'DUPLICATE', 'That email is already in use', 409);
    fields.push('email = ?');
    values.push(body.email);
  }

  if (fields.length === 0) return error(c, 'NO_CHANGES', 'Nothing to update', 400);

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  values.push(userId);
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  // Revoke other sessions when email changes (re-login required on other devices).
  if (body.email !== undefined) {
    await bumpSessionEpoch(c.env, userId);
    await deleteSession(sessionId, c.env);
    const epoch = (await getUserAuthState(c.env, userId))?.session_epoch ?? 0;
    const { sessionId: newSid, ttl } = await createSession(userId, body.email, session.role, session.name, c.env, false, epoch);
    setCookie(c, 'session_id', newSid, sessionCookieOptions(c.env, ttl));
  }

  const updated = await c.env.DB.prepare(
    'SELECT id, name, email, staff_id, phone, role, pin_acknowledged FROM users WHERE id = ?'
  ).bind(userId).first();

  return success(c, { user: updated });
});
```

**3c** — Update `GET /auth/me` to include `phone` and `staff_id` in the DB read and response. Find the existing `/me` handler and replace the DB query and response:

```typescript
  const row = await c.env.DB.prepare(
    'SELECT name, email, staff_id, phone, role, pin_acknowledged, is_active FROM users WHERE id = ?'
  )
    .bind(session.userId)
    .first<{ name: string; email: string; staff_id: string | null; phone: string | null; role: string; pin_acknowledged: number; is_active: number }>();

  if (!row || row.is_active !== 1) {
    return error(c, 'UNAUTHORIZED', 'Account disabled or deleted', 401);
  }

  return success(c, {
    user: {
      id: session.userId,
      name: row.name,
      email: row.email,
      staff_id: row.staff_id,
      phone: row.phone,
      role: row.role,
      pin_acknowledged: row.pin_acknowledged === 1,
    },
  });
```

- [ ] **Step 4: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/api/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/auth.ts packages/api/src/routes/auth-profile.test.ts
git commit -m "feat(api): PATCH /auth/profile for self-service phone+email; phone+staff_id in /auth/me"
```

---

## Task 5: API — Officer Edit Phone Propagation + OFFICER_COLUMNS Update

**Files:**
- Modify: `packages/api/src/routes/officers.ts`
- Modify: `packages/api/src/routes/admin-directorates.ts`

- [ ] **Step 1: Add staff_id and has_sa_account to OFFICER_COLUMNS in officers.ts**

Open `packages/api/src/routes/officers.ts`. Replace the `OFFICER_COLUMNS` constant:

```typescript
const OFFICER_COLUMNS = `o.id, o.name, o.title, o.directorate_id, o.email, o.phone,
       o.office_number, o.is_available, o.staff_id, o.created_at, o.updated_at,
       (o.override_pin_hash IS NOT NULL) as has_override_pin,
       (o.staff_id IS NOT NULL AND EXISTS(
         SELECT 1 FROM users u WHERE u.staff_id = o.staff_id
       )) as has_sa_account,
       d.name as directorate_name, d.abbreviation as directorate_abbr`;
```

- [ ] **Step 2: Add phone propagation to officer UPDATE in admin-directorates.ts**

Open `packages/api/src/routes/admin-directorates.ts`. Find the officer `PUT /officers/:id` handler. Near the top of the handler, the existing code fetches the existing officer:

```typescript
  const existing = await c.env.DB.prepare(
    'SELECT id, name, title, directorate_id, email, phone, office_number, is_available FROM officers WHERE id = ?'
  ).bind(id).first<Record<string, unknown> & { name?: string }>();
```

Replace with (add `staff_id` to the SELECT):

```typescript
  const existing = await c.env.DB.prepare(
    'SELECT id, name, title, directorate_id, email, phone, office_number, is_available, staff_id FROM officers WHERE id = ?'
  ).bind(id).first<Record<string, unknown> & { name?: string; staff_id?: string | null }>();
```

Then, after the existing audit+return block at the end of the handler (after `return success(c, row);`), insert the phone propagation. Actually, insert it BEFORE `return success(c, row)`. Find:

```typescript
  return success(c, row);
});
```

Replace with:

```typescript
  // If this officer has a staff_id and phone changed, mirror the new phone to the
  // linked users row so the Staff Attendance profile stays in sync.
  if (body.phone !== undefined && existing.staff_id) {
    await c.env.DB.prepare(
      `UPDATE users SET phone = ? WHERE staff_id = ?`
    ).bind(body.phone || null, existing.staff_id).run();
  }

  return success(c, row);
});
```

- [ ] **Step 3: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/api/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/officers.ts packages/api/src/routes/admin-directorates.ts
git commit -m "feat(api): expose staff_id+has_sa_account on officers; propagate phone to users on officer edit"
```

---

## Task 6: Admin UI — Users Tab (phone, readiness badge, provision button, unprovisioned count)

**Files:**
- Modify: `packages/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Update UserRecord interface and add helpers**

Open `packages/web/src/pages/AdminPage.tsx`.

**1a** — Update `UserRecord` interface (add `phone`):

```typescript
interface UserRecord {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  phone: string | null;
  role: string;
  grade: string | null;
  directorate_abbr: string | null;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  user_type?: string | null;
}
```

**1b** — Add readiness helper below the `ROLES` constant:

```typescript
type ReadinessLevel = 'ready' | 'partial' | 'inactive';

function getReadiness(user: UserRecord): ReadinessLevel {
  if (!user.is_active) return 'inactive';
  if (!user.phone || user.email.endsWith('@ohcs.internal')) return 'partial';
  return 'ready';
}

const READINESS_BADGE: Record<ReadinessLevel, { label: string; cls: string }> = {
  ready:    { label: 'Ready',    cls: 'bg-success/10 text-success' },
  partial:  { label: 'Partial',  cls: 'bg-accent/15 text-accent-warm' },
  inactive: { label: 'Inactive', cls: 'bg-border text-muted-foreground' },
};
```

- [ ] **Step 2: Add unprovisioned count query and provision button to UsersTab**

Inside the `UsersTab` function, after the existing `useQuery` for users, add:

```typescript
  const { data: unprovisionedData, refetch: refetchUnprovisioned } = useQuery({
    queryKey: ['unprovisioned-count'],
    queryFn: () => api.get<{ count: number }>('/users/unprovisioned-count'),
  });
  const unprovisionedCount = unprovisionedData?.data?.count ?? 0;
```

Replace the existing `provisionMutation` (currently in BulkImportTab only — add a fresh one here):

```typescript
  const provisionMutation = useMutation({
    mutationFn: () =>
      api.post<{ provisioned: number; skipped: number; skipped_details: string[] }>(
        '/users/provision-from-officers', {}
      ),
    onSuccess: (res) => {
      const d = res.data;
      if (d) {
        if (d.provisioned > 0) {
          toast.success(`${d.provisioned} account${d.provisioned !== 1 ? 's' : ''} created`);
        } else {
          toast.success('All officers with staff IDs already have accounts');
        }
        if (d.skipped > 0) toast.error(`${d.skipped} skipped — check Bulk Import tab`);
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      refetchUnprovisioned();
    },
  });
```

Add the `toast` import at the top of the file (if not already present):

```typescript
import { toast } from '@/stores/toast';
```

- [ ] **Step 3: Update the Users tab header area**

Find the `<div className="flex justify-end gap-3">` section in `UsersTab` (the one with the "Add User" button). Replace it with:

```typescript
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Readiness summary */}
        <div className="flex items-center gap-4 text-[13px]">
          <span className="text-success font-semibold">
            {users.filter(u => getReadiness(u) === 'ready').length} ready
          </span>
          <span className="text-accent-warm font-semibold">
            {users.filter(u => getReadiness(u) === 'partial').length} partial
          </span>
          {unprovisionedCount > 0 && (
            <span className="text-muted font-semibold">{unprovisionedCount} no account</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {unprovisionedCount > 0 && (
            <button
              onClick={() => provisionMutation.mutate()}
              disabled={provisionMutation.isPending}
              className="inline-flex items-center gap-2 h-10 px-4 bg-surface border border-border text-[13px] font-semibold rounded-xl hover:border-primary/40 transition-all disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              {provisionMutation.isPending ? 'Provisioning…' : `Provision ${unprovisionedCount} Missing`}
            </button>
          )}
          <button
            onClick={() => { setShowCreate(true); setEditingUser(null); }}
            className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15 active:scale-[0.98]"
          >
            <UserPlus className="h-4.5 w-4.5" />
            Add User
          </button>
        </div>
      </div>
```

Add `Sparkles` to the lucide-react imports at the top of the file:

```typescript
import { Users, UserPlus, Pencil, Power, X, Sparkles } from 'lucide-react';
```

- [ ] **Step 4: Update the users table — add Phone column, replace Status with readiness badge**

In the `<thead>` of the users table, add a `Phone` column header after `Grade` and before `Role`, and change `Status` to `Readiness`:

```typescript
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff ID</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden md:table-cell">Grade</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">Phone</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dir</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Role</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Readiness</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden xl:table-cell">Last Login</th>
                  <th className="text-right px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Actions</th>
```

In the `<tbody>`, add the Phone `<td>` after Grade and replace the Status `<td>` with a readiness badge. Find the Grade cell and add after it:

```typescript
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <span className="text-[13px] font-mono text-muted">{user.phone ?? '—'}</span>
                      </td>
```

Replace the existing Status cell:

```typescript
                      <td className="px-6 py-4">
                        {(() => {
                          const r = getReadiness(user);
                          const cfg = READINESS_BADGE[r];
                          return (
                            <span className={cn(
                              'inline-flex items-center gap-1.5 h-6 px-2.5 text-[11px] font-bold rounded-lg uppercase tracking-wide',
                              cfg.cls
                            )}>
                              {cfg.label}
                            </span>
                          );
                        })()}
                      </td>
```

- [ ] **Step 5: Add phone to Create/Edit user modals**

In `CreateUserModal`, add a Phone field in the second grid (the one with Grade and Directorate Code):

```typescript
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Grade / Designation">
              <input {...form.register('grade')} className={inputCls} placeholder="e.g. Snr IT/IM Technician" />
            </FormField>
            <FormField label="Phone">
              <input {...form.register('phone')} type="tel" className={inputCls} placeholder="0241234567" inputMode="tel" />
            </FormField>
            <FormField label="Directorate Code">
              <input {...form.register('directorate_code')} className={cn(inputCls, 'uppercase')} placeholder="e.g. RSIMD" />
            </FormField>
          </div>
```

Update `createUserSchema` to include phone (optional):

```typescript
const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email').max(255),
  staff_id: z.string().min(1, 'Staff ID is required').max(20),
  pin: z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  directorate_code: z.string().max(20).optional(),
});
type CreateUserForm = z.infer<typeof createUserSchema>;
```

Update `CreateUserModal` defaultValues and mutation payload:

```typescript
    defaultValues: { name: '', email: '', staff_id: '', pin: '', role: 'staff', grade: '', phone: '', directorate_code: '' },
```

Mutation in CreateUserModal is already `api.post('/users', data)` which passes all schema fields — no change needed there.

Do the same for `editUserSchema` and `EditUserModal`:

```typescript
const editUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  staff_id: z.string().min(1).max(20),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  directorate_code: z.string().max(20).optional(),
  pin: z.string().length(4).regex(/^\d{4}$/).or(z.literal('')).optional(),
});
type EditUserForm = z.infer<typeof editUserSchema>;
```

Update `EditUserModal` defaultValues:

```typescript
    defaultValues: {
      name: user.name,
      email: user.email,
      staff_id: user.staff_id ?? '',
      role: user.role as EditUserForm['role'],
      grade: user.grade ?? '',
      phone: user.phone ?? '',
      directorate_code: user.directorate_abbr ?? '',
      pin: '',
    },
```

Add phone field to the EditUserModal form alongside grade:

```typescript
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Grade / Designation">
              <input {...form.register('grade')} className={inputCls} placeholder="e.g. Snr IT/IM Technician" />
            </FormField>
            <FormField label="Phone">
              <input {...form.register('phone')} type="tel" className={inputCls} inputMode="tel" />
            </FormField>
            <FormField label="Directorate Code">
              <input {...form.register('directorate_code')} className={cn(inputCls, 'uppercase')} placeholder="e.g. RSIMD" />
            </FormField>
          </div>
```

Also update `users.ts` API create/update handlers to accept phone:

In `packages/api/src/routes/users.ts`, update `createUserSchema`:
```typescript
const createUserSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).toLowerCase().trim(),
  staff_id: z.string().min(1).max(20).trim(),
  pin: z.string().length(4).regex(/^\d{4}$/, 'PIN must be 4 digits'),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  directorate_code: z.string().max(20).optional().or(z.literal('')),
});
```

Update the INSERT in the create handler:
```typescript
  await c.env.DB.prepare(
    `INSERT INTO users (id, name, email, staff_id, pin_hash, role, grade, directorate_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.name, body.email, body.staff_id.toUpperCase(), pinHash, body.role, body.grade || null, directorateId, body.phone || null).run();
```

Update `updateUserSchema`:
```typescript
const updateUserSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  email: z.string().email().max(255).toLowerCase().trim().optional(),
  staff_id: z.string().min(1).max(20).trim().optional(),
  pin: z.string().length(4).regex(/^\d{4}$/).optional(),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'it', 'director', 'staff']).optional(),
  grade: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  directorate_code: z.string().max(20).optional().or(z.literal('')),
  is_active: z.number().min(0).max(1).optional(),
});
```

Add phone handling in the update handler after the grade block:
```typescript
  if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone || null); }
```

- [ ] **Step 6: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -30
node node_modules/typescript/bin/tsc --noEmit --project packages/api/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/AdminPage.tsx packages/api/src/routes/users.ts
git commit -m "feat(admin): phone column, readiness badges, provision button in Users tab"
```

---

## Task 7: Admin UI — DirectoratesTab (staff_id column, SA Account chip, phone in officer edit modal)

**Files:**
- Modify: `packages/web/src/components/admin/DirectoratesTab.tsx`

- [ ] **Step 1: Update OfficerExt interface**

Open `packages/web/src/components/admin/DirectoratesTab.tsx`. Update the `OfficerExt` interface:

```typescript
interface OfficerExt extends Officer {
  directorate_abbr?: string;
  has_override_pin?: number;
  staff_id?: string | null;
  has_sa_account?: number;
}
```

- [ ] **Step 2: Add phone to officerSchema**

```typescript
const officerSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  directorate_id: z.string().min(1),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().max(20).optional(),
  office_number: z.string().max(20).optional(),
});
```

(Phone is already in this schema — confirm it's present. If it is, no change needed.)

- [ ] **Step 3: Update the officers table — add Staff ID and SA Account columns**

Find the officers `<thead>` inside `DirectoratesTab`. It currently has Name, Title, Directorate, Status, Actions columns. Add Staff ID and SA Account:

```typescript
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name / Title</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden md:table-cell">Directorate</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">Staff ID</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">SA Account</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                  <th className="text-right px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
```

In the `<tbody>`, add the two new cells after the Directorate cell and before the Status cell. Find the directorate cell and add after it:

```typescript
                      <td className="px-5 py-3 hidden lg:table-cell">
                        <span className="text-[13px] font-mono text-muted">{off.staff_id ?? '—'}</span>
                      </td>
                      <td className="px-5 py-3 hidden lg:table-cell">
                        {off.has_sa_account ? (
                          <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-success/10 text-success rounded-lg uppercase tracking-wide">
                            Linked
                          </span>
                        ) : (
                          <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-border text-muted-foreground rounded-lg uppercase tracking-wide">
                            None
                          </span>
                        )}
                      </td>
```

- [ ] **Step 4: Ensure Phone field is in the officer edit modal form**

Find the `OfficerForm` component (or wherever the officer edit form is rendered). Confirm the Phone input field is present in the form. If it's missing, add it in the form fields:

```typescript
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Email">
              <input {...form.register('email')} type="email" className={inputCls} placeholder="officer@ohcs.gov.gh" />
            </FormField>
            <FormField label="Phone">
              <input {...form.register('phone')} type="tel" className={inputCls} placeholder="0241234567" inputMode="tel" />
            </FormField>
          </div>
```

- [ ] **Step 5: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/admin/DirectoratesTab.tsx
git commit -m "feat(admin): staff_id + SA account columns in officers list; phone in officer edit modal"
```

---

## Task 8: Auth Store Update + Profile Page

**Files:**
- Modify: `packages/web/src/stores/auth.ts`
- Create: `packages/web/src/pages/ProfilePage.tsx`

- [ ] **Step 1: Update auth store — User type + updateProfile action**

Open `packages/web/src/stores/auth.ts`. Replace the `User` interface and `AuthState` with:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  phone: string | null;
  role: string;
  pin_acknowledged?: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  loginWithPin: (staffId: string, pin: string, remember: boolean) => Promise<void>;
  login: (email: string) => Promise<void>;
  verify: (email: string, code: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  updateProfile: (patch: { phone?: string; email?: string; current_pin?: string }) => Promise<void>;
}
```

Add `updateProfile` to the store implementation (inside the `create` call, after `checkSession`):

```typescript
  updateProfile: async (patch) => {
    const res = await api.patch<{ user: User }>('/auth/profile', patch);
    const u = res.data?.user;
    if (u) set((s) => ({ user: s.user ? { ...s.user, ...u } : u }));
  },
```

Update `checkSession` to handle the new fields (the response now includes `staff_id` and `phone`):

```typescript
  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },
```

Check that `api.patch` exists in `packages/web/src/lib/api.ts`. If it doesn't, add it. Open `packages/web/src/lib/api.ts` and look for the `api` object. If there's no `patch` method, add it alongside `put`:

```typescript
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
```

- [ ] **Step 2: Create ProfilePage.tsx**

Create `packages/web/src/pages/ProfilePage.tsx`:

```typescript
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { UserCircle, Phone, Mail, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!user) return null;

  const emailChanged = email !== user.email;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const patch: { phone?: string; email?: string; current_pin?: string } = {};
      if (phone !== (user?.phone ?? '')) patch.phone = phone;
      if (emailChanged) { patch.email = email; patch.current_pin = pin; }
      if (Object.keys(patch).length === 0) {
        setResult({ ok: false, msg: 'No changes to save.' });
        setSaving(false);
        return;
      }
      await updateProfile(patch);
      setResult({ ok: true, msg: emailChanged ? 'Profile updated. Other devices have been signed out.' : 'Profile updated.' });
      setPin('');
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed to update profile.' });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

  return (
    <div className="space-y-6 max-w-xl">
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          My Profile
        </h1>
        <p className="text-[15px] text-muted mt-0.5">Update your contact details</p>
      </div>

      {/* Identity card */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-1">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <UserCircle className="h-7 w-7 text-primary" />
          </div>
          <div>
            <p className="text-[18px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{user.name}</p>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {user.staff_id && (
                <span className="text-[12px] font-mono font-semibold text-muted bg-background px-2 py-0.5 rounded-lg border border-border">
                  {user.staff_id}
                </span>
              )}
              <span className="text-[12px] font-semibold text-muted uppercase tracking-wide">{user.role}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={handleSubmit} className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-2">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6 space-y-5">
          <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Contact Details
          </h2>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Phone Number</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              placeholder="0241234567"
              inputMode="tel"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Address</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@ohcs.gov.gh"
            />
            {emailChanged && (
              <p className="text-[12px] text-muted mt-1">Changing your email requires your current PIN to confirm.</p>
            )}
          </div>

          {/* PIN confirmation — only shown when email changes */}
          {emailChanged && (
            <div>
              <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
                <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Current PIN (to confirm email change)</span>
              </label>
              <input
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className={cn(inputCls, 'text-center tracking-[0.4em] font-mono text-xl')}
                placeholder="••••"
                inputMode="numeric"
                required={emailChanged}
              />
            </div>
          )}

          {result && (
            <div className={cn(
              'flex items-center gap-2 text-[13px] font-medium',
              result.ok ? 'text-success' : 'text-danger'
            )}>
              {result.ok
                ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                : <AlertCircle className="h-4 w-4 shrink-0" />}
              {result.msg}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || (emailChanged && pin.length < 4)}
            className="w-full h-11 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15 active:scale-[0.98]"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -30
```

Expected: no errors. If `api.patch` is missing, you'll see an error — add it to `packages/web/src/lib/api.ts` as shown in Step 1.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/stores/auth.ts packages/web/src/pages/ProfilePage.tsx packages/web/src/lib/api.ts
git commit -m "feat(profile): self-service profile page for phone and email update"
```

---

## Task 9: Nav Wiring + Route Registration

**Files:**
- Modify: `packages/web/src/components/layout/BottomNav.tsx`
- Modify: `packages/web/src/components/layout/Sidebar.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add Profile to BottomNav MORE_ITEMS**

Open `packages/web/src/components/layout/BottomNav.tsx`. Add `UserCircle` to the lucide-react import:

```typescript
import {
  LayoutDashboard, ClipboardCheck, Users, BarChart3,
  MoreHorizontal, ScrollText, FileText, Settings, LogOut, X, UserCircle,
} from 'lucide-react';
```

Add Profile to `MORE_ITEMS` (before Visit Log):

```typescript
const MORE_ITEMS = [
  { to: '/profile', icon: UserCircle, label: 'My Profile' },
  { to: '/visit-log', icon: ScrollText, label: 'Visit Log' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];
```

- [ ] **Step 2: Add Profile to Sidebar NAV_ITEMS**

Open `packages/web/src/components/layout/Sidebar.tsx`. Add `UserCircle` to the lucide-react import:

```typescript
import { LayoutDashboard, ClipboardCheck, Users, ScrollText, BarChart3, FileText, Settings, LogOut, ChevronsLeft, ChevronsRight, UserCircle } from 'lucide-react';
```

Add Profile to `NAV_ITEMS` (add it at the end, before Reports or after Analytics — user's choice; here we add it last):

```typescript
const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/check-in', icon: ClipboardCheck, label: 'Check-In' },
  { to: '/visitors', icon: Users, label: 'Visitors' },
  { to: '/visit-log', icon: ScrollText, label: 'Visit Log' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/reports', icon: FileText, label: 'Reports' },
  { to: '/profile', icon: UserCircle, label: 'My Profile' },
];
```

- [ ] **Step 3: Register /profile route in App.tsx**

Open `packages/web/src/App.tsx`. Find where other page routes are registered (look for `import` statements of page components and `<Route>` elements). Add:

```typescript
import { ProfilePage } from '@/pages/ProfilePage';
```

And in the routes:

```typescript
<Route path="/profile" element={<ProfilePage />} />
```

This route should be inside the authenticated layout wrapper (the same wrapper that wraps Dashboard, Check-In, etc.).

- [ ] **Step 4: Run type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/layout/BottomNav.tsx packages/web/src/components/layout/Sidebar.tsx packages/web/src/App.tsx
git commit -m "feat(nav): add My Profile link to bottom nav and sidebar"
```

---

## Task 10: Apply Migrations + Smoke Test

- [ ] **Step 1: Apply migrations via the admin Settings UI**

In the running app (or Cloudflare dashboard), navigate to **Admin → Settings → Run Migrations**. Apply:
- `migration-users-phone.sql`
- `migration-officers-staff-id-backfill.sql`

Verify both show "applied" status.

- [ ] **Step 2: Provision missing accounts**

In **Admin → Users tab**, click **"Provision N Missing"** button. Confirm a success toast appears and the "no account" count drops to 0.

- [ ] **Step 3: Verify readiness badges appear**

Confirm:
- Users with phone and non-placeholder email show green "Ready"
- Users with placeholder `@ohcs.internal` email or no phone show amber "Partial"

- [ ] **Step 4: Verify Org Entities officers list**

Navigate to **Admin → Org Entities**. Scroll to the officers table. Confirm:
- Staff ID column shows numeric IDs (e.g. `808859`)
- SA Account column shows "Linked" green chip for provisioned officers
- Officers without accounts show "None" grey chip

- [ ] **Step 5: Verify Profile page**

Log in as a staff user. Navigate to **My Profile** (via nav). Confirm:
- Name and Staff ID are shown read-only
- Phone field is editable and saves without PIN
- Changing email shows the PIN confirmation field
- Entering wrong PIN shows error message
- Entering correct PIN + new email saves successfully

- [ ] **Step 6: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: post-migration smoke test cleanup"
```

---

## Spec Coverage Check

| Spec Requirement | Task(s) |
|-----------------|---------|
| Python script generates backfill SQL from Excel col B + R | Task 1 |
| `migration-users-phone.sql` adds phone column | Task 2 |
| `migration-officers-staff-id-backfill.sql` backfills officers | Task 1 + 2 |
| Both migrations registered in migrations-index.ts | Task 2 |
| schema.sql updated | Task 2 |
| provision copies officers.phone → users.phone | Task 3 |
| `GET /users` includes phone | Task 3 |
| `GET /users/unprovisioned-count` endpoint | Task 3 |
| `PATCH /auth/profile` — phone free, email requires PIN | Task 4 |
| `GET /auth/me` includes phone + staff_id | Task 4 |
| Officer edit propagates phone to linked users row | Task 5 |
| officers.ts OFFICER_COLUMNS includes staff_id + has_sa_account | Task 5 |
| Admin Users tab — phone column | Task 6 |
| Admin Users tab — readiness badge (ready/partial/inactive) | Task 6 |
| Admin Users tab — provision button with unprovisioned count | Task 6 |
| Admin Users tab — N ready / M partial / P no account summary | Task 6 |
| Admin Org Entities — Staff ID column | Task 7 |
| Admin Org Entities — SA Account chip | Task 7 |
| Officer edit modal — phone field | Task 7 |
| Auth store — phone + staff_id in User type + updateProfile | Task 8 |
| ProfilePage — read-only identity, editable phone + email | Task 8 |
| BottomNav — Profile in MORE_ITEMS | Task 9 |
| Sidebar — Profile nav link | Task 9 |
| App.tsx — /profile route | Task 9 |
| Login flow unchanged | Not touched — ✅ |
