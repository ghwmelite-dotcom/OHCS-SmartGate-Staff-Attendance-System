# Comms — Option 1: Announcements (Broadcast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let designated admins post in-app announcements (organization-wide or scoped to a directorate / role / NSS / leadership tier); every targeted staff member sees them in a new **Notices** tab with an unread badge, and gets a push notification on new posts.

**Architecture:** Two new D1 tables (`announcements`, `announcement_reads`). Two new route files: staff-side (`/api/announcements`) and admin-side (`/api/admin/announcements`). One new service (`services/announcements.ts`) that resolves audience filters to user IDs and fans out push notifications via the existing `sendTypedNotification` helper. Staff PWA gains a `NoticesPage`, a `NoticesBadge` for unread counts, and a route entry. Admin SPA gains an `AnnouncementsTab` with compose form and list.

**Tech Stack:** Cloudflare Workers + Hono + D1 (API). React 18 + Zustand + TanStack Query (staff PWA). React 18 + TanStack Query + shadcn-style components (admin SPA). No test runner — verification via `tsc --noEmit` + curl + manual UI smoke.

---

## File Structure

**New files:**
- `packages/api/src/db/migration-announcements.sql` — `CREATE TABLE` for both tables + indexes.
- `packages/api/src/services/announcements.ts` — `sendAnnouncementPush()` + `resolveAudience()` helpers.
- `packages/api/src/routes/announcements.ts` — staff-facing list + mark-read.
- `packages/api/src/routes/admin-announcements.ts` — admin compose / delete / list-all.
- `packages/staff/src/pages/NoticesPage.tsx` — list view.
- `packages/staff/src/components/NoticesBadge.tsx` — unread count for nav.
- `packages/web/src/components/admin/AnnouncementsTab.tsx` — admin compose + list.

**Modified files:**
- `packages/api/src/db/schema.sql` — append the two new tables.
- `packages/api/src/services/notifier.ts` — add `'announcement'` to `PUSH_WHITELIST`.
- `packages/api/src/index.ts` — register the two new route mounts.
- `packages/staff/src/App.tsx` — add `/notices` route.
- `packages/staff/src/components/BottomNav.tsx` — add Notices tab with badge.
- `packages/web/src/pages/AdminPage.tsx` (or wherever the admin tabs live) — add the new tab.

---

## Task 1: Add `announcements` + `announcement_reads` tables

**Files:**
- Create: `packages/api/src/db/migration-announcements.sql`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Write the migration**

Create `packages/api/src/db/migration-announcements.sql` with exactly:

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience_kind   TEXT NOT NULL CHECK(audience_kind IN ('all','directorate','role','nss','leadership')),
  audience_value  TEXT,
  posted_by       TEXT NOT NULL REFERENCES users(id),
  posted_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at      TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_announcements_posted_at ON announcements(posted_at);
CREATE INDEX IF NOT EXISTS idx_announcements_audience ON announcements(audience_kind, audience_value);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);
```

`audience_kind` semantics:
- `all` — every active user; `audience_value` ignored.
- `directorate` — `audience_value` = directorate id.
- `role` — `audience_value` = exact role string.
- `nss` — every active user with role `nss`; `audience_value` ignored.
- `leadership` — Deputy Director / Director / Chief Director / Head of Service.

- [ ] **Step 2: Apply to local D1**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-announcements.sql
```

Expected: `5 commands executed successfully.`

- [ ] **Step 3: Mirror in `schema.sql`**

