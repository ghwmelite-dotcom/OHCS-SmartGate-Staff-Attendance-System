# Superadmin System Documentation Section — Design

Date: 2026-07-20 · Status: implementing

## Problem

OHCS needs in-product documentation covering everything the VMS and Staff
Attendance systems comprise — architecture, features, flags, conventions —
visible **only to superadmins**, and a **standing rule** that keeps it current
as features ship.

## Decisions

- **A dedicated `/docs` page** in the VMS portal, not another AdminPage tab —
  a reading experience needs the full width. Sidebar + BottomNav items appear
  only for `role === 'superadmin'`; the page hard-redirects anyone else (same
  posture as AdminPage). Content ships in the bundle, so the gate is
  functional rather than cryptographic — consistent with how the admin UI
  itself is already shipped, and the content documents behavior, not secrets.
- **Content as a typed data module** (`packages/web/src/docs/content.ts`)
  rendered by a docs-engine page. No markdown renderer, no new dependencies,
  type-checked at build. Updating docs = editing one data file in the same
  commit as the feature.
- **The update rule** is written into `AGENTS.md` conventions AND displayed in
  the docs page footer, so the convention is discoverable where it applies.

## Content model

```ts
type DocStatus = 'live' | 'shadow' | 'design';
interface DocFeature { name: string; status: DocStatus; summary: string; details?: string[] }
interface DocSection { id: string; title: string; tagline: string; color: string; icon: string; features: DocFeature[] }
```

Ten sections: Platform Overview · Staff Clock-In · Presence & Risk · Kiosk
Experience · Reception & Visits · Telegram & Notifications · Appointments ·
Safety & Compliance · Roles & Access · Operations & Conventions. Each section
carries a distinct accent color and lucide icon; each feature a status badge
(live = green, shadow = amber, design = slate).

## Page design

Hero (deep-green gradient, gold accents, search, section/feature counts +
last-updated) → sticky section pill-nav → sections stacked: colored icon chip
+ title + tagline, feature cards in a responsive grid. Search filters across
names/summaries/details with a graceful empty state. Footer carries the
maintenance rule. House idiom: `animate-fade-in-up stagger-N`, Playfair
display headers, surface/border tokens — no chart library, no new deps.

## The rule (goes into AGENTS.md conventions + page footer)

> **Docs stay current.** Every shipped feature adds or updates its entry in
> `packages/web/src/docs/content.ts` in the same commit (correct section,
> correct status badge). The docs page is the user-facing mirror of the
> feature-state table in AGENTS.md.

## Files

- `packages/web/src/docs/content.ts` (+ `content.test.ts`: unique ids, valid
  statuses, non-empty fields)
- `packages/web/src/pages/DocsPage.tsx`
- `App.tsx` route `/docs`; `Sidebar.tsx` + `BottomNav.tsx` superadmin items
- `AGENTS.md` conventions entry
- Playwright screenshots (hero, section, search) as superadmin
