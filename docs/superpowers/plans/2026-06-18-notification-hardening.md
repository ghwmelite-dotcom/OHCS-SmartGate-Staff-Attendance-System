# Notification Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram + Web Push delivery observable (prod logs + KV counters) and stop silent drops (count failures, clean up dead push subscriptions on 410, log unreachable recipients) — with no change to who is notified or via what channel.

**Architecture:** One shared `recordNotifyOutcome` helper (prod log line + KV daily per-channel counter) that the Telegram call sites and the existing push status tracker both feed. The push send loop acts on the returned status to delete `410`/`404` subscriptions. Logs carry IDs/status only — never visitor PII.

**Tech Stack:** Cloudflare Workers (Hono), D1, KV; vitest (pure-function + fetch-stub tests).

**Reference spec:** `docs/superpowers/specs/2026-06-18-notification-hardening-design.md`

**Toolchain note (repo path has a space + `&`):** never `npm run`; from `packages/api`:
- type-check: `node ../../node_modules/typescript/bin/tsc --noEmit`
- tests: `node ../../node_modules/vitest/vitest.mjs run <file>`

**Verified current code:**
- `services/telegram.ts:10` `sendTelegramMessage({chatId,text,token}): Promise<boolean>` returns `res.ok`; non-OK responses return false with no log; `catch` does `console.error` + returns false.
- `lib/webpush.ts:97` `trackPushStatus(env, status)` writes `push-stat:<date>:<status>` KV counters; `sendWebPush(...)` (line 123) returns the HTTP status and calls `trackPushStatus` internally.
- `services/notifier.ts:181-192` `sendTypedNotification` push loop maps `push_subscriptions` → `sendWebPush(...).catch(devError)` — status ignored, no 410 cleanup. Telegram call sites at lines 80-86, 92-98 (notifyHostStaff) and 127-133, 139-145 (notifyDirectorateLeadership) ignore the returned boolean. `findUserByOfficer` resolves the officer→user at line 89.

---

## File Structure

**Create:**
- `packages/api/src/lib/notify-metrics.ts` — `recordNotifyOutcome(env, channel, ok, detail?)` + `isDeadPushStatus(status)`.
- `packages/api/src/lib/notify-metrics.test.ts` — unit tests.
- `packages/api/src/services/telegram.test.ts` — `sendTelegramMessage` outcome tests.

**Modify:**
- `packages/api/src/lib/webpush.ts` — `trackPushStatus` delegates to `recordNotifyOutcome`.
- `packages/api/src/services/telegram.ts` — log non-OK responses (status only).
- `packages/api/src/services/notifier.ts` — count Telegram outcomes at the 4 call sites; rewrite the push loop for 410/404 cleanup; log unreachable recipients.

---

### Task 1: `recordNotifyOutcome` + `isDeadPushStatus` (TDD)

**Files:** Create `packages/api/src/lib/notify-metrics.ts`, `packages/api/src/lib/notify-metrics.test.ts`.

- [ ] **Step 1: Write the failing test**

`packages/api/src/lib/notify-metrics.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { recordNotifyOutcome, isDeadPushStatus } from './notify-metrics';

function kvStub() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

describe('recordNotifyOutcome', () => {
  it('increments an ok counter keyed by date+channel', async () => {
    const kv = kvStub();
    await recordNotifyOutcome({ KV: kv } as never, 'telegram', true);
    const key = [...kv.store.keys()][0]!;
    expect(key).toMatch(/^notify-stat:\d{4}-\d{2}-\d{2}:telegram:ok$/);
    expect(kv.store.get(key)).toBe('1');
    await recordNotifyOutcome({ KV: kv } as never, 'telegram', true);
    expect(kv.store.get(key)).toBe('2');
  });
  it('uses a fail counter when not ok', async () => {
    const kv = kvStub();
    await recordNotifyOutcome({ KV: kv } as never, 'push', false, '410');
    expect([...kv.store.keys()][0]).toMatch(/:push:fail$/);
  });
  it('never throws when KV fails', async () => {
    const kv = { get: vi.fn(async () => { throw new Error('kv down'); }), put: vi.fn() };
    await expect(recordNotifyOutcome({ KV: kv } as never, 'push', true)).resolves.toBeUndefined();
  });
});

describe('isDeadPushStatus', () => {
  it('is true for 404 and 410', () => {
    expect(isDeadPushStatus(410)).toBe(true);
    expect(isDeadPushStatus(404)).toBe(true);
  });
  it('is false for success/other statuses', () => {
    expect(isDeadPushStatus(201)).toBe(false);
    expect(isDeadPushStatus(429)).toBe(false);
    expect(isDeadPushStatus(0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/lib/notify-metrics.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/notify-metrics.ts`**

