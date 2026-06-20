# Comms — Option 3: Full Chat (DMs + Group Conversations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time staff-to-staff messaging in the OHCS Staff app — direct messages and group conversations — with persistent history, push notifications when offline, presence indicators, and admin moderation tools (audit log, lock conversation, retention policy enforcement).

**Architecture:** Three phases, each independently shippable.
- **Phase A — Foundation (DM-only, polling).** D1 tables for `conversations`, `conversation_members`, `messages`. REST endpoints + polling UI. No real-time yet but a complete usable DM product.
- **Phase B — Real-time.** A Cloudflare Durable Object per conversation relays messages over WebSocket to connected clients; offline users still get push. Replaces polling.
- **Phase C — Groups + moderation.** Group creation, member management, admin audit log, "lock conversation", retention sweep cron, blocklist.

**Tech Stack:** Cloudflare Workers + Hono + D1 (REST), Durable Objects + WebSocket (Phase B), R2 (Phase C attachments — optional, deferred). Staff PWA: React 18 + TanStack Query + Zustand + native `WebSocket`.

---

## ⚠️ Prerequisites — non-technical decisions required before Phase A

Chat is the only one of the three comms options that creates a **records-management surface**. Before any code is written, OHCS needs written answers to:

1. **Retention.** How long are messages kept? (Common government answers: 90 days, 1 year, 7 years.) Auto-delete after that, or archive?
2. **Audit.** Who can read another user's conversations, under what circumstances? (E.g., compliance officer with a documented request.)
3. **Acceptable use.** Written policy staff agree to on first chat open. What's prohibited? Who enforces?
4. **DMs vs groups only.** Some orgs forbid private DMs entirely and only allow named/audited group channels.
5. **Privacy boundary.** Are HR/admins ever shown DM content, or only metadata (sender / recipient / timestamp)?
6. **External account ban.** Is chat available to suspended / on-leave staff?

Without these answered, the build will need rework when policy lands. Recommended path: **draft a 1-page acceptable-use & retention policy with HR/legal first**, then start Phase A.

---

## Phase A — Foundation (DM-only, polling)

### A. File Structure

**New API files:**
- `packages/api/src/db/migration-chat.sql` — `conversations`, `conversation_members`, `messages` tables.
- `packages/api/src/services/chat.ts` — helpers: `findOrCreateDmConversation`, `recordMessage`, `markRead`.
- `packages/api/src/routes/chat.ts` — REST endpoints under `/api/chat`.

**New staff PWA files:**
- `packages/staff/src/pages/ChatListPage.tsx` — conversation list.
- `packages/staff/src/pages/ChatConversationPage.tsx` — message view + composer.
- `packages/staff/src/pages/ChatNewPage.tsx` — pick a colleague to start a DM.
- `packages/staff/src/components/ChatBadge.tsx` — unread count for nav.
- `packages/staff/src/stores/chat.ts` — local cache of conversations + last-read marker.

**Modified files:**
- `packages/api/src/db/schema.sql` — append chat tables.
- `packages/api/src/services/notifier.ts` — add `'chat_message'` to `PUSH_WHITELIST`.
- `packages/api/src/index.ts` — mount chat routes.
- `packages/staff/src/App.tsx` — add `/chat`, `/chat/new`, `/chat/:id` routes.
- `packages/staff/src/components/BottomNav.tsx` — add Chat tab.

### A.1: Schema

**Files:**
- Create: `packages/api/src/db/migration-chat.sql`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  kind          TEXT NOT NULL CHECK(kind IN ('dm','group')) DEFAULT 'dm',
  title         TEXT,                            -- groups only; DMs derive titles client-side
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_message_at TEXT,
  locked_at     TEXT,                            -- Phase C: admin lock
  locked_by     TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_read_at    TEXT,
  is_admin        INTEGER NOT NULL DEFAULT 0,    -- group conversation admin
  left_at         TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id, left_at);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  edited_at       TEXT,
  deleted_at      TEXT,                          -- soft-delete by sender / admin
  deleted_by      TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sent_at);
```

- [ ] **Step 2: Apply local + mirror in `schema.sql` + commit**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-chat.sql
```
Append the same blocks to `schema.sql`.
```bash
git add packages/api/src/db/migration-chat.sql packages/api/src/db/schema.sql
git commit -m "feat(db): chat foundation tables (conversations, members, messages)"
```

