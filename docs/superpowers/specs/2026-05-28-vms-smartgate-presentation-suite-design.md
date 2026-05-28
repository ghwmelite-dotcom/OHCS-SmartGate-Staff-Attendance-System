# OHCS SmartGate & Staff Attendance — Executive Presentation Suite

**Date:** 2026-05-28
**Owner:** ohwpstudios@gmail.com
**Audience:** OHCS Executive Leadership
**Purpose:** Showcase — "look what we delivered"
**Format:** Native .pptx (PowerPoint), Kente Executive brand throughout
**Count:** 13 decks (with 2 reserved slots, up to 15)

---

## 1 · Goal

Produce a coordinated suite of executive-grade .pptx presentations that lets OHCS leadership see, understand, and recount what the SmartGate (VMS) and Staff Attendance system delivers. The suite is structured so any single deck stands alone, but the full library reads as one product — the Kente Executive design language carrying across every artifact.

**Success criteria:**

- 13 .pptx files that open cleanly in PowerPoint, Keynote, Google Slides, and LibreOffice with embedded fonts.
- A `_SUITE-COVER.pdf` contact sheet showing all 13 cover slides on one page.
- Every deck under 25 MB (email-attachable).
- Brand cohesion test: any two random decks must obviously belong to the same suite.
- Every embedded asset (screenshot, metric, quote) has a recorded source in its deck's manifest.

---

## 2 · Inventory (13 decks, +2 reserved)

### Tier 1 — Flagship

| # | Title | Slides | Purpose |
|---|-------|--------|---------|
| 01 | OHCS SmartGate & Staff Attendance — The Story So Far | ~18 | The whole system in one sitting. Opens with the manual-logbook problem, closes with two installed PWAs and real-time alerts. The only deck a busy director needs to read. |

### Tier 2 — App Spotlights

| # | Title | Slides | Purpose |
|---|-------|--------|---------|
| 02 | SmartGate — Visitor Management in Production | ~20 | Reception's day, host-routing logic, three-channel arrival alert, printable badge, offline-resilient check-in, reporting suite. |
| 03 | Staff Attendance — Clocking In, Honestly | ~20 | First-login PIN moment, 75 m GPS geofence with accuracy-aware tolerance, streak system, absence notice flow, 9:00 AM daily summary, eBadge. |

### Tier 3 — Thematic Deep-Dives

| # | Title | Slides | Wow moment |
|---|-------|--------|------------|
| 04 | Security & Trust | ~16 | "0 third-party push services" — self-hosted Web Push hero number |
| 05 | Offline-First Resilience | ~14 | Reception kept checking visitors in during a 12-minute outage |
| 06 | The Notifications Engine | ~14 | The 9:00 AM Telegram summary recreated in-deck |
| 07 | GPS Geofence Precision | ~14 | Side-by-side "before retrace fix" vs "after" geofence map |
| 08 | Kente Executive — A Civic Design Language | ~16 | The brand spread: type, color, motif, motion |
| 09 | Reception Workflow | ~14 | Paper logbook → SmartGate before/after |
| 10 | The Staff Experience | ~14 | One officer's morning, frame-by-frame |
| 11 | Director Visibility | ~12 | Mock Telegram thread showing real summary cadence |
| 12 | The Build Discipline | ~14 | The `docs/superpowers/` design history tree |
| 13 | Roadmap — Care Continues | ~12 | What ongoing stewardship looks like |

### Reserved (build only on greenlight)

| # | Title | Slides | Trigger |
|---|-------|--------|---------|
| 14 | Cloudflare Edge Architecture | ~14 | Add if CTO/IT-tilted audience needs deep technical view |
| 15 | Numbers & Impact | ~12 | Add once a full year of metrics is in the bag |

---

## 3 · Per-Deck Anatomy (the 7-block skeleton)

Every deck — flagship, spotlight, thematic — follows the same skeleton so the suite reads as one product.

