# Reception Team + Telegram Deep-Link Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a directorate's reception *team* (primary + others) reachable on Telegram via a one-time per-officer deep link, and privately fan out the visitor-arrival alert to the whole team on kiosk check-ins.

**Architecture:** A `directorate_receivers` join table (team) alongside the existing `reception_officer_id` (primary). A bot `/start <token>` deep-link handler links any officer's Telegram with no account needed. On kiosk check-ins, `notifyOnCheckIn` fans out the existing private host alert to each other receiver via a shared per-officer helper (reusing the Spec-A hardened, non-throwing send path). Admin manages the team + link status + generates deep links.

**Tech Stack:** Cloudflare Workers (Hono), D1, KV; React 18 + react-hook-form + TanStack Query; vitest (pure-function tests).

**Reference spec:** `docs/superpowers/specs/2026-06-18-reception-team-telegram-deeplink-design.md`

**Toolchain note (repo path has a space + `&`):** never `npm run`; from `packages/api` or `packages/web`:
- type-check: `node ../../node_modules/typescript/bin/tsc --noEmit`
- tests: `node ../../node_modules/vitest/vitest.mjs run <file>`
- web build: `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build`
- wrangler local D1 (from `packages/api`): `node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=<sql>`

**Verified current code:**
- `directorates.reception_officer_id` (PR #9). Admin `PUT /api/admin/directorates/:id` accepts `reception_officer_id` with a same-directorate check (`routes/admin-directorates.ts`). `routes/admin-directorates.ts` imports `{ success, error, created, notFound }` and uses `zValidator`, `z`, `requireSuperadmin(c)`, `crypto`.
- `services/notifier.ts`: `notifyOnCheckIn(data: VisitNotifyData, env)` (line 58) → `notifyHostStaff(data,env)` (line 62, fetches officer + Telegram + in-app, with Spec-A `recordNotifyOutcome` + unreachable log) → optional `notifyDirectorateLeadership`. `VisitNotifyData` (line 11) has `host_officer_id`, `directorate_id`, etc. but NOT `check_in_source`. `findUserByOfficer`, `createInAppNotification`, `formatVisitorMessage(data,'host'|'director')`, `recordNotifyOutcome` exist.
- `services/check-in.ts`: `performCheckIn` fires `ctx.waitUntil(notifyOnCheckIn({ visit_id, host_officer_id, ...directorate_id, directorate_abbr }, env))` only when `host_officer_id` set; `CheckInParams.check_in_source` is `'staff'|'kiosk'`.
- `services/telegram.ts`: `telegramWebhook` handles `if (text === '/start')` (greeting), `/link`, `/admin`, `/stop`; uses `c.env.DB`, `c.env.KV`, `c.env.TELEGRAM_BOT_TOKEN`.
- `Env` (`types.ts`) has `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET?` — no bot username.
- Web `api` client (`packages/web/src/lib/api.ts`) has `get`, `post`, `put` (no `del` yet). `components/admin/DirectoratesTab.tsx` loads `/directorates` + `/officers` and renders the per-row primary picker (PR #9).

---

## File Structure

**Create:**
- `packages/api/src/db/migration-directorate-receivers.sql` — team table + backfill primaries.
- `packages/api/src/services/notifier.test.ts` — `selectFanoutReceivers` unit tests.
- `packages/api/src/services/telegram.test.ts` already exists (Spec A) — extend with `parseStartToken` tests.

**Modify:**
- `packages/api/src/db/migrations-index.ts`, `schema.sql` — register table.
- `packages/api/wrangler.toml`, `packages/api/src/types.ts` — `TELEGRAM_BOT_USERNAME`.
- `packages/api/src/services/telegram.ts` — `parseStartToken` + `/start <token>` deep-link handler.
- `packages/api/src/routes/admin-directorates.ts` — link-token, unlink, receivers CRUD, tightened primary.
- `packages/api/src/services/notifier.ts` — `notifyOfficerOfVisit` helper + `selectFanoutReceivers` + kiosk fan-out; `VisitNotifyData.check_in_source`.
- `packages/api/src/services/check-in.ts` — pass `check_in_source` into `notifyOnCheckIn`.
- `packages/web/src/lib/api.ts` — add `del`; types.
- `packages/web/src/components/admin/DirectoratesTab.tsx` — team manager.

---

### Task 1: Migration — `directorate_receivers` (+ backfill primaries)

**Files:** Create `packages/api/src/db/migration-directorate-receivers.sql`; Modify `migrations-index.ts`, `schema.sql`.

- [ ] **Step 1: Create the migration**

`packages/api/src/db/migration-directorate-receivers.sql`:
```sql
-- The team of officers alerted (private DM + in-app) when a visitor self-routes to
-- this directorate at the kiosk. directorates.reception_officer_id (the primary) is
-- always also a row here. The backfill seeds existing primaries onto their teams.
CREATE TABLE IF NOT EXISTS directorate_receivers (
    directorate_id TEXT NOT NULL REFERENCES directorates(id),
    officer_id     TEXT NOT NULL REFERENCES officers(id),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (directorate_id, officer_id)
);

INSERT OR IGNORE INTO directorate_receivers (directorate_id, officer_id)
SELECT id, reception_officer_id FROM directorates WHERE reception_officer_id IS NOT NULL;
```

- [ ] **Step 2: Register in `migrations-index.ts`** — import + LAST array entry:
```ts
import directorateReceivers from './migration-directorate-receivers.sql';
```
```ts
  { filename: 'migration-directorate-receivers.sql', sql: directorateReceivers },
```

- [ ] **Step 3: Add to `schema.sql`** — append the `CREATE TABLE directorate_receivers (...)` block (same columns/PK as the migration) near the other join/index tables.

- [ ] **Step 4: Apply LOCAL + verify** (from `packages/api`):
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --file=src/db/migration-directorate-receivers.sql
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='directorate_receivers'"
```
Expected: one row `directorate_receivers`. (Remote apply at deploy — confirmed step.)

- [ ] **Step 5: Type-check + commit**

`node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
```
git add packages/api/src/db/migration-directorate-receivers.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): add directorate_receivers team table + backfill primaries"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 2: Bot username config + deep-link `/start <token>` (TDD)

**Files:** Modify `packages/api/wrangler.toml`, `packages/api/src/types.ts`, `packages/api/src/services/telegram.ts`, `packages/api/src/services/telegram.test.ts`.

- [ ] **Step 1: Add the config var**

In `packages/api/src/types.ts`, add to the `Env` interface (near `TELEGRAM_BOT_TOKEN`):
```ts
  TELEGRAM_BOT_USERNAME: string;
```
In `packages/api/wrangler.toml`, under `[vars]`, add (PLACEHOLDER — the real bot @username, without `@`, must be set before deploy; see Deployment):
```toml
TELEGRAM_BOT_USERNAME = "REPLACE_WITH_BOT_USERNAME"
```
Also add the same line under `[env.dev.vars]`.

- [ ] **Step 2: Write the failing test** — append to `packages/api/src/services/telegram.test.ts`:
```ts
import { parseStartToken } from './telegram';

describe('parseStartToken', () => {
  it('extracts the token after /start', () => {
    expect(parseStartToken('/start abc123')).toBe('abc123');
  });
  it('takes only the first whitespace-delimited token', () => {
    expect(parseStartToken('/start abc def')).toBe('abc');
  });
  it('returns null for bare /start', () => {
    expect(parseStartToken('/start')).toBeNull();
    expect(parseStartToken('/start   ')).toBeNull();
  });
  it('returns null for non-start text', () => {
    expect(parseStartToken('/link 123')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it — confirm FAIL** (`parseStartToken` not exported). From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/services/telegram.test.ts`.

- [ ] **Step 4: Implement `parseStartToken` + the deep-link handler in `services/telegram.ts`**

Add the exported helper (top-level, near the other exports):
```ts
export function parseStartToken(text: string): string | null {
  if (!text.startsWith('/start')) return null;
  const rest = text.slice('/start'.length).trim();
  if (!rest) return null;
  return rest.split(/\s+/)[0] ?? null;
}
```
Replace the existing `if (text === '/start') { ... }` block with one that handles a deep-link payload first, then falls back to the greeting:
```ts
  if (text === '/start' || text.startsWith('/start ')) {
    const startToken = parseStartToken(text);
    if (startToken) {
      const officerId = await c.env.KV.get(`officer-link:${startToken}`);
      if (officerId) {
        await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?')
          .bind(String(chatId), officerId).run();
        await c.env.KV.delete(`officer-link:${startToken}`);
        const row = await c.env.DB.prepare(
          `SELECT o.name, d.abbreviation AS dir FROM officers o
           LEFT JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
        ).bind(officerId).first<{ name: string; dir: string | null }>();
        await sendTelegramMessage({
          chatId: String(chatId),
          text: `✅ <b>Linked!</b>\n\n${row?.name ?? 'You'} will now receive visitor arrival alerts${row?.dir ? ` for ${row.dir}` : ''}.`,
          token: c.env.TELEGRAM_BOT_TOKEN,
        });
        return c.json({ ok: true });
      }
      // invalid/expired token → fall through to the greeting (no error leak)
    }
    await sendTelegramMessage({
      chatId: String(chatId),
      text: [
        `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot</b>`,
        '',
        `Link your account to receive visitor notifications and daily attendance summaries.`,
        '',
        `<b>Commands:</b>`,
        `/link 1334685 — Link your Staff ID`,
        `/admin — Get daily attendance reports`,
        `/stop — Unsubscribe`,
        '',
        `Just send /link followed by your Staff ID to get started.`,
      ].join('\n'),
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }
```
(Reuse the EXACT greeting text already in the file — copy it verbatim from the current `/start` block.)

- [ ] **Step 5: Run tests — PASS.** `node ../../node_modules/vitest/vitest.mjs run src/services/telegram.test.ts`; then `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**
```
git add packages/api/wrangler.toml packages/api/src/types.ts packages/api/src/services/telegram.ts packages/api/src/services/telegram.test.ts
git commit -m "feat(telegram): officer deep-link linking via /start <token> + bot username config"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 3: Admin endpoints — link token, unlink, receivers CRUD, primary invariant

**Files:** Modify `packages/api/src/routes/admin-directorates.ts`.

- [ ] **Step 1: Link-token + unlink endpoints**

Add (after the existing officer routes; `requireSuperadmin`, `error`, `notFound`, `success`, `created`, `crypto` are in scope):
```ts
// Generate a one-time Telegram deep-link for an officer (superadmin).
adminDirectorateRoutes.post('/officers/:id/link-token', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE id = ?').bind(id).first();
  if (!officer) return notFound(c, 'Officer');
  const token = crypto.randomUUID().replace(/-/g, '');
  await c.env.KV.put(`officer-link:${token}`, id, { expirationTtl: 7 * 86400 });
  const url = `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
  return success(c, { url, token });
});

// Revoke an officer's Telegram link (superadmin).
adminDirectorateRoutes.delete('/officers/:id/telegram', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = NULL WHERE id = ?').bind(id).run();
  return success(c, { unlinked: true });
});
```

- [ ] **Step 2: Receivers CRUD**
```ts
// List a directorate's receiver team with link + primary state (superadmin).
adminDirectorateRoutes.get('/:id/receivers', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const dir = await c.env.DB.prepare('SELECT reception_officer_id FROM directorates WHERE id = ?')
    .bind(id).first<{ reception_officer_id: string | null }>();
  if (!dir) return notFound(c, 'Directorate');
  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.name, (o.telegram_chat_id IS NOT NULL) AS linked
     FROM directorate_receivers dr JOIN officers o ON dr.officer_id = o.id
     WHERE dr.directorate_id = ? ORDER BY o.name`
  ).bind(id).all<{ id: string; name: string; linked: number }>();
  const receivers = (rows.results ?? []).map((r) => ({
    id: r.id, name: r.name, linked: !!r.linked, primary: r.id === dir.reception_officer_id,
  }));
  return success(c, receivers);
});

const addReceiverSchema = z.object({ officer_id: z.string().min(1) });
adminDirectorateRoutes.post('/:id/receivers', zValidator('json', addReceiverSchema), async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const { officer_id } = c.req.valid('json');
  const officer = await c.env.DB.prepare('SELECT directorate_id FROM officers WHERE id = ?')
    .bind(officer_id).first<{ directorate_id: string }>();
  if (!officer) return error(c, 'INVALID_OFFICER', 'Officer not found', 400);
  if (officer.directorate_id !== id) return error(c, 'INVALID_OFFICER', 'Officer must belong to this directorate', 400);
  await c.env.DB.prepare('INSERT OR IGNORE INTO directorate_receivers (directorate_id, officer_id) VALUES (?, ?)')
    .bind(id, officer_id).run();
  return created(c, { officer_id });
});

adminDirectorateRoutes.delete('/:id/receivers/:officerId', async (c) => {
  if (!requireSuperadmin(c)) return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const id = c.req.param('id');
  const officerId = c.req.param('officerId');
  await c.env.DB.prepare('DELETE FROM directorate_receivers WHERE directorate_id = ? AND officer_id = ?')
    .bind(id, officerId).run();
  // Removing the primary clears the pointer (keeps the "primary is on the team" invariant).
  await c.env.DB.prepare('UPDATE directorates SET reception_officer_id = NULL WHERE id = ? AND reception_officer_id = ?')
    .bind(id, officerId).run();
  return success(c, { removed: true });
});
```

- [ ] **Step 3: Tighten the primary setter (in the existing `PUT /:id` handler)**

Find the `if (body.reception_officer_id !== undefined) { ... }` block added in PR #9 (it currently checks the officer belongs to the directorate). Replace its validation with a **receiver-membership** check:
```ts
  if (body.reception_officer_id !== undefined) {
    const recId = body.reception_officer_id || null;
    if (recId !== null) {
      const member = await c.env.DB.prepare(
        'SELECT 1 FROM directorate_receivers WHERE directorate_id = ? AND officer_id = ?'
      ).bind(id, recId).first();
      if (!member) return error(c, 'NOT_A_RECEIVER', 'Add the officer to the team before making them primary', 400);
    }
    fields.push('reception_officer_id = ?');
    values.push(recId);
  }
```
(A receiver is already guaranteed same-directorate by the POST `/:id/receivers` validation, so this is strictly stronger than the old check.)

- [ ] **Step 4: Type-check + commit**

`node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
```
git add packages/api/src/routes/admin-directorates.ts
git commit -m "feat(admin): receiver-team CRUD, officer deep-link token + unlink, primary-on-team invariant"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 4: Kiosk fan-out to the team (TDD for selection)

**Files:** Create `packages/api/src/services/notifier.test.ts`; Modify `packages/api/src/services/notifier.ts`, `packages/api/src/services/check-in.ts`.

- [ ] **Step 1: Write the failing test** `packages/api/src/services/notifier.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { selectFanoutReceivers } from './notifier';

describe('selectFanoutReceivers', () => {
  it('excludes the host/primary', () => {
    const out = selectFanoutReceivers([{ officer_id: 'a' }, { officer_id: 'b' }], 'a');
    expect(out).toEqual(['b']);
  });
  it('dedupes officer ids', () => {
    const out = selectFanoutReceivers([{ officer_id: 'b' }, { officer_id: 'b' }, { officer_id: 'c' }], 'a');
    expect(out).toEqual(['b', 'c']);
  });
  it('returns empty when only the host is a receiver', () => {
    expect(selectFanoutReceivers([{ officer_id: 'a' }], 'a')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL** (`selectFanoutReceivers` not exported). `node ../../node_modules/vitest/vitest.mjs run src/services/notifier.test.ts`.

- [ ] **Step 3: Implement in `notifier.ts`**

Add `check_in_source` to `VisitNotifyData` (the interface near line 11):
```ts
  check_in_source?: 'staff' | 'kiosk';
```
Add the exported pure selector (top-level):
```ts
export function selectFanoutReceivers(receivers: { officer_id: string }[], hostOfficerId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of receivers) {
    if (r.officer_id === hostOfficerId || seen.has(r.officer_id)) continue;
    seen.add(r.officer_id);
    out.push(r.officer_id);
  }
  return out;
}
```
Extract the per-officer notify logic from `notifyHostStaff` into a shared helper, and make `notifyHostStaff` delegate (BEHAVIOUR UNCHANGED for the host):
```ts
async function notifyOfficerOfVisit(officerId: string, data: VisitNotifyData, env: Env): Promise<void> {
  const officer = await env.DB.prepare(
    'SELECT id, name, email, telegram_chat_id FROM officers WHERE id = ?'
  ).bind(officerId).first<{ id: string; name: string; email: string | null; telegram_chat_id: string | null }>();
  if (!officer) return;

  if (officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    const ok = await sendTelegramMessage({ chatId: officer.telegram_chat_id, text: formatVisitorMessage(data, 'host'), token: env.TELEGRAM_BOT_TOKEN });
    await recordNotifyOutcome(env, 'telegram', ok);
  }

  const user = await findUserByOfficer(officer, env);
  if (!officer.telegram_chat_id && !user) {
    console.warn(JSON.stringify({ kind: 'notify', channel: 'none', ok: false, detail: 'unreachable', officer_id: officer.id, visit_id: data.visit_id }));
  }
  if (user) {
    const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
    if (kvChatId && kvChatId !== officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      const ok = await sendTelegramMessage({ chatId: kvChatId, text: formatVisitorMessage(data, 'host'), token: env.TELEGRAM_BOT_TOKEN });
      await recordNotifyOutcome(env, 'telegram', ok);
    }
    await createInAppNotification(user.id, data, env);
  }
}

async function notifyHostStaff(data: VisitNotifyData, env: Env): Promise<void> {
  await notifyOfficerOfVisit(data.host_officer_id, data, env);
}
```
(Replace the existing `notifyHostStaff` body with the two functions above — the helper IS the old body, parameterised by `officerId`.)

In `notifyOnCheckIn`, after `await notifyHostStaff(data, env);` (line 62) and before the leadership block, add the kiosk fan-out:
```ts
  // --- 1b. Kiosk only: also alert the rest of the directorate's reception team ---
  if (data.check_in_source === 'kiosk' && data.directorate_id) {
    const rows = await env.DB.prepare('SELECT officer_id FROM directorate_receivers WHERE directorate_id = ?')
      .bind(data.directorate_id).all<{ officer_id: string }>();
    for (const officerId of selectFanoutReceivers(rows.results ?? [], data.host_officer_id)) {
      await notifyOfficerOfVisit(officerId, data, env);
    }
  }
```

- [ ] **Step 4: Pass `check_in_source` from `performCheckIn`**

In `packages/api/src/services/check-in.ts`, in the `ctx.waitUntil(notifyOnCheckIn({ ... }, env))` object, add:
```ts
        check_in_source: params.check_in_source,
```
(alongside the existing `host_officer_id`, `directorate_id`, etc.)

- [ ] **Step 5: Run tests + type-check**

`node ../../node_modules/vitest/vitest.mjs run src/services/notifier.test.ts` → 3 pass. `node ../../node_modules/vitest/vitest.mjs run` → all pass (no regression). `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**
```
git add packages/api/src/services/notifier.ts packages/api/src/services/notifier.test.ts packages/api/src/services/check-in.ts
git commit -m "feat(notify): fan out kiosk arrivals to the directorate reception team (private DM + in-app)"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 5: Admin UI — team manager in DirectoratesTab

**Files:** Modify `packages/web/src/lib/api.ts`, `packages/web/src/components/admin/DirectoratesTab.tsx`.

- [ ] **Step 1: Ensure the api client has `del`**

In `packages/web/src/lib/api.ts`, if there is no `del`/`delete` method, add one next to `put`:
```ts
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
```

- [ ] **Step 2: Replace the per-row "Reception" primary picker with a team manager**

In `packages/web/src/components/admin/DirectoratesTab.tsx`, replace the `ReceptionOfficerCell` (PR #9) with a `ReceptionTeamCell` that lists receivers and exposes add / remove / set-primary / generate-link / unlink. Add the component (uses `useQuery`/`useMutation`/`api`, all already imported; add `useState` if not imported):
```tsx
interface ReceiverRow { id: string; name: string; linked: boolean; primary: boolean }

function ReceptionTeamCell({ directorate, officers, onChanged }: {
  directorate: DirectorateExt;
  officers: OfficerExt[];
  onChanged: () => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: ['dir-receivers', directorate.id],
    queryFn: () => api.get<ReceiverRow[]>(`/admin/directorates/${directorate.id}/receivers`),
  });
  const receivers = data?.data ?? [];
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const own = officers.filter((o) => o.directorate_id === directorate.id);
  const candidates = own.filter((o) => !receivers.some((r) => r.id === o.id));

  const after = () => { refetch(); onChanged(); };
  const addM = useMutation({ mutationFn: (officer_id: string) => api.post(`/admin/directorates/${directorate.id}/receivers`, { officer_id }), onSuccess: after });
  const delM = useMutation({ mutationFn: (officerId: string) => api.del(`/admin/directorates/${directorate.id}/receivers/${officerId}`), onSuccess: after });
  const primaryM = useMutation({ mutationFn: (reception_officer_id: string) => api.put(`/admin/directorates/${directorate.id}`, { reception_officer_id }), onSuccess: after });
  const linkM = useMutation({ mutationFn: (officerId: string) => api.post<{ url: string }>(`/admin/directorates/officers/${officerId}/link-token`, {}), onSuccess: (r) => setLinkUrl(r.data?.url ?? null) });
  const unlinkM = useMutation({ mutationFn: (officerId: string) => api.del(`/admin/directorates/officers/${officerId}/telegram`), onSuccess: after });

  return (
    <div className="space-y-1.5 min-w-[260px]">
      {receivers.length === 0 && <p className="text-[12px] text-muted">No receivers</p>}
      {receivers.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-foreground">{r.name}</span>
          {r.primary && <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">PRIMARY</span>}
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', r.linked ? 'bg-success/10 text-success' : 'bg-border text-muted')}>{r.linked ? 'TG ✓' : 'no TG'}</span>
          {!r.primary && <button onClick={() => primaryM.mutate(r.id)} className="text-[11px] text-primary hover:underline">make primary</button>}
          <button onClick={() => linkM.mutate(r.id)} className="text-[11px] text-accent-warm hover:underline">generate link</button>
          {r.linked && <button onClick={() => unlinkM.mutate(r.id)} className="text-[11px] text-muted hover:text-danger">unlink</button>}
          <button onClick={() => delM.mutate(r.id)} className="text-[11px] text-muted hover:text-danger ml-auto">remove</button>
        </div>
      ))}
      {candidates.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) addM.mutate(e.target.value); }}
          className="h-8 px-2 rounded-lg border border-border bg-background text-[12px]"
        >
          <option value="">+ add receiver…</option>
          {candidates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {linkUrl && (
        <div className="text-[11px]">
          <input readOnly value={linkUrl} onFocus={(e) => e.currentTarget.select()} className="w-full h-7 px-2 rounded border border-border bg-background font-mono" />
          <span className="text-muted">Copy &amp; send to the officer; they tap it once on their phone.</span>
        </div>
      )}
    </div>
  );
}
```
Update the directorates table: change the "Reception" column cell to render `<ReceptionTeamCell directorate={d} officers={officers} onChanged={() => queryClient.invalidateQueries({ queryKey: ['directorates-admin'] })} />`. Rename the header to "Reception team". Remove the old `ReceptionOfficerCell` component. Add `import { useState } from 'react'` if not present.

- [ ] **Step 3: Type-check + build**

From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`. (If TS flags `api.del` missing, Step 1 wasn't applied — add it.)

- [ ] **Step 4: Commit**
```
git add packages/web/src/lib/api.ts packages/web/src/components/admin/DirectoratesTab.tsx
git commit -m "feat(admin-ui): reception-team manager (add/remove, primary, link status + deep link)"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 6: Full verification (static)

**Files:** none.

- [ ] **Step 1:** From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run` → ALL pass (adds `parseStartToken` + `selectFanoutReceivers`; existing suite green). `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
- [ ] **Step 2:** From `packages/web`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/typescript/bin/tsc -b && node ../../node_modules/vite/bin/vite.js build` → `✓ built`.
- [ ] **Step 3:** Confirm local D1 has `directorate_receivers`:
```
node "C:\dev\Projects\OHCS SmartGate & Staff Attendance\node_modules\wrangler\bin\wrangler.js" d1 execute smartgate-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='directorate_receivers'"
```
- [ ] **Step 4:** Confirm staff-flow unchanged by reading the `notifier.ts` diff: the fan-out is gated on `data.check_in_source === 'kiosk'`; `notifyHostStaff` behaviour is identical (now delegates to `notifyOfficerOfVisit`). No commit.

---

## Deployment (controller-run, after merge — NOT a subagent task)

1. **Set the real bot username:** replace `TELEGRAM_BOT_USERNAME = "REPLACE_WITH_BOT_USERNAME"` in `wrangler.toml` with the actual bot @username (no `@`) — ASK THE USER for it; the deep links are wrong until this is correct.
2. **Remote D1 migration FIRST** (confirm): apply `migration-directorate-receivers.sql` with `--remote`, record in `applied_migrations`, verify the table + that the backfill seeded existing primaries. Additive/new table — safe; the kiosk fan-out queries it (empty/missing would error), so it must exist before the new Worker deploys.
3. **Deploy** via merge → `deploy.yml`; confirm green.
4. **Configure teams:** a superadmin adds receivers per directorate, marks primaries, and uses "generate link" so each receiver taps the deep link once to link Telegram.

---

## Self-Review

**Spec coverage:**
- A. `directorate_receivers` + schema + register + backfill primaries → Task 1. ✓
- B. `TELEGRAM_BOT_USERNAME` config → Task 2 Step 1. ✓
- C. Deep-link `/start <token>` handler (link officer, single-use, friendly fallback) + admin link-token + unlink → Task 2 + Task 3 Step 1. ✓
- D. Receiver CRUD + tightened primary-must-be-receiver → Task 3 Steps 2-3. ✓
- E. Kiosk-only fan-out via shared `notifyOfficerOfVisit` + `check_in_source` threading → Task 4. ✓
- F. Admin team-manager UI (add/remove/primary/link status/generate link) → Task 5. ✓
- G. Kiosk display unchanged → no task needed (confirmed). ✓
- Invariant (primary on team): enforced by Task 3 Step 3 (set), Task 3 Step 2 DELETE (clears pointer on removal), Task 1 backfill (existing primaries). ✓
- Privacy/never-blocks: fan-out reuses Spec A's non-throwing path; private DMs; no PII in logs → Task 4 (reuses `notifyOfficerOfVisit`/`recordNotifyOutcome`). ✓

**Placeholder scan:** Only intentional placeholder is `TELEGRAM_BOT_USERNAME = "REPLACE_WITH_BOT_USERNAME"` — a user-owned config value, explicitly flagged as a required deploy step (asked of the user), not a code gap. Everything else has full code + expected output.

**Type consistency:** `selectFanoutReceivers(receivers:{officer_id}[], hostOfficerId)` and `parseStartToken(text)` defined + used consistently. `VisitNotifyData.check_in_source?: 'staff'|'kiosk'` matches `CheckInParams.check_in_source` and the `performCheckIn` pass-through. KV key `officer-link:<token>` written in Task 3 Step 1, read in Task 2 Step 4 — identical. Receiver row shape `{id,name,linked,primary}` returned by `GET /:id/receivers` (Task 3) matches `ReceiverRow` in the UI (Task 5). `api.del` added in Task 5 Step 1, used in Step 2.

**Testability note:** pure units (`parseStartToken`, `selectFanoutReceivers`) are TDD'd. The DB-bound glue (endpoints, fan-out queries, /start handler, admin UI) is verified by type-check + the no-regression suite + review + the on-device link/fan-out manual check — consistent with how this repo verifies route/UI glue (no integration harness).
