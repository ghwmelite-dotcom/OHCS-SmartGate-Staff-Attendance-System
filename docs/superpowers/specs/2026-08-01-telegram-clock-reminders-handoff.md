# Handoff Brief — Telegram-delivered clock-in / clock-out reminders

**For:** an implementing agent (Kimi Code) starting cold in this repo.
**Date:** 2026-08-01
**Deadline context:** RSIMD pilot relies on this from **Monday**. Keep scope tight; this is additive to a working system.

---

## 1. Goal (what we're building)

Staff Attendance currently nudges officers to clock in (mornings) and clock out
(evenings) via **web push + an in-app bell**. Web push on installed PWAs is
proving unreliable, so we are adding **Telegram as the primary phone channel**.

When a staff member opens the app to clock in, show a sleek banner that lets
them link their Telegram account in one tap. Once linked, their morning
clock-in and evening clock-out reminders arrive as Telegram messages.

### Decisions already locked (do not re-litigate)
- **Telegram = primary** phone reminder channel.
- **In-app bell = always fires** (unchanged).
- **Web push = stays in place** as a fallback for staff who haven't linked
  Telegram yet. Do **not** remove it.
- **Reminders auto-stop for the day the moment the person clocks in / out.**
  This already works (see §3) and Telegram inherits it for free — no new logic.
- **Attendance is organised by directorate. This is an RSIMD-only pilot**
  (directorate id `dir_rsimd`, abbreviation `RSIMD`). The reminder audience MUST
  be scoped to RSIMD — see §6.0. The *banner* naturally only appears to that
  same reminder audience, so no separate banner gate is needed.

### Service name — dynamic, per org-entity
The label is **`{ABBR} Attendance Alerts`**, where `{ABBR}` is the staff
member's own org-entity abbreviation. For the pilot that renders as
**"RSIMD Attendance Alerts"**; it automatically becomes "IAU Attendance Alerts",
"F&A Attendance Alerts", etc. for other entities with **zero code change**.

- `{ABBR}` = `directorates.abbreviation`, resolved from the user's
  `users.directorate_id`. **The `directorates` table is OHCS's org-entity table**
  — it holds directorates AND units (and secretariats); `type IN
  ('directorate','secretariat','unit')`. So units (IAU, CSC, RCU, ACCOUNTS,
  ESTATE, …) are covered by the same lookup, no special-casing.
- **Fallback:** if a user has no `directorate_id` (or the entity is missing),
  use **"OHCS Attendance Alerts"**.
- Use the resolved label in BOTH places:
  - the connect banner heading in the staff app, and
  - the sign-off line of each Telegram reminder (e.g. `— RSIMD Attendance`).
- Noun is deliberately channel-neutral ("Attendance", not "Clock-In") because
  the feature covers clock-*out* reminders too.

Note: staff DM the existing bot `@ohcs_smartgate_bot`; this is a service label,
not a new bot or a Telegram broadcast channel.

---

## 2. Repo orientation

- Monorepo. Relevant packages:
  - `packages/api` — Cloudflare Worker (Hono). D1 (`env.DB`), KV (`env.KV`),
    R2 (`env.STORAGE`). Cron via `scheduled()` in `src/index.ts`.
  - `packages/staff` — the staff PWA (React + Vite + Tailwind). This is where
    the banner goes.
  - `packages/web` — the admin/reception dashboard (not needed here).
- **Build/test gotcha (known):** the repo path contains a space and `&`, which
  breaks some `.cmd` npm shims. Prefer direct `node` invocations for
  wrangler/vitest. The API vitest suite already shows **4 pre-existing failing
  files** that are `.sql`-as-JS collection errors from that path — treat those 4
  as green; only new failures matter.
- Response envelope: API helpers `success(c, {...})` return
  `{ data: {...}, error: null }`. Raw `fetch()` callers must read
  `res.data?.x`. The staff app's `api.ts` helper unwraps `data` for you.

---

## 3. How reminders work today (the mechanism you're extending)

**File: `packages/api/src/services/reminders.ts`**
- Cron ticks every 15 min. Morning ladder 08:00–11:00, evening 15:30–17:00
  (weekdays only; holidays/weekends suppressed via `getOfficeStatus`).
- `buildClockInNudgeQuery()` audience = active, activated
  (`pin_acknowledged=1`), has an identifier, **no `clock_in` today**, no absence
  notice. `buildClockOutNudgeQuery()` = clocked in but **no `clock_out` today**.
- **This is why compliance auto-stops the ladder:** every tick re-runs the
  query, so someone who clocked in at 08:20 is gone from the 08:30 audience.
  A per-user-per-slot KV key `reminder:{in|out}:{userId}:{date}:{slot}`
  prevents double-sends within a slot.
