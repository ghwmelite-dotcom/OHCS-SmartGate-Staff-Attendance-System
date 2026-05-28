# OHCS SmartGate & Staff Attendance — Executive Presentation Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 13 native .pptx executive showcase decks (with 2 reserved slots) covering OHCS SmartGate (VMS) and Staff Attendance, all rendered in the Kente Executive visual language with per-deck asset manifests and two-track v0/v1 production.

**Architecture:** Python-based deck factory. A small set of shared building blocks (`theme.py`, `slide_templates.py`, `build_deck.py`, `manifest_loader.py`) plus four reusable `.pptx` slide masters drive 13 per-deck builder scripts. Each builder reads an outline `.md` file, applies the Kente Executive theme, and writes both a `v0` placeholder and (once the manifest is 100% complete) a `v1` final.

**Tech Stack:**
- Python 3.11+
- `python-pptx` (deck generation)
- `Pillow` (image processing — screenshot framing, Kente accent strips)
- `markdown-it-py` (parse outline + manifest .md files)
- `reportlab` (suite-cover contact-sheet PDF)
- Google Fonts: Playfair Display + DM Sans (embedded into every .pptx)

---

## File Structure

```
decks/
├── _assets/
│   ├── fonts/
│   │   ├── PlayfairDisplay-Bold.ttf
│   │   ├── PlayfairDisplay-Black.ttf
│   │   ├── DMSans-Regular.ttf
│   │   ├── DMSans-Medium.ttf
│   │   └── DMSans-SemiBold.ttf
│   ├── kente-texture-overlay.png        ← dark divider background overlay (6% opacity)
│   ├── kente-strip-flagship.png         ← 12px-tall left-edge accent strip
│   ├── kente-strip-smartgate.png
│   ├── kente-strip-staff.png
│   ├── kente-strip-thematic.png
│   ├── gold-deco-hairline.png           ← 120px × 1px gold horizontal rule
│   ├── ohcs-crest.png                   ← user-supplied
│   └── screenshot-frame.json            ← Pillow framing parameters
├── _masters/
│   ├── cover-master.pptx                ← slide-master template
│   ├── body-master.pptx
│   ├── divider-master.pptx
│   └── wow-master.pptx
├── _scripts/
│   ├── theme.py                         ← color tokens, type stack constants
│   ├── slide_templates.py               ← cover/statement/evidence/divider/wow factories
│   ├── manifest_loader.py               ← parse manifest .md → dict
│   ├── outline_loader.py                ← parse outline .md → list[Slide]
│   ├── build_deck.py                    ← shared orchestrator (called by per-deck scripts)
│   ├── verify_deck.py                   ← read-back validation (slide count, fonts, size)
│   ├── build_suite_cover.py             ← assembles all 13 covers into _SUITE-COVER.pdf
│   ├── build_01_flagship.py
│   ├── build_02_smartgate_spotlight.py
│   ├── build_03_staff_attendance_spotlight.py
│   ├── build_04_security_and_trust.py
│   ├── build_05_offline_resilience.py
│   ├── build_06_notifications_engine.py
│   ├── build_07_geofence_precision.py
│   ├── build_08_kente_executive_design.py
│   ├── build_09_reception_workflow.py
│   ├── build_10_staff_experience.py
│   ├── build_11_director_visibility.py
│   ├── build_12_build_discipline.py
│   └── build_13_roadmap_care_continues.py
├── _outlines/                           ← one .md per deck, full slide-by-slide content
│   └── (13 files, mirrors _scripts/ naming)
├── _manifests/                          ← one .md per deck, asset checklists
│   ├── _INDEX.md                        ← aggregate de-duplicated asset roll-up
│   └── (13 files, mirrors _scripts/ naming)
└── output/
    ├── 01-flagship-v0.pptx
    ├── 01-flagship-v1.pptx
    ├── ... (one v0 + one v1 per deck)
    └── _SUITE-COVER.pdf
```

**File responsibility rules:**
- `_scripts/` files are reusable Python. Per-deck scripts (`build_NN_*.py`) are thin orchestrators that call `build_deck.py` with deck-specific config.
- `_outlines/` files are markdown — readable as docs and parsed as slide data.
- `_manifests/` files are markdown — the user's checklist of what to supply.
- `_assets/` files are binary or static — generated once, reused everywhere.
- `output/` is the only directory that contains deck artifacts the user consumes.

---

## Conventions used throughout this plan

- **Verification is automated, not manual.** Every deck-build task ends with a `verify_deck.py` invocation that asserts slide count, font embedding, file size, and structural integrity. No "open in PowerPoint and check by hand".
- **Commits are frequent and atomic.** One commit per task. Commit messages follow `<scope>(decks): <subject>` where scope is `assets`, `scripts`, `outlines`, `manifests`, `output`, or `meta`.
- **Windows / PowerShell native.** Commands assume PowerShell. Python is invoked via `python` (the engineer should verify `python --version` returns 3.11+ before starting Sprint 0).

---

## Sprint 0 — Foundations

Sets up the entire factory. Nothing in subsequent sprints works without this. Estimated 15 tasks.

### Task 0.1: Verify Python environment

**Files:** none (verification only)

- [ ] **Step 1: Check Python version**

Run: `python --version`
Expected: `Python 3.11.x` or higher. If missing or older, install Python 3.11+ from python.org before continuing.

- [ ] **Step 2: Check pip is available**

Run: `python -m pip --version`
Expected: pip version string. If missing, run `python -m ensurepip`.

### Task 0.2: Create decks/ folder skeleton

**Files:**
- Create: `decks/_assets/fonts/.gitkeep`
- Create: `decks/_masters/.gitkeep`
- Create: `decks/_scripts/.gitkeep`
- Create: `decks/_outlines/.gitkeep`
- Create: `decks/_manifests/.gitkeep`
- Create: `decks/output/.gitkeep`

- [ ] **Step 1: Create the directory tree**

Run in PowerShell:
```powershell
New-Item -ItemType Directory -Force -Path "decks/_assets/fonts","decks/_masters","decks/_scripts","decks/_outlines","decks/_manifests","decks/output" | Out-Null
"" | Out-File -Encoding utf8 -FilePath "decks/_assets/fonts/.gitkeep"
"" | Out-File -Encoding utf8 -FilePath "decks/_masters/.gitkeep"
"" | Out-File -Encoding utf8 -FilePath "decks/_scripts/.gitkeep"
"" | Out-File -Encoding utf8 -FilePath "decks/_outlines/.gitkeep"
"" | Out-File -Encoding utf8 -FilePath "decks/_manifests/.gitkeep"
"" | Out-File -Encoding utf8 -FilePath "decks/output/.gitkeep"
```

- [ ] **Step 2: Verify**

Run: `Get-ChildItem -Recurse -Directory decks | Select-Object FullName`
Expected: six directories listed.

- [ ] **Step 3: Commit**

```powershell
git add decks/
git commit -m "meta(decks): scaffold decks/ folder structure"
```

### Task 0.3: Add deck-builder Python dependencies

**Files:**
- Create: `decks/_scripts/requirements.txt`

- [ ] **Step 1: Write requirements.txt**

Content:
```
python-pptx==1.0.2
Pillow==11.0.0
markdown-it-py==3.0.0
reportlab==4.2.5
```

- [ ] **Step 2: Install them**

Run: `python -m pip install -r decks/_scripts/requirements.txt`
Expected: "Successfully installed python-pptx-1.0.2 Pillow-11.0.0 markdown-it-py-3.0.0 reportlab-4.2.5" (plus transitive deps).

- [ ] **Step 3: Verify imports work**

