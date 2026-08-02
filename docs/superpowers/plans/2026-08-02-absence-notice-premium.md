# Absence Notice Premium Refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make absence notices complete (required fields, specified Other, real date UX), routed to the org-entity head with Telegram delivery, and retractable — per spec `docs/superpowers/specs/2026-08-02-absence-notice-premium-design.md`.

**Architecture:** No migrations. Server: stricter zod + upsert + DELETE + audit in `attendance.ts`; routing chain rewrite of `sendAbsenceNoticePush` in `reminders.ts`; `head_officer_id` wired through `admin-directorates.ts`. Clients: staff PWA form + retract; web DirectoratesTab head dropdown.

**Tech Stack:** Hono/D1 (api), React+Vite (staff, web), vitest + node:sqlite shims.

## Global Constraints

- From `packages/api`: typecheck `node ../../node_modules/typescript/bin/tsc --noEmit`; tests `node ../../node_modules/vitest/vitest.mjs run <file>`. 4 pre-existing `.sql`-as-JS collection errors may appear in full runs — ignore.
- No DB migrations anywhere in this plan.
- Envelope: `success(c, {...})` → `{data, error: null}`.
- Telegram sends are HTML — `escapeHtml` (`packages/api/src/lib/html.ts`) all user content.
- `expected_return_date` semantics: **first day back at work**; notice active while `notice_date <= today < expected_return_date`.
- Return date ≤ today + 30 days (longer absences = leave-requests workflow).

---

### Task 1: API — validation, upsert, DELETE, audit (`attendance.ts`)

**Files:**
- Modify: `packages/api/src/routes/attendance.ts:483-540` (POST zod + handler, GET today)
- Test: `packages/api/src/routes/attendance-absence.test.ts` (new — node:sqlite D1-shim pattern from `attendance.test.ts`)

**Interfaces:**
- Consumes: existing `absence_notices` table; `recordAudit` (`src/services/audit.ts`); `authMiddleware` session (`c.get('session').userId`).
- Produces: `POST /absence-notice` body `{reason, note, expected_return_date}` (all required); `DELETE /absence-notice/today` → 200 `{deleted:true}` / 404.

- [ ] **Step 1: failing tests** — validation matrix: missing/short `note` → 400; `reason='other'` + blank note → 400; missing return date → 400; return date = today → 400; > today+30d → 400. Re-submit same day → row updated, count still 1. DELETE → 200 then GET today 404s the row; DELETE again → 404. Audit rows exist for submit/update/retract.
- [ ] **Step 2: run, watch fail** (`vitest run src/routes/attendance-absence.test.ts`).
- [ ] **Step 3: implement** — zod: `note: z.string().trim().min(2).max(200)`, `expected_return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` required + refinement `> today && <= today+30d`. Upsert: `SELECT id FROM absence_notices WHERE user_id=? AND notice_date=?` → UPDATE else INSERT. DELETE route. `recordAudit` on all three (action `absence.submit|absence.update|absence.retract`, entity `absence_notice`).
- [ ] **Step 4: run, watch pass.**
- [ ] **Step 5: commit** — `fix(attendance): absence notices require note + return date, upsert, retract (premium 1/3)`

### Task 2: API — date semantics + Other label (`reminders.ts`)

**Files:**
- Modify: `packages/api/src/services/reminders.ts` (AUDIENCE_SQL absence clause ~:95-99; label map ~:311-316)
- Test: extend `packages/api/src/services/reminders.test.ts`

**Interfaces:**
- Consumes: Task 1's exclusive-return-date semantics.
- Produces: suppression clause `? >= notice_date AND ? < COALESCE(expected_return_date, date(notice_date,'+1 day'))` (binds: today twice — adjust existing bind order carefully, append/replace in place).

- [ ] **Step 1: failing test** — user with notice ending tomorrow is suppressed today; user whose return date IS today is NOT suppressed (nudge audience includes them).
- [ ] **Step 2-4:** watch fail → replace inclusive `BETWEEN` with exclusive form → watch pass. Also `'other'` label → `"Other"`.
- [ ] **Step 5: commit** — fold into Task 1's commit (same area).