- Each target is delivered via `sendTypedNotification(env, { userId, type, ... })`
  with `type = 'clock_reminder'` (morning) or `'clock_out_reminder'` (evening).

**File: `packages/api/src/services/notifier.ts`**
- `sendTypedNotification()` is the single funnel. Today it does exactly two
  things: (1) INSERT into `notifications` (in-app bell), (2) if the type is in
  `PUSH_WHITELIST`, send web push to the user's `push_subscriptions`.
- **It does NOT send Telegram.** That is the gap you're filling.

**Cron wiring:** `packages/api/src/index.ts` `scheduled()` switch (around
line 160) already routes the cron strings to `sendClockReminders(env)` /
`sendClockOutReminders(env)`. `packages/api/wrangler.toml` `[triggers] crons`
already has the schedules. **No cron changes needed.**

---

## 4. Existing Telegram infrastructure (reuse, don't rebuild)

- Live bot: `@ohcs_smartgate_bot`. Token in `env.TELEGRAM_BOT_TOKEN`.
  Bot username in `env.TELEGRAM_BOT_USERNAME` (Env type at
  `packages/api/src/types.ts`).
- **Webhook + secret:** `packages/api/src/routes/telegram.ts` `telegramWebhook`.
  **In production `TELEGRAM_WEBHOOK_SECRET` is MANDATORY** — if unset/mismatched
  the webhook 401s every update and no one can link. It's already configured in
  prod; just don't break it.
- **Send helper:** `packages/api/src/services/telegram.ts`
  `sendTelegramMessage({ chatId, text, token, replyMarkup? }) => Promise<boolean>`.
  `text` is **HTML** (`parse_mode: 'HTML'`) — escape user content with
  `escapeHtml` from `../lib/html`.
- **User ↔ Telegram link store:** KV key `telegram-user:${userId}` → `chatId`
  (string). Created today by the `/link <StaffID>` command. This is the key the
  reminder send will read.