| Block | Slides | Purpose |
|-------|--------|---------|
| Cover | 1 | Playfair Display title, gold deco hairline, Kente accent strip, OHCS crest, audience tag, version + date |
| Opening line | 1 | One editorial sentence on a dark Kente-textured slide. Sets emotional frame. |
| What you'll see | 1 | 3-bullet table of contents. No hierarchy theatre. |
| Body | 8–14 | Alternates **Statement slides** (Playfair headline + 1 supporting visual) and **Evidence slides** (screenshot + 3 annotation callouts, OR chart + caption). |
| Wow moment | 1 | One memorable slide per deck — full-bleed screenshot, hero chart, or single large number in gold. Photographable/shareable. |
| Closing line | 1 | Mirrors opening. |
| Appendix + credits | 1–2 | Live URLs, related decks, source manifest, "built on Cloudflare's edge". |

### Consistency rules (no exceptions)

- Cover identifies tier — flagship: gold ring motif; SmartGate spotlight: gold Kente; Staff spotlight: green Kente; thematic: gold-with-deco-notch strip.
- Footer always shows deck ID + page: `06 · Notifications Engine · 09/14`.
- Type pair is fixed: Playfair Display (display), DM Sans (body). No Calibri.
- One chart style across the suite: DM Sans labels, gold + green + cream palette, no gridlines, captions instead of titles.
- Every wow-moment slide is screenshot-ready: clean enough to be cropped and used standalone on social.

---

## 4 · Visual System (Kente Executive applied to PPTX)

### Color tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `ink.deep` | `#0E1411` | Dark dividers, statement-slide backgrounds, footer bar |
| `ink.warm` | `#1A1714` | Body text on cream slides |
| `cream.page` | `#F6F1E7` | Default body-slide background |
| `cream.soft` | `#FBF7EF` | Card surfaces, chart canvas backgrounds |
| `gold.signature` | `#C9A14A` | Deco hairlines, headline accents, chart primary, brand strip |
| `gold.deep` | `#8B6B22` | Hover/active mock UI, chart secondary |
| `green.smartgate` | `#1A4D2E` | Staff spotlight, production status markers, chart tertiary |
| `red.alert` | `#7A1F1F` | Late-clock evidence, error-state callouts (sparingly) |
| `neutral.line` | `#D8CFBE` | Subtle dividers, table grids, chart axes |

Six core colors plus two specialists. No rainbow charts, no theme drift.

### Typography stack

| Role | Face | Size | Weight | Leading |
|------|------|------|--------|---------|
| Display (covers, statement headlines) | Playfair Display | 44–60pt | Bold (700) | 1.05 |
| Section title (body slides) | DM Sans | 32pt | Semibold (600) | 1.2 |
| Body | DM Sans | 18pt | Regular (400) | 1.45 |
| Caption / footer / page no. | DM Sans | 11pt | Medium (500) | 1.3 |
| Hero number (wow slides) | Playfair Display | 160–220pt | Black (900) | 1.0 |

Both faces are SIL OFL / Google Fonts licensed — embedded into every .pptx so machines without them still render correctly.

### Signature motifs

1. **Gold deco hairline** — 1pt `gold.signature` rule, 120px wide, centered under statement headlines.
2. **Kente accent strip** — 12px-tall horizontal band on left edge of body slides. Tier-specific patterns (flagship: diagonal gold-on-ink hatch; SmartGate: gold-and-cream block weave; Staff: green-and-gold step weave; thematic: solid gold with single deco notch).
3. **Dark Kente-textured dividers** — full-bleed `ink.deep` with 6% opacity Kente texture overlay. One reusable PNG asset.
4. **OHCS crest treatment** — 28pt tall, bottom-right of cover, inside footer bar. Never enlarged.
5. **Screenshot framing** — 1px `neutral.line` border, 16px outer radius corner mask, 24px-blur shadow at 8% opacity. No 3D bevels.

### Layout grid

16:9 aspect (1920×1080). 12-column grid, 32px gutter, 48px outer margin. 80px safe-zone inset on all sides.

### Motion

PPTX gets two animations only:

- Statement slides: headline fades up over 240ms on click (ease-out).
- Wow-moment slides: hero number scales 0.96→1.0 + fades up over 320ms on slide-enter.

Slide transition: fade through black, 200ms. No carousel, no swooping. Animations are decorative — disabling them does not lose meaning.

### Shared asset library

Built once in `decks/_assets/`, reused across all 13 decks:

- `kente-texture-overlay.png` (6% opacity)
- `ohcs-crest.svg`
- `gold-deco-hairline.svg`
- `kente-strip-flagship.png`, `-smartgate.png`, `-staff.png`, `-thematic.png`
- `screenshot-frame.svg`
- `chart-theme.json` (python-pptx chart presets)
- Four slide-master .pptx files: `cover-master.pptx`, `body-master.pptx`, `divider-master.pptx`, `wow-master.pptx`

---

## 5 · Asset Manifest Pattern (per-deck checklist)

Because the user supplies real-world content, every deck has a manifest as the single source of truth for what's outstanding.

### Manifest location

```
decks/_manifests/
├── _INDEX.md                          ← aggregate roll-up across all decks
├── 01-flagship.md
├── 02-smartgate-spotlight.md
├── 03-staff-attendance-spotlight.md
├── 04-security-and-trust.md
├── 05-offline-resilience.md
├── 06-notifications-engine.md
├── 07-geofence-precision.md
├── 08-kente-executive-design.md
├── 09-reception-workflow.md
├── 10-staff-experience.md
├── 11-director-visibility.md
├── 12-build-discipline.md
└── 13-roadmap-care-continues.md
```

### Manifest template (every deck uses this shape)

Each manifest has five sections:

1. **Status + metadata** — checkboxes for `draft / assets gathered / produced / delivered`, slide count target, audience, wow moment.
2. **Screenshots needed** — numbered table: ID, screen, where to capture, state to show, status checkbox.
3. **Numbers needed** — numbered table: ID, metric, value field, query/source notes.
4. **Quotes / sign-off needed** — numbered table: ID, from whom, purpose, text field.
5. **Anything else this deck needs** — free-text list (permissions, OHCS-specific imagery, etc.).

The aggregate `_INDEX.md` deduplicates shared assets: if "Clock-in success screen" is needed by decks 03, 07, and 10, it appears once with a `used by: 03, 07, 10` tag. User captures once, suite reuses everywhere.

### Estimated asset volume (across all 13 decks)

| Type | Rough total | User effort |
|------|-------------|-------------|
| Unique screenshots | ~45 | 2–3 hrs (one Playwright session with demo data) |
| Metrics (D1 queries) | ~25 | 1 hr (one batch query) |
| Quotes / sign-offs | 6–8 | Stakeholder-dependent |
| OHCS imagery (crest, HQ photo) | 2–3 | Minutes if on hand |

### Two-track production

1. **v0 placeholder decks** — produced immediately by the suite-builder. Every screenshot/metric replaced by a labeled placeholder block (`[REPLACE: S1 · Clock-in success]`). User can review narrative, slide order, and visual system on real .pptx files within the first production sprint.
2. **v1 final decks** — produced per deck as its manifest hits 100% complete. Decks ship independently — Deck 01 can be final while Deck 11 is still v0.

---

## 6 · Tooling

### Primary

- **`document-skills:pptx` skill** — python-pptx under the hood. Produces native .pptx with editable shapes/charts/text. Embeds fonts.

### Supporting

- **`document-skills:webapp-testing` (Playwright)** — batch-capture screenshots from `staff-attendance.pages.dev` and `ohcs-smartgate.pages.dev` if user provides demo credentials.
- **`sharp`** (already in devDependencies) — image processing for screenshot framing (corner mask + shadow + border).
- **Native PPTX charts** — bar, line, donut. Built from manifest data. No screenshotted Excel charts.

### Not used

- HTML/web-slides skill — wrong format for this ask.
- AI image generation — design language is screenshots + typography + Kente texture, not generated illustrations.
- Speaker notes (out of scope; follow-up if requested).

---

## 7 · Production Pipeline (per deck)

```
1. Manifest created            →  decks/_manifests/NN-name.md
2. Slide outline drafted       →  decks/_outlines/NN-name.md
3. v0 placeholder built        →  decks/output/NN-name-v0.pptx
4. User reviews v0 narrative   →  feedback in manifest "notes" field
5. Assets gathered             →  manifest ticked to 100%
6. v1 final built              →  decks/output/NN-name-v1.pptx
7. User signs off / requests   →  manifest status → "delivered"
```

Each step is its own atomic task in the implementation plan — keeps progress visible across ~90 small tasks (13 decks × ~7 steps).