```ts
export type NotifyChannel = 'telegram' | 'push';

// Records a delivery outcome: a structured production log line (visible via
// `wrangler tail` / Logpush) + a best-effort KV daily counter. Logs carry only
// channel/outcome/status — never the message body or any visitor PII. Never
// throws into the delivery path.
export async function recordNotifyOutcome(
  env: { KV: KVNamespace },
  channel: NotifyChannel,
  ok: boolean,
  detail?: string,
): Promise<void> {
  const line = JSON.stringify({ kind: 'notify', channel, ok, ...(detail ? { detail } : {}) });
  if (ok) console.log(line); else console.warn(line);
  try {
    const date = new Date().toISOString().slice(0, 10);
    const key = `notify-stat:${date}:${channel}:${ok ? 'ok' : 'fail'}`;
    const raw = await env.KV.get(key);
    const n = raw ? parseInt(raw, 10) : 0;
    await env.KV.put(key, String(n + 1), { expirationTtl: 35 * 86400 });
  } catch {
    // Counters are best-effort — never let them affect delivery.
  }
}

// Web Push statuses that mean the subscription is dead and should be removed.
export function isDeadPushStatus(status: number): boolean {
  return status === 404 || status === 410;
}
```

- [ ] **Step 4: Run tests — PASS (5)**

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/lib/notify-metrics.test.ts` → 5 pass. Then `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 5: Refactor `trackPushStatus` to delegate (unify counters)**

In `packages/api/src/lib/webpush.ts`, add the import at the top:
```ts
import { recordNotifyOutcome } from './notify-metrics';
```
Replace the `trackPushStatus` body (lines ~97-107) with a delegation (keeps the same call sites in `sendWebPush` unchanged):
```ts
async function trackPushStatus(env: { KV: KVNamespace }, status: number): Promise<void> {
  await recordNotifyOutcome(env, 'push', status >= 200 && status < 300, String(status));
}
```
Run `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**
```
git add packages/api/src/lib/notify-metrics.ts packages/api/src/lib/notify-metrics.test.ts packages/api/src/lib/webpush.ts
git commit -m "feat(notify): add recordNotifyOutcome (logs + KV counters), unify push counting"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 2: Telegram — log non-OK + count outcomes + log unreachable

**Files:** Create `packages/api/src/services/telegram.test.ts`; Modify `packages/api/src/services/telegram.ts`, `packages/api/src/services/notifier.ts`.

- [ ] **Step 1: Write the failing test for `sendTelegramMessage`**

`packages/api/src/services/telegram.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendTelegramMessage } from './telegram';

afterEach(() => vi.unstubAllGlobals());

describe('sendTelegramMessage', () => {
  it('returns true on an OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await sendTelegramMessage({ chatId: '1', text: 'x', token: 't' })).toBe(true);
  });
  it('returns false and warns on a non-OK response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    expect(await sendTelegramMessage({ chatId: '1', text: 'x', token: 't' })).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await sendTelegramMessage({ chatId: '1', text: 'x', token: 't' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL** (the non-OK case fails: no warn yet).

From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run src/services/telegram.test.ts`.

- [ ] **Step 3: Log non-OK in `sendTelegramMessage`**

In `packages/api/src/services/telegram.ts`, change the `try` body so a non-OK response is logged (status only — never `text`/PII):
```ts
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) console.warn(JSON.stringify({ kind: 'notify', channel: 'telegram', ok: false, detail: String(res.status) }));
    return res.ok;
  } catch (err) {
    console.error('[Telegram] Send failed:', err);
    return false;
  }
```

- [ ] **Step 4: Run tests — PASS (3).**

- [ ] **Step 5: Count Telegram outcomes at the call sites + log unreachable (`notifier.ts`)**

Add the import near the top of `packages/api/src/services/notifier.ts`:
```ts
import { recordNotifyOutcome } from '../lib/notify-metrics';
```
At EACH of the four `await sendTelegramMessage({...})` calls (two in `notifyHostStaff`, two in `notifyDirectorateLeadership`), capture the result and record it. Pattern (apply to all four):
```ts
      const ok = await sendTelegramMessage({
        chatId: officer.telegram_chat_id,
        text: formatVisitorMessage(data, 'host'),
        token: env.TELEGRAM_BOT_TOKEN,
      });
      await recordNotifyOutcome(env, 'telegram', ok);
```
(Use the correct `chatId`/recipientType for each site — `officer.telegram_chat_id`/`kvChatId` and `'host'`/`'director'` exactly as they are today; only wrap with `const ok = ...` + `recordNotifyOutcome`.)

In `notifyHostStaff`, immediately AFTER `const user = await findUserByOfficer(officer, env);` (line ~89), add the unreachable signal:
```ts
  if (!officer.telegram_chat_id && !user) {
    console.warn(JSON.stringify({ kind: 'notify', channel: 'none', ok: false, detail: 'unreachable', officer_id: officer.id, visit_id: data.visit_id }));
  }
```