### A.2: `services/chat.ts`

**Files:**
- Create: `packages/api/src/services/chat.ts`

- [ ] **Step 1: Write the service**

```ts
import type { Env } from '../types';

export async function findOrCreateDmConversation(env: Env, userA: string, userB: string): Promise<string> {
  // Find existing DM where both users are members and there are exactly 2 active members.
  const existing = await env.DB.prepare(
    `SELECT c.id FROM conversations c
     JOIN conversation_members ma ON ma.conversation_id = c.id AND ma.user_id = ? AND ma.left_at IS NULL
     JOIN conversation_members mb ON mb.conversation_id = c.id AND mb.user_id = ? AND mb.left_at IS NULL
     WHERE c.kind = 'dm'
     LIMIT 1`
  ).bind(userA, userB).first<{ id: string }>();
  if (existing) return existing.id;

  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO conversations (id, kind, created_by) VALUES (?, 'dm', ?)`).bind(id, userA),
    env.DB.prepare(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)`).bind(id, userA),
    env.DB.prepare(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)`).bind(id, userB),
  ]);
  return id;
}

export async function recordMessage(env: Env, conversationId: string, userId: string, body: string): Promise<{ id: string; sent_at: string }> {
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages (id, conversation_id, user_id, body) VALUES (?, ?, ?, ?)`
    ).bind(id, conversationId, userId, body),
    env.DB.prepare(
      `UPDATE conversations SET last_message_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    ).bind(conversationId),
  ]);
  const row = await env.DB.prepare(`SELECT sent_at FROM messages WHERE id = ?`).bind(id).first<{ sent_at: string }>();
  return { id, sent_at: row!.sent_at };
}

export async function markRead(env: Env, conversationId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE conversation_members
     SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE conversation_id = ? AND user_id = ?`
  ).bind(conversationId, userId).run();
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/chat.ts
git commit -m "feat(api): chat service helpers (DM lookup, record, mark-read)"
```

### A.3: REST routes

**Files:**
- Create: `packages/api/src/routes/chat.ts`
- Modify: `packages/api/src/services/notifier.ts` (add `'chat_message'` to `PUSH_WHITELIST`)

- [ ] **Step 1: Whitelist `chat_message`**

```ts
const PUSH_WHITELIST = new Set([
  'visitor_arrival', 'clock_reminder', 'late_clock_alert',
  'monthly_report_ready', 'absence_notice', 'announcement',
  'feedback_reply', 'chat_message',
]);
```

- [ ] **Step 2: Write `routes/chat.ts`**

Endpoints:
- `GET /api/chat/conversations` — my conversations with last message + unread count.
- `POST /api/chat/dm` — body `{ user_id }`. Creates or returns existing DM id.
- `GET /api/chat/conversations/:id/messages?since=<iso>&limit=50` — paginated messages (descending), with `since` for polling.
- `POST /api/chat/conversations/:id/messages` — body `{ body }`. Returns `{ id, sent_at }`. Fires push to other members.
- `POST /api/chat/conversations/:id/read` — mark read.
- `GET /api/chat/contacts?q=<query>` — searches active users by name/staff_id (excludes self; respects directorate roster), returning min fields for picker.
- `DELETE /api/chat/messages/:id` — soft-delete (only sender; replaces body with placeholder).

Code outline (full file is ~200 lines; structure):

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { success, error } from '../lib/response';
import { findOrCreateDmConversation, recordMessage, markRead } from '../services/chat';
import { sendTypedNotification } from '../services/notifier';

export const chatRoutes = new Hono<{ Bindings: Env; Variables: { session: import('../types').SessionData } }>();

// All routes require membership of the conversation. Implement a helper:
async function requireMember(env: Env, conversationId: string, userId: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL`
  ).bind(conversationId, userId).first();
  return !!r;
}

// GET /conversations
chatRoutes.get('/conversations', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.kind, c.title, c.last_message_at,
            (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.sent_at DESC LIMIT 1) as last_body,
            (SELECT user_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1) as last_user_id,
            cm.last_read_at,
            (SELECT COUNT(*) FROM messages m
              WHERE m.conversation_id = c.id
                AND m.deleted_at IS NULL
                AND (cm.last_read_at IS NULL OR m.sent_at > cm.last_read_at)
                AND m.user_id != ?) as unread
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ? AND cm.left_at IS NULL
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT 100`
  ).bind(session.userId, session.userId).all();
  return success(c, rows.results ?? []);
});

