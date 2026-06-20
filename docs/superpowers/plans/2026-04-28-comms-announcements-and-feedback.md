# Comms — Option 2: Announcements + Staff Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything from Option 1 (broadcast announcements with scoped audiences + push) **plus** a one-way private channel where any staff member can send a written message/concern/question to admins, and an admin can mark it resolved or send a single push reply.

**Architecture:** Builds directly on Option 1. Adds one new table (`feedback_messages`) with optional reply field, two new staff endpoints (`POST /api/feedback`, `GET /api/feedback/mine`), three admin endpoints (`GET`, `POST :id/resolve`, `POST :id/reply`), a new staff page (`FeedbackPage`), and an admin tab (`FeedbackTab`). Replies fire a push back to the original sender via the existing `sendTypedNotification` helper using a new `'feedback_reply'` push type.

**Tech Stack:** Same as Option 1 — Cloudflare Workers + Hono + D1 (API); React 18 + TanStack Query (PWA + admin SPA).

**Read this first:** This plan **assumes Option 1 (`2026-04-28-comms-announcements.md`) ships first** — Tasks 1–10 of that plan are prerequisites. Tasks below are numbered starting at 13 to make the dependency obvious.

---

## File Structure

**New files (in addition to Option 1):**
- `packages/api/src/db/migration-feedback.sql` — `feedback_messages` table.
- `packages/api/src/routes/feedback.ts` — staff submit + history.
- `packages/api/src/routes/admin-feedback.ts` — admin list / resolve / reply.
- `packages/staff/src/pages/FeedbackPage.tsx` — submit form + own history list.
- `packages/web/src/components/admin/FeedbackTab.tsx` — admin inbox with resolve + reply.

**Modified files:**
- `packages/api/src/db/schema.sql` — append `feedback_messages` block.
- `packages/api/src/services/notifier.ts` — add `'feedback_reply'` to `PUSH_WHITELIST`.
- `packages/api/src/index.ts` — mount the two new route groups.
- `packages/staff/src/App.tsx` — add `/feedback` route.
- `packages/staff/src/components/BottomNav.tsx` — add Feedback entry (or merge under a "More" menu).
- Admin tabs container — add Feedback tab.

---

## Task 13: `feedback_messages` table

**Files:**
- Create: `packages/api/src/db/migration-feedback.sql`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Write the migration**

Create `packages/api/src/db/migration-feedback.sql`:

```sql
CREATE TABLE IF NOT EXISTS feedback_messages (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  reply_body    TEXT,
  reply_by      TEXT REFERENCES users(id),
  reply_at      TEXT,
  resolved_by   TEXT REFERENCES users(id),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_messages(status, created_at);
```

- [ ] **Step 2: Apply local + mirror in `schema.sql`**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-feedback.sql
```

Expected: `3 commands executed successfully.`

Append the same `CREATE TABLE` + indexes to `schema.sql`.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/migration-feedback.sql packages/api/src/db/schema.sql
git commit -m "feat(db): add feedback_messages table"
```

---

## Task 14: Whitelist `feedback_reply` push type

**Files:**
- Modify: `packages/api/src/services/notifier.ts`

- [ ] **Step 1: Update the whitelist**

The whitelist after Option 1 looks like:
```ts
const PUSH_WHITELIST = new Set([
  'visitor_arrival', 'clock_reminder', 'late_clock_alert',
  'monthly_report_ready', 'absence_notice', 'announcement',
]);
```

Add `'feedback_reply'`:
```ts
const PUSH_WHITELIST = new Set([
  'visitor_arrival', 'clock_reminder', 'late_clock_alert',
  'monthly_report_ready', 'absence_notice', 'announcement', 'feedback_reply',
]);
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/notifier.ts
git commit -m "feat(api): allow feedback_reply through push whitelist"
```

---

## Task 15: Staff feedback routes

**Files:**
- Create: `packages/api/src/routes/feedback.ts`

- [ ] **Step 1: Write the route file**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { success } from '../lib/response';

const submitSchema = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
});

export const feedbackRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: import('../types').SessionData };
}>();