- **One-tap deep-link linking already exists**, but for a *different* purpose:
  `handleStart` in `telegram.ts` (line ~161) resolves `officer-link:${token}`
  and sets `officers.telegram_chat_id` (visitor alerts). The token is minted in
  `packages/api/src/routes/admin-directorates.ts:376` with:
  ```ts
  await c.env.KV.put(`officer-link:${token}`, id, { expirationTtl: 7 * 86400 });
  const url = `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
  ```
  **Mirror this pattern for a new user-level token (§6.2).** Do NOT reuse the
  `officer-link` namespace — it links officers for visitor alerts, not the
  attendance user for clock reminders.

---

## 5. THE TRAP — read before writing the delivery arm

`sendTypedNotification` is shared by **every** notification type. `notifier.ts`
**already** sends Telegram *separately* for `visitor_arrival` (via
`notifyOfficerOfVisit` → `sendArrivalAlert`) and `watchlist_alert`. If you make
`sendTypedNotification` send Telegram for everything, those types will
**double- or triple-fire** to Telegram.

**Therefore:** add a **new, separate** `TELEGRAM_WHITELIST` set — NOT the same as
`PUSH_WHITELIST`. For the Monday pilot it contains **only**:
```ts
const TELEGRAM_WHITELIST = new Set(['clock_reminder', 'clock_out_reminder']);
```
Do not add `visitor_arrival` or `watchlist_alert`. (Later you may add
`late_clock_alert` / `absence_notice` / `monthly_report_ready`, but not now.)

---

## 6. Implementation tasks

### 6.0 Backend — scope the reminder audience to RSIMD (directorate allowlist)
**Decision:** a reversible **directorate allowlist stored in `app_settings`**,
seeded to RSIMD. Empty/unset = all directorates (backward compatible). Widening
the pilot later is a Settings change, not a code change.

- **Setting key:** `reminder_directorate_ids` — comma-separated **org-entity**
  ids (e.g. `dir_rsimd`). These are `directorates.id` values; because that table
  holds directorates AND units, the same setting scopes units too (add `dir_iau`
  for Internal Audit, etc.). Empty string / unset ⇒ no filter (everyone).
- **Seed it to `dir_rsimd`** (via the same mechanism app_settings defaults are
  seeded — check `packages/api/src/services/settings.ts` `getAppSettings` and
  the settings migration/seed. Add the key with default `dir_rsimd` for the
  pilot).
- **Read it** in `reminders.ts`: `getAppSettings(env)` already runs at the top
  of `sendClockReminders` / `sendClockOutReminders`. Parse the CSV into a
  `string[]` (trim, drop empties).
- **Apply it in the audience queries.** `AUDIENCE_SQL` and the two builders
  (`buildClockInNudgeQuery`, `buildClockOutNudgeQuery`) use positional `?`
  binds. To avoid reordering the existing date binds, **append** the directorate
  filter at the **very end** of the built query and **append** the ids to the
  existing `.bind(...)` call:
  ```ts
  // builder gains an optional param:
  export function buildClockInNudgeQuery(directorateIds: string[] = []): string {
    const dirFilter = directorateIds.length
      ? ` AND u.directorate_id IN (${directorateIds.map(() => '?').join(',')})`
      : '';
    return `SELECT u.id, u.name, u.current_streak ${AUDIENCE_SQL}
      AND NOT EXISTS ( ...clock_in today... )${dirFilter}`;
  }
  // caller — existing binds first, dir ids appended LAST to match:
  const rows = await env.DB.prepare(buildClockInNudgeQuery(dirIds))
    .bind(date, date, ...dirIds).all();
  ```
  Same shape for the clock-out builder (its existing binds are `date, date,
  date`, then `...dirIds`). When the allowlist is empty, `dirFilter` is `''`
  and binds are unchanged — fully backward compatible.
- **Admin control (reversible path):** wire the setting into the existing
  Settings surface where the work-hours / clock-in enforcement toggles live
  (Attendance tab → work-hours modal; admin settings route
  `packages/api/src/routes/admin-settings.ts` + the web SettingsModal). A simple
  multi-select or comma field is enough. *If time is tight for Monday, the seed
  + read is REQUIRED; the admin UI is strongly-recommended-but-optional — the
  value can also be changed directly in `app_settings`.*
- **Tests:** audience query includes RSIMD users and excludes a non-RSIMD user
  when the allowlist = `['dir_rsimd']`; empty allowlist ⇒ no directorate filter
  (all users). Extend `reminders.test.ts`.

### 6.1 Backend — Telegram delivery arm in `sendTypedNotification`
**File: `packages/api/src/services/notifier.ts`**
- Add `TELEGRAM_WHITELIST` (see §5) near the existing `PUSH_WHITELIST`.
- In `sendTypedNotification`, after the existing in-app INSERT and alongside the
  push block, add a **best-effort, never-throws** Telegram send:
  ```ts
  if (TELEGRAM_WHITELIST.has(opts.type) && env.TELEGRAM_BOT_TOKEN) {
    try {
      const chatId = await env.KV.get(`telegram-user:${opts.userId}`);
      if (chatId) {
        // Dynamic org-entity label for the sign-off (see "Service name").
        const ent = await env.DB.prepare(
          `SELECT d.abbreviation AS abbr FROM users u
             LEFT JOIN directorates d ON d.id = u.directorate_id
            WHERE u.id = ?`
        ).bind(opts.userId).first<{ abbr: string | null }>();
        const label = `${ent?.abbr ?? 'OHCS'} Attendance`;
        const text = [
          `<b>${escapeHtml(opts.title)}</b>`,
          '',
          escapeHtml(opts.body),
          '',
          `<a href="${STAFF_APP_URL}${opts.url}">Open clock page</a>`,
          '',
          `— ${escapeHtml(label)}`,
        ].join('\n');
        const ok = await sendTelegramMessage({ chatId, text, token: env.TELEGRAM_BOT_TOKEN });
        await recordNotifyOutcome(env, 'telegram', ok);
      }
    } catch (err) {
      devError(env, '[notifier] telegram reminder send failed', err);
    }
  }
  ```
- `sendTelegramMessage` and `recordNotifyOutcome` are already imported in this
  file. `escapeHtml` too.
- **`STAFF_APP_URL`**: the staff PWA origin. Do NOT hardcode blindly — check how
  the staff app is served (branded domain). Look for an existing base-URL
  constant / env var first; if none, add one to the Env type + `wrangler.toml`
  (e.g. `STAFF_APP_URL`) and set it in prod. The clock page path is `/` (that's
  the `url` the reminders already pass). If in doubt, a plain-text message
  without the link is acceptable for the pilot — the link is a nice-to-have.

### 6.2 Backend — user-level link token + deep-link handler
**New endpoints (authenticated). Suggested: a small router
`packages/api/src/routes/notifications-telegram.ts` mounted under
`/api/notifications/telegram`** (mirror `notifications-push.ts`, which uses
`c.get('session')` → `session.userId`; everything under `/api/*` already has
`authMiddleware` applied in `index.ts:93`).

1. `POST /api/notifications/telegram/link-token`
   - Mint a random token (`crypto.randomUUID().replace(/-/g,'')`).
   - `await env.KV.put('telegram-user-link:'+token, session.userId, { expirationTtl: 3600 })`
     (1h TTL — short-lived, one link session).
   - Guard: if `!env.TELEGRAM_BOT_USERNAME` or it's the placeholder, return a
     503 like admin-directorates does.
   - Return `success(c, { url: 'https://t.me/'+env.TELEGRAM_BOT_USERNAME+'?start='+token })`.

2. `GET /api/notifications/telegram/status`
   - `const chatId = await env.KV.get('telegram-user:'+session.userId)`
   - Also resolve the caller's org-entity abbreviation for the banner heading:
     `SELECT d.abbreviation FROM users u LEFT JOIN directorates d ON d.id =
     u.directorate_id WHERE u.id = ?` (bind `session.userId`).
   - Return `success(c, { linked: !!chatId, entityAbbr: row?.abbreviation ?? null })`.

3. Register the router in `packages/api/src/index.ts` next to
   `app.route('/api/notifications/push', notificationsPushRoutes)`.

**Deep-link handler — extend `handleStart`** in
`packages/api/src/routes/telegram.ts` (line ~161). Add a branch that checks the
new namespace **before** the existing `officer-link` branch:
```ts
if (args) {
  const userId = await c.env.KV.get(`telegram-user-link:${args}`);
  if (userId) {
    await c.env.KV.put(`telegram-user:${userId}`, String(chatId));
    await c.env.KV.delete(`telegram-user-link:${args}`);
    // Optional but recommended: also set officers.telegram_chat_id if this
    // user maps to an officer (so they ALSO get visitor alerts). Mirror the
    // user→officer lookup used in handleLink (by email, then name).
    const u = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(userId).first<{name:string;email:string|null}>();
    // ... look up officer by email/name, UPDATE officers SET telegram_chat_id ...
    await sendTelegramMessage({
      chatId: String(chatId),
      text: [`✅ <b>Connected!</b>`, '', `You'll now get your clock-in and clock-out reminders here on Telegram.`].join('\n'),
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
    return;
  }
  // then existing officer-link:${args} branch...
}
```
Keep the existing greeting fall-through for invalid/expired tokens (no error
leak).

### 6.3 Frontend — "Connect Telegram" banner
**New component `packages/staff/src/components/TelegramConnectBanner.tsx`**,
mirroring `packages/staff/src/components/PushNudgeBanner.tsx` for styling
(rounded-2xl card, emerald accents, "Connect" + "Not now", 14-day snooze via
`localStorage`). Use Telegram-blue accents instead of emerald if you want it to
read as "Telegram".

Behaviour:
- On mount: `GET /api/notifications/telegram/status`. If `linked`, render
  nothing (or a subtle "Telegram connected ✅"). If not linked and not snoozed,
  show the banner. Read `entityAbbr` from the response for the heading.
- Copy: heading **"{entityAbbr ?? 'OHCS'} Attendance Alerts"** (→ "RSIMD
  Attendance Alerts" for the pilot); body "Link your Telegram once and we'll
  remind you to clock in each morning and clock out each evening — reliably,
  even with the app closed."
- **Connect button:** on click → `POST /api/notifications/telegram/link-token`,
  read `data.url`, then `window.location.assign(url)` (opens the Telegram app /
  web to the bot with the start token; user taps Start; handler links them).
- On `window` `focus` (returning from Telegram), re-fetch status; if now
  `linked`, flip to the success state and stop showing.
- "Not now" → `localStorage` dismiss timestamp, 14-day re-ask (copy the
  `DISMISS_KEY` / `REASK_AFTER_MS` pattern; use a distinct key,
  e.g. `ohcs.telegram.connect.dismissed_at`).

**Render site:** `packages/staff/src/pages/ClockPage.tsx` around line 689 where
`<PushNudgeBanner />` renders. Show the Telegram banner there (it can sit above
or replace the push banner in the pilot — but per the locked decision, keep
`PushNudgeBanner` too; both can coexist, Telegram first).

Add the API calls to the staff app's `packages/staff/src/lib/` (mirror
`pushClient.ts`).

---

## 7. Testing
- **API unit tests (vitest):**
  - `sendTypedNotification`: `clock_reminder` with a KV-linked chat → Telegram
    send fired; **`visitor_arrival` does NOT fire an extra Telegram send** from
    the funnel (guards the double-send trap). Mock `sendTelegramMessage`.
  - Link-token endpoint mints KV `telegram-user-link:*`; status reflects
    `telegram-user:*` presence.
  - `handleStart` with a valid `telegram-user-link` token writes
    `telegram-user:${userId}` and deletes the one-time token; invalid token
    falls through to the greeting.
  - Follow existing test style (`notifier.test.ts`, `telegram.test.ts`,
    `reminders.test.ts`). Node 24 needed for `node:sqlite` tests.
- **Manual E2E before Monday:** link a real test account via the banner →
  confirm the "Connected!" Telegram message → wait for a nudge slot (or invoke
  `sendClockReminders`) → confirm the Telegram reminder arrives → clock in →
  confirm no further reminder that day.

---

## 8. Pre-flight / config (verify in prod before pilot)
- `TELEGRAM_BOT_TOKEN` — set (bot is live).
- `TELEGRAM_BOT_USERNAME` — must be the real username, not the
  `REPLACE_WITH_BOT_USERNAME` placeholder (the link-token endpoint 503s if unset).
- `TELEGRAM_WEBHOOK_SECRET` — must be set in prod (mandatory) and match the
  value registered with Telegram's `setWebhook`. **Do not break this** — it's
  the difference between linking working and every update 401ing.
- `STAFF_APP_URL` (if you add it in §6.1) — set to the staff PWA origin.
- Wrangler in this repo: invoke as `node node_modules/wrangler/bin/wrangler.js`
  (the `.cmd` shim breaks on the spaced/`&` path). Prod account id
  `f4f236a6…` (set `CLOUDFLARE_ACCOUNT_ID`). User re-auths interactively.

---

## 9. Summary of files touched
| File | Change |
|---|---|
| `packages/api/src/services/reminders.ts` | Read `reminder_directorate_ids`; thread directorate allowlist into the two audience builders (§6.0) |
| `packages/api/src/services/settings.ts` | Add `reminder_directorate_ids` to `getAppSettings` (default seed `dir_rsimd`) |
| `packages/api/src/routes/admin-settings.ts` + web SettingsModal | (recommended) admin control for the directorate allowlist |
| `packages/api/src/services/notifier.ts` | Add `TELEGRAM_WHITELIST` + Telegram arm in `sendTypedNotification` |
| `packages/api/src/routes/notifications-telegram.ts` | **new** — `link-token` + `status` endpoints |
| `packages/api/src/index.ts` | Register the new router |
| `packages/api/src/routes/telegram.ts` | `handleStart`: new `telegram-user-link` branch |
| `packages/api/src/types.ts` | (maybe) add `STAFF_APP_URL` to `Env` |
| `packages/api/wrangler.toml` | (maybe) add `STAFF_APP_URL` var |
| `packages/staff/src/components/TelegramConnectBanner.tsx` | **new** banner |
| `packages/staff/src/lib/telegramClient.ts` | **new** — link-token/status fetch helpers |
| `packages/staff/src/pages/ClockPage.tsx` | Render the banner (~line 689) |
| `*.test.ts` | Tests per §7 |

**No cron changes. No web-push removal.** Link state is KV; the only new
persisted config is the `reminder_directorate_ids` app_setting (a settings
key/seed, not a table migration).

---

## Addendum (2026-08-01, post-ship) — dedicated attendance bot

Product decision changed after initial ship: clock reminders + staff linking
moved off `@ohcs_smartgate_bot` onto a **dedicated bot
`@RSIMDAttendanceAlertsBot`** ("RSIMD Attendance Alerts"). When the system goes
operational OHCS-wide, the bot is simply renamed in BotFather ("OHCS Attendance
Alerts") — token, username, and code are unaffected by a display-name change.

- Env: `TELEGRAM_ATTENDANCE_BOT_TOKEN` + `TELEGRAM_ATTENDANCE_WEBHOOK_SECRET`
  (Worker secrets), `TELEGRAM_ATTENDANCE_BOT_USERNAME` (wrangler var).
  Fallback chain everywhere: attendance value `||` main-bot value, so the
  system keeps working before the secrets are set.
- Reminder delivery (`notifier.ts`) and the link-token URL
  (`notifications-telegram.ts`) resolve through that chain.
- Second webhook `POST /api/telegram/webhook-attendance` handles ONLY
  `/start <telegram-user-link token>` (via the extracted `handleUserLinkStart`
  helper) + greeting fall-through; officer-link, `/link`, callbacks and all
  visitor-alert traffic stay on the main webhook/bot untouched.
- KV link store unchanged (`telegram-user-link:*`, `telegram-user:*`).
- A broadcast **channel was considered and rejected**: reminders are per-user
  DMs so the ladder auto-stops per person on compliance; a channel can't do
  that.