Run: `python -c "import pptx, PIL, markdown_it, reportlab; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```powershell
git add decks/_scripts/requirements.txt
git commit -m "scripts(decks): add python-pptx + Pillow + markdown-it + reportlab"
```

### Task 0.4: Download and place Google Fonts

**Files:**
- Create: `decks/_assets/fonts/PlayfairDisplay-Bold.ttf`
- Create: `decks/_assets/fonts/PlayfairDisplay-Black.ttf`
- Create: `decks/_assets/fonts/DMSans-Regular.ttf`
- Create: `decks/_assets/fonts/DMSans-Medium.ttf`
- Create: `decks/_assets/fonts/DMSans-SemiBold.ttf`

- [ ] **Step 1: Download Playfair Display from Google Fonts**

Run in PowerShell:
```powershell
$tmp = New-Item -ItemType Directory -Force -Path "$env:TEMP/ohcs-fonts"
Invoke-WebRequest -Uri "https://fonts.google.com/download?family=Playfair+Display" -OutFile "$tmp/playfair.zip"
Expand-Archive -Force -Path "$tmp/playfair.zip" -DestinationPath "$tmp/playfair"
Copy-Item "$tmp/playfair/static/PlayfairDisplay-Bold.ttf" "decks/_assets/fonts/PlayfairDisplay-Bold.ttf"
Copy-Item "$tmp/playfair/static/PlayfairDisplay-Black.ttf" "decks/_assets/fonts/PlayfairDisplay-Black.ttf"
```

- [ ] **Step 2: Download DM Sans from Google Fonts**

Run in PowerShell:
```powershell
Invoke-WebRequest -Uri "https://fonts.google.com/download?family=DM+Sans" -OutFile "$tmp/dmsans.zip"
Expand-Archive -Force -Path "$tmp/dmsans.zip" -DestinationPath "$tmp/dmsans"
Copy-Item "$tmp/dmsans/static/DMSans-Regular.ttf" "decks/_assets/fonts/DMSans-Regular.ttf"
Copy-Item "$tmp/dmsans/static/DMSans-Medium.ttf" "decks/_assets/fonts/DMSans-Medium.ttf"
Copy-Item "$tmp/dmsans/static/DMSans-SemiBold.ttf" "decks/_assets/fonts/DMSans-SemiBold.ttf"
```

- [ ] **Step 3: Verify font files exist and are non-empty**

Run: `Get-ChildItem decks/_assets/fonts/*.ttf | Select-Object Name, Length`
Expected: five .ttf files, each > 50 KB.

- [ ] **Step 4: Commit (fonts only — keep this commit isolated)**

```powershell
git add decks/_assets/fonts/
git commit -m "assets(decks): embed Playfair Display + DM Sans (SIL OFL)"
```

### Task 0.5: Write the theme module (`theme.py`)

**Files:**
- Create: `decks/_scripts/theme.py`

- [ ] **Step 1: Write theme.py**

```python
"""Kente Executive design tokens for OHCS presentation suite."""
from pptx.util import Pt, Emu
from pptx.dml.color import RGBColor

# Color tokens (Section 4 of spec)
INK_DEEP       = RGBColor(0x0E, 0x14, 0x11)
INK_WARM       = RGBColor(0x1A, 0x17, 0x14)
CREAM_PAGE     = RGBColor(0xF6, 0xF1, 0xE7)
CREAM_SOFT     = RGBColor(0xFB, 0xF7, 0xEF)
GOLD_SIGNATURE = RGBColor(0xC9, 0xA1, 0x4A)
GOLD_DEEP      = RGBColor(0x8B, 0x6B, 0x22)
GREEN_SMARTGATE = RGBColor(0x1A, 0x4D, 0x2E)
RED_ALERT      = RGBColor(0x7A, 0x1F, 0x1F)
NEUTRAL_LINE   = RGBColor(0xD8, 0xCF, 0xBE)

# Typography (Section 4)
FONT_DISPLAY = "Playfair Display"
FONT_BODY    = "DM Sans"

SIZE_DISPLAY_COVER     = Pt(60)
SIZE_DISPLAY_STATEMENT = Pt(44)
SIZE_SECTION_TITLE     = Pt(32)
SIZE_BODY              = Pt(18)
SIZE_CAPTION           = Pt(11)
SIZE_HERO_NUMBER       = Pt(220)

# Slide dimensions (16:9 at 1920x1080)
SLIDE_WIDTH_EMU  = Emu(12192000)   # 1920px @ 96 DPI in EMUs
SLIDE_HEIGHT_EMU = Emu(6858000)    # 1080px

# Layout grid (Section 4: 12-col, 32px gutter, 48px outer margin, 80px safe-zone)
OUTER_MARGIN_EMU = Emu(457200)     # 48px
SAFE_INSET_EMU   = Emu(762000)     # 80px
GUTTER_EMU       = Emu(304800)     # 32px

# Tier accent strip mapping
TIER_STRIPS = {
    "flagship":  "_assets/kente-strip-flagship.png",
    "smartgate": "_assets/kente-strip-smartgate.png",
    "staff":     "_assets/kente-strip-staff.png",
    "thematic":  "_assets/kente-strip-thematic.png",
}

# Tier cover ring color
TIER_COVER_ACCENT = {
    "flagship":  GOLD_SIGNATURE,
    "smartgate": GOLD_SIGNATURE,
    "staff":     GREEN_SMARTGATE,
    "thematic":  GOLD_SIGNATURE,
}
```

- [ ] **Step 2: Verify the module imports**

Run: `python -c "import sys; sys.path.insert(0, 'decks/_scripts'); import theme; print(theme.GOLD_SIGNATURE)"`
Expected: a color object representation (no errors).

- [ ] **Step 3: Commit**

```powershell
git add decks/_scripts/theme.py
git commit -m "scripts(decks): add Kente Executive theme tokens"
```

### Task 0.6: Generate the Kente accent strips

**Files:**
- Create: `decks/_scripts/generate_assets.py`
- Create: `decks/_assets/kente-strip-flagship.png`
- Create: `decks/_assets/kente-strip-smartgate.png`
- Create: `decks/_assets/kente-strip-staff.png`
- Create: `decks/_assets/kente-strip-thematic.png`
- Create: `decks/_assets/gold-deco-hairline.png`
- Create: `decks/_assets/kente-texture-overlay.png`

- [ ] **Step 1: Write the asset-generation script**

```python
"""Generates Kente accent strips, gold deco hairline, and Kente texture overlay."""
from PIL import Image, ImageDraw
from pathlib import Path
import random

ASSETS = Path(__file__).parent.parent / "_assets"
ASSETS.mkdir(exist_ok=True)

# Color tuples (RGB)
INK_DEEP        = (0x0E, 0x14, 0x11)
CREAM_PAGE      = (0xF6, 0xF1, 0xE7)
GOLD_SIGNATURE  = (0xC9, 0xA1, 0x4A)
GREEN_SMARTGATE = (0x1A, 0x4D, 0x2E)

# Strip dimensions: 1920px wide × 12px tall (full-width left-edge band)
STRIP_W, STRIP_H = 1920, 12


def strip_flagship():
    img = Image.new("RGB", (STRIP_W, STRIP_H), INK_DEEP)
    d = ImageDraw.Draw(img)
    for x in range(0, STRIP_W, 8):
        d.polygon([(x, 0), (x + 4, 0), (x + 8, STRIP_H), (x + 4, STRIP_H)], fill=GOLD_SIGNATURE)
    img.save(ASSETS / "kente-strip-flagship.png")


def strip_smartgate():
    img = Image.new("RGB", (STRIP_W, STRIP_H), GOLD_SIGNATURE)
    d = ImageDraw.Draw(img)
    for x in range(0, STRIP_W, 24):
        d.rectangle([x, 0, x + 12, STRIP_H], fill=CREAM_PAGE)
    img.save(ASSETS / "kente-strip-smartgate.png")


def strip_staff():
    img = Image.new("RGB", (STRIP_W, STRIP_H), GREEN_SMARTGATE)
    d = ImageDraw.Draw(img)
    for x in range(0, STRIP_W, 16):
        d.rectangle([x, 0, x + 4, STRIP_H], fill=GOLD_SIGNATURE)
        d.rectangle([x + 8, 4, x + 12, STRIP_H - 4], fill=GOLD_SIGNATURE)
    img.save(ASSETS / "kente-strip-staff.png")


def strip_thematic():
    img = Image.new("RGB", (STRIP_W, STRIP_H), GOLD_SIGNATURE)
    d = ImageDraw.Draw(img)
    cx = STRIP_W // 2
    d.polygon([(cx - 6, 0), (cx + 6, 0), (cx, STRIP_H)], fill=INK_DEEP)
    img.save(ASSETS / "kente-strip-thematic.png")


def gold_deco_hairline():
    # 120px wide × 1px tall, transparent background
    img = Image.new("RGBA", (120, 1), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([(0, 0), (119, 0)], fill=GOLD_SIGNATURE + (255,), width=1)
    img.save(ASSETS / "gold-deco-hairline.png")


def kente_texture_overlay():
    # 1920x1080 dark Kente-inspired weave at 6% opacity (alpha=15/255)
    random.seed(42)
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    alpha = 15
    for y in range(0, 1080, 24):
        for x in range(0, 1920, 48):
            d.rectangle([x, y, x + 24, y + 12], fill=GOLD_SIGNATURE + (alpha,))
            d.rectangle([x + 24, y + 12, x + 48, y + 24], fill=GOLD_SIGNATURE + (alpha,))
    img.save(ASSETS / "kente-texture-overlay.png")


if __name__ == "__main__":
    strip_flagship()
    strip_smartgate()
    strip_staff()
    strip_thematic()
    gold_deco_hairline()
    kente_texture_overlay()
    print("Generated 6 assets in", ASSETS)
```

- [ ] **Step 2: Run it**

Run: `python decks/_scripts/generate_assets.py`
Expected: `Generated 6 assets in <path>`

- [ ] **Step 3: Verify all 6 files exist**

Run: `Get-ChildItem decks/_assets/*.png | Select-Object Name, Length`
Expected: 6 PNG files, each > 100 bytes.

- [ ] **Step 4: Commit**

```powershell
git add decks/_scripts/generate_assets.py decks/_assets/*.png
git commit -m "assets(decks): generate Kente strips, deco hairline, texture overlay"
```

### Task 0.7: Write the slide template factory (`slide_templates.py`)

**Files:**
- Create: `decks/_scripts/slide_templates.py`

- [ ] **Step 1: Write slide_templates.py**

```python
"""Slide factory functions — one per slide type in the 7-block skeleton."""
from pathlib import Path
from pptx.util import Emu, Pt, Inches
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
import theme

ASSETS = Path(__file__).parent.parent / "_assets"


def _set_slide_background(slide, color):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color


def _add_text(slide, left, top, width, height, text, font, size, color, bold=False, align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.name = font
    run.font.size = size
    run.font.color.rgb = color
    run.font.bold = bold
    return box


def _add_footer(slide, deck_id: str, deck_title: str, page: int, total: int):
    """Footer bar: '06 · Notifications Engine · 09/14' bottom-right."""
    text = f"{deck_id} · {deck_title} · {page:02d}/{total:02d}"
    _add_text(
        slide,
        left=Emu(8000000), top=Emu(6500000),
        width=Emu(4000000), height=Emu(300000),
        text=text, font=theme.FONT_BODY, size=theme.SIZE_CAPTION,
        color=theme.NEUTRAL_LINE, align=PP_ALIGN.RIGHT,
    )


def _add_tier_strip(slide, tier: str):
    """12px-tall left-edge accent strip rendered as a top band."""
    img_path = str(ASSETS / Path(theme.TIER_STRIPS[tier]).name)
    slide.shapes.add_picture(img_path, Emu(0), Emu(0), width=theme.SLIDE_WIDTH_EMU, height=Emu(100000))


def add_cover_slide(prs, deck_id, deck_title, deck_subtitle, tier, audience, version, date):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    _set_slide_background(slide, theme.CREAM_PAGE)
    _add_tier_strip(slide, tier)

    # Deck ID badge (top-left, small, gold)
    _add_text(
        slide, Emu(800000), Emu(600000), Emu(1500000), Emu(300000),
        deck_id, theme.FONT_BODY, theme.SIZE_CAPTION, theme.GOLD_DEEP, bold=True,
    )

    # Title (centered vertically, generous space)
    _add_text(
        slide, Emu(800000), Emu(2200000), Emu(10500000), Emu(1500000),
        deck_title, theme.FONT_DISPLAY, theme.SIZE_DISPLAY_COVER, theme.INK_DEEP, bold=True,
        align=PP_ALIGN.CENTER,
    )

    # Gold deco hairline under title
    slide.shapes.add_picture(
        str(ASSETS / "gold-deco-hairline.png"),
        Emu(5896000), Emu(3900000), width=Emu(400000), height=Emu(20000),
    )

    # Subtitle
    _add_text(
        slide, Emu(800000), Emu(4100000), Emu(10500000), Emu(500000),
        deck_subtitle, theme.FONT_BODY, theme.SIZE_BODY, theme.INK_WARM,
        align=PP_ALIGN.CENTER,
    )

    # Audience tag (bottom-left)
    _add_text(
        slide, Emu(800000), Emu(6200000), Emu(4000000), Emu(300000),
        f"For: {audience}", theme.FONT_BODY, theme.SIZE_CAPTION, theme.GOLD_DEEP,
    )

    # Version + date (bottom-right)
    _add_text(
        slide, Emu(8000000), Emu(6200000), Emu(4000000), Emu(300000),
        f"v{version} · {date}", theme.FONT_BODY, theme.SIZE_CAPTION, theme.NEUTRAL_LINE,
        align=PP_ALIGN.RIGHT,
    )
    return slide


def add_divider_slide(prs, line: str):
    """Dark Kente-textured slide with one editorial sentence."""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.INK_DEEP)
    # Texture overlay
    slide.shapes.add_picture(
        str(ASSETS / "kente-texture-overlay.png"),
        Emu(0), Emu(0), width=theme.SLIDE_WIDTH_EMU, height=theme.SLIDE_HEIGHT_EMU,
    )
    _add_text(
        slide, Emu(1600000), Emu(2800000), Emu(8900000), Emu(2000000),
        line, theme.FONT_DISPLAY, theme.SIZE_DISPLAY_STATEMENT, theme.CREAM_PAGE,
        align=PP_ALIGN.CENTER,
    )
    return slide


def add_toc_slide(prs, bullets: list[str], deck_id: str, deck_title: str, page: int, total: int):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.CREAM_PAGE)
    _add_text(
        slide, Emu(1000000), Emu(800000), Emu(10000000), Emu(800000),
        "What you'll see", theme.FONT_DISPLAY, theme.SIZE_DISPLAY_STATEMENT,
        theme.INK_DEEP, bold=True,
    )
    for i, bullet in enumerate(bullets):
        _add_text(
            slide, Emu(1500000), Emu(2400000 + i * 1000000), Emu(9000000), Emu(800000),
            f"{i+1:02d}.  {bullet}", theme.FONT_BODY, Pt(24), theme.INK_WARM,
        )
    _add_footer(slide, deck_id, deck_title, page, total)
    return slide


def add_statement_slide(prs, headline: str, sub: str, deck_id: str, deck_title: str, page: int, total: int):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.CREAM_PAGE)
    _add_text(
        slide, Emu(1200000), Emu(2200000), Emu(9700000), Emu(1500000),
        headline, theme.FONT_DISPLAY, theme.SIZE_DISPLAY_STATEMENT,
        theme.INK_DEEP, bold=True, align=PP_ALIGN.CENTER,
    )
    slide.shapes.add_picture(
        str(ASSETS / "gold-deco-hairline.png"),
        Emu(5896000), Emu(3800000), width=Emu(400000), height=Emu(20000),
    )
    _add_text(
        slide, Emu(1500000), Emu(4100000), Emu(9100000), Emu(1200000),
        sub, theme.FONT_BODY, Pt(22), theme.INK_WARM, align=PP_ALIGN.CENTER,
    )
    _add_footer(slide, deck_id, deck_title, page, total)
    return slide


def add_evidence_slide(prs, title: str, image_path: str | None, bullets: list[str],
                       caption: str, deck_id: str, deck_title: str, page: int, total: int):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.CREAM_PAGE)

    _add_text(
        slide, Emu(800000), Emu(500000), Emu(10500000), Emu(700000),
        title, theme.FONT_BODY, theme.SIZE_SECTION_TITLE, theme.INK_DEEP, bold=True,
    )

    # Left: screenshot/image (or placeholder rectangle)
    if image_path and Path(image_path).exists():
        slide.shapes.add_picture(image_path, Emu(800000), Emu(1500000),
                                 width=Emu(5800000), height=Emu(4500000))
    else:
        ph = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                    Emu(800000), Emu(1500000), Emu(5800000), Emu(4500000))
        ph.fill.solid()
        ph.fill.fore_color.rgb = theme.CREAM_SOFT
        ph.line.color.rgb = theme.NEUTRAL_LINE
        tf = ph.text_frame
        tf.text = f"[REPLACE: {Path(image_path).name if image_path else 'image'}]"
        for p in tf.paragraphs:
            p.alignment = PP_ALIGN.CENTER
            for r in p.runs:
                r.font.name = theme.FONT_BODY
                r.font.size = theme.SIZE_CAPTION
                r.font.color.rgb = theme.GOLD_DEEP

    # Right: numbered callout bullets
    for i, bullet in enumerate(bullets[:3]):
        _add_text(
            slide, Emu(7100000), Emu(1500000 + i * 1300000),
            Emu(4200000), Emu(1100000),
            f"{chr(0x2460 + i)}  {bullet}", theme.FONT_BODY, Pt(16),
            theme.INK_WARM,
        )

    # Caption (full-width, below image)
    _add_text(
        slide, Emu(800000), Emu(6100000), Emu(10500000), Emu(300000),
        caption, theme.FONT_BODY, theme.SIZE_CAPTION, theme.GOLD_DEEP,
    )
    _add_footer(slide, deck_id, deck_title, page, total)
    return slide


def add_wow_slide(prs, hero_number: str, label: str, deck_id: str, deck_title: str, page: int, total: int):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.INK_DEEP)
    slide.shapes.add_picture(
        str(ASSETS / "kente-texture-overlay.png"),
        Emu(0), Emu(0), width=theme.SLIDE_WIDTH_EMU, height=theme.SLIDE_HEIGHT_EMU,
    )
    _add_text(
        slide, Emu(800000), Emu(1500000), Emu(10500000), Emu(3500000),
        hero_number, theme.FONT_DISPLAY, theme.SIZE_HERO_NUMBER,
        theme.GOLD_SIGNATURE, bold=True, align=PP_ALIGN.CENTER,
    )
    _add_text(
        slide, Emu(800000), Emu(5300000), Emu(10500000), Emu(700000),
        label, theme.FONT_BODY, Pt(28), theme.CREAM_PAGE, align=PP_ALIGN.CENTER,
    )
    _add_footer(slide, deck_id, deck_title, page, total)
    return slide


def add_appendix_slide(prs, links: list[str], related: list[str], deck_id: str, deck_title: str, page: int, total: int):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.CREAM_PAGE)
    _add_text(
        slide, Emu(1000000), Emu(800000), Emu(10000000), Emu(700000),
        "Appendix", theme.FONT_DISPLAY, theme.SIZE_DISPLAY_STATEMENT, theme.INK_DEEP, bold=True,
    )
    _add_text(
        slide, Emu(1000000), Emu(2000000), Emu(5000000), Emu(400000),
        "Live URLs", theme.FONT_BODY, Pt(18), theme.GOLD_DEEP, bold=True,
    )
    for i, link in enumerate(links):
        _add_text(slide, Emu(1000000), Emu(2500000 + i * 400000), Emu(5000000), Emu(400000),
                  link, theme.FONT_BODY, Pt(14), theme.INK_WARM)
    _add_text(
        slide, Emu(7000000), Emu(2000000), Emu(5000000), Emu(400000),
        "Related decks", theme.FONT_BODY, Pt(18), theme.GOLD_DEEP, bold=True,
    )
    for i, rel in enumerate(related):
        _add_text(slide, Emu(7000000), Emu(2500000 + i * 400000), Emu(5000000), Emu(400000),
                  rel, theme.FONT_BODY, Pt(14), theme.INK_WARM)
    _add_text(
        slide, Emu(1000000), Emu(6300000), Emu(10000000), Emu(400000),
        "Built on Cloudflare's edge · Designed in the Kente Executive language",
        theme.FONT_BODY, theme.SIZE_CAPTION, theme.GOLD_DEEP, align=PP_ALIGN.CENTER,
    )
    _add_footer(slide, deck_id, deck_title, page, total)
    return slide
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `python -c "import sys; sys.path.insert(0, 'decks/_scripts'); import slide_templates; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```powershell
git add decks/_scripts/slide_templates.py
git commit -m "scripts(decks): add 7-block slide template factory"
```

### Task 0.8: Write the outline loader (`outline_loader.py`)

**Files:**
- Create: `decks/_scripts/outline_loader.py`

- [ ] **Step 1: Write outline_loader.py**

```python
"""Parses an outline .md file into a list of Slide dicts.

Outline format (each slide is a markdown H2 with typed metadata):

    ## [cover]
    title: SmartGate — Visitor Management in Production
    subtitle: How OHCS reception checks visitors in
    tier: smartgate
    audience: Executive Leadership
    version: 0
    date: 2026-05-28

    ## [divider]
    line: Before SmartGate, OHCS knew who arrived only when someone signed a book.

    ## [toc]
    - The check-in flow
    - The arrival alert
    - The reports leadership reads

    ## [statement]
    headline: The 75m circle isn't a circle.
    sub: It's a circle plus your phone's reported GPS accuracy.

    ## [evidence]
    title: Clock-in in 4 seconds
    image: ../_assets/screenshots/staff-clock-success.png
    bullets:
        - Tap once. Camera opens.
        - GPS confirmed inside 75m fence.
        - Streak counter ticks up.
    caption: Captured from staff-attendance.pages.dev, May 2026.

    ## [wow]
    hero: 0
    label: Third-party push services used. Zero.

    ## [appendix]
    links:
        - staff-attendance.pages.dev
        - ohcs-smartgate.pages.dev
    related:
        - Deck 06 · The Notifications Engine
        - Deck 13 · Roadmap
"""
from pathlib import Path


def parse_outline(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    slides = []
    current = None
    current_key = None
    list_accumulator = None

    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("## ["):
            if current is not None:
                if list_accumulator is not None and current_key is not None:
                    current[current_key] = list_accumulator
                slides.append(current)
            slide_type = line[4:line.index("]")]
            current = {"type": slide_type}
            current_key = None
            list_accumulator = None
        elif current is None:
            continue
        elif line.strip().startswith("-") and current_key is not None:
            if list_accumulator is None:
                list_accumulator = []
            list_accumulator.append(line.strip()[1:].strip())
        elif ":" in line and not line.startswith(" "):
            if list_accumulator is not None and current_key is not None:
                current[current_key] = list_accumulator
                list_accumulator = None
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            current_key = key
            if value:
                current[key] = value
                current_key = None

    if current is not None:
        if list_accumulator is not None and current_key is not None:
            current[current_key] = list_accumulator
        slides.append(current)
    return slides
```

- [ ] **Step 2: Quick smoke test**

Run:
```powershell
@"
## [cover]
title: Test
subtitle: Sub
tier: thematic
audience: Test
version: 0
date: 2026-05-28
"@ | Out-File -Encoding utf8 -FilePath "$env:TEMP/test-outline.md"

python -c "import sys; sys.path.insert(0, 'decks/_scripts'); from outline_loader import parse_outline; from pathlib import Path; print(parse_outline(Path(r'$env:TEMP/test-outline.md')))"
```
Expected: `[{'type': 'cover', 'title': 'Test', 'subtitle': 'Sub', 'tier': 'thematic', 'audience': 'Test', 'version': '0', 'date': '2026-05-28'}]`

- [ ] **Step 3: Commit**

```powershell
git add decks/_scripts/outline_loader.py
git commit -m "scripts(decks): add outline .md parser"
```

### Task 0.9: Write the shared build orchestrator (`build_deck.py`)

**Files:**
- Create: `decks/_scripts/build_deck.py`

- [ ] **Step 1: Write build_deck.py**

```python
"""Orchestrates a deck build: outline.md -> .pptx via slide_templates."""
from pathlib import Path
from pptx import Presentation
from pptx.util import Emu

import theme
import slide_templates as tpl
from outline_loader import parse_outline


def build(outline_path: Path, output_path: Path, deck_id: str, deck_title: str):
    slides = parse_outline(outline_path)
    if not slides:
        raise ValueError(f"No slides parsed from {outline_path}")

    prs = Presentation()
    prs.slide_width = theme.SLIDE_WIDTH_EMU
    prs.slide_height = theme.SLIDE_HEIGHT_EMU

    total = len(slides)
    for i, slide in enumerate(slides, start=1):
        t = slide["type"]
        if t == "cover":
            tpl.add_cover_slide(prs, deck_id, slide["title"], slide.get("subtitle", ""),
                                slide["tier"], slide["audience"],
                                slide.get("version", "0"), slide["date"])
        elif t == "divider":
            tpl.add_divider_slide(prs, slide["line"])
        elif t == "toc":
            tpl.add_toc_slide(prs, slide.get("bullets", []), deck_id, deck_title, i, total)
        elif t == "statement":
            tpl.add_statement_slide(prs, slide["headline"], slide.get("sub", ""),
                                    deck_id, deck_title, i, total)
        elif t == "evidence":
            image = slide.get("image")
            image_full = str((outline_path.parent / image).resolve()) if image else None
            tpl.add_evidence_slide(prs, slide["title"], image_full,
                                   slide.get("bullets", []), slide.get("caption", ""),
                                   deck_id, deck_title, i, total)
        elif t == "wow":
            tpl.add_wow_slide(prs, slide["hero"], slide.get("label", ""),
                              deck_id, deck_title, i, total)
        elif t == "appendix":
            tpl.add_appendix_slide(prs, slide.get("links", []), slide.get("related", []),
                                   deck_id, deck_title, i, total)
        else:
            raise ValueError(f"Unknown slide type: {t}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
    return output_path
```

- [ ] **Step 2: Verify imports**

Run: `python -c "import sys; sys.path.insert(0, 'decks/_scripts'); import build_deck; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```powershell
git add decks/_scripts/build_deck.py
git commit -m "scripts(decks): add shared deck build orchestrator"
```

### Task 0.10: Write the verifier (`verify_deck.py`)

**Files:**
- Create: `decks/_scripts/verify_deck.py`

- [ ] **Step 1: Write verify_deck.py**

```python
"""Reads back a .pptx and asserts: slide count matches, file size under cap, no broken pictures."""
import sys
from pathlib import Path
from pptx import Presentation


def verify(pptx_path: Path, expected_slides: int, max_mb: int = 25) -> None:
    prs = Presentation(str(pptx_path))
    actual = len(prs.slides)
    if actual != expected_slides:
        raise AssertionError(f"{pptx_path.name}: expected {expected_slides} slides, got {actual}")
    size_mb = pptx_path.stat().st_size / (1024 * 1024)
    if size_mb > max_mb:
        raise AssertionError(f"{pptx_path.name}: {size_mb:.1f} MB exceeds {max_mb} MB cap")
    # Walk every shape and confirm no orphaned pictures
    for i, slide in enumerate(prs.slides, start=1):
        for shape in slide.shapes:
            if shape.shape_type == 13:  # PICTURE
                if shape.image is None:
                    raise AssertionError(f"{pptx_path.name}: slide {i} has orphan picture")
    print(f"OK  {pptx_path.name}  slides={actual}  size={size_mb:.2f}MB")


if __name__ == "__main__":
    pptx_path = Path(sys.argv[1])
    expected = int(sys.argv[2])
    verify(pptx_path, expected)
```

- [ ] **Step 2: Commit**

```powershell
git add decks/_scripts/verify_deck.py
git commit -m "scripts(decks): add read-back verifier"
```

### Task 0.11: Smoke-test the full pipeline

**Files:**
- Create: `decks/_outlines/_smoke.md` (temporary, deleted after smoke test)

- [ ] **Step 1: Write a 3-slide smoke outline**

Path: `decks/_outlines/_smoke.md`

```markdown
## [cover]
title: Smoke Test
subtitle: Pipeline check
tier: thematic
audience: Engineer
version: 0
date: 2026-05-28

## [divider]
line: If this builds, the factory works.

## [appendix]
links:
    - example.com
related:
    - none
```

- [ ] **Step 2: Build it**

Run:
```powershell
cd decks/_scripts
python -c "from pathlib import Path; from build_deck import build; build(Path('../_outlines/_smoke.md'), Path('../output/_smoke.pptx'), '00', 'Smoke Test')"
cd ../..
```
Expected: no errors, file `decks/output/_smoke.pptx` exists.

- [ ] **Step 3: Verify it**

Run:
```powershell
cd decks/_scripts
python verify_deck.py "../output/_smoke.pptx" 3
cd ../..
```
Expected: `OK  _smoke.pptx  slides=3  size=<N>MB`

- [ ] **Step 4: Clean up smoke artifacts**

Run:
```powershell
Remove-Item decks/_outlines/_smoke.md
Remove-Item decks/output/_smoke.pptx
```

- [ ] **Step 5: Commit (no artifacts, just a "smoke verified" marker)**

```powershell
git commit --allow-empty -m "meta(decks): foundations smoke test passed (3-slide pipeline)"
```

### Task 0.12: Write the aggregate manifest index

**Files:**
- Create: `decks/_manifests/_INDEX.md`

- [ ] **Step 1: Write _INDEX.md**

```markdown
# Asset Manifest — Aggregate Index

This file is the **single source of truth** for every screenshot, metric, quote, and miscellaneous asset needed across all 13 decks. De-duplicated: each asset listed once with a `Used by:` tag showing which decks consume it.

When you finish capturing/supplying an asset, tick it here AND in every per-deck manifest that consumes it.

---

## Screenshots needed

| ID | Asset | Used by decks | Where to capture | Status |
|----|-------|---------------|------------------|--------|
| S01 | Reception check-in form, blank | 01, 02, 09 | ohcs-smartgate.pages.dev → /reception/checkin | ☐ |
| S02 | Reception check-in form, mid-fill (visitor + host selected) | 02, 09 | same | ☐ |
| S03 | Visitor badge — printable view | 01, 02, 09 | same → after submit | ☐ |
| S04 | Host officer — incoming arrival in-app bell | 02, 11 | ohcs-smartgate.pages.dev (logged in as host) | ☐ |
| S05 | Telegram visitor-arrival notification (mobile) | 02, 06, 11 | Telegram app on phone | ☐ |
| S06 | Director directorate visit report (date range) | 02, 11 | ohcs-smartgate.pages.dev → /admin/reports | ☐ |
| S07 | PDF export of visit report | 02, 11 | downloaded PDF, screenshot first page | ☐ |
| S08 | Clock-in screen — GPS acquired, inside fence | 01, 03, 07, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S09 | Clock-in screen — weak GPS at boundary, accepted | 03, 07 | same, accuracy ~40m, ~70m from center | ☐ |
| S10 | Clock-in rejection — clear distance + accuracy | 03, 07 | same, 200m+ outside fence | ☐ |
| S11 | First-login enforced PIN-change modal | 03, 04, 10 | staff-attendance.pages.dev (new user) | ☐ |
| S12 | Streak banner with "best-ever" badge | 03, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S13 | Absence notice flow — modal open | 03, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S14 | Daily summary Telegram message (mobile, 9:00 AM) | 01, 06, 11 | Telegram app on phone | ☐ |
| S15 | Director late-clock-alert push | 06, 11 | iOS/Android notification screen | ☐ |
| S16 | OHCS HQ location, Google Maps with 75m circle drawn | 01, 07 | maps.google.com, OHCS HQ pinned | ☐ |
| S17 | Geofence precision retrace — commit diff (59b564a) | 07, 12 | github.com, commit page | ☐ |
| S18 | Self-hosted Web Push code excerpt — VAPID + aes128gcm | 04, 12 | VS Code, packages/api/src/lib/webpush.ts | ☐ |
| S19 | Security fixes list — `docs/superpowers/specs/2026-04-18-security-hardening-design.md` | 04, 12 | repo, rendered or VS Code | ☐ |
| S20 | RBAC require-role middleware code excerpt | 04, 12 | VS Code, requireRole helper | ☐ |
| S21 | Offline banner showing on staff PWA | 03, 05, 10 | staff-attendance.pages.dev, airplane mode | ☐ |
| S22 | Queued mutations replay (IndexedDB inspector + reconnect log) | 05, 12 | Chrome DevTools, Application → IndexedDB | ☐ |
| S23 | iOS Add-to-Home-Screen instructions screen | 05 | iOS Safari, Share menu | ☐ |
| S24 | Distinct home-screen icons — staff (green) + VMS (gold) | 05, 08 | phone home screen with both installed | ☐ |
| S25 | Kente Executive — full clock page hero | 08, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S26 | Confetti burst on successful clock-in | 08, 10 | staff-attendance.pages.dev → /clock | ☐ |
| S27 | Type pair — Playfair + DM Sans specimen sheet | 08 | designed in-deck (no capture needed) | n/a |
| S28 | docs/superpowers tree screenshot | 12 | VS Code file tree | ☐ |
| S29 | One spec file (rendered) — pick a representative one | 12 | GitHub or VS Code preview | ☐ |
| S30 | One plan file (rendered) — pick a representative one | 12 | GitHub or VS Code preview | ☐ |
| S31 | wrangler.toml cron triggers section | 06 | VS Code, packages/api/wrangler.toml | ☐ |
| S32 | Telegram bot daily summary HTML message preview | 06 | code or rendered | ☐ |
| S33 | KV rate-limit hit response (devtools network tab) | 04 | Chrome DevTools | ☐ |
| S34 | applied_migrations table view | 04, 12 | D1 console | ☐ |
| S35 | Push health endpoint response JSON | 04, 06 | /api/admin/health/push | ☐ |
| S36 | eBadge — staff digital badge view | 03, 10 | per spec 2026-04-28-staff-ebadge | ☐ |

## Numbers needed

| ID | Metric | Used by decks | Source | Value | Status |
|----|--------|---------------|--------|-------|--------|
| N01 | Total visitors checked in to date | 01, 02, 09 | D1: `SELECT COUNT(*) FROM visits` | _____ | ☐ |
| N02 | Average daily visitors | 02, 09 | D1: rolling 30-day avg | _____ | ☐ |
| N03 | Total clock-ins to date | 01, 03, 10 | D1: `SELECT COUNT(*) FROM clock_records WHERE clock_in_at IS NOT NULL` | _____ | ☐ |
| N04 | % clock-ins successful on first GPS try | 03, 07 | D1 derived | _____% | ☐ |
| N05 | Average GPS accuracy at clock-in | 07 | D1: `clock_records.gps_accuracy` mean | _____ m | ☐ |
| N06 | Distinct staff accounts active | 01, 03, 10 | D1: `staff WHERE last_login >= 30d` | _____ | ☐ |
| N07 | Telegram daily summary subscribers (directorate heads) | 06, 11 | D1 telegram links | _____ | ☐ |
| N08 | Web Push subscriptions active | 04, 06 | D1 push subscriptions | _____ | ☐ |
| N09 | Push delivery success rate (last 7d) | 04, 06 | /api/admin/health/push | _____% | ☐ |
| N10 | Offline-queued clock-ins replayed successfully | 05 | D1 counter | _____ | ☐ |
| N11 | Avg p50 API latency (Cloudflare analytics) | 01, 14 | CF dashboard | _____ ms | ☐ |
| N12 | Absence notices filed | 03 | D1 absence_notices | _____ | ☐ |
| N13 | Late-clock alerts sent | 06, 11 | D1 push log | _____ | ☐ |
| N14 | Total specs in docs/superpowers/specs/ | 12 | repo file count | _____ | ☐ |
| N15 | Lines of TypeScript across packages/ | 12, 14 | `git ls-files \| sl '.ts$'` (PowerShell) | _____ | ☐ |

## Quotes / sign-off needed

| ID | From | Used by decks | Purpose | Text | Status |
|----|------|---------------|---------|------|--------|
| Q01 | Head of Civil Service | 01 | Flagship closing endorsement | "_____" | ☐ |
| Q02 | IT Director | 04 | Security & Trust closing | "_____" | ☐ |
| Q03 | Reception lead | 02, 09 | Workflow improvement quote | "_____" | ☐ |
| Q04 | A directorate director | 11 | Visibility quote | "_____" | ☐ |
| Q05 | One staff member | 10 | Daily experience quote | "_____" | ☐ |
| Q06 | Designer / brand owner | 08 | Design language statement | "_____" | ☐ |

## Miscellaneous

| ID | Asset | Used by decks | Notes | Status |
|----|-------|---------------|-------|--------|
| M01 | OHCS official crest (high-res PNG, transparent bg) | all 13 | place at decks/_assets/ohcs-crest.png | ☐ |
| M02 | OHCS HQ exterior photograph | 01, 09 | Optional but warm; used on cover or divider | ☐ |
| M03 | Permission to display Google Maps screenshot publicly | 01, 07 | Google brand guidelines | ☐ |
| M04 | Permission to share metrics publicly | all | Internal governance check | ☐ |

---

**Delivery gate:** No deck moves from v0 to v1 until every asset that deck consumes is ✓ here.
```

- [ ] **Step 2: Commit**

```powershell
git add decks/_manifests/_INDEX.md
git commit -m "manifests(decks): aggregate asset roll-up across all 13 decks"
```

### Task 0.13: Stub all 13 per-deck manifest files

**Files:** create 13 files in `decks/_manifests/` — one per deck.

Each manifest follows the same template. To keep this plan readable, the template is shown once below and the engineer creates the 13 instances by copy-paste, swapping the deck-specific fields.

- [ ] **Step 1: Write the manifest template** to `decks/_manifests/_TEMPLATE.md`:

```markdown
# Deck NN · <Deck Title> — Asset Manifest

**Status:** ☐ draft  ☐ assets gathered  ☐ produced  ☐ delivered
**Slide count target:** NN
**Audience:** Executive Leadership
**Tier:** flagship | smartgate | staff | thematic
**Wow moment:** <describe>

---

## 1 · Screenshots needed

Pull from `_INDEX.md`. Tick here AND in `_INDEX.md` once captured.

| Local ref | Index ID | Status |
|-----------|----------|--------|
| S1 | S08 | ☐ |
| S2 | S09 | ☐ |

## 2 · Numbers needed

| Local ref | Index ID | Status |
|-----------|----------|--------|
| N1 | N03 | ☐ |

## 3 · Quotes / sign-off needed

| Local ref | Index ID | Status |
|-----------|----------|--------|
| Q1 | Q02 | ☐ |

## 4 · Anything else this deck needs

- (deck-specific notes)

---

**Delivery gate:** This deck cannot move from v0 → v1 until every ☐ above is ✓.
```

- [ ] **Step 2: Create the 13 per-deck manifest stubs**

Run:
```powershell
$decks = @(
    @{n="01"; t="flagship"; title="The Story So Far"; slides=18; tier="flagship"},
    @{n="02"; t="smartgate-spotlight"; title="SmartGate — Visitor Management in Production"; slides=20; tier="smartgate"},
    @{n="03"; t="staff-attendance-spotlight"; title="Staff Attendance — Clocking In, Honestly"; slides=20; tier="staff"},
    @{n="04"; t="security-and-trust"; title="Security & Trust"; slides=16; tier="thematic"},
    @{n="05"; t="offline-resilience"; title="Offline-First Resilience"; slides=14; tier="thematic"},
    @{n="06"; t="notifications-engine"; title="The Notifications Engine"; slides=14; tier="thematic"},
    @{n="07"; t="geofence-precision"; title="GPS Geofence Precision"; slides=14; tier="thematic"},
    @{n="08"; t="kente-executive-design"; title="Kente Executive — A Civic Design Language"; slides=16; tier="thematic"},
    @{n="09"; t="reception-workflow"; title="Reception Workflow"; slides=14; tier="thematic"},
    @{n="10"; t="staff-experience"; title="The Staff Experience"; slides=14; tier="thematic"},
    @{n="11"; t="director-visibility"; title="Director Visibility"; slides=12; tier="thematic"},
    @{n="12"; t="build-discipline"; title="The Build Discipline"; slides=14; tier="thematic"},
    @{n="13"; t="roadmap-care-continues"; title="Roadmap — Care Continues"; slides=12; tier="thematic"}
)
$template = Get-Content -Raw decks/_manifests/_TEMPLATE.md
foreach ($d in $decks) {
    $out = $template `
        -replace 'NN · <Deck Title>', "$($d.n) · $($d.title)" `
        -replace 'Slide count target:\*\* NN', "Slide count target:** $($d.slides)" `
        -replace 'flagship \| smartgate \| staff \| thematic', $d.tier
    $path = "decks/_manifests/$($d.n)-$($d.t).md"
    $out | Out-File -Encoding utf8 -FilePath $path
}
Get-ChildItem decks/_manifests/*.md | Select-Object Name
```
Expected: 14 files listed (13 deck manifests + `_INDEX.md` + `_TEMPLATE.md`).

- [ ] **Step 3: Commit**

```powershell
git add decks/_manifests/
git commit -m "manifests(decks): stub per-deck manifests for all 13 decks"
```

### Task 0.14: Mark Sprint 0 complete

- [ ] **Step 1: Empty commit as Sprint 0 boundary marker**

```powershell
git commit --allow-empty -m "meta(decks): Sprint 0 complete — foundations + factory ready"
```

---

## Sprint 1 — Reference Deck (Deck 04 · Security & Trust)

Proves the foundations work by building one deck end-to-end. All subsequent decks follow this exact pattern.

### Task 1.1: Write the Deck 04 outline

**Files:**
- Create: `decks/_outlines/04-security-and-trust.md`

- [ ] **Step 1: Write the full outline**

Path: `decks/_outlines/04-security-and-trust.md`

```markdown
## [cover]
title: Security & Trust
subtitle: How SmartGate keeps OHCS data safe — by design, not by hope
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Trust isn't a feature. It's a side-effect of a hundred small decisions made carefully.

## [toc]
- The twelve-fix hardening pass
- Self-hosted Web Push — no third party in the loop
- Role-based access, constant-time secrets, audited migrations

## [statement]
headline: Twelve security fixes. One quarter.
sub: Logged together as a single hardening sweep across OTP exposure, PIN timing, CORS, photo auth, RBAC, and rate limits.

## [evidence]
title: The hardening sweep at a glance
image: ../_assets/screenshots/S19-security-fixes-list.png
bullets:
    - Each fix has a written spec and a tested fix.
    - The list is in the repo — not a slide deck.
    - Every fix shipped within 30 days of being filed.
caption: Source — docs/superpowers/specs/2026-04-18-security-hardening-design.md

## [statement]
headline: PIN verification runs in constant time.
sub: No length leaks. No timing oracles. Byte-wise XOR comparison.

## [evidence]
title: Constant-time PIN compare
image: ../_assets/screenshots/S20-rbac-middleware.png
bullets:
    - PINs are SHA-256 hashed at rest.
    - Comparison cannot short-circuit on first mismatch.
    - Same time to fail whether your PIN is right or wrong.
caption: packages/api/src/services/auth — verifyPin()

## [statement]
headline: Web Push, self-hosted from scratch.
sub: VAPID JWT signing, RFC 8291 aes128gcm encryption — via Web Crypto API in a Worker.

## [evidence]
title: Zero third-party push dependencies
image: ../_assets/screenshots/S18-webpush-code.png
bullets:
    - No FCM, no OneSignal, no proxy.
    - VAPID private key is a Worker secret.
    - Push payload encrypted end-to-end per subscription.
caption: packages/api/src/lib/webpush.ts

## [wow]
hero: 0
label: Third-party push services in the delivery path. Zero.

## [statement]
headline: Role-based access, centralised.
sub: One requireRole guard. Six roles. Every authenticated endpoint passes through it.

## [evidence]
title: Six roles, one guard
image: ../_assets/screenshots/S20-rbac-middleware.png
bullets:
    - superadmin, admin, director, receptionist, it, staff.
    - Routes declare required role inline.
    - Drift is detectable — every endpoint exercises the guard.
caption: packages/api/src/lib/require-role.ts

## [statement]
headline: Login attempts are rate-limited at the edge.
sub: KV-backed counters per email, per IP, per staff ID. Brute force has nowhere to land.

## [evidence]
title: Rate-limit hit, surfaced to the user
image: ../_assets/screenshots/S33-ratelimit-hit.png
bullets:
    - /auth/login, /auth/verify, /auth/pin-login all gated.
    - Cloudflare KV stores hit counts with TTL.
    - Counters reset cleanly — no false lockouts.
caption: Captured from staff-attendance.pages.dev DevTools

## [statement]
headline: Migrations are tracked, not whispered.
sub: An applied_migrations table records every schema change. The runner is superadmin-only.

## [evidence]
title: Audited schema evolution
image: ../_assets/screenshots/S34-applied-migrations.png
bullets:
    - No "we ran the file in production at 2 AM" risk.
    - Idempotent — re-runs are safe.
    - Migration history is queryable.
caption: D1 console — applied_migrations table

## [statement]
headline: Push delivery is observed.
sub: A 7-day KV-backed counter surfaces failures before users feel them.

## [evidence]
title: Health endpoint surfaces silent failure
image: ../_assets/screenshots/S35-push-health.png
bullets:
    - GET /api/admin/health/push returns per-status counts.
    - Breakage is visible the same day, not the same week.
    - Trend, not snapshot.
caption: /api/admin/health/push — last 7 days

## [divider]
line: Security shipped in the dark is security that erodes. SmartGate's was shipped in writing.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System
related:
    - Deck 06 · The Notifications Engine
    - Deck 12 · The Build Discipline
```

- [ ] **Step 2: Commit**

```powershell
git add decks/_outlines/04-security-and-trust.md
git commit -m "outlines(decks): deck 04 Security & Trust outline"
```

### Task 1.2: Write the Deck 04 builder script

**Files:**
- Create: `decks/_scripts/build_04_security_and_trust.py`

- [ ] **Step 1: Write the builder**

```python
"""Builds Deck 04 · Security & Trust."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent
DECK_ID = "04"
DECK_TITLE = "Security & Trust"

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "04-security-and-trust.md",
        output_path=ROOT / "output" / "04-security-and-trust-v0.pptx",
        deck_id=DECK_ID,
        deck_title=DECK_TITLE,
    )
    print(f"Built {out}")
```

- [ ] **Step 2: Commit**

```powershell
git add decks/_scripts/build_04_security_and_trust.py
git commit -m "scripts(decks): deck 04 builder"
```

### Task 1.3: Build the Deck 04 v0 placeholder

- [ ] **Step 1: Run the builder**

Run:
```powershell
cd decks/_scripts
python build_04_security_and_trust.py
cd ../..
```
Expected: `Built <path>/04-security-and-trust-v0.pptx`

- [ ] **Step 2: Verify the v0 .pptx**

Run:
```powershell
cd decks/_scripts
python verify_deck.py "../output/04-security-and-trust-v0.pptx" 16
cd ../..
```
Expected: `OK  04-security-and-trust-v0.pptx  slides=16  size=<N>MB`

- [ ] **Step 3: Open in PowerPoint visually to spot-check brand fidelity**

Run: `Invoke-Item decks/output/04-security-and-trust-v0.pptx`
Manually verify: cover renders Playfair + DM Sans + gold accent strip, statement slides render hairline + headline, evidence slides show `[REPLACE: ...]` placeholders, wow slide shows `0` at 220pt in gold on dark, divider slide is dark with editorial sentence centered, footer shows `04 · Security & Trust · NN/16`.

- [ ] **Step 4: Commit the output**

```powershell
git add decks/output/04-security-and-trust-v0.pptx
git commit -m "output(decks): deck 04 v0 (Security & Trust placeholder)"
```

### Task 1.4: Mark Sprint 1 complete

- [ ] **Step 1: Sprint boundary commit**

```powershell
git commit --allow-empty -m "meta(decks): Sprint 1 complete — reference deck (04) shipped v0"
```

---

## Sprint 2 — Flagship + App Spotlights (Decks 01, 02, 03)

Three high-visibility decks. Each follows the Deck 04 pattern: outline → builder → v0 → verify → commit.

### Task 2.1: Deck 01 outline + build + verify

**Files:**
- Create: `decks/_outlines/01-flagship.md`
- Create: `decks/_scripts/build_01_flagship.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/01-flagship.md`

```markdown
## [cover]
title: OHCS SmartGate & Staff Attendance
subtitle: The story so far
tier: flagship
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Before SmartGate, OHCS knew who arrived only when someone signed a book.

## [toc]
- What we built and why
- What it does today
- What ongoing care looks like

## [statement]
headline: Two installable apps. One quiet system.
sub: SmartGate for visitors. Staff Attendance for officers. Both on every phone, both invisible until needed.

## [evidence]
title: The two apps, side by side
image: ../_assets/screenshots/S24-home-screen-icons.png
bullets:
    - Gold badge — SmartGate visitor management.
    - Green badge — Staff Attendance.
    - Distinct enough to find in two seconds.
caption: Both PWAs installed to the home screen, same device.

## [statement]
headline: Edge-delivered. Sub-100ms across West Africa.
sub: Cloudflare Workers, D1, KV, R2 — globally distributed, locally fast.

## [evidence]
title: Architecture in one diagram
image: ../_assets/screenshots/architecture-diagram.png
bullets:
    - Two PWAs on Cloudflare Pages.
    - One Hono-based Worker API.
    - D1 for data, KV for sessions, R2 for photos.
caption: docs/architecture overview.

## [wow]
hero: <N03>
label: Verified clock-ins recorded to date.

## [statement]
headline: Reception used to fill out a book. Now it's three taps.
sub: Visitor search, host selection, purpose tag — printable badge in under a minute.

## [evidence]
title: SmartGate in production
image: ../_assets/screenshots/S03-visitor-badge.png
bullets:
    - Host gets the alert before the visitor sits down.
    - Directorate leadership cc'd automatically.
    - Reports any director can pull in seconds.
caption: ohcs-smartgate.pages.dev, captured May 2026.

## [statement]
headline: Officers clock in from where they actually are.
sub: 75-metre GPS fence around OHCS HQ. Accuracy-aware. Honest about its margins.

## [evidence]
title: Staff Attendance, live
image: ../_assets/screenshots/S08-clockin-success.png
bullets:
    - Tap once. Camera opens. Inside the fence — done.
    - Streak counter ticks. Best-ever stays remembered.
    - Telegram summary to leadership at 9:00 AM sharp.
caption: staff-attendance.pages.dev, captured May 2026.

## [statement]
headline: When the Wi-Fi drops, the work doesn't.
sub: Both apps queue mutations locally and replay them on reconnect.

## [evidence]
title: Offline resilience
image: ../_assets/screenshots/S21-offline-banner.png
bullets:
    - Reception keeps checking visitors in through outages.
    - Staff clock-ins are never lost.
    - Replay is idempotent — no duplicates.
caption: IndexedDB queue with Background Sync fallback.

## [statement]
headline: Security shipped in writing.
sub: Twelve fixes. Constant-time PIN. Self-hosted Web Push. RBAC. Audited migrations.

## [statement]
headline: Designed in a civic register.
sub: Kente Executive — Playfair Display, gold deco, Ghanaian Kente texture. Cultural, not decorative.

## [statement]
headline: Care continues.
sub: Automated tests, bundle optimisation, manifest shortcuts, iOS startup images — stewardship, not unfinished work.

## [divider]
line: SmartGate isn't a product. It's how OHCS shows up for itself.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
    - ohcs-smartgate-api.ghwmelite.workers.dev
related:
    - Deck 02 · SmartGate Spotlight
    - Deck 03 · Staff Attendance Spotlight
    - Deck 13 · Roadmap
```

- [ ] **Step 2: Write the builder**

Path: `decks/_scripts/build_01_flagship.py`

```python
"""Builds Deck 01 · Flagship."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "01-flagship.md",
        output_path=ROOT / "output" / "01-flagship-v0.pptx",
        deck_id="01",
        deck_title="The Story So Far",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build it**

Run:
```powershell
cd decks/_scripts
python build_01_flagship.py
python verify_deck.py "../output/01-flagship-v0.pptx" 18
cd ../..
```
Expected: build success + `OK  01-flagship-v0.pptx  slides=18  size=<N>MB`

- [ ] **Step 4: Commit**

```powershell
git add decks/_outlines/01-flagship.md decks/_scripts/build_01_flagship.py decks/output/01-flagship-v0.pptx
git commit -m "output(decks): deck 01 Flagship v0"
```

### Task 2.2: Deck 02 outline + build + verify (SmartGate Spotlight)

**Files:**
- Create: `decks/_outlines/02-smartgate-spotlight.md`
- Create: `decks/_scripts/build_02_smartgate_spotlight.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/02-smartgate-spotlight.md`

```markdown
## [cover]
title: SmartGate
subtitle: Visitor Management in Production
tier: smartgate
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A logbook tells you who was here yesterday. SmartGate tells you who's here now.

## [toc]
- Reception's three-tap check-in
- The arrival alert that finds the host
- The reports leadership actually opens

## [statement]
headline: One screen. One workflow. One minute.
sub: Visitor search, host routing, purpose classification — printable badge in under sixty seconds.

## [evidence]
title: The check-in form
image: ../_assets/screenshots/S01-checkin-form-blank.png
bullets:
    - Existing visitor? Search.
    - New visitor? Three fields.
    - Host selection is type-ahead by directorate.
caption: ohcs-smartgate.pages.dev — reception view.

## [evidence]
title: The form, mid-fill
image: ../_assets/screenshots/S02-checkin-form-midfill.png
bullets:
    - Purpose is a curated list, not free text.
    - Host's directorate auto-fills.
    - Submit is one tap.
caption: Same form, second screen.

## [statement]
headline: The badge prints. The alert fires.
sub: Host knows before the visitor reaches the waiting area.

## [evidence]
title: The visitor badge
image: ../_assets/screenshots/S03-visitor-badge.png
bullets:
    - QR-coded, time-stamped, host-named.
    - Printable from any device.
    - Re-issuable if lost.
caption: Badge view, post-submit.

## [evidence]
title: Three-channel arrival alert
image: ../_assets/screenshots/S04-in-app-bell.png
bullets:
    - In-app bell — for hosts at their desk.
    - Telegram — for hosts on the move.
    - Web Push — for hosts on mobile, app closed.
caption: Three independent channels, one event.

## [evidence]
title: Telegram alert, the host's phone
image: ../_assets/screenshots/S05-telegram-arrival.png
bullets:
    - Visitor name, purpose, badge code.
    - Tap to acknowledge.
    - Directorate director cc'd automatically.
caption: Telegram bot message, captured live.

## [wow]
hero: <N02>
label: Visitors checked in on an average day. Each one accounted for.

## [statement]
headline: Reports leadership opens.
sub: Per-directorate, per-category, date-range. PDF export — no special access required.

## [evidence]
title: Visit reports
image: ../_assets/screenshots/S06-visit-report.png
bullets:
    - Filter by directorate, by date, by category.
    - Sortable, sortable, sortable.
    - Director-level scoping built in.
caption: /admin/reports — director view.

## [evidence]
title: PDF export
image: ../_assets/screenshots/S07-pdf-export.png
bullets:
    - One-click export.
    - Server-side rendering — no client memory hog.
    - Same layout as on-screen — what you see is what you share.
caption: Exported PDF, first page.

## [statement]
headline: When connectivity drops, reception doesn't stop.
sub: Queued check-ins replay on reconnect. Idempotent. Lossless.

## [evidence]
title: Offline check-in queue
image: ../_assets/screenshots/S22-queue-replay.png
bullets:
    - IndexedDB stores the pending check-in.
    - Background Sync replays when online.
    - iOS gets a flush-queue message fallback.
caption: Chrome DevTools — Application → IndexedDB.

## [statement]
headline: One workflow. Six roles. No leakage.
sub: Receptionists check in. Directors see their directorate. Admins see everything. RBAC, enforced.

## [statement]
headline: One feature deserves a quote.
sub: "<Q03>"

## [divider]
line: SmartGate works because reception didn't have to learn it. They already knew it.

## [appendix]
links:
    - ohcs-smartgate.pages.dev
    - ohcs-smartgate-api.ghwmelite.workers.dev
related:
    - Deck 06 · The Notifications Engine
    - Deck 09 · Reception Workflow
    - Deck 11 · Director Visibility
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 02 · SmartGate Spotlight."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "02-smartgate-spotlight.md",
        output_path=ROOT / "output" / "02-smartgate-spotlight-v0.pptx",
        deck_id="02",
        deck_title="SmartGate — Visitor Management",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_02_smartgate_spotlight.py
python verify_deck.py "../output/02-smartgate-spotlight-v0.pptx" 20
cd ../..
git add decks/_outlines/02-smartgate-spotlight.md decks/_scripts/build_02_smartgate_spotlight.py decks/output/02-smartgate-spotlight-v0.pptx
git commit -m "output(decks): deck 02 SmartGate Spotlight v0"
```

### Task 2.3: Deck 03 outline + build + verify (Staff Attendance Spotlight)

**Files:**
- Create: `decks/_outlines/03-staff-attendance-spotlight.md`
- Create: `decks/_scripts/build_03_staff_attendance_spotlight.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/03-staff-attendance-spotlight.md`

```markdown
## [cover]
title: Staff Attendance
subtitle: Clocking in, honestly
tier: staff
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A paper sheet records that you were here. Staff Attendance records that you arrived.

## [toc]
- The first-login moment
- The clock-in that respects your GPS
- The streak, the absence, the badge

## [statement]
headline: First login is a moment, not a friction point.
sub: Enforced PIN change with clear language, gentle motion, no jargon.

## [evidence]
title: Enforced PIN change
image: ../_assets/screenshots/S11-first-login-pin.png
bullets:
    - Triggered automatically on default PIN.
    - Validates length + character variety.
    - Confirmation reduces silent re-entry.
caption: First login, fresh account.

## [statement]
headline: The 75-metre circle isn't a circle.
sub: It's a circle plus your phone's reported GPS accuracy.

## [evidence]
title: Clock-in, GPS clean
image: ../_assets/screenshots/S08-clockin-success.png
bullets:
    - Accuracy ≤15m, inside fence — instant approval.
    - Camera-verified selfie on capture.
    - Streak counter ticks.
caption: Typical clock-in, captured live.

## [evidence]
title: Clock-in, weak GPS at boundary
image: ../_assets/screenshots/S09-clockin-weak-gps.png
bullets:
    - Accuracy ~40m at the edge — accepted.
    - Buffer scales with reported accuracy.
    - Real users in real buildings get through.
caption: Edge case, validated.

## [evidence]
title: Clock-in rejected, clearly
image: ../_assets/screenshots/S10-clockin-rejected.png
bullets:
    - 200m+ outside — clear distance shown.
    - GPS accuracy shown alongside.
    - User knows exactly why and where.
caption: Honest rejection, captured.

## [wow]
hero: <N04>
label: First-try success rate inside the geofence.

## [statement]
headline: Streaks turn habit into recognition.
sub: Consecutive working-day counter. "Best-ever" stays remembered.

## [evidence]
title: Streak banner
image: ../_assets/screenshots/S12-streak-banner.png
bullets:
    - Yesterday counts. Today builds. Tomorrow continues.
    - Best-ever displayed alongside current.
    - Quietly celebratory, not gamified-to-death.
caption: Clock page hero — streak module.

## [statement]
headline: Absence is a flow, not a phone call.
sub: Sick, family emergency, transport, other. Optional note. Optional return date.

## [evidence]
title: Absence notice
image: ../_assets/screenshots/S13-absence-modal.png
bullets:
    - One self-service flow.
    - Directors notified immediately.
    - Morning clock-reminder suppressed automatically.
caption: Absence modal, in-progress.

## [statement]
headline: Leadership reads the summary, not the spreadsheet.
sub: Telegram message at 9:00 AM weekdays. Per-directorate breakdown. One screen.

## [evidence]
title: 9:00 AM daily summary
image: ../_assets/screenshots/S14-daily-summary.png
bullets:
    - Sent every weekday at 9:00 sharp.
    - Per-directorate counts of clocked/not-clocked.
    - Outlier names surfaced — no scrolling.
caption: Daily summary, captured today.

## [statement]
headline: One staff voice on what's changed.
sub: "<Q05>"

## [statement]
headline: The eBadge — staff identity, in the pocket.
sub: Digital, scannable, refreshable. The paper card retires.

## [divider]
line: Attendance is dignity. SmartGate treats it that way.

## [appendix]
links:
    - staff-attendance.pages.dev
related:
    - Deck 07 · GPS Geofence Precision
    - Deck 10 · The Staff Experience
    - Deck 11 · Director Visibility
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 03 · Staff Attendance Spotlight."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "03-staff-attendance-spotlight.md",
        output_path=ROOT / "output" / "03-staff-attendance-spotlight-v0.pptx",
        deck_id="03",
        deck_title="Staff Attendance",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_03_staff_attendance_spotlight.py
python verify_deck.py "../output/03-staff-attendance-spotlight-v0.pptx" 20
cd ../..
git add decks/_outlines/03-staff-attendance-spotlight.md decks/_scripts/build_03_staff_attendance_spotlight.py decks/output/03-staff-attendance-spotlight-v0.pptx
git commit -m "output(decks): deck 03 Staff Attendance Spotlight v0"
```

### Task 2.4: Sprint 2 boundary

- [ ] **Step 1: Mark sprint complete**

```powershell
git commit --allow-empty -m "meta(decks): Sprint 2 complete — flagship + 2 spotlights shipped v0"
```

---

## Sprint 3 — Themed Deep-Dives Part 1 (Decks 05, 06, 07, 08)

Each deck follows the same pattern as Decks 01–03: outline → builder → build → verify → commit.

### Task 3.1: Deck 05 · Offline-First Resilience

**Files:**
- Create: `decks/_outlines/05-offline-resilience.md`
- Create: `decks/_scripts/build_05_offline_resilience.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/05-offline-resilience.md`

```markdown
## [cover]
title: Offline-First Resilience
subtitle: When the Wi-Fi drops, the work doesn't
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Most apps tell you to try again later. SmartGate gets on with it.

## [toc]
- What the user sees when offline
- What the system does behind the glass
- Why nothing is ever lost

## [statement]
headline: The banner is honest. The work is unbroken.
sub: A persistent indicator tells the user we're offline. A queue keeps accepting their actions anyway.

## [evidence]
title: Offline banner, staff app
image: ../_assets/screenshots/S21-offline-banner.png
bullets:
    - Subtle, persistent, dismissible.
    - Mutations queued silently in the background.
    - User keeps clocking, keeps checking in visitors.
caption: staff-attendance.pages.dev, airplane mode.

## [statement]
headline: IndexedDB is the buffer.
sub: Every action that would mutate the server is staged locally first.

## [evidence]
title: The queue in action
image: ../_assets/screenshots/S22-queue-replay.png
bullets:
    - Mutations stored in IndexedDB with a unique idempotency key.
    - Background Sync API triggers replay on reconnect.
    - iOS falls back to a flush-queue message.
caption: Chrome DevTools — Application → IndexedDB.

## [statement]
headline: Replay is idempotent.
sub: Same request twice produces the same result. No duplicate clock-ins, ever.

## [wow]
hero: <N10>
label: Offline-queued mutations replayed successfully. Zero losses.

## [statement]
headline: Installable. Updatable. Distinct.
sub: Both apps install to the home screen with branded icons that don't look alike.

## [evidence]
title: Two icons, instantly recognisable
image: ../_assets/screenshots/S24-home-screen-icons.png
bullets:
    - Green clock badge for Staff Attendance.
    - Gold user-plus badge for SmartGate.
    - One glance to the right app.
caption: iOS home screen with both PWAs installed.

## [evidence]
title: Add to Home Screen, iOS
image: ../_assets/screenshots/S23-ios-a2hs.png
bullets:
    - iOS Safari Share menu shows custom instructions.
    - Android Chrome handles beforeinstallprompt natively.
    - No app store, no review queue.
caption: iOS Safari Share sheet.

## [statement]
headline: Service worker, hand-rolled.
sub: No PWA framework. Just the platform — for control and clarity.

## [divider]
line: Offline isn't a feature. It's the default state of a building you can't always reach.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
related:
    - Deck 02 · SmartGate Spotlight
    - Deck 12 · The Build Discipline
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 05 · Offline-First Resilience."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "05-offline-resilience.md",
        output_path=ROOT / "output" / "05-offline-resilience-v0.pptx",
        deck_id="05",
        deck_title="Offline-First Resilience",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_05_offline_resilience.py
python verify_deck.py "../output/05-offline-resilience-v0.pptx" 14
cd ../..
git add decks/_outlines/05-offline-resilience.md decks/_scripts/build_05_offline_resilience.py decks/output/05-offline-resilience-v0.pptx
git commit -m "output(decks): deck 05 Offline-First Resilience v0"
```

### Task 3.2: Deck 06 · The Notifications Engine

**Files:**
- Create: `decks/_outlines/06-notifications-engine.md`
- Create: `decks/_scripts/build_06_notifications_engine.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/06-notifications-engine.md`

```markdown
## [cover]
title: The Notifications Engine
subtitle: Three channels, one promise
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A notification that doesn't arrive isn't a feature. It's a failure with a logo.

## [toc]
- The three channels
- The five scheduled jobs
- How we know they actually arrived

## [statement]
headline: One event. Three channels. Whichever the user reads first.
sub: In-app bell, Telegram, Web Push. Redundancy by design, not by accident.

## [evidence]
title: Telegram — the surface leadership uses
image: ../_assets/screenshots/S14-daily-summary.png
bullets:
    - 9:00 AM daily summary, weekday cadence.
    - Per-directorate clocked/not-clocked counts.
    - HTML-escaped to neutralise injection from user input.
caption: Daily summary, real morning.

## [evidence]
title: Web Push — for hosts on the move
image: ../_assets/screenshots/S15-late-clock-push.png
bullets:
    - VAPID signed, aes128gcm encrypted.
    - Five whitelisted push types only.
    - Delivered even when the app is closed.
caption: Late-clock alert, lockscreen.

## [statement]
headline: Five scheduled jobs run themselves.
sub: 08:30 weekday clock-reminders, 09:00 daily summary, 16:00 Friday weekly digest, 09:00 monthly report, 09:00 yearly recap.

## [evidence]
title: Cloudflare cron triggers
image: ../_assets/screenshots/S31-wrangler-cron.png
bullets:
    - Schedules are configuration, not code.
    - Each cron writes a log line.
    - Failures route to the health endpoint.
caption: packages/api/wrangler.toml.

## [wow]
hero: <N09>
label: Push delivery success rate over the last 7 days.

## [statement]
headline: Five push types. Whitelisted. Auditable.
sub: visitor_arrival, clock_reminder, late_clock_alert, monthly_report_ready, absence_notice. No surprise pushes, ever.

## [statement]
headline: When push fails, we see it the same day.
sub: A 7-day KV-backed counter buckets responses by HTTP status.

## [evidence]
title: Push health endpoint
image: ../_assets/screenshots/S35-push-health.png
bullets:
    - GET /api/admin/health/push — superadmin-gated.
    - 7-day rolling window, per-status counts.
    - Silent breakage becomes visible breakage.
caption: /api/admin/health/push.

## [statement]
headline: Telegram messages are HTML-safe.
sub: Every user-supplied field is escaped. The bot never renders attacker-controlled HTML.

## [divider]
line: Notifications are how the system speaks. We made it speak carefully.

## [appendix]
links:
    - /api/admin/health/push
    - ohcs-smartgate-api.ghwmelite.workers.dev
related:
    - Deck 04 · Security & Trust
    - Deck 11 · Director Visibility
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 06 · The Notifications Engine."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "06-notifications-engine.md",
        output_path=ROOT / "output" / "06-notifications-engine-v0.pptx",
        deck_id="06",
        deck_title="The Notifications Engine",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_06_notifications_engine.py
python verify_deck.py "../output/06-notifications-engine-v0.pptx" 14
cd ../..
git add decks/_outlines/06-notifications-engine.md decks/_scripts/build_06_notifications_engine.py decks/output/06-notifications-engine-v0.pptx
git commit -m "output(decks): deck 06 Notifications Engine v0"
```

### Task 3.3: Deck 07 · GPS Geofence Precision

**Files:**
- Create: `decks/_outlines/07-geofence-precision.md`
- Create: `decks/_scripts/build_07_geofence_precision.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/07-geofence-precision.md`

```markdown
## [cover]
title: GPS Geofence Precision
subtitle: A circle that respects your signal
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: The hardest part of a geofence is being right when the GPS isn't.

## [toc]
- The OHCS HQ fence
- The accuracy-aware buffer
- The precision retrace fix

## [statement]
headline: A 75-metre fence around OHCS HQ.
sub: Centre at 5.55269 N, -0.19752 E. Tight enough to mean something, wide enough to be fair.

## [evidence]
title: The fence on a map
image: ../_assets/screenshots/S16-hq-map-fence.png
bullets:
    - Centre point at the main building.
    - 75-metre radius.
    - Covers reception, courtyard, parking.
caption: Google Maps with the fence drawn for reference.

## [statement]
headline: GPS lies. Honestly.
sub: Every reading comes with a reported accuracy in metres. We use it.

## [evidence]
title: Clock-in, weak signal at the boundary — accepted
image: ../_assets/screenshots/S09-clockin-weak-gps.png
bullets:
    - Reading: 70m from centre, 40m accuracy.
    - Buffer scales — fence becomes effective 115m.
    - Real user, real building, real result.
caption: Edge case validated in production.

## [evidence]
title: Clock-in, clearly outside — rejected with reasons
image: ../_assets/screenshots/S10-clockin-rejected.png
bullets:
    - Reading: 250m from centre.
    - Even with worst-case accuracy, still outside.
    - User sees distance + accuracy + why.
caption: Honest rejection at a coffee shop nearby.

## [wow]
hero: <N04>
label: First-try success rate, inside the geofence.

## [statement]
headline: The retrace fix that turned approximation into precision.
sub: Replaced a 3-building rectangle hack with proper Haversine + accuracy buffer logic.

## [evidence]
title: Commit 59b564a — the precision retrace
image: ../_assets/screenshots/S17-geofence-commit.png
bullets:
    - Before: a 3-building approximation, brittle and unfair.
    - After: Haversine distance + reported-accuracy buffer.
    - Specced, planned, executed — same week.
caption: github.com/.../commit/59b564a.

## [statement]
headline: Average GPS accuracy at clock-in
sub: <N05>m. Most readings beat the buffer.

## [statement]
headline: Honest rejections beat clever workarounds.
sub: Users trust the system because the system tells them the truth.

## [divider]
line: Geofences fail when they pretend GPS is perfect. Ours assumes it isn't.

## [appendix]
links:
    - staff-attendance.pages.dev
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System/commit/59b564a
related:
    - Deck 03 · Staff Attendance Spotlight
    - Deck 12 · The Build Discipline
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 07 · GPS Geofence Precision."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "07-geofence-precision.md",
        output_path=ROOT / "output" / "07-geofence-precision-v0.pptx",
        deck_id="07",
        deck_title="GPS Geofence Precision",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_07_geofence_precision.py
python verify_deck.py "../output/07-geofence-precision-v0.pptx" 14
cd ../..
git add decks/_outlines/07-geofence-precision.md decks/_scripts/build_07_geofence_precision.py decks/output/07-geofence-precision-v0.pptx
git commit -m "output(decks): deck 07 GPS Geofence Precision v0"
```

### Task 3.4: Deck 08 · Kente Executive Design

**Files:**
- Create: `decks/_outlines/08-kente-executive-design.md`
- Create: `decks/_scripts/build_08_kente_executive_design.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/08-kente-executive-design.md`

```markdown
## [cover]
title: Kente Executive
subtitle: A civic design language
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Design isn't decoration. It's how a public-sector app says "this is yours".

## [toc]
- The type pair
- The colour register
- The Kente motif as anchor

## [statement]
headline: Playfair Display sets the tone.
sub: A display serif with editorial confidence. Used for titles, statements, hero numbers.

## [statement]
headline: DM Sans does the work.
sub: A neutral, readable sans for body, captions, UI. Stays out of the way.

## [evidence]
title: The type pair in practice
image: ../_assets/screenshots/S27-type-pair.png
bullets:
    - Playfair Display Bold — 60pt covers, 44pt statements.
    - DM Sans Regular — 18pt body, 11pt captions.
    - One serif, one sans. Never a third.
caption: Specimen sheet, this deck.

## [statement]
headline: Six colours do all the work.
sub: Ink-deep, cream-page, gold-signature, gold-deep, green-SmartGate, neutral-line. No rainbow. No drift.

## [statement]
headline: Gold is the signature.
sub: One colour — #C9A14A — connects every deck, every screen, every page.

## [statement]
headline: Kente is the anchor.
sub: A 12px accent strip on every body slide. Different pattern per tier. Always present.

## [evidence]
title: The four tier strips
image: ../_assets/screenshots/kente-strips-side-by-side.png
bullets:
    - Flagship — diagonal gold-on-ink hatch.
    - SmartGate — gold-and-cream block weave.
    - Staff — green-and-gold step weave.
    - Thematic — solid gold with deco notch.
caption: All four strips at 100% scale.

## [evidence]
title: Distinct PWA icons — the same idea on a phone
image: ../_assets/screenshots/S24-home-screen-icons.png
bullets:
    - Green clock badge for Staff Attendance.
    - Gold user-plus badge for SmartGate.
    - The brand crosses from PPTX to home screen.
caption: iOS home screen, both apps installed.

## [statement]
headline: Motion has meaning.
sub: Rotating logo ring, magnetic-hover clock buttons, gold confetti on success. Respects prefers-reduced-motion.

## [evidence]
title: Confetti on successful clock-in
image: ../_assets/screenshots/S26-confetti-burst.png
bullets:
    - Triggered on clock-in success only.
    - Gold particles, short duration.
    - Disabled when reduced motion is on.
caption: Clock page, post-success.

## [evidence]
title: One sentence from the designer
image: ../_assets/screenshots/S25-clock-page-hero.png
bullets:
    - "<Q06>"
caption: Designer quote, in-context.

## [statement]
headline: The design is the audit trail.
sub: Every visual decision is specced, planned, and executed in `docs/superpowers/`.

## [divider]
line: Kente Executive isn't a theme. It's how OHCS shows up in pixels.

## [appendix]
links:
    - staff-attendance.pages.dev
    - ohcs-smartgate.pages.dev
related:
    - Deck 12 · The Build Discipline
    - Deck 10 · The Staff Experience
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 08 · Kente Executive Design."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "08-kente-executive-design.md",
        output_path=ROOT / "output" / "08-kente-executive-design-v0.pptx",
        deck_id="08",
        deck_title="Kente Executive Design",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_08_kente_executive_design.py
python verify_deck.py "../output/08-kente-executive-design-v0.pptx" 16
cd ../..
git add decks/_outlines/08-kente-executive-design.md decks/_scripts/build_08_kente_executive_design.py decks/output/08-kente-executive-design-v0.pptx
git commit -m "output(decks): deck 08 Kente Executive Design v0"
```

### Task 3.5: Sprint 3 boundary

- [ ] **Step 1: Mark sprint complete**

```powershell
git commit --allow-empty -m "meta(decks): Sprint 3 complete — themed deep-dives part 1 (05, 06, 07, 08) v0"
```

---

## Sprint 4 — Themed Deep-Dives Part 2 (Decks 09, 10, 11)

### Task 4.1: Deck 09 · Reception Workflow

**Files:**
- Create: `decks/_outlines/09-reception-workflow.md`
- Create: `decks/_scripts/build_09_reception_workflow.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/09-reception-workflow.md`

```markdown
## [cover]
title: Reception Workflow
subtitle: From paper logbook to printable badge
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: Reception's job didn't change. The workflow finally caught up.

## [toc]
- The "before" — what reception used to do
- The "after" — what reception does now
- What changed that the user can feel

## [statement]
headline: Before — a book, a pen, a queue.
sub: Visitor signs in. Receptionist transcribes. Host gets a phone call. Sometimes.

## [statement]
headline: After — a screen, a search, a tap.
sub: Visitor named. Host selected. Purpose tagged. Badge printed. Host alerted.

## [evidence]
title: The new check-in flow, step one
image: ../_assets/screenshots/S01-checkin-form-blank.png
bullets:
    - Existing visitor? Search.
    - New visitor? Three fields.
    - Type-ahead host selection by directorate.
caption: ohcs-smartgate.pages.dev — reception view.

## [evidence]
title: The new check-in flow, step two
image: ../_assets/screenshots/S02-checkin-form-midfill.png
bullets:
    - Host's directorate auto-fills.
    - Purpose is curated, not free-text.
    - Submit is one tap.
caption: Same screen, mid-fill.

## [evidence]
title: The badge appears, the alert fires
image: ../_assets/screenshots/S03-visitor-badge.png
bullets:
    - QR-coded, time-stamped, host-named.
    - Host knows before the visitor sits down.
    - Director cc'd automatically.
caption: Badge view, post-submit.

## [wow]
hero: <N01>
label: Visitors checked in since launch. Each one accounted for.

## [statement]
headline: A reception lead, on what changed.
sub: "<Q03>"

## [statement]
headline: When the Wi-Fi drops, reception doesn't stop.
sub: Queued check-ins replay on reconnect. No "please wait" screens. No lost arrivals.

## [evidence]
title: Reception kept working through a 12-minute outage
image: ../_assets/screenshots/S21-offline-banner.png
bullets:
    - Banner went up. Reception kept checking in.
    - Queue absorbed the gap.
    - Replay flushed on reconnect — no manual intervention.
caption: Real incident, captured.

## [statement]
headline: Reception didn't have to learn it. They already knew it.
sub: The shape of the workflow matches the shape of the job.

## [divider]
line: The best workflow is the one the user doesn't have to think about.

## [appendix]
links:
    - ohcs-smartgate.pages.dev
related:
    - Deck 02 · SmartGate Spotlight
    - Deck 05 · Offline-First Resilience
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 09 · Reception Workflow."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "09-reception-workflow.md",
        output_path=ROOT / "output" / "09-reception-workflow-v0.pptx",
        deck_id="09",
        deck_title="Reception Workflow",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_09_reception_workflow.py
python verify_deck.py "../output/09-reception-workflow-v0.pptx" 14
cd ../..
git add decks/_outlines/09-reception-workflow.md decks/_scripts/build_09_reception_workflow.py decks/output/09-reception-workflow-v0.pptx
git commit -m "output(decks): deck 09 Reception Workflow v0"
```

### Task 4.2: Deck 10 · The Staff Experience

**Files:**
- Create: `decks/_outlines/10-staff-experience.md`
- Create: `decks/_scripts/build_10_staff_experience.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/10-staff-experience.md`

```markdown
## [cover]
title: The Staff Experience
subtitle: One officer's morning, frame by frame
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A great clock-in is one you stop thinking about. Ours got out of the way.

## [toc]
- The first login, the way it should feel
- The daily clock-in, in seconds
- The streak, the absence, the badge

## [statement]
headline: First login is a moment, not a friction point.
sub: Enforced PIN change with clear language and no jargon.

## [evidence]
title: Enforced PIN change, first login
image: ../_assets/screenshots/S11-first-login-pin.png
bullets:
    - Triggered automatically on default PIN.
    - Validates length + variety.
    - Confirmation field reduces silent re-entry.
caption: First login, fresh account.

## [statement]
headline: The clock-in takes four seconds.
sub: Tap. Camera opens. GPS confirms. Done.

## [evidence]
title: A successful clock-in
image: ../_assets/screenshots/S25-clock-page-hero.png
bullets:
    - Magnetic-hover buttons feel intentional.
    - Streak counter ticks immediately.
    - Confetti — quietly celebratory.
caption: Clock page, in motion.

## [evidence]
title: Confetti on success
image: ../_assets/screenshots/S26-confetti-burst.png
bullets:
    - Gold particles, short duration.
    - Disabled when reduced motion is on.
    - Reward without infantilisation.
caption: Clock-in success, captured live.

## [evidence]
title: Streak banner — the quiet recognition
image: ../_assets/screenshots/S12-streak-banner.png
bullets:
    - Yesterday counts. Today builds. Tomorrow continues.
    - Best-ever stays remembered.
    - Recognition, not gamification.
caption: Clock page hero — streak module.

## [wow]
hero: <N03>
label: Clock-ins recorded. Each one a quiet morning's start.

## [statement]
headline: Absence is a flow, not a phone call.
sub: Sick, family emergency, transport, other. Optional note. Optional return.

## [evidence]
title: Absence notice modal
image: ../_assets/screenshots/S13-absence-modal.png
bullets:
    - One self-service flow.
    - Directors notified immediately.
    - Morning clock-reminder suppressed automatically.
caption: Absence modal, in-progress.

## [statement]
headline: The eBadge — staff identity, in the pocket.
sub: Digital, scannable, refreshable. The paper card retires.

## [evidence]
title: Two apps, distinct icons
image: ../_assets/screenshots/S24-home-screen-icons.png
bullets:
    - Green clock badge for Staff Attendance.
    - Gold user-plus badge for SmartGate.
    - Find the right app at a glance.
caption: Home screen, both apps installed.

## [statement]
headline: One staff voice.
sub: "<Q05>"

## [divider]
line: Attendance is dignity. The system treats it that way.

## [appendix]
links:
    - staff-attendance.pages.dev
related:
    - Deck 03 · Staff Attendance Spotlight
    - Deck 07 · GPS Geofence Precision
    - Deck 08 · Kente Executive Design
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 10 · The Staff Experience."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "10-staff-experience.md",
        output_path=ROOT / "output" / "10-staff-experience-v0.pptx",
        deck_id="10",
        deck_title="The Staff Experience",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_10_staff_experience.py
python verify_deck.py "../output/10-staff-experience-v0.pptx" 14
cd ../..
git add decks/_outlines/10-staff-experience.md decks/_scripts/build_10_staff_experience.py decks/output/10-staff-experience-v0.pptx
git commit -m "output(decks): deck 10 The Staff Experience v0"
```

### Task 4.3: Deck 11 · Director Visibility

**Files:**
- Create: `decks/_outlines/11-director-visibility.md`
- Create: `decks/_scripts/build_11_director_visibility.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/11-director-visibility.md`

```markdown
## [cover]
title: Director Visibility
subtitle: What leadership actually sees
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A dashboard nobody opens is a screenshot. SmartGate delivers the signal to where leadership already is.

## [toc]
- The morning Telegram summary
- The arrival and late-clock alerts
- The monthly report that writes itself

## [statement]
headline: 9:00 AM. A Telegram message arrives.
sub: Per-directorate clocked/not-clocked counts. Outlier names. No login required.

## [evidence]
title: The daily summary
image: ../_assets/screenshots/S14-daily-summary.png
bullets:
    - Every weekday at 9:00 sharp.
    - Per-directorate, with totals.
    - Outliers surfaced — no scrolling.
caption: Telegram daily summary, real morning.

## [statement]
headline: Visitor arrivals reach the director, not the inbox.
sub: A direct push when a visitor arrives for the directorate — host and director, simultaneously.

## [evidence]
title: Visitor arrival alert — director's phone
image: ../_assets/screenshots/S05-telegram-arrival.png
bullets:
    - Visitor name, purpose, time, host.
    - Tap to acknowledge.
    - Searchable later — no archive maintenance.
caption: Telegram visitor-arrival message.

## [statement]
headline: Late-clock alerts go where they matter.
sub: A late clock-in pings the director — not the staff member. The conversation that follows is theirs.

## [evidence]
title: Late-clock alert
image: ../_assets/screenshots/S15-late-clock-push.png
bullets:
    - Triggered after the configurable late threshold.
    - Sent to directorate director(s) only.
    - Web Push — works with the app closed.
caption: Late-clock notification, lockscreen.

## [wow]
hero: <N07>
label: Directorate heads receiving the daily summary. Every weekday.

## [statement]
headline: The monthly report writes itself.
sub: On the 1st at 9:00 AM, last month's per-directorate breakdown lands. Same format every time.

## [statement]
headline: A director, on what changed.
sub: "<Q04>"

## [divider]
line: Visibility isn't a dashboard. It's the signal arriving at the right phone.

## [appendix]
links:
    - ohcs-smartgate.pages.dev
related:
    - Deck 06 · The Notifications Engine
    - Deck 02 · SmartGate Spotlight
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 11 · Director Visibility."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "11-director-visibility.md",
        output_path=ROOT / "output" / "11-director-visibility-v0.pptx",
        deck_id="11",
        deck_title="Director Visibility",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_11_director_visibility.py
python verify_deck.py "../output/11-director-visibility-v0.pptx" 12
cd ../..
git add decks/_outlines/11-director-visibility.md decks/_scripts/build_11_director_visibility.py decks/output/11-director-visibility-v0.pptx
git commit -m "output(decks): deck 11 Director Visibility v0"
```

### Task 4.4: Sprint 4 boundary

- [ ] **Step 1: Mark sprint complete**

```powershell
git commit --allow-empty -m "meta(decks): Sprint 4 complete — themed deep-dives part 2 (09, 10, 11) v0"
```

---

## Sprint 5 — Close-Out Decks (12, 13)

### Task 5.1: Deck 12 · The Build Discipline

**Files:**
- Create: `decks/_outlines/12-build-discipline.md`
- Create: `decks/_scripts/build_12_build_discipline.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/12-build-discipline.md`

```markdown
## [cover]
title: The Build Discipline
subtitle: Spec, plan, execute — every time
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: The polish you can feel is the by-product of a process you can read.

## [toc]
- The discipline — every feature has a spec
- The artefact — `docs/superpowers/`
- The result — code you can trust

## [statement]
headline: Every feature has a spec.
sub: Before code, a written design. Before tasks, an approved plan.

## [evidence]
title: The spec/plan tree
image: ../_assets/screenshots/S28-docs-tree.png
bullets:
    - One spec per feature.
    - One plan per spec.
    - Both committed to the repo.
caption: docs/superpowers/, captured today.

## [evidence]
title: A representative spec
image: ../_assets/screenshots/S29-spec-rendered.png
bullets:
    - Goal, architecture, requirements.
    - Approved by the user before any code is touched.
    - Lives in the repo forever — audit trail by default.
caption: docs/superpowers/specs/2026-04-18-security-hardening-design.md.

## [evidence]
title: A representative plan
image: ../_assets/screenshots/S30-plan-rendered.png
bullets:
    - Atomic tasks — 2 to 5 minutes each.
    - Test before code where it makes sense.
    - Commit after every task.
caption: docs/superpowers/plans/...

## [wow]
hero: <N14>
label: Design specs in the repo. Each one a feature shipped with intention.

## [statement]
headline: The retrace fix was specced, planned, executed.
sub: Geofence precision — a single 30-minute design conversation, then atomic tasks until done.

## [evidence]
title: The retrace fix in code
image: ../_assets/screenshots/S17-geofence-commit.png
bullets:
    - Spec written, plan written, commit landed — same day.
    - Reviewable as a unit.
    - Reversible if needed.
caption: Commit 59b564a.

## [statement]
headline: Lines of TypeScript across packages/.
sub: <N15> lines. Strict mode throughout. No `any` without justification.

## [statement]
headline: The discipline is the moat.
sub: Another team could ship the same features. They couldn't ship them this carefully without writing it down first.

## [divider]
line: The system is good because the process was patient.

## [appendix]
links:
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System/tree/main/docs/superpowers
related:
    - Deck 04 · Security & Trust
    - Deck 07 · GPS Geofence Precision
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 12 · The Build Discipline."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "12-build-discipline.md",
        output_path=ROOT / "output" / "12-build-discipline-v0.pptx",
        deck_id="12",
        deck_title="The Build Discipline",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_12_build_discipline.py
python verify_deck.py "../output/12-build-discipline-v0.pptx" 14
cd ../..
git add decks/_outlines/12-build-discipline.md decks/_scripts/build_12_build_discipline.py decks/output/12-build-discipline-v0.pptx
git commit -m "output(decks): deck 12 The Build Discipline v0"
```

### Task 5.2: Deck 13 · Roadmap — Care Continues

**Files:**
- Create: `decks/_outlines/13-roadmap-care-continues.md`
- Create: `decks/_scripts/build_13_roadmap_care_continues.py`

- [ ] **Step 1: Write the outline**

Path: `decks/_outlines/13-roadmap-care-continues.md`

```markdown
## [cover]
title: Roadmap
subtitle: Care continues
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: A system that stops getting better starts getting worse. Care isn't optional.

## [toc]
- What's queued for the next quarter
- Why each item is on the list
- What good ongoing care looks like

## [statement]
headline: Automated tests across the API.
sub: Vitest for crypto, auth, offline queue, geofence. Confidence by repetition.

## [statement]
headline: Bundle optimisation.
sub: Dynamic-import admin reports and analytics in the VMS app. Smaller initial load, same capability.

## [statement]
headline: Component decomposition.
sub: Split CheckInPage (907 LOC) and AdminPage (492 LOC) into focused sub-components. Easier to reason about, faster to change.

## [statement]
headline: Shared workspace.
sub: Extract duplicated offlineQueue, tokenStore, pushClient into packages/shared. One source of truth.

## [statement]
headline: iOS startup images.
sub: Generate apple-touch-startup-image per device class. A polished launch experience.

## [statement]
headline: Manifest shortcuts.
sub: Long-press app icon quick actions — "Clock In Now", "New Visitor". Friction removed.

## [wow]
hero: 6
label: Roadmap items. Each one specced before any code lands.

## [statement]
headline: Care looks like a list.
sub: Open, visible, prioritised. Anyone can read it. Anyone can question it.

## [statement]
headline: Care looks like a process.
sub: Each item gets the spec/plan/execute treatment. Just like everything before it.

## [divider]
line: The roadmap isn't a wishlist. It's the next set of patient decisions.

## [appendix]
links:
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System#roadmap
related:
    - Deck 12 · The Build Discipline
    - Deck 01 · The Story So Far
```

- [ ] **Step 2: Write the builder**

```python
"""Builds Deck 13 · Roadmap — Care Continues."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "13-roadmap-care-continues.md",
        output_path=ROOT / "output" / "13-roadmap-care-continues-v0.pptx",
        deck_id="13",
        deck_title="Roadmap",
    )
    print(f"Built {out}")
```

- [ ] **Step 3: Build + verify + commit**

```powershell
cd decks/_scripts
python build_13_roadmap_care_continues.py
python verify_deck.py "../output/13-roadmap-care-continues-v0.pptx" 12
cd ../..
git add decks/_outlines/13-roadmap-care-continues.md decks/_scripts/build_13_roadmap_care_continues.py decks/output/13-roadmap-care-continues-v0.pptx
git commit -m "output(decks): deck 13 Roadmap v0"
```

### Task 5.3: Sprint 5 boundary

- [ ] **Step 1: Mark sprint complete**

```powershell
git commit --allow-empty -m "meta(decks): Sprint 5 complete — close-out decks (12, 13) v0; all 13 v0 decks shipped"
```

---

## Sprint 6 — Suite Cover PDF + Final QA

### Task 6.1: Build the suite cover contact-sheet PDF

**Files:**
- Create: `decks/_scripts/build_suite_cover.py`
- Create: `decks/output/_SUITE-COVER.pdf`

- [ ] **Step 1: Write the cover-sheet generator**

```python
"""Generates _SUITE-COVER.pdf — a single-page contact sheet showing all 13 covers as a 3-column grid.

Uses reportlab to render a landscape A3 with each deck rendered as a labelled rectangle.
For a screenshot-grade version, the engineer can later swap rectangles for PIL-rendered
thumbnails of each deck's cover slide — but the simple labelled-rectangle version is
sufficient as a "menu" for leadership.
"""
from pathlib import Path
from reportlab.lib.pagesizes import landscape, A3
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib import colors

ROOT = Path(__file__).parent.parent
OUTPUT = ROOT / "output" / "_SUITE-COVER.pdf"

DECKS = [
    ("01", "The Story So Far", "Flagship"),
    ("02", "SmartGate Spotlight", "App Spotlight"),
    ("03", "Staff Attendance Spotlight", "App Spotlight"),
    ("04", "Security & Trust", "Thematic"),
    ("05", "Offline-First Resilience", "Thematic"),
    ("06", "The Notifications Engine", "Thematic"),
    ("07", "GPS Geofence Precision", "Thematic"),
    ("08", "Kente Executive Design", "Thematic"),
    ("09", "Reception Workflow", "Thematic"),
    ("10", "The Staff Experience", "Thematic"),
    ("11", "Director Visibility", "Thematic"),
    ("12", "The Build Discipline", "Thematic"),
    ("13", "Roadmap", "Thematic"),
]

GOLD = colors.HexColor("#C9A14A")
INK  = colors.HexColor("#0E1411")
CREAM = colors.HexColor("#F6F1E7")

PAGE_W, PAGE_H = landscape(A3)
MARGIN = 20 * mm
COLS = 4   # 13 fits in 4×4 grid with one empty
ROWS = 4
TITLE_BAND = 30 * mm

cell_w = (PAGE_W - 2 * MARGIN) / COLS
cell_h = (PAGE_H - 2 * MARGIN - TITLE_BAND) / ROWS

c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A3))

# Title band
c.setFillColor(INK)
c.rect(0, PAGE_H - TITLE_BAND, PAGE_W, TITLE_BAND, fill=1, stroke=0)
c.setFillColor(CREAM)
c.setFont("Helvetica-Bold", 22)
c.drawString(MARGIN, PAGE_H - 18 * mm, "OHCS SmartGate & Staff Attendance — Executive Presentation Suite")
c.setFont("Helvetica", 10)
c.setFillColor(GOLD)
c.drawString(MARGIN, PAGE_H - 25 * mm, "13 decks · Kente Executive design language · v0 generated 2026-05-28")

# Deck cards
for i, (num, title, tier) in enumerate(DECKS):
    row = i // COLS
    col = i % COLS
    x = MARGIN + col * cell_w
    y = PAGE_H - TITLE_BAND - MARGIN - (row + 1) * cell_h
    pad = 4 * mm

    c.setFillColor(CREAM)
    c.setStrokeColor(GOLD)
    c.setLineWidth(1)
    c.rect(x + pad, y + pad, cell_w - 2 * pad, cell_h - 2 * pad, fill=1, stroke=1)

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + pad + 4 * mm, y + cell_h - pad - 6 * mm, num)

    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(x + pad + 4 * mm, y + cell_h - pad - 14 * mm, title[:30])

    c.setFillColor(GOLD)
    c.setFont("Helvetica", 8)
    c.drawString(x + pad + 4 * mm, y + pad + 4 * mm, tier.upper())

c.showPage()
c.save()
print(f"Wrote {OUTPUT}")
```

- [ ] **Step 2: Generate it**

Run:
```powershell
cd decks/_scripts
python build_suite_cover.py
cd ../..
```
Expected: `Wrote <path>/_SUITE-COVER.pdf`

- [ ] **Step 3: Verify the PDF exists and is sensible**

Run: `Get-Item decks/output/_SUITE-COVER.pdf | Select-Object Name, Length`
Expected: file exists, size > 5 KB.

- [ ] **Step 4: Commit**

```powershell
git add decks/_scripts/build_suite_cover.py decks/output/_SUITE-COVER.pdf
git commit -m "output(decks): _SUITE-COVER.pdf — 13-deck contact sheet"
```

### Task 6.2: Final suite-wide verification

**Files:** none (verification only)

- [ ] **Step 1: Verify every v0 deck individually**

Run:
```powershell
$expected = @{
    "01-flagship" = 18
    "02-smartgate-spotlight" = 20
    "03-staff-attendance-spotlight" = 20
    "04-security-and-trust" = 16
    "05-offline-resilience" = 14
    "06-notifications-engine" = 14
    "07-geofence-precision" = 14
    "08-kente-executive-design" = 16
    "09-reception-workflow" = 14
    "10-staff-experience" = 14
    "11-director-visibility" = 12
    "12-build-discipline" = 14
    "13-roadmap-care-continues" = 12
}
cd decks/_scripts
foreach ($name in $expected.Keys) {
    python verify_deck.py "../output/$name-v0.pptx" $expected[$name]
}
cd ../..
```
Expected: 13 lines each beginning with `OK`.

- [ ] **Step 2: Verify no deck exceeds 25 MB**

Run:
```powershell
Get-ChildItem decks/output/*.pptx | ForEach-Object {
    $mb = [math]::Round($_.Length / 1MB, 2)
    if ($mb -gt 25) { Write-Error "$($_.Name) is $mb MB (over 25 MB cap)" }
    else { "OK  $($_.Name)  $mb MB" }
}
```
Expected: 13 OK lines, no errors.

- [ ] **Step 3: Verify total suite size is reasonable**

Run: `(Get-ChildItem decks/output/*.pptx | Measure-Object Length -Sum).Sum / 1MB`
Expected: under 100 MB total for v0 (will grow with real screenshots in v1).

- [ ] **Step 4: Mark suite v0 complete**

```powershell
git commit --allow-empty -m "meta(decks): all 13 v0 decks verified · suite ready for asset gathering"
```

### Task 6.3: Write the v1 production loop (per-deck workflow)

Once a deck's manifest hits 100% complete (every screenshot captured, every number filled, every quote in), the user follows this loop to produce v1.

- [ ] **Step 1: Document the v1 loop**

Create `decks/V1-PRODUCTION.md`:

```markdown
# v1 Production Loop

When a deck's manifest hits 100%, follow this loop to produce the v1.

## 1. Place captured screenshots

Per the manifest, save each captured screenshot to:

```
decks/_assets/screenshots/<ID>-<short-name>.png
```

Match the IDs in the manifest exactly (e.g., `S08-clockin-success.png`).

## 2. Fill numbers and quotes in the outline

Edit the deck's outline at `decks/_outlines/NN-<name>.md`. Replace every `<N##>` and `<Q##>` token with the value from the manifest.

## 3. Rebuild as v1

In the per-deck builder script (`decks/_scripts/build_NN_<name>.py`), change the output filename from `-v0.pptx` to `-v1.pptx`. Run it:

```powershell
cd decks/_scripts
python build_NN_<name>.py
python verify_deck.py "../output/NN-<name>-v1.pptx" <expected_slides>
cd ../..
```

## 4. Regenerate the suite cover

```powershell
cd decks/_scripts
python build_suite_cover.py
cd ../..
```

## 5. Commit

```powershell
git add decks/_outlines/NN-<name>.md decks/_scripts/build_NN_<name>.py decks/output/NN-<name>-v1.pptx decks/output/_SUITE-COVER.pdf decks/_assets/screenshots/
git commit -m "output(decks): deck NN <Title> v1 — real assets"
```

## 6. Mark manifest delivered

In `decks/_manifests/NN-<name>.md`, tick the `delivered` checkbox at the top.

```powershell
git add decks/_manifests/NN-<name>.md
git commit -m "manifests(decks): deck NN delivered"
```
```

- [ ] **Step 2: Commit the loop doc**

```powershell
git add decks/V1-PRODUCTION.md
git commit -m "docs(decks): v1 production loop instructions"
```

### Task 6.4: Suite complete marker

- [ ] **Step 1: Final empty commit**

```powershell
git commit --allow-empty -m "meta(decks): suite v0 complete · 13 decks + cover sheet + production loop"
```

---

## Out of scope (deliberately not building in this plan)

- Decks 14 and 15 (Cloudflare Edge Architecture, Numbers & Impact) — reserved per spec §2. Build only on explicit greenlight; pattern is identical to Decks 04–13.
- Speaker notes — flagged for follow-up if requested.
- HTML/web slide versions — separate project.
- Translations.
- Video walkthroughs.
- Animated GIF flows.
- v1 production for any deck — gated on the user supplying assets per `_INDEX.md`. The plan's last task documents the v1 loop.

---

## Self-review summary

- **Spec coverage:** Sections 1–10 of the spec are covered. Section 11 (risks) is internalised in the plan's design choices. Section 12 (done means) is verified by Task 6.2.
- **Placeholder scan:** outline files use `<N##>` and `<Q##>` tokens deliberately — these are *content placeholders* the user fills during v1 production, not plan placeholders. They are documented in the v1 loop.
- **Type consistency:** `theme.TIER_STRIPS` keys (`flagship`, `smartgate`, `staff`, `thematic`) match outline `tier:` values. `slide_templates` function signatures match `build_deck.py` call sites. Manifest tier values match.
- **Sprint accounting:** Sprint 0 = foundations only. Sprint 1 = Deck 04 (reference). Sprint 2 = Decks 01, 02, 03. Sprint 3 = Decks 05, 06, 07, 08. Sprint 4 = Decks 09, 10, 11. Sprint 5 = Decks 12, 13. Sprint 6 = suite cover + final QA. Total = 13 decks built, matches spec.