feedbackRoutes.post('/', zValidator('json', submitSchema), async (c) => {
  const session = c.get('session');
  const { subject, body } = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO feedback_messages (id, user_id, subject, body) VALUES (?, ?, ?, ?)`
  ).bind(id, session.userId, subject, body).run();
  return success(c, { id });
});

feedbackRoutes.get('/mine', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT id, subject, body, status, reply_body, reply_at, created_at
     FROM feedback_messages
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`
  ).bind(session.userId).all();
  return success(c, rows.results ?? []);
});
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/feedback.ts
git commit -m "feat(api): staff feedback routes — submit + own history"
```

---

## Task 16: Admin feedback routes — list / resolve / reply

**Files:**
- Create: `packages/api/src/routes/admin-feedback.ts`

- [ ] **Step 1: Write the route file**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { success, error } from '../lib/response';
import { sendTypedNotification } from '../services/notifier';

const replySchema = z.object({ reply: z.string().min(1).max(2000) });

export const adminFeedbackRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: import('../types').SessionData };
}>();

adminFeedbackRoutes.use('*', requireRole(['superadmin', 'chief_director', 'head_of_service', 'f_and_a_admin']));

adminFeedbackRoutes.get('/', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.subject, f.body, f.status, f.reply_body, f.reply_at, f.resolved_at, f.created_at,
            f.user_id, u.name as user_name, u.role as user_role, d.name as directorate_name
     FROM feedback_messages f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN directorates d ON d.id = u.directorate_id
     WHERE f.status = ?
     ORDER BY f.created_at DESC
     LIMIT 200`
  ).bind(status).all();
  return success(c, rows.results ?? []);
});

adminFeedbackRoutes.post('/:id/resolve', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE feedback_messages
     SET status = 'resolved', resolved_by = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND status = 'open'`
  ).bind(session.userId, id).run();
  return success(c, { ok: true });
});

adminFeedbackRoutes.post('/:id/reply', zValidator('json', replySchema), async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  const { reply } = c.req.valid('json');

  const row = await c.env.DB.prepare(
    `SELECT user_id, subject FROM feedback_messages WHERE id = ?`
  ).bind(id).first<{ user_id: string; subject: string }>();
  if (!row) return error(c, 'NOT_FOUND', 'Feedback not found', 404);

  await c.env.DB.prepare(
    `UPDATE feedback_messages
     SET reply_body = ?, reply_by = ?, reply_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         status = 'resolved', resolved_by = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(reply, session.userId, session.userId, id).run();

  c.executionCtx.waitUntil(
    sendTypedNotification(c.env, {
      userId: row.user_id,
      type: 'feedback_reply',
      title: `Reply: ${row.subject}`,
      body: reply.length > 140 ? reply.slice(0, 137) + '...' : reply,
      url: '/feedback',
    }).catch((err) => console.error('[feedback] reply push failed', err)),
  );

  return success(c, { ok: true });
});
```

(Reply auto-resolves the message — keeps inbox clean. If you want "reply but keep open", swap the `status = 'resolved'` line for nothing.)

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/admin-feedback.ts
git commit -m "feat(api): admin feedback routes — list/resolve/reply with push"
```

---

## Task 17: Mount routes

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add imports**

```ts
import { feedbackRoutes } from './routes/feedback';
import { adminFeedbackRoutes } from './routes/admin-feedback';
```

- [ ] **Step 2: Mount under `/api/`**

After the announcements mounts:
```ts
app.route('/api/feedback', feedbackRoutes);
app.route('/api/admin/feedback', adminFeedbackRoutes);
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/index.ts
git commit -m "feat(api): mount feedback + admin-feedback routes"
```

---

## Task 18: Staff PWA — `FeedbackPage`