- [ ] **Step 6: Type-check**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**
```
git add packages/api/src/services/telegram.ts packages/api/src/services/telegram.test.ts packages/api/src/services/notifier.ts
git commit -m "feat(notify): log non-OK Telegram sends, count outcomes, flag unreachable recipients"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 3: Web Push — delete dead subscriptions on 410/404

**Files:** Modify `packages/api/src/services/notifier.ts`.

- [ ] **Step 1: Rewrite the push loop in `sendTypedNotification`**

Add `isDeadPushStatus` to the existing import:
```ts
import { recordNotifyOutcome, isDeadPushStatus } from '../lib/notify-metrics';
```
Replace the push-subscription loop (currently lines ~184-191) — capture the status, delete dead subscriptions, and record exceptions (success/failure status counting already happens inside `sendWebPush` via `trackPushStatus`, so don't double-count there):
```ts
    await Promise.all(
      (subs.results ?? []).map(async (s) => {
        const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
        try {
          const status = await sendWebPush(target, { title: opts.title, body: opts.body, url: opts.url, type: opts.type }, env);
          if (isDeadPushStatus(status)) {
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
            console.warn(JSON.stringify({ kind: 'notify', channel: 'push', ok: false, detail: `cleaned ${status}` }));
          }
        } catch (err) {
          await recordNotifyOutcome(env, 'push', false, 'exception');
          devError(env, '[webpush] send threw', err);
        }
      }),
    );
```
(`devError` import stays — now only used for the verbose exception object in dev; the prod-visible signal is `recordNotifyOutcome`. The per-status counter is still recorded inside `sendWebPush`→`trackPushStatus`→`recordNotifyOutcome`.)

- [ ] **Step 2: Type-check + full api tests**

From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS; `node ../../node_modules/vitest/vitest.mjs run` → all PASS (incl. the new `notify-metrics` + `telegram` tests; existing suite unchanged).

- [ ] **Step 3: Commit**
```
git add packages/api/src/services/notifier.ts
git commit -m "feat(notify): delete dead push subscriptions on 410/404, record push exceptions"
```
(End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 4: Full verification (static)

**Files:** none.

- [ ] **Step 1:** From `packages/api`: `node ../../node_modules/vitest/vitest.mjs run` → ALL pass (adds `notify-metrics.test.ts` 5 + `telegram.test.ts` 3; existing suite green).
- [ ] **Step 2:** From `packages/api`: `node ../../node_modules/typescript/bin/tsc --noEmit` → PASS.
- [ ] **Step 3:** Confirm no behavioural change to recipients/channels by reading the `notifier.ts` diff: the only additions are `recordNotifyOutcome` calls, the unreachable `console.warn`, and the 410/404 `DELETE`. No recipient query or channel selection changed.
- [ ] **Step 4: No commit** — report results.

---

## Self-Review

**Spec coverage:**
- A. Unified `recordNotifyOutcome` (logs + KV counters); `trackPushStatus` delegates → Task 1. ✓
- B. Telegram logs non-OK (status only) + counts outcomes at all 4 call sites → Task 2. ✓
- C. Push acts on status: delete `push_subscriptions` on 410/404; failures counted (inside sendWebPush) + exceptions recorded; dev-only swallow replaced → Task 3. ✓
- D. Unreachable-on-every-channel logged with officer id + visit id → Task 2 Step 5. ✓
- Privacy: logs carry channel/status/ids only — never `text`/name/purpose → enforced in Tasks 1-3 (no message body in any log line). ✓
- Out of scope honored: no retries/queues, no audit table, no recipient/channel change → confirmed in Task 4 Step 3. ✓

**Placeholder scan:** No TBDs; every code step has full code; commands have expected output. "apply to all four" names the exact call sites + the exact wrap pattern.

**Type consistency:** `recordNotifyOutcome(env: {KV}, channel: 'telegram'|'push', ok, detail?)` and `isDeadPushStatus(status)` defined in Task 1 and used identically in Tasks 2-3 and the `trackPushStatus` refactor. `NotifyChannel` union covers both uses. Log shape `{kind:'notify', channel, ok, detail?}` is consistent across telegram.ts, notify-metrics.ts, and the notifier push/unreachable logs.

**Testability note:** `recordNotifyOutcome`, `isDeadPushStatus`, and `sendTelegramMessage` are unit-tested. The notifier wiring (DB DELETE, call-site counting, unreachable log) is DB/branch glue verified by type-check + the no-regression suite + review + the manual post-deploy `wrangler tail` check — consistent with how this repo verifies route/service glue.

## Deployment

No DB migration, no schema change — a normal merge → `deploy.yml`. Post-deploy: tail logs (`wrangler tail`) during a check-in to confirm `{"kind":"notify",...}` lines appear, and confirm a stale push subscription is deleted on a 410.