// POST /dm
chatRoutes.post('/dm', zValidator('json', z.object({ user_id: z.string() })), async (c) => {
  const session = c.get('session');
  const { user_id } = c.req.valid('json');
  if (user_id === session.userId) return error(c, 'INVALID', "Can't DM yourself", 400);
  const id = await findOrCreateDmConversation(c.env, session.userId, user_id);
  return success(c, { id });
});

// GET /conversations/:id/messages
chatRoutes.get('/conversations/:id/messages', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  if (!(await requireMember(c.env, id, session.userId))) return error(c, 'FORBIDDEN', 'Not a member', 403);
  const since = c.req.query('since');
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const rows = since
    ? await c.env.DB.prepare(
        `SELECT id, user_id, body, sent_at, edited_at, deleted_at FROM messages
         WHERE conversation_id = ? AND sent_at > ? ORDER BY sent_at ASC LIMIT ?`
      ).bind(id, since, limit).all()
    : await c.env.DB.prepare(
        `SELECT id, user_id, body, sent_at, edited_at, deleted_at FROM messages
         WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT ?`
      ).bind(id, limit).all();
  return success(c, rows.results ?? []);
});

// POST /conversations/:id/messages
chatRoutes.post('/conversations/:id/messages', zValidator('json', z.object({ body: z.string().min(1).max(4000) })), async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  if (!(await requireMember(c.env, id, session.userId))) return error(c, 'FORBIDDEN', 'Not a member', 403);
  const locked = await c.env.DB.prepare(`SELECT locked_at FROM conversations WHERE id = ?`).bind(id).first<{ locked_at: string | null }>();
  if (locked?.locked_at) return error(c, 'LOCKED', 'Conversation locked', 423);

  const { body } = c.req.valid('json');
  const msg = await recordMessage(c.env, id, session.userId, body);

  // Fire push to OTHER members
  const others = await c.env.DB.prepare(
    `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? AND left_at IS NULL`
  ).bind(id, session.userId).all<{ user_id: string }>();
  const me = await c.env.DB.prepare(`SELECT name FROM users WHERE id = ?`).bind(session.userId).first<{ name: string }>();
  for (const m of others.results ?? []) {
    c.executionCtx.waitUntil(
      sendTypedNotification(c.env, {
        userId: m.user_id, type: 'chat_message',
        title: me?.name ?? 'Message', body: body.length > 140 ? body.slice(0, 137) + '...' : body,
        url: `/chat/${id}`,
      }).catch((err) => console.error('[chat] push failed', err)),
    );
  }
  return success(c, msg);
});

// POST /conversations/:id/read
chatRoutes.post('/conversations/:id/read', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  if (!(await requireMember(c.env, id, session.userId))) return error(c, 'FORBIDDEN', 'Not a member', 403);
  await markRead(c.env, id, session.userId);
  return success(c, { ok: true });
});