**Files:**
- Create: `packages/staff/src/pages/FeedbackPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Send, MessageCircle, Check } from 'lucide-react';

interface MyFeedback {
  id: string;
  subject: string;
  body: string;
  status: 'open' | 'resolved';
  reply_body: string | null;
  reply_at: string | null;
  created_at: string;
}

export function FeedbackPage() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);

  const { data } = useQuery({
    queryKey: ['feedback-mine'],
    queryFn: () => api.get<MyFeedback[]>('/feedback/mine'),
  });

  const submit = useMutation({
    mutationFn: () => api.post('/feedback', { subject, body }),
    onSuccess: () => {
      setSent(true);
      setSubject('');
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['feedback-mine'] });
      setTimeout(() => setSent(false), 3000);
    },
  });

  const items = data?.data ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A4D2E] via-[#0F2E1B] to-[#071A0F] text-white">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <MessageCircle className="h-5 w-5 text-[#D4A017]" />
        <h1 className="text-[22px] font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
          Feedback
        </h1>
      </header>

      <main className="px-5 pb-24 space-y-5">
        <section className="rounded-2xl bg-white/10 ring-1 ring-white/10 p-4 space-y-3">
          <h2 className="text-[14px] font-semibold text-white/80">Send a message to OHCS admin</h2>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value.slice(0, 120))}
            placeholder="Subject"
            className="w-full h-10 px-3 rounded-lg bg-white/10 ring-1 ring-white/10 text-[14px] placeholder-white/40 focus:outline-none focus:ring-[#D4A017]/40"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder="Your message…"
            className="w-full px-3 py-2 rounded-lg bg-white/10 ring-1 ring-white/10 text-[14px] placeholder-white/40 resize-none focus:outline-none focus:ring-[#D4A017]/40"
          />
          <button
            type="button"
            disabled={!subject.trim() || !body.trim() || submit.isPending}
            onClick={() => submit.mutate()}
            className="w-full h-11 rounded-xl bg-[#D4A017] text-[#1A4D2E] font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {sent ? <><Check className="h-4 w-4" /> Sent</> : <><Send className="h-4 w-4" /> Send</>}
          </button>
          <p className="text-[11px] text-white/40 leading-relaxed">
            Your message goes only to OHCS admin. You'll get a push notification if they reply.
          </p>
        </section>

        {items.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-white/40 px-1">Your messages</h2>
            {items.map((m) => (
              <div key={m.id} className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="text-[14px] font-bold">{m.subject}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    m.status === 'resolved' ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'
                  }`}>{m.status}</span>
                </div>
                <p className="text-[12px] text-white/60 whitespace-pre-wrap">{m.body}</p>
                {m.reply_body && (
                  <div className="mt-3 pl-3 border-l-2 border-[#D4A017]/40">
                    <p className="text-[11px] text-[#D4A017] uppercase tracking-wide font-semibold mb-1">Reply</p>
                    <p className="text-[13px] text-white/90 whitespace-pre-wrap">{m.reply_body}</p>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Wire `/feedback` route in `App.tsx`**

Add import + route:
```tsx
import { FeedbackPage } from './pages/FeedbackPage';
// inside <Routes>:
<Route path="/feedback" element={<ProtectedRoute><FeedbackPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add nav entry**

In `BottomNav.tsx`, add a Feedback item alongside Notices. With both Notices and Feedback added, the nav now has Clock / Notices / Feedback / Settings. If that's too many, group Notices + Feedback under a single "Inbox" tab that switches between them — note this as a UI decision for review before merging.

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/FeedbackPage.tsx packages/staff/src/App.tsx packages/staff/src/components/BottomNav.tsx
git commit -m "feat(staff): FeedbackPage + nav entry"
```

---

## Task 19: Admin SPA — `FeedbackTab`

**Files:**
- Create: `packages/web/src/components/admin/FeedbackTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Inbox, CheckCircle2, Reply } from 'lucide-react';

interface FeedbackRow {
  id: string;
  subject: string;
  body: string;
  status: 'open' | 'resolved';
  reply_body: string | null;
  user_name: string | null;
  user_role: string | null;
  directorate_name: string | null;
  created_at: string;
}

export function FeedbackTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved'>('open');
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data } = useQuery({
    queryKey: ['admin-feedback', statusFilter],
    queryFn: () => api.get<FeedbackRow[]>(`/admin/feedback?status=${statusFilter}`),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/admin/feedback/${id}/resolve`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-feedback'] }),
  });

  const reply = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post(`/admin/feedback/${id}/reply`, { reply: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] });
      setReplyingId(null);
      setReplyText('');
    },
  });

  const items = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Inbox className="h-4 w-4" /> Staff feedback
        </h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 text-sm">
          {(['open', 'resolved'] as const).map((s) => (
            <button key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-md font-medium ${statusFilter === s ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
            >{s}</button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {items.length === 0 && <p className="p-4 text-sm text-gray-500">Nothing here.</p>}
        {items.map((m) => (
          <div key={m.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{m.subject}</h3>
                <p className="text-[11px] text-gray-500">
                  {m.user_name ?? '—'} {m.user_role && <>· {m.user_role}</>} {m.directorate_name && <>· {m.directorate_name}</>} ·{' '}
                  {new Date(m.created_at).toLocaleString('en-GB')}
                </p>
              </div>
              {m.status === 'open' && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setReplyingId(replyingId === m.id ? null : m.id)}
                    className="h-8 px-2 rounded-lg bg-[#1A4D2E] text-white text-xs font-medium flex items-center gap-1"
                  >
                    <Reply className="h-3 w-3" /> Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve.mutate(m.id)}
                    className="h-8 px-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium flex items-center gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Resolve
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.body}</p>
            {m.reply_body && (
              <div className="mt-2 pl-3 border-l-2 border-[#D4A017]">
                <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-1">Reply</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.reply_body}</p>
              </div>
            )}
            {replyingId === m.id && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value.slice(0, 2000))}
                  rows={3}
                  placeholder="Reply (this will push-notify the staff member)…"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setReplyingId(null); setReplyText(''); }}
                    className="h-9 px-3 rounded-lg text-sm font-medium text-gray-600">Cancel</button>
                  <button type="button"
                    disabled={!replyText.trim() || reply.isPending}
                    onClick={() => reply.mutate({ id: m.id, body: replyText.trim() })}
                    className="h-9 px-3 rounded-lg bg-[#1A4D2E] text-white text-sm font-semibold disabled:opacity-50"
                  >Send reply</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into admin tabs**

Mount `<FeedbackTab />` next to `<AnnouncementsTab />` in the admin tabs container, gated on the same role list as the API.

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/components/admin/FeedbackTab.tsx packages/web/src/pages/AdminPage.tsx
git commit -m "feat(web): admin FeedbackTab — inbox, resolve, reply"
```

---

## Task 20: Local smoke test (feedback)

- [ ] **Step 1: Submit feedback as a regular officer**

Log into the staff app as a non-admin. Open Feedback, send subject `"Cafeteria menu"`, body `"Could we add vegetarian options?"`. Expect "Sent" confirmation.

- [ ] **Step 2: Verify in admin inbox**

Log into the admin SPA as superadmin. Open Feedback tab. The new submission should appear under **open**.

- [ ] **Step 3: Reply**

Click Reply, type `"Forwarded to F&A — will update."`, send. Expect:
- Row moves to **resolved** filter.
- Push notification fires for the original sender (visible in dev console: `[notifier] sent feedback_reply ...`).

- [ ] **Step 4: Verify staff sees the reply**

Log back in as that officer → Feedback. The message now shows status `resolved` with a yellow-bordered reply quote underneath.

- [ ] **Step 5: Verify resolve-without-reply**

Submit another, click **Resolve** (no reply). Expect: row moves to resolved, no push fired (intentional — silent resolve).

- [ ] **Step 6: Clean up**

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="DELETE FROM feedback_messages"
```

---

## Task 21: Deploy

- [ ] **Step 1: Apply migration to remote D1**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-feedback.sql
```

- [ ] **Step 2: Push (CI deploys all three)**

```bash
git push origin main
```

- [ ] **Step 3: Production smoke**

Submit a test feedback as a real staff account, confirm it appears in the admin inbox, reply, confirm push lands.

---

## Self-Review Notes

- **Spec coverage:**
  - Submit + own-history endpoints → Task 15.
  - Admin list / resolve / reply → Task 16.
  - Reply push → Task 16 + Task 14 whitelist.
  - Staff UI (compose + history) → Task 18.
  - Admin UI (inbox + reply) → Task 19.
- **Combined plan size:** Option 1 = 12 tasks, Option 2 adds 9 more → 21 tasks total. Roughly 1.5× Option 1.
- **Type consistency:** `MyFeedback` shape mirrors what `GET /feedback/mine` returns. `FeedbackRow` mirrors what admin list returns (extra user/directorate fields). Both reuse the same `status` enum.
- **Out of scope (intentional):**
  - Threading (multi-turn back-and-forth). Reply is one-shot. If the staff member needs to follow up, they submit a new message. Adding threading effectively makes this Option 3 chat.
  - Attachments. Could be added later via R2 — flagged as a future-phase item, not in this plan.
  - Anonymous feedback. All messages are tied to the sender's user_id by design (auth is enforced).
- **Risk note:** A staff member could spam the inbox. If this becomes real, add a rate limit at `POST /feedback` (e.g., max 5/day per user) — not included by default to avoid premature complexity.