### Task 3: API — head-of-entity routing + admin wiring

**Files:**
- Modify: `packages/api/src/services/reminders.ts:323-362` (`sendAbsenceNoticePush`)
- Modify: `packages/api/src/routes/admin-directorates.ts` (PUT schema ~:99-102 add `head_officer_id`; validation officer belongs to entity; GET returns it)
- Modify: `packages/api/src/db/schema.sql` (add `staff_id TEXT` to `officers` CREATE TABLE — drift fix)
- Test: extend `packages/api/src/routes/attendance-absence.test.ts` + `admin-settings`-style route test for the PUT field

**Interfaces:**
- Consumes: `officers.staff_id` → `users.staff_id`; `findUserByOfficer` pattern (`notifier.ts:311`); `sendTelegramMessage`; `sendTypedNotification` (`type 'absence_notice'` already push-whitelisted).
- Produces: resolution chain head → director-role users → superadmins (submitter excluded; unreachable head falls through); Telegram to `officers.telegram_chat_id` best-effort.

- [ ] **Step 1: failing tests** — head set + linked user + telegram → user gets in-app notification AND telegram send fired (mock); head set but unreachable → director-role user notified; no head, no director → superadmin only; submitter never recipient; message contains reason label, note, return date.
- [ ] **Step 2-4:** watch fail → implement chain → watch pass.
- [ ] **Step 5: commit** — `feat(attendance): route absence notices to org-entity head (premium 2/3)`

### Task 4: Staff PWA — premium form + retract

**Files:**
- Modify: `packages/staff/src/components/AbsenceNoticeModal.tsx`, `AbsenceNoticeButton.tsx`
- Test: `packages/staff/src/components/AbsenceNoticeModal.test.tsx` (new, vitest pattern from `TelegramConnectBanner.test.tsx`)

**Interfaces:**
- Consumes: Task 1 endpoints (`POST /attendance/absence-notice` all-required body; `DELETE /attendance/absence-notice/today`).
- Produces: chips `Tomorrow|2 days|1 week|Pick a date` setting `expected_return_date`; note label "Please specify" when reason=other else "Brief detail"; Withdraw flow on the reported chip.

- [ ] **Step 1: failing component tests** — submit disabled until reason+note+date set; Other without specify keeps disabled; chips compute correct dates (Tomorrow = +1d etc.); retract confirm → DELETE called → button returns.
- [ ] **Step 2-4:** implement (match existing modal styling, emerald accents; `api.post`/`api.del` from `src/lib/api.ts` — check delete helper exists or use `api.request`).
- [ ] **Step 5: commit** — `feat(attendance): premium absence form + withdraw (premium 3/3)`

### Task 5: Web — Head dropdown + docs card

**Files:**
- Modify: `packages/web/src/components/admin/DirectoratesTab.tsx` (Head dropdown per entity row, officers of that entity, superadmin)
- Modify: `packages/web/src/docs/content.ts` (new "Absence notices" card, status `live`)
- Test: existing web suites stay green; docs `content.test.ts` guards shape.

**Interfaces:**
- Consumes: Task 3's PUT `head_officer_id` + GET directors payload (now includes head_officer_id + head officer name via join — Task 3 must add the join).
- Produces: dropdown writes on change (or row-save idiom matching the tab's existing edit pattern — follow the file's convention).

- [ ] **Step 1-4:** implement; typecheck + suites green.
- [ ] **Step 5: commit** — fold into Task 3's commit or standalone `feat(admin): org-entity head assignment + absence docs card`

---

## Self-review notes
- Spec coverage: §3→T4, §4→T1/T2, §5→T3/T5, §6→T3 (staff_id) + T5 (docs), §8→test steps. No gaps.
- Type consistency: `expected_return_date`, `head_officer_id`, `absence_notice` type used identically across tasks.
- T3/T5 share the GET join shape — T3 produces it, T5 consumes; if parallelized, the join shape is: GET directorates rows gain `head_officer_id TEXT|null` and `head_name TEXT|null`.