Append the same `CREATE TABLE` + `CREATE INDEX` blocks to the end of `packages/api/src/db/schema.sql`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migration-announcements.sql packages/api/src/db/schema.sql
git commit -m "feat(db): add announcements + announcement_reads tables"
```

---

## Task 2: Add `announcement` to PUSH_WHITELIST

**Files:**
- Modify: `packages/api/src/services/notifier.ts`

- [ ] **Step 1: Update the whitelist**

Find the `PUSH_WHITELIST` line (similar to:
`const PUSH_WHITELIST = new Set(['visitor_arrival', 'clock_reminder', 'late_clock_alert', 'monthly_report_ready', 'absence_notice']);`).

Add `'announcement'`:

```ts
const PUSH_WHITELIST = new Set([
  'visitor_arrival', 'clock_reminder', 'late_clock_alert',
  'monthly_report_ready', 'absence_notice', 'announcement',
]);
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/notifier.ts
git commit -m "feat(api): allow announcement type through push whitelist"
```

---

## Task 3: `services/announcements.ts` — audience resolver + push fan-out

**Files:**
- Create: `packages/api/src/services/announcements.ts`

- [ ] **Step 1: Write the service**

Create `packages/api/src/services/announcements.ts` with exactly:

```ts
import type { Env } from '../types';
import { sendTypedNotification } from './notifier';

export type AudienceKind = 'all' | 'directorate' | 'role' | 'nss' | 'leadership';

export interface Audience {
  kind: AudienceKind;
  value: string | null;
}

export interface AnnouncementForPush {
  id: string;
  title: string;
  body: string;
}

const LEADERSHIP_ROLES = ['deputy_director', 'director', 'chief_director', 'head_of_service'];

/**
 * Resolves an audience descriptor to a list of active user IDs.
 * Excludes inactive users and the poster themselves.
 */
export async function resolveAudience(
  env: Env,
  audience: Audience,
  excludeUserId: string,
): Promise<string[]> {
  const base = 'SELECT id FROM users WHERE is_active = 1 AND id != ?';
  switch (audience.kind) {
    case 'all': {
      const r = await env.DB.prepare(base).bind(excludeUserId).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    }
    case 'directorate': {
      if (!audience.value) return [];
      const r = await env.DB.prepare(base + ' AND directorate_id = ?')
        .bind(excludeUserId, audience.value).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    }
    case 'role': {
      if (!audience.value) return [];
      const r = await env.DB.prepare(base + ' AND role = ?')
        .bind(excludeUserId, audience.value).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    }
    case 'nss': {
      const r = await env.DB.prepare(base + " AND role = 'nss'")
        .bind(excludeUserId).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    }
    case 'leadership': {
      const placeholders = LEADERSHIP_ROLES.map(() => '?').join(',');
      const r = await env.DB.prepare(`${base} AND role IN (${placeholders})`)
        .bind(excludeUserId, ...LEADERSHIP_ROLES).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    }
    default:
      return [];
  }
}

/**
 * Fan-out push notification for a newly-posted announcement. Best-effort —
 * each user is independent so one failure doesn't block the rest.
 */
export async function sendAnnouncementPush(
  env: Env,
  announcement: AnnouncementForPush,
  audience: Audience,
  posterUserId: string,
): Promise<{ recipients: number }> {
  const userIds = await resolveAudience(env, audience, posterUserId);
  for (const uid of userIds) {
    await sendTypedNotification(env, {
      userId: uid,
      type: 'announcement',
      title: announcement.title,
      body: announcement.body.length > 140 ? announcement.body.slice(0, 137) + '...' : announcement.body,
      url: `/notices?id=${announcement.id}`,
    }).catch((err) => console.error('[announcements] push failed', err));
  }
  console.log(`[announcements] ${announcement.id} → ${userIds.length} recipients`);
  return { recipients: userIds.length };
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/announcements.ts
git commit -m "feat(api): announcement audience resolver + push fan-out service"
```

---

## Task 4: Admin routes — compose / list-all / delete

**Files:**
- Create: `packages/api/src/routes/admin-announcements.ts`

- [ ] **Step 1: Write the route file**

Create `packages/api/src/routes/admin-announcements.ts`:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { success, error } from '../lib/response';
import { sendAnnouncementPush, type AudienceKind } from '../services/announcements';

const AUDIENCE_KINDS: AudienceKind[] = ['all', 'directorate', 'role', 'nss', 'leadership'];

const createSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  audience_kind: z.enum(['all', 'directorate', 'role', 'nss', 'leadership']),
  audience_value: z.string().max(64).nullable().optional(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).optional(),
});

export const adminAnnouncementsRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: import('../types').SessionData };
}>();

adminAnnouncementsRoutes.use('*', requireRole(['superadmin', 'chief_director', 'head_of_service', 'f_and_a_admin']));

adminAnnouncementsRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.body, a.audience_kind, a.audience_value, a.posted_by, a.posted_at, a.expires_at,
            u.name as posted_by_name,
            (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) as read_count
     FROM announcements a
     LEFT JOIN users u ON u.id = a.posted_by
     WHERE a.deleted_at IS NULL
     ORDER BY a.posted_at DESC
     LIMIT 200`
  ).all();
  return success(c, rows.results ?? []);
});

adminAnnouncementsRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');

  if ((body.audience_kind === 'directorate' || body.audience_kind === 'role') && !body.audience_value) {
    return error(c, 'INVALID_AUDIENCE', `audience_value required for ${body.audience_kind}`, 400);
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO announcements (id, title, body, audience_kind, audience_value, posted_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, body.title, body.body, body.audience_kind,
    body.audience_value ?? null, session.userId, body.expires_at ?? null,
  ).run();

  c.executionCtx.waitUntil(
    sendAnnouncementPush(
      c.env,
      { id, title: body.title, body: body.body },
      { kind: body.audience_kind, value: body.audience_value ?? null },
      session.userId,
    ),
  );

  return success(c, { id });
});

adminAnnouncementsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE announcements SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(id).run();
  return success(c, { ok: true });
});
```

(Allowed roles deliberately broad — `superadmin`, `chief_director`, `head_of_service`, `f_and_a_admin`. Adjust if HR is strict that only superadmin posts.)

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/admin-announcements.ts
git commit -m "feat(api): admin announcements routes (list/create/soft-delete)"
```

---

## Task 5: Staff routes — list visible + mark-read

**Files:**
- Create: `packages/api/src/routes/announcements.ts`

- [ ] **Step 1: Write the route file**

Create `packages/api/src/routes/announcements.ts`:

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { success } from '../lib/response';

const LEADERSHIP_ROLES = ['deputy_director', 'director', 'chief_director', 'head_of_service'];

export const announcementsRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: import('../types').SessionData };
}>();

announcementsRoutes.get('/', async (c) => {
  const session = c.get('session');

  const me = await c.env.DB.prepare(
    `SELECT role, directorate_id FROM users WHERE id = ?`
  ).bind(session.userId).first<{ role: string; directorate_id: string | null }>();
  if (!me) return success(c, []);

  const isLeadership = LEADERSHIP_ROLES.includes(me.role);

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.body, a.audience_kind, a.audience_value, a.posted_by, a.posted_at, a.expires_at,
            u.name as posted_by_name,
            CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END as is_read
     FROM announcements a
     LEFT JOIN users u ON u.id = a.posted_by
     LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
     WHERE a.deleted_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       AND (
         a.audience_kind = 'all'
         OR (a.audience_kind = 'directorate' AND a.audience_value = ?)
         OR (a.audience_kind = 'role' AND a.audience_value = ?)
         OR (a.audience_kind = 'nss' AND ? = 'nss')
         OR (a.audience_kind = 'leadership' AND ? = 1)
       )
     ORDER BY a.posted_at DESC
     LIMIT 100`
  ).bind(
    session.userId,
    me.directorate_id ?? '',
    me.role,
    me.role,
    isLeadership ? 1 : 0,
  ).all();

  return success(c, rows.results ?? []);
});

announcementsRoutes.post('/:id/read', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)`
  ).bind(id, session.userId).run();
  return success(c, { ok: true });
});
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/announcements.ts
git commit -m "feat(api): staff announcements routes (list + mark-read)"
```

---

## Task 6: Mount the new routes in `index.ts`

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add imports**

Near the existing `import { adminNssRoutes }` line, add:

```ts
import { announcementsRoutes } from './routes/announcements';
import { adminAnnouncementsRoutes } from './routes/admin-announcements';
```

- [ ] **Step 2: Mount the routes**

Find the existing `app.route('/api/admin/...', ...)` mounts. Add (right after the auth middleware so both are protected):

```ts
app.route('/api/announcements', announcementsRoutes);
app.route('/api/admin/announcements', adminAnnouncementsRoutes);
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/index.ts
git commit -m "feat(api): mount announcements + admin-announcements routes"
```

---

## Task 7: Staff PWA — `NoticesPage`

**Files:**
- Create: `packages/staff/src/pages/NoticesPage.tsx`

- [ ] **Step 1: Write the page**

Create `packages/staff/src/pages/NoticesPage.tsx`:

```tsx
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Bell, Megaphone } from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  body: string;
  posted_by_name: string | null;
  posted_at: string;
  is_read: 0 | 1;
}

function fmtRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function NoticesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<Announcement[]>('/announcements'),
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/announcements/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcements'] }),
  });

  const items = data?.data ?? [];

  useEffect(() => {
    const unread = items.filter((a) => !a.is_read);
    for (const a of unread) markRead.mutate(a.id);
    // intentionally empty deps — fire on first render where items is populated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A4D2E] via-[#0F2E1B] to-[#071A0F] text-white">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <Megaphone className="h-5 w-5 text-[#D4A017]" />
        <h1 className="text-[22px] font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
          Notices
        </h1>
      </header>

      <main className="px-5 pb-24 space-y-3">
        {isLoading && <p className="text-white/60 text-[14px]">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6 text-center">
            <Bell className="h-6 w-6 text-white/40 mx-auto mb-2" />
            <p className="text-[14px] text-white/60">No notices yet.</p>
          </div>
        )}
        {items.map((a) => (
          <article
            key={a.id}
            className={`rounded-2xl p-4 ring-1 ${a.is_read ? 'bg-white/5 ring-white/10' : 'bg-white/10 ring-[#D4A017]/30'}`}
          >
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <h2 className="text-[15px] font-bold leading-snug">{a.title}</h2>
              {!a.is_read && <span className="mt-1 h-2 w-2 rounded-full bg-[#D4A017] flex-shrink-0" />}
            </div>
            <p className="text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">{a.body}</p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-white/40">
              <span>{a.posted_by_name ?? 'OHCS'}</span>
              <span>·</span>
              <time dateTime={a.posted_at}>{fmtRelative(a.posted_at)}</time>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/NoticesPage.tsx
git commit -m "feat(staff): NoticesPage — list announcements + auto-mark-read"
```

---

## Task 8: Staff PWA — `NoticesBadge` (unread count)

**Files:**
- Create: `packages/staff/src/components/NoticesBadge.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Announcement { id: string; is_read: 0 | 1 }

export function NoticesBadge() {
  const { data } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<Announcement[]>('/announcements'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const unread = (data?.data ?? []).filter((a) => !a.is_read).length;
  if (unread === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D4A017] text-[10px] font-bold text-[#1A4D2E] flex items-center justify-center ring-2 ring-[#1A4D2E]">
      {unread > 9 ? '9+' : unread}
    </span>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/NoticesBadge.tsx
git commit -m "feat(staff): NoticesBadge — unread count chip"
```

---

## Task 9: Staff PWA — wire route + nav

**Files:**
- Modify: `packages/staff/src/App.tsx`
- Modify: `packages/staff/src/components/BottomNav.tsx`

- [ ] **Step 1: Add route in `App.tsx`**

In `packages/staff/src/App.tsx`, add to imports:

```ts
import { NoticesPage } from './pages/NoticesPage';
```

Add a new `<Route>` inside `<Routes>` (alongside the existing `/` clock route):

```tsx
<Route path="/notices" element={<ProtectedRoute><NoticesPage /></ProtectedRoute>} />
```

- [ ] **Step 2: Add Notices tab to `BottomNav.tsx`**

Read `packages/staff/src/components/BottomNav.tsx`. Wherever the existing nav items are defined, add a Notices entry next to the others. Replace the existing nav-items array with the version that includes Notices, OR add a new item — exact diff depends on current structure. Example pattern:

```tsx
import { Megaphone } from 'lucide-react';
import { NoticesBadge } from './NoticesBadge';
// inside the rendered nav:
<NavLink to="/notices" className={...}>
  <span className="relative">
    <Megaphone className="h-5 w-5" />
    <NoticesBadge />
  </span>
  <span className="text-[11px] mt-0.5">Notices</span>
</NavLink>
```

Match the className styling of the existing items so the spacing is consistent.

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/App.tsx packages/staff/src/components/BottomNav.tsx
git commit -m "feat(staff): wire /notices route + bottom-nav entry with unread badge"
```

---

## Task 10: Admin SPA — `AnnouncementsTab`

**Files:**
- Create: `packages/web/src/components/admin/AnnouncementsTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Trash2, Plus, Megaphone } from 'lucide-react';

type AudienceKind = 'all' | 'directorate' | 'role' | 'nss' | 'leadership';

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience_kind: AudienceKind;
  audience_value: string | null;
  posted_by_name: string | null;
  posted_at: string;
  expires_at: string | null;
  read_count: number;
}

interface Directorate { id: string; name: string }

const ROLES = ['officer', 'director', 'deputy_director', 'chief_director', 'head_of_service', 'nss', 'f_and_a_admin', 'superadmin'];

export function AnnouncementsTab() {
  const queryClient = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);

  const { data: list } = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: () => api.get<Announcement[]>('/admin/announcements'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/announcements/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-announcements'] }),
  });

  const items = list?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> Announcements
        </h2>
        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          className="h-9 px-3 rounded-lg bg-[#1A4D2E] text-white text-sm font-semibold flex items-center gap-1.5 hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> New announcement
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {items.length === 0 && <p className="p-4 text-sm text-gray-500">No announcements yet.</p>}
        {items.map((a) => (
          <div key={a.id} className="p-4 flex gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-900">{a.title}</h3>
                <span className="text-[11px] text-gray-500">· {audienceLabel(a)}</span>
              </div>
              <p className="text-sm text-gray-600 leading-snug whitespace-pre-wrap">{a.body}</p>
              <p className="text-[11px] text-gray-400 mt-2">
                {a.posted_by_name ?? '—'} · {new Date(a.posted_at).toLocaleString('en-GB')} · {a.read_count} read
              </p>
            </div>
            <button
              type="button"
              onClick={() => { if (confirm('Delete this announcement?')) del.mutate(a.id); }}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} />}
    </div>
  );
}

function audienceLabel(a: Announcement): string {
  switch (a.audience_kind) {
    case 'all': return 'Everyone';
    case 'directorate': return `Directorate: ${a.audience_value}`;
    case 'role': return `Role: ${a.audience_value}`;
    case 'nss': return 'NSS personnel';
    case 'leadership': return 'Leadership (Deputy Director +)';
    default: return a.audience_kind;
  }
}

function ComposeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<AudienceKind>('all');
  const [value, setValue] = useState<string>('');

  const { data: directorates } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });

  const post = useMutation({
    mutationFn: () => api.post('/admin/announcements', {
      title, body,
      audience_kind: kind,
      audience_value: kind === 'directorate' || kind === 'role' ? value : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      onClose();
    },
  });

  const valid = title.trim().length > 0 && body.trim().length > 0
    && (kind !== 'directorate' || value)
    && (kind !== 'role' || value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 space-y-4">
          <h3 className="text-base font-semibold text-gray-900">New announcement</h3>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="Title"
            className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            rows={5}
            placeholder="Message"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={kind} onChange={(e) => { setKind(e.target.value as AudienceKind); setValue(''); }} className="h-10 px-3 rounded-lg border border-gray-300 text-sm">
              <option value="all">Everyone</option>
              <option value="leadership">Leadership (Deputy Director +)</option>
              <option value="nss">NSS personnel</option>
              <option value="directorate">Specific directorate</option>
              <option value="role">Specific role</option>
            </select>
            {kind === 'directorate' && (
              <select value={value} onChange={(e) => setValue(e.target.value)} className="h-10 px-3 rounded-lg border border-gray-300 text-sm">
                <option value="">Choose directorate…</option>
                {(directorates?.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {kind === 'role' && (
              <select value={value} onChange={(e) => setValue(e.target.value)} className="h-10 px-3 rounded-lg border border-gray-300 text-sm">
                <option value="">Choose role…</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              type="button"
              disabled={!valid || post.isPending}
              onClick={() => post.mutate()}
              className="h-10 px-4 rounded-lg bg-[#1A4D2E] text-white text-sm font-semibold disabled:opacity-50"
            >
              {post.isPending ? 'Posting…' : 'Post & notify'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into the admin page**

Open `packages/web/src/pages/AdminPage.tsx` (or whichever file holds the admin tab list). Add an `Announcements` tab that renders `<AnnouncementsTab />`, gated on the same role list as the API (`superadmin`, `chief_director`, `head_of_service`, `f_and_a_admin`).

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/components/admin/AnnouncementsTab.tsx packages/web/src/pages/AdminPage.tsx
git commit -m "feat(web): admin AnnouncementsTab — compose, list, delete"
```

---

## Task 11: Local smoke test

- [ ] **Step 1: Start API + both PWAs**

Terminal A:
```bash
cd packages/api && node ../../node_modules/wrangler/bin/wrangler.js dev
```
Terminal B:
```bash
cd packages/staff && npm run dev
```
Terminal C:
```bash
cd packages/web && npm run dev
```

- [ ] **Step 2: Post an announcement as superadmin**

In the admin UI, open Announcements → New announcement. Title `"Smoke test"`, body `"This is a smoke test"`, audience `Everyone`. Click *Post & notify*.

Verify in DB:
```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT id, title, audience_kind FROM announcements ORDER BY posted_at DESC LIMIT 3"
```

- [ ] **Step 3: Verify staff sees it**

Log into the staff app as a non-superadmin user. Navigate to **Notices**. The smoke-test entry should appear with a yellow unread dot. After ~1 s the dot disappears (auto-mark-read fired).

Re-check DB:
```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT * FROM announcement_reads"
```
Expected: one row for that user.

- [ ] **Step 4: Verify scoping**

Post a `Leadership` announcement. Log in as a regular officer — it should NOT appear. Log in as a director — it should.

- [ ] **Step 5: Verify push**

If the test user has push subscriptions in DB, watch the dev console for `[announcements] <id> → N recipients` and confirm a push notification fires.

- [ ] **Step 6: Clean up**

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="DELETE FROM announcements; DELETE FROM announcement_reads;"
```

---

## Task 12: Deploy

- [ ] **Step 1: Apply migration to remote D1**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-announcements.sql
```

- [ ] **Step 2: Push to GitHub (CI deploys all three pieces)**

```bash
git push origin main
```

- [ ] **Step 3: Production smoke test**

After CI green: post a `superadmin`-only announcement on prod, log in as a superadmin on staff PWA, verify it shows up in `/notices` and a push notification fires.

---

## Self-Review Notes

- **Spec coverage:**
  - Compose / list / delete admin endpoints → Task 4.
  - Staff list + mark-read → Task 5.
  - Push fan-out → Task 3.
  - Audience scoping (all / directorate / role / nss / leadership) → Task 3 + Task 5.
  - Staff Notices UI → Task 7.
  - Unread badge → Task 8.
  - Admin compose UI → Task 10.
- **Ordering:** Tables first (Task 1), service before routes (Task 3 → Task 4–5), routes mounted in `index.ts` after both files exist (Task 6). Frontend depends on the API being live (Tasks 7–10 land after 1–6).
- **Type consistency:** `AudienceKind`, `Audience`, and `AnnouncementForPush` shapes are reused across `services/announcements.ts`, `routes/admin-announcements.ts`, and the admin SPA.
- **Out of scope (intentional):**
  - Edit-after-post (delete-and-repost is the workflow).
  - Rich-text body (Markdown could be added later — for now it's plain text + line breaks).
  - Attachments (defer to chat plan or a dedicated phase).
- **Risk note:** Push fan-out is sequential, not concurrent. For ≤ 200 active staff this is fine (~< 2 s). If the org grows past ~500, parallelize with `Promise.allSettled`.
