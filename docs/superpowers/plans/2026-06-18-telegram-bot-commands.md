# Telegram Bot Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished self-service command set (`/help`, `/status`, `/unlink` + refined `/start`) and register the Telegram command menu, replacing the webhook's `if`-chain with a tested `parseCommand` dispatcher.

**Architecture:** A pure `parseCommand(text)` + a code-defined `BOT_COMMANDS` list + `setBotCommands` live in `services/telegram.ts`. The webhook (`routes/telegram.ts`) dispatches via a `switch` to small per-command handlers. A superadmin endpoint pushes the menu to Telegram. The old `parseStartToken` is replaced by `parseCommand`.

**Tech Stack:** Cloudflare Workers (Hono), D1, KV; vitest (pure-function + fetch-stub tests).

**Reference spec:** `docs/superpowers/specs/2026-06-18-telegram-bot-commands-design.md`

**Toolchain note (repo path has a space + `&`):** never `npm run`; from `packages/api`:
- type-check: `node ../../node_modules/typescript/bin/tsc --noEmit`
- tests: `node ../../node_modules/vitest/vitest.mjs run <file>`

**Verified current code (`routes/telegram.ts`):** webhook reads `chatId = body.message.chat.id`, `text = body.message.text.trim()`; handles `/start` (+`/start <token>` deep-link via `parseStartToken`), `/link <StaffID>` (sets `officers.telegram_chat_id` if an officer matches by email/name + KV `telegram-user:<userId>`), `/admin` (KV `telegram-admin-chat-id`), `/stop`. `telegramLinkRoute` + `linkSchema` are separate and stay. `parseStartToken` is in `services/telegram.ts` with tests in `services/telegram.test.ts`.

---

## File Structure

**Create:**
- `packages/api/src/routes/admin-telegram.ts` — superadmin `POST /sync-commands`.

**Modify:**
- `packages/api/src/services/telegram.ts` — add `parseCommand`, `BOT_COMMANDS`, `setBotCommands`; later remove `parseStartToken`.
- `packages/api/src/services/telegram.test.ts` — add `parseCommand`/`BOT_COMMANDS` tests; remove `parseStartToken` tests.
- `packages/api/src/routes/telegram.ts` — `parseCommand` dispatch + new handlers.
- `packages/api/src/index.ts` — mount `adminTelegramRoutes`.

---

### Task 1: `parseCommand` + `BOT_COMMANDS` + `setBotCommands` (TDD)

**Files:** Modify `packages/api/src/services/telegram.ts`, `packages/api/src/services/telegram.test.ts`.

- [ ] **Step 1: Add failing tests** — append to `packages/api/src/services/telegram.test.ts`:
```ts
import { parseCommand, BOT_COMMANDS } from './telegram';

describe('parseCommand', () => {
  it('splits command and args', () => {
    expect(parseCommand('/link 123')).toEqual({ command: 'link', args: '123' });
  });
  it('returns empty args for a bare command', () => {
    expect(parseCommand('/help')).toEqual({ command: 'help', args: '' });
  });
  it('keeps the full remainder as args', () => {
    expect(parseCommand('/start tok')).toEqual({ command: 'start', args: 'tok' });
  });
  it('strips a @BotName suffix and lowercases', () => {
    expect(parseCommand('/Start@ohcs_smartgate_bot tok')).toEqual({ command: 'start', args: 'tok' });
  });
  it('trims surrounding whitespace', () => {
    expect(parseCommand('   /status  ')).toEqual({ command: 'status', args: '' });
  });
  it('returns null for non-commands and a lone slash', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});

describe('BOT_COMMANDS', () => {
  it('every entry is a valid Telegram command + non-empty description', () => {
    expect(BOT_COMMANDS.length).toBeGreaterThan(0);
    for (const c of BOT_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });
});
```

- [ ] **Step 2: Run — confirm FAIL** (`parseCommand`/`BOT_COMMANDS` not exported). From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/services/telegram.test.ts`.

- [ ] **Step 3: Implement in `services/telegram.ts`** (add near the top exports; keep `parseStartToken` for now):
```ts
export function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const m = trimmed.slice(1).match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const command = m[1]!.split('@')[0]!.toLowerCase();
  if (!command) return null;
  return { command, args: (m[2] ?? '').trim() };
}