// GET /contacts?q=…
chatRoutes.get('/contacts', async (c) => {
  const session = c.get('session');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const like = `%${q}%`;
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.staff_id, d.name as directorate_name
     FROM users u LEFT JOIN directorates d ON d.id = u.directorate_id
     WHERE u.is_active = 1 AND u.id != ?
       AND (LOWER(u.name) LIKE ? OR LOWER(u.staff_id) LIKE ?)
     ORDER BY u.name LIMIT 50`
  ).bind(session.userId, like, like).all();
  return success(c, rows.results ?? []);
});

// DELETE /messages/:id
chatRoutes.delete('/messages/:id', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE messages SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), deleted_by = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
  ).bind(session.userId, id, session.userId).run();
  return success(c, { ok: true });
});
```

- [ ] **Step 3: Mount in `index.ts` + type-check + commit**

```ts
import { chatRoutes } from './routes/chat';
// after auth middleware:
app.route('/api/chat', chatRoutes);
```

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/chat.ts packages/api/src/services/notifier.ts packages/api/src/index.ts
git commit -m "feat(api): chat REST endpoints + push on new message"
```

### A.4: Staff PWA — list, conversation, new-DM picker

**Files:**
- Create: `packages/staff/src/pages/ChatListPage.tsx`
- Create: `packages/staff/src/pages/ChatConversationPage.tsx`
- Create: `packages/staff/src/pages/ChatNewPage.tsx`
- Create: `packages/staff/src/components/ChatBadge.tsx`
- Modify: `packages/staff/src/App.tsx`, `BottomNav.tsx`

Each page is ~120–180 lines. Pattern follows the `NoticesPage` style from Option 1: dark gradient background, gold accent, TanStack Query polling at 5–10 s for the list and 3 s for the open conversation.

- [ ] **Step 1: `ChatListPage.tsx`**

Renders one row per conversation: avatar (colour-blocked initials), name (other DM party / group title), last message preview, unread count chip, relative timestamp. Polls `GET /chat/conversations` every 10 s. Tap row → navigate `/chat/:id`. Floating "+ New" button → `/chat/new`.

- [ ] **Step 2: `ChatConversationPage.tsx`**

Header: back button, title (other party name / group title), member count for groups. Body: scrollable message list (newest at bottom; load older on scroll-to-top via `?before=<sent_at>` — note this requires adding a `before` cursor to `GET /messages`; small follow-up to A.3). Composer: textarea + send button. On mount: `POST /chat/conversations/:id/read`. Polls `GET .../messages?since=<latest>` every 3 s while focused. On send: optimistic append + revalidate.

- [ ] **Step 3: `ChatNewPage.tsx`**

Search input that hits `GET /chat/contacts?q=...`. Tapping a contact `POST /chat/dm` then navigates to the returned conversation id.

- [ ] **Step 4: `ChatBadge.tsx`**

Sums `unread` across all conversations (from the same query the list uses) — renders a chip if > 0.

- [ ] **Step 5: Wire routes + nav + commit**

```tsx
// App.tsx
<Route path="/chat" element={<ProtectedRoute><ChatListPage /></ProtectedRoute>} />
<Route path="/chat/new" element={<ProtectedRoute><ChatNewPage /></ProtectedRoute>} />
<Route path="/chat/:id" element={<ProtectedRoute><ChatConversationPage /></ProtectedRoute>} />
```

BottomNav adds Chat with `<ChatBadge />`. Now nav has: Clock / Notices / Chat / Settings (drop one if too crowded — recommendation: collapse Notices and Chat under one **Inbox** tab with sub-tabs, since both are passive-arrival surfaces).

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ChatListPage.tsx packages/staff/src/pages/ChatConversationPage.tsx packages/staff/src/pages/ChatNewPage.tsx packages/staff/src/components/ChatBadge.tsx packages/staff/src/App.tsx packages/staff/src/components/BottomNav.tsx
git commit -m "feat(staff): chat list, conversation, contact picker, nav"
```

### A.5: Smoke test + deploy

- [ ] **Step 1: Local smoke**

Two browser windows, two staff accounts. From window A, search → start DM with B → send "hello". Verify B's `/chat` list shows the conversation, badge shows 1, opening it shows the message and clears the badge after read. Send a reply from B. Verify A's poll picks it up within 3 s.

- [ ] **Step 2: Deploy**

Migrate remote D1, push to main, smoke on prod.

```bash
cd packages/api && node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-chat.sql
git push origin main
```

---

## Phase B — Real-time delivery (Durable Object + WebSocket)

Polling at 3 s in Phase A is functional but burns request quota and feels laggy. Phase B replaces it with a Durable Object per conversation that relays messages to connected WebSockets and falls back to push for offline members.

### B. Architecture

- New Durable Object class `ConversationDO` in `packages/api/src/durable/conversation-do.ts`.
- One DO instance per conversation id (sharded automatically by Cloudflare).
- `GET /api/chat/ws/:id` on the Worker → upgrades to WebSocket → forwards into the DO.
- DO holds the set of connected sockets, broadcasts incoming messages to all of them, persists nothing extra (messages still write to D1 for canonical storage).
- Client opens a single WebSocket on conversation page mount; closes on unmount.

### B. Tasks

- [ ] **B.1 — Add Durable Object binding to `wrangler.toml`**

```toml
[[durable_objects.bindings]]
name = "CONVERSATION_DO"
class_name = "ConversationDO"

[[migrations]]
tag = "v1"
new_classes = ["ConversationDO"]
```

- [ ] **B.2 — Implement `ConversationDO`**

```ts
import { DurableObject } from 'cloudflare:workers';

interface Sub { socket: WebSocket; userId: string }

export class ConversationDO extends DurableObject {
  private subs: Sub[] = [];

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const userId = url.searchParams.get('uid');
    if (!userId) return new Response('missing uid', { status: 400 });
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const sub: Sub = { socket: server, userId };
    this.subs.push(sub);

    server.addEventListener('close', () => {
      this.subs = this.subs.filter((s) => s !== sub);
    });
    server.addEventListener('error', () => {
      this.subs = this.subs.filter((s) => s !== sub);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called via RPC from the message-send handler
  async broadcast(message: unknown): Promise<void> {
    const json = JSON.stringify(message);
    for (const s of this.subs) {
      try { s.socket.send(json); } catch { /* drop */ }
    }
  }
}
```

- [ ] **B.3 — WebSocket upgrade route on the main Worker**

```ts
// in routes/chat.ts (or a new ws router)
chatRoutes.get('/ws/:id', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');
  if (!(await requireMember(c.env, id, session.userId))) return error(c, 'FORBIDDEN', 'Not a member', 403);
  const stub = c.env.CONVERSATION_DO.get(c.env.CONVERSATION_DO.idFromName(id));
  const url = new URL(c.req.url);
  url.searchParams.set('uid', session.userId);
  return stub.fetch(url.toString(), { headers: c.req.raw.headers });
});
```

- [ ] **B.4 — Send-message handler broadcasts via DO**

In the existing `POST /messages` handler, after `recordMessage(...)` and before push fan-out, call:

```ts
const stub = c.env.CONVERSATION_DO.get(c.env.CONVERSATION_DO.idFromName(id));
await stub.broadcast({ type: 'message', message: { id: msg.id, user_id: session.userId, body, sent_at: msg.sent_at } }).catch(() => {});
```

Push fan-out continues — push targets users **not** currently subscribed (they'll be offline on PWA). To avoid double-notifying a user who's both subscribed via WS and gets push, the simpler approach is to send push to all and have the client suppress notifications for the open conversation via the `tag` field; or maintain a "currently online users" set in the DO and skip them in push. Recommendation: **start with push-to-all** and add suppression only if it's actually annoying users.

- [ ] **B.5 — Client uses WebSocket instead of polling**

In `ChatConversationPage`:
- On mount: open `wss://<api-host>/api/chat/ws/:id?bearer=<token>` (the Worker auth middleware needs to accept a `bearer` query for WS; otherwise pass via `Sec-WebSocket-Protocol`).
- On `message` event: append to local message list.
- Keep an `onerror`/`onclose` reconnect with exponential backoff.
- Drop the polling interval.

- [ ] **B.6 — Type-check, deploy with `--keep-vars` to preserve secrets, smoke test**

After deploy: send a message from window A, confirm window B sees it within ~100 ms with no polling.

### B. Notes / risks

- **Worker auth on WebSocket upgrade.** Cookie auth works on WS upgrades only if the cookie is `SameSite=None; Secure`. Most browsers don't send `Authorization: Bearer` on WS upgrades, so the bearer fallback will need to be in the URL. Use a **short-lived chat-only token** issued by `GET /api/chat/ws-token` instead of leaking the long-lived bearer in URLs (URLs leak via logs / referrers). Add this token issuance + verification before B.3 ships.
- **DO cost.** ~$0.20 per million requests + duration. For an org of ~200 staff with normal chat volume, estimate < $5/month. Worth confirming on the Cloudflare pricing page before committing.

---

## Phase C — Groups + moderation

### C. Scope

- **Group conversations.** Multi-member, named, with admins.
- **Member management.** Add / remove / leave, transfer admin.
- **Admin moderation.** Lock conversation (no new messages); soft-delete any message; per-conversation audit log of admin actions.
- **Retention sweep.** Cron deletes (hard or soft, per policy) messages older than the configured retention window.
- **Blocklist.** A user can block another from DMing them; admins can globally suspend chat for a user.

### C. Tasks (high-level)

- [ ] **C.1 — Schema additions**
  - New table `chat_audit_events` (`id`, `conversation_id`, `actor_user_id`, `action`, `target_user_id`, `target_message_id`, `meta`, `created_at`).
  - New table `chat_blocks` (`blocker_user_id`, `blockee_user_id`, `created_at`, PK both).
  - Add `chat_disabled` boolean to `users` (admin can suspend).

- [ ] **C.2 — Group-conversation routes**
  - `POST /api/chat/groups` — body `{ title, member_ids }`. Creates group, creator is admin.
  - `POST /api/chat/conversations/:id/members` — admin only.
  - `DELETE /api/chat/conversations/:id/members/:user_id` — admin only.
  - `POST /api/chat/conversations/:id/leave` — sets `left_at`.
  - `PATCH /api/chat/conversations/:id` — title (admin only).

- [ ] **C.3 — Admin moderation routes**
  - `POST /api/admin/chat/conversations/:id/lock` (and `/unlock`).
  - `DELETE /api/admin/chat/messages/:id` — admin soft-delete.
  - `GET /api/admin/chat/audit?conversation_id=...` — chronological audit log.
  - `POST /api/admin/users/:id/chat-disable` (and `enable`).

- [ ] **C.4 — Block list**
  - `POST /api/chat/blocks` — `{ user_id }`.
  - `DELETE /api/chat/blocks/:user_id`.
  - `findOrCreateDmConversation` checks blocklist before opening; returns 423 if blocked either way.

- [ ] **C.5 — Retention cron**
  - New entry in `wrangler.toml`: `crons = [..., "0 2 * * 0"]` (weekly Sunday 02:00 UTC).
  - Service `services/chat-retention.ts` deletes messages older than `RETENTION_DAYS` (env var, default 365). Audit row written.
  - Scheduled handler in `index.ts` dispatches.

- [ ] **C.6 — UI**
  - New group pages: `ChatGroupNewPage`, `ChatGroupSettingsPage`.
  - Admin SPA: `ChatModerationTab` — list of conversations with last-activity, lock/unlock buttons, view audit log, delete-message tool with confirmation.

- [ ] **C.7 — Smoke + deploy**

### C. Notes / risks

- **Phase C size.** Larger than A and B combined. Plan ~3–4 weeks of work to do it right.
- **Acceptable-use prompt.** Before chat is usable on first open, surface a one-time modal where the user accepts the OHCS chat policy. Record acceptance in `users.chat_policy_accepted_at`. Without this, the legal/HR conversation isn't really closed.
- **Search.** Org-wide message search is a common request once chat exists. It's a meaningful add — D1 FTS5 virtual table works, but adds cost and complexity. **Defer to Phase D** if needed.

---

## Self-Review Notes

- **Spec coverage:**
  - DM + history → Phase A.
  - Real-time delivery → Phase B.
  - Groups + moderation + retention → Phase C.
  - Push notification when offline → Phase A (and Phase B retains it).
- **Decisions still required (carried over from Prerequisites):** retention period, audit access policy, acceptable-use language, DM-vs-group-only, suspended-staff access.
- **Effort estimate:**
  - Phase A: ~ size of NSS Phase 4 (~1 week).
  - Phase B: ~ 4–5 days once auth-on-WS is solved.
  - Phase C: ~ 3–4 weeks (the moderation + audit + retention + UI is not small).
  - **Total: ~5–7 weeks** of focused work, vs ~1 week for Option 1 and ~1.5 weeks for Option 2.
- **Cost:** Phase B's DO usage is the only new line item. At ~200 staff with typical chat volume, expect single-digit USD/month. Validate on Cloudflare pricing page.
- **Out of scope (intentional, even at the end of Phase C):**
  - Voice/video calls — entirely different stack.
  - File attachments — feasible via R2 in a Phase D, deliberately out for now.
  - Threaded replies inside a message — common ask but adds significant UI complexity; defer until people actually need it.
  - Read receipts at the per-message level (only conversation-level last_read here).
  - Typing indicators — possible via DO presence in Phase B follow-up, deliberately omitted.
- **Honest framing for the boss:** Chat is the option that buys the most user-perceived "modern app" feel and the most ongoing maintenance / governance burden. The other two (Announcements, Feedback) deliver much of the practical workplace value at a fraction of the cost. Recommend Option 1 or Option 2 unless there's a specific operational need DMs solve that announcements + feedback can't.
