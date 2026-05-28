"""Slide factory functions — one per slide type in the 7-block skeleton."""
from pathlib import Path
from pptx.util import Emu, Pt
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
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
    text = f"{deck_id} · {deck_title} · {page:02d}/{total:02d}"
    _add_text(
        slide,
        left=Emu(8000000), top=Emu(6500000),
        width=Emu(4000000), height=Emu(300000),
        text=text, font=theme.FONT_BODY, size=theme.SIZE_CAPTION,
        color=theme.NEUTRAL_LINE, align=PP_ALIGN.RIGHT,
    )


def _add_tier_strip(slide, tier: str):
    img_path = str(ASSETS / theme.TIER_STRIPS[tier])
    slide.shapes.add_picture(img_path, Emu(0), Emu(0), width=theme.SLIDE_WIDTH_EMU, height=Emu(100000))


def add_cover_slide(prs, deck_id, deck_title, deck_subtitle, tier, audience, version, date):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.CREAM_PAGE)
    _add_tier_strip(slide, tier)

    _add_text(
        slide, Emu(800000), Emu(600000), Emu(1500000), Emu(300000),
        deck_id, theme.FONT_BODY, theme.SIZE_CAPTION, theme.GOLD_DEEP, bold=True,
    )

    _add_text(
        slide, Emu(800000), Emu(2200000), Emu(10500000), Emu(1500000),
        deck_title, theme.FONT_DISPLAY, theme.SIZE_DISPLAY_COVER, theme.INK_DEEP, bold=True,
        align=PP_ALIGN.CENTER,
    )

    slide.shapes.add_picture(
        str(ASSETS / "gold-deco-hairline.png"),
        Emu(5896000), Emu(3900000), width=Emu(400000), height=Emu(20000),
    )

    _add_text(
        slide, Emu(800000), Emu(4100000), Emu(10500000), Emu(500000),
        deck_subtitle, theme.FONT_BODY, theme.SIZE_BODY, theme.INK_WARM,
        align=PP_ALIGN.CENTER,
    )

    _add_text(
        slide, Emu(800000), Emu(6200000), Emu(4000000), Emu(300000),
        f"For: {audience}", theme.FONT_BODY, theme.SIZE_CAPTION, theme.GOLD_DEEP,
    )

    _add_text(
        slide, Emu(8000000), Emu(6200000), Emu(4000000), Emu(300000),
        f"v{version} · {date}", theme.FONT_BODY, theme.SIZE_CAPTION, theme.NEUTRAL_LINE,
        align=PP_ALIGN.RIGHT,
    )
    return slide


def add_divider_slide(prs, line: str):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.INK_DEEP)
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


def add_evidence_slide(prs, title: str, image_path, bullets: list[str],
                       caption: str, deck_id: str, deck_title: str, page: int, total: int):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_slide_background(slide, theme.CREAM_PAGE)

    _add_text(
        slide, Emu(800000), Emu(500000), Emu(10500000), Emu(700000),
        title, theme.FONT_BODY, theme.SIZE_SECTION_TITLE, theme.INK_DEEP, bold=True,
    )

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

    for i, bullet in enumerate(bullets[:3]):
        _add_text(
            slide, Emu(7100000), Emu(1500000 + i * 1300000),
            Emu(4200000), Emu(1100000),
            f"{chr(0x2460 + i)}  {bullet}", theme.FONT_BODY, Pt(16),
            theme.INK_WARM,
        )

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