export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'start',  description: 'What this bot does' },
  { command: 'help',   description: 'Show all commands' },
  { command: 'link',   description: 'Link your Staff ID to receive alerts' },
  { command: 'status', description: 'Check your link & alert status' },
  { command: 'unlink', description: 'Stop receiving visitor alerts' },
  { command: 'admin',  description: 'Get daily attendance summaries' },
  { command: 'stop',   description: 'Stop daily summaries' },
];

// Publish the command menu to Telegram (global; persists until re-pushed). Best-effort.
export async function setBotCommands(env: { TELEGRAM_BOT_TOKEN: string }): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests — PASS.** Then `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**
```
git add packages/api/src/services/telegram.ts packages/api/src/services/telegram.test.ts
git commit -m "feat(telegram): add parseCommand, BOT_COMMANDS, setBotCommands"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 2: Webhook dispatch + new handlers; retire `parseStartToken`

**Files:** Modify `packages/api/src/routes/telegram.ts`, `packages/api/src/services/telegram.ts`, `packages/api/src/services/telegram.test.ts`.

- [ ] **Step 1: Rewrite the webhook in `routes/telegram.ts`**

Change the import line (drop `parseStartToken`, add `parseCommand`; keep the rest):
```ts
import { generateLinkCode, consumeLinkCode, sendTelegramMessage, parseCommand } from '../services/telegram';
```
Replace the whole `telegramWebhook` function body's command section (everything from `if (text === '/start'...` through the final `return c.json({ ok: true })`, i.e. lines ~30-142) with a dispatcher + handlers. The pre-amble (webhook-secret check, `body`/`chatId`/`text` parsing, the `if (!chatId || !text)` guard) stays. New dispatcher:
```ts
  const cmd = parseCommand(text);
  if (!cmd) return c.json({ ok: true }); // ignore non-command chatter

  switch (cmd.command) {
    case 'start':  await handleStart(c, chatId, cmd.args); break;
    case 'help':   await handleHelp(c, chatId); break;
    case 'link':   await handleLink(c, chatId, cmd.args); break;
    case 'status': await handleStatus(c, chatId); break;
    case 'unlink': await handleUnlink(c, chatId); break;
    case 'admin':  await handleAdmin(c, chatId); break;
    case 'stop':   await handleStop(c, chatId); break;
    default:
      await sendTelegramMessage({ chatId: String(chatId), text: 'I don’t recognise that command. Send /help to see what I can do.', token: c.env.TELEGRAM_BOT_TOKEN });
  }
  return c.json({ ok: true });
}
```
Then add the handler functions BELOW `telegramWebhook` (and above `telegramLinkRoute`). They are behaviour-preserving for start/link/admin/stop:
```ts
type Ctx = Context<{ Bindings: Env }>;

async function handleStart(c: Ctx, chatId: number, args: string): Promise<void> {
  if (args) {
    const officerId = await c.env.KV.get(`officer-link:${args}`);
    if (officerId) {
      await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?').bind(String(chatId), officerId).run();
      await c.env.KV.delete(`officer-link:${args}`);
      const row = await c.env.DB.prepare(
        `SELECT o.name, d.abbreviation AS dir FROM officers o LEFT JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
      ).bind(officerId).first<{ name: string; dir: string | null }>();
      await sendTelegramMessage({
        chatId: String(chatId),
        text: `✅ <b>Linked!</b>\n\n${row?.name ?? 'You'} will now receive visitor arrival alerts${row?.dir ? ` for ${row.dir}` : ''}.`,
        token: c.env.TELEGRAM_BOT_TOKEN,
      });
      return;
    }
    // invalid/expired token → fall through to the greeting (no error leak)
  }
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [
      `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot</b>`,
      '',
      `I send visitor-arrival alerts and daily attendance summaries.`,
      '',
      `Send /help to see everything I can do, or /link &lt;StaffID&gt; to start receiving alerts.`,
    ].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleHelp(c: Ctx, chatId: number): Promise<void> {
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [
      `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot — Commands</b>`,
      '',
      `/link &lt;StaffID&gt; — Link your account to receive alerts`,
      `/status — Check your link &amp; alert status`,
      `/unlink — Stop receiving visitor alerts`,
      `/admin — Get daily attendance summaries`,
      `/stop — Stop daily summaries`,
      `/help — Show this list`,
    ].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleLink(c: Ctx, chatId: number, args: string): Promise<void> {
  const staffId = args.trim().toUpperCase();
  if (!staffId) {
    await sendTelegramMessage({ chatId: String(chatId), text: `Please include your Staff ID.\n\nExample: <code>/link 1334685</code>`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  const user = await c.env.DB.prepare('SELECT id, name, email FROM users WHERE staff_id = ?').bind(staffId).first<{ id: string; name: string; email: string }>();
  if (!user) {
    await sendTelegramMessage({ chatId: String(chatId), text: `❌ Staff ID <code>${staffId}</code> not found. Check your ID and try again.`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE email = ? OR name = ?').bind(user.email, user.name).first<{ id: string }>();
  if (officer) {
    await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?').bind(String(chatId), officer.id).run();
  }
  await c.env.KV.put(`telegram-user:${user.id}`, String(chatId));
  await sendTelegramMessage({
    chatId: String(chatId),
    text: [`✅ <b>Linked successfully!</b>`, '', `\u{1F464} ${user.name}`, `\u{1F4CB} Staff ID: ${staffId}`, '', `You'll now receive visitor arrival notifications. Send /admin for daily summaries.`].join('\n'),
    token: c.env.TELEGRAM_BOT_TOKEN,
  });
}

async function handleStatus(c: Ctx, chatId: number): Promise<void> {
  const officer = await c.env.DB.prepare(
    `SELECT o.name, d.abbreviation AS dir FROM officers o LEFT JOIN directorates d ON o.directorate_id = d.id WHERE o.telegram_chat_id = ? LIMIT 1`
  ).bind(String(chatId)).first<{ name: string; dir: string | null }>();
  const summariesOn = (await c.env.KV.get('telegram-admin-chat-id')) === String(chatId);
  const lines = [`\u{1F4CB} <b>Your status</b>`, ''];
  lines.push(officer
    ? `Visitor alerts: <b>ON</b> — linked as ${officer.name}${officer.dir ? ` (${officer.dir})` : ''}.`
    : `Visitor alerts: <b>OFF</b> — not linked. Send /link &lt;StaffID&gt;, or use the link from reception.`);
  lines.push(`Daily summaries: <b>${summariesOn ? 'ON' : 'OFF'}</b>.`);
  await sendTelegramMessage({ chatId: String(chatId), text: lines.join('\n'), token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleUnlink(c: Ctx, chatId: number): Promise<void> {
  const rows = (await c.env.DB.prepare('SELECT id, email, name FROM officers WHERE telegram_chat_id = ?').bind(String(chatId)).all<{ id: string; email: string | null; name: string }>()).results ?? [];
  if (rows.length === 0) {
    await sendTelegramMessage({ chatId: String(chatId), text: `You aren’t linked, so there’s nothing to unlink.`, token: c.env.TELEGRAM_BOT_TOKEN });
    return;
  }
  // Also clear any KV telegram-user mapping that points at this chat (set by /link),
  // otherwise the notifier's secondary path would keep DMing this chat.
  for (const o of rows) {
    let user = o.email ? await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(o.email).first<{ id: string }>() : null;
    if (!user) user = await c.env.DB.prepare('SELECT id FROM users WHERE name = ?').bind(o.name).first<{ id: string }>();
    if (user && (await c.env.KV.get(`telegram-user:${user.id}`)) === String(chatId)) {
      await c.env.KV.delete(`telegram-user:${user.id}`);
    }
  }
  await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').bind(String(chatId)).run();
  await sendTelegramMessage({ chatId: String(chatId), text: `Done — you’ll no longer receive visitor alerts. Re-link any time with /link or a fresh link from reception.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleAdmin(c: Ctx, chatId: number): Promise<void> {
  await c.env.KV.put('telegram-admin-chat-id', String(chatId));
  await sendTelegramMessage({ chatId: String(chatId), text: `✅ <b>Daily summaries enabled!</b>\n\nYou’ll receive attendance reports at 9:00 AM (Mon–Fri).\n\nSend /stop to unsubscribe.`, token: c.env.TELEGRAM_BOT_TOKEN });
}

async function handleStop(c: Ctx, chatId: number): Promise<void> {
  await c.env.KV.delete('telegram-admin-chat-id');
  await sendTelegramMessage({ chatId: String(chatId), text: `Daily summaries disabled. Send /admin to re-enable.`, token: c.env.TELEGRAM_BOT_TOKEN });
}
```
Ensure `Context` is imported (it already is: `import type { Context } from 'hono';`). `Env`/`SessionData` imports stay.

- [ ] **Step 2: Retire `parseStartToken`**

In `services/telegram.ts`, delete the `parseStartToken` function (now unused — the webhook uses `parseCommand`). In `services/telegram.test.ts`, delete the `describe('parseStartToken', …)` block and its `import { parseStartToken }` (its coverage is now in the `parseCommand` tests). Grep to confirm no other `parseStartToken` references remain: `node -e "0"` then a search — expected zero hits in `src`.

- [ ] **Step 3: Type-check + tests**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS (resolves any now-unused import). `node ../../node_modules/vitest/vitest.mjs run` → all PASS.

- [ ] **Step 4: Commit**
```
git add packages/api/src/routes/telegram.ts packages/api/src/services/telegram.ts packages/api/src/services/telegram.test.ts
git commit -m "feat(telegram): command dispatcher + /help /status /unlink, refined /start; drop parseStartToken"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 3: `sync-commands` admin endpoint

**Files:** Create `packages/api/src/routes/admin-telegram.ts`; Modify `packages/api/src/index.ts`.

- [ ] **Step 1: Create the route** `packages/api/src/routes/admin-telegram.ts`:
```ts
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { setBotCommands } from '../services/telegram';

export const adminTelegramRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Publish the bot's command menu to Telegram (superadmin).
adminTelegramRoutes.post('/sync-commands', async (c) => {
  if (c.get('session').role !== 'superadmin') return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  const ok = await setBotCommands(c.env);
  return success(c, { ok });
});
```

- [ ] **Step 2: Mount in `index.ts`**

Add the import with the other route imports:
```ts
import { adminTelegramRoutes } from './routes/admin-telegram';
```
Mount it in the protected section (after `app.use('/api/*', authMiddleware)`, alongside the other `app.route('/api/admin/...', ...)` lines):
```ts
app.route('/api/admin/telegram', adminTelegramRoutes);
```

- [ ] **Step 3: Type-check** — from `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**
```
git add packages/api/src/routes/admin-telegram.ts packages/api/src/index.ts
git commit -m "feat(admin): POST /api/admin/telegram/sync-commands to publish the bot command menu"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 4: Full verification (static)

**Files:** none.

- [ ] **Step 1:** From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run` → ALL pass (adds the `parseCommand`/`BOT_COMMANDS` tests; `parseStartToken` tests removed; rest green). `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
- [ ] **Step 2:** Grep confirms `parseStartToken` no longer appears anywhere under `packages/api/src`.
- [ ] **Step 3:** Read the webhook diff to confirm: `/link`, `/admin`, `/stop`, and `/start <token>` behaviour is preserved (same KV keys, same SQL, same messages where unchanged); only the dispatch shape changed + new handlers added.
- [ ] **Step 4: No commit** — report results.

---

## Deployment (controller-run, after merge)

No DB/schema change — normal merge → `deploy.yml`. **Post-deploy, once:** a superadmin calls `POST /api/admin/telegram/sync-commands` (authenticated; e.g. from the app, or curl with a superadmin session) to publish the menu. Then `/` in the bot shows the seven commands.

---

## Self-Review

**Spec coverage:**
- A. `parseCommand` (pure, @BotName-stripping, replaces parseStartToken) → Task 1 + Task 2 Step 2. ✓
- B. `BOT_COMMANDS` + `setBotCommands` → Task 1. ✓
- C. Webhook dispatch + handlers (start/help/link/status/unlink/admin/stop + unknown-command fallback; non-command ignored) → Task 2. ✓
- D. `/status` (officer linkage + summaries state) → Task 2 `handleStatus`. ✓
- E. `/unlink` clears officer column AND KV `telegram-user` → Task 2 `handleUnlink`. ✓
- F. Superadmin `sync-commands` endpoint → Task 3. ✓
- Existing `/link`,`/admin`,`/stop`,`/start <token>` preserved → Task 2 (behaviour-preserving handlers). ✓

**Placeholder scan:** No TBDs; full code in every step; commands have expected output. HTML replies correctly escape literals (`&lt;StaffID&gt;`, `&amp;`).

**Type consistency:** `parseCommand(text): {command, args} | null` defined in Task 1, consumed identically in Task 2. `setBotCommands(env)` defined in Task 1, used in Task 3. `BOT_COMMANDS` shape (`{command, description}`) consistent across Task 1 + its test. Handler signatures `(c: Ctx, chatId: number, args?: string)` consistent. KV keys (`officer-link:`, `telegram-user:`, `telegram-admin-chat-id`) identical to the current code.

**Testability note:** `parseCommand` + `BOT_COMMANDS` are unit-tested; the webhook handlers + `setBotCommands` + the endpoint are DB/HTTP glue verified by type-check + the no-regression suite + review + the on-device command run — consistent with how this repo verifies route glue.