---

## 8 · Build Order (sprint sequencing)

### Sprint 0 — Foundations

- Build 4 slide masters (cover, body, divider, wow).
- Generate `_assets/` library.
- Create all 13 manifests + aggregate `_INDEX.md`.
- Produce one reference deck (Deck 04 · Security & Trust) end-to-end as visual benchmark.

### Sprint 1 — Tier 1 + Tier 2 (3 decks)

- 01 Flagship
- 02 SmartGate Spotlight
- 03 Staff Spotlight

### Sprint 2 — High-impact thematic (3 decks; deck 04 already shipped in Sprint 0)

- 06 Notifications Engine
- 07 Geofence Precision
- 08 Kente Executive Design

### Sprint 3 — Workflow + people (3 decks)

- 05 Offline Resilience
- 09 Reception Workflow
- 10 Staff Experience

### Sprint 4 — Leadership lens + close-out (3 decks)

- 11 Director Visibility
- 12 Build Discipline
- 13 Roadmap

### Reserve sprint (only on user greenlight)

- 14 Cloudflare Edge Architecture
- 15 Numbers & Impact

---

## 9 · File Layout & Naming

```
decks/
├── _assets/                       ← visual system (Section 4)
├── _manifests/                    ← per-deck asset checklists (Section 5)
│   └── _INDEX.md                  ← aggregated asset list
├── _outlines/                     ← markdown outlines (review before .pptx build)
├── _masters/                      ← 4 slide-master .pptx files
└── output/
    ├── 01-flagship-v1.pptx
    ├── 02-smartgate-spotlight-v1.pptx
    ├── 03-staff-attendance-spotlight-v1.pptx
    ├── 04-security-and-trust-v1.pptx
    ├── 05-offline-resilience-v1.pptx
    ├── 06-notifications-engine-v1.pptx
    ├── 07-geofence-precision-v1.pptx
    ├── 08-kente-executive-design-v1.pptx
    ├── 09-reception-workflow-v1.pptx
    ├── 10-staff-experience-v1.pptx
    ├── 11-director-visibility-v1.pptx
    ├── 12-build-discipline-v1.pptx
    ├── 13-roadmap-care-continues-v1.pptx
    └── _SUITE-COVER.pdf           ← one-page contact sheet of all 13 covers
```

**Naming convention:** `NN-kebab-case-title-v{version}.pptx`. Two-digit prefix preserves sort order; version suffix preserves v0 alongside v1.

The `decks/` tree lives at the repo root alongside `docs/`, `packages/`, `scripts/`.

---

## 10 · Out of Scope

The following are deliberately excluded. Any of them can become a follow-up project on request:

- Speaker notes for each slide.
- HTML / web-based presentation versions.
- Translations (English-only).
- Video walkthroughs or recorded narration.
- Animated GIFs of UI flows.
- Reserved decks 14 and 15 unless explicitly greenlit.

---

## 11 · Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| User supplies assets slowly → suite stalls | v0 placeholder decks ship before any assets arrive; suite is visibly progressing while assets are gathered. |
| Authenticated screenshots blocked by no demo account | Manifest flags this per screenshot; fallback to user-captured screenshots or hand-built UI mockups using the Kente palette. |
| Brand cohesion drift across 13 decks | All decks inherit from 4 shared slide masters; visual rules in Section 4 are exact (hex, pt sizes, easing curves). |
| Font rendering on OHCS machines | Playfair Display + DM Sans embedded into every .pptx file. |
| Decks balloon past 25 MB | Screenshots resized to 1600px max width, JPG-encoded at 85% quality for photos, PNG only for UI screenshots. |
| Suite-cover contact sheet drifts out of date | `_SUITE-COVER.pdf` is regenerated as part of every deck-finalization step. |

---

## 12 · Done Means

- 13 .pptx files in `decks/output/` named per convention, each under 25 MB, opening cleanly in PowerPoint and Keynote with embedded fonts intact.
- 13 manifest files in `decks/_manifests/` with status `delivered` on each.
- `_SUITE-COVER.pdf` showing all 13 cover slides on one page.
- `_INDEX.md` proving every asset has a recorded source.
- Any two random decks pulled from the suite obviously belong to the same product.
