"""Magazine-spread slide renderer for the OHCS executive deck.

Each render function returns a 1920x1080 PIL.Image. The build pipeline embeds
each rendered image full-bleed in the .pptx, so the deck becomes an image-
composed presentation with full design control.

Slide types:
  render_cover, render_divider, render_toc, render_statement,
  render_evidence (dispatches to 4 sub-layouts by image aspect ratio),
  render_wow, render_appendix
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ─── Paths & constants ───────────────────────────────────────────────────────

W, H = 1920, 1080
WIN = "C:/Windows/Fonts"

F_SERIF_BOLD    = f"{WIN}/georgiab.ttf"
F_SERIF_REGULAR = f"{WIN}/georgia.ttf"
F_SERIF_ITALIC  = f"{WIN}/georgiai.ttf"
F_SANS_REGULAR  = f"{WIN}/segoeui.ttf"
F_SANS_BOLD     = f"{WIN}/segoeuib.ttf"
F_SANS_BLACK    = f"{WIN}/seguibl.ttf"

# Palette
INK_DEEP        = (0x0E, 0x14, 0x11)
INK_WARM        = (0x1A, 0x17, 0x14)
CREAM_PAGE      = (0xF6, 0xF1, 0xE7)
CREAM_SOFT      = (0xFB, 0xF7, 0xEF)
GOLD_SIGNATURE  = (0xC9, 0xA1, 0x4A)
GOLD_DEEP       = (0x8B, 0x6B, 0x22)
GREEN_SMARTGATE = (0x1A, 0x4D, 0x2E)
NEUTRAL_LINE    = (0xD8, 0xCF, 0xBE)
NEUTRAL_TEXT    = (0x6E, 0x68, 0x5C)
WHITE           = (0xFF, 0xFF, 0xFF)


def ft(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def measure(text: str, font) -> tuple[int, int]:
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def wrap_text(text: str, font, max_w: int) -> list[str]:
    """Word-wrap text to fit within max_w pixels, preserving \\n breaks."""
    out: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            out.append("")
            continue
        line = ""
        for w in words:
            cand = (line + " " + w).strip()
            if measure(cand, font)[0] <= max_w:
                line = cand
            else:
                if line:
                    out.append(line)
                line = w
        if line:
            out.append(line)
    return out


def draw_paragraph(d, x, y, text, font, fill, max_w, line_h: int | None = None) -> int:
    """Draw word-wrapped text. Returns the y-position immediately after the last line."""
    lh = line_h or int(font.size * 1.35)
    for i, line in enumerate(wrap_text(text, font, max_w)):
        d.text((x, y + i * lh), line, font=font, fill=fill)
    return y + len(wrap_text(text, font, max_w)) * lh


def fit_image_to_box(img: Image.Image, box_w: int, box_h: int) -> Image.Image:
    src_w, src_h = img.size
    src_ar = src_w / src_h
    box_ar = box_w / box_h
    if src_ar >= box_ar:
        return img.resize((box_w, int(box_w / src_ar)), Image.LANCZOS)
    else:
        return img.resize((int(box_h * src_ar), box_h), Image.LANCZOS)


def composite_shadow(base: Image.Image, top: Image.Image, x: int, y: int, blur: int = 30, opacity: int = 100, offset=(0, 18)) -> Image.Image:
    """Paste `top` at (x,y) on `base` with a soft drop-shadow beneath it."""
    base_rgba = base.convert("RGBA")
    w, h = top.size
    shadow_layer = Image.new("RGBA", base_rgba.size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, opacity))
    shadow_layer.paste(shadow, (x + offset[0], y + offset[1]), shadow)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))
    base_rgba = Image.alpha_composite(base_rgba, shadow_layer)
    base_rgba.paste(top.convert("RGBA"), (x, y), top.convert("RGBA"))
    return base_rgba.convert("RGB")


# ─── Recurring chrome ────────────────────────────────────────────────────────

def _draw_gold_rule(d, dark=False):
    """4px-wide gold rule down the left edge — recurring brand mark."""
    d.rectangle((0, 0, 4, H), fill=GOLD_SIGNATURE)


def _draw_eyebrow(d, x, y, text, dark=False):
    color = GOLD_SIGNATURE if dark else GOLD_DEEP
    spaced = "   ".join(text.upper())  # tracked-out small caps
    d.text((x, y), spaced, font=ft(F_SANS_BOLD, 14), fill=color)


def _draw_pagination(d, page: int, total: int, dark=False):
    color = NEUTRAL_LINE if dark else NEUTRAL_TEXT
    text = f"{page:02d}  /  {total:02d}"
    bbox = ft(F_SANS_BOLD, 13).getbbox(text)
    w = bbox[2] - bbox[0]
    d.text((W - 80 - w, H - 60), text, font=ft(F_SANS_BOLD, 13), fill=color)


def _draw_kente_overlay(img: Image.Image, alpha: int = 22) -> Image.Image:
    """Subtle Kente texture overlaid on a dark slide."""
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 36):
        for x in range(0, W, 72):
            od.rectangle((x, y, x + 36, y + 18), fill=(GOLD_SIGNATURE[0], GOLD_SIGNATURE[1], GOLD_SIGNATURE[2], alpha))
            od.rectangle((x + 36, y + 18, x + 72, y + 36), fill=(GOLD_SIGNATURE[0], GOLD_SIGNATURE[1], GOLD_SIGNATURE[2], alpha))
    base = img.convert("RGBA")
    base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


# ─── Browser-frame helper for screenshot polish ──────────────────────────────

def frame_screenshot(img: Image.Image, url: str = "smartgate.ohcsghana.org") -> Image.Image:
    """Wrap a screenshot in a minimal browser chrome — adds polish without overwhelming."""
    chrome_h = 38
    w, h = img.size
    canvas = Image.new("RGB", (w, h + chrome_h), (245, 244, 240))
    d = ImageDraw.Draw(canvas)
    d.rectangle((0, 0, w, chrome_h), fill=(232, 230, 224))
    # Traffic lights
    cy = chrome_h // 2
    for i, color in enumerate([(252, 96, 89), (252, 188, 47), (40, 200, 64)]):
        cx = 18 + i * 18
        d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=color)
    # URL chip
    url_x1, url_x2 = 84, w - 60
    d.rounded_rectangle((url_x1, 8, url_x2, chrome_h - 8), radius=6, fill=(220, 218, 210))
    d.text((url_x1 + 14, 13), url, font=ft(F_SANS_REGULAR, 13), fill=(80, 80, 80))
    canvas.paste(img, (0, chrome_h))
    return canvas


# ─── COVER ───────────────────────────────────────────────────────────────────

def render_cover(deck_id: str, title: str, subtitle: str, audience: str, version: str, date: str) -> Image.Image:
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)

    # Top masthead
    d.text((80, 70), "O H C S   ·   S M A R T G A T E", font=ft(F_SANS_BOLD, 16), fill=GOLD_DEEP)
    d.text((W - 220, 70), f"VOLUME I  ·  {deck_id}", font=ft(F_SANS_BOLD, 13), fill=GOLD_DEEP)

    # Editorial title
    d.text((80, 260), title, font=ft(F_SERIF_BOLD, 188), fill=INK_DEEP)
    d.text((84, 530), subtitle, font=ft(F_SERIF_ITALIC, 38), fill=INK_WARM)

    # Decorative gold rule below subtitle (NOT under title — under sub instead)
    d.rectangle((84, 620, 84 + 80, 624), fill=GOLD_SIGNATURE)

    # Editorial body — a single curtain-raiser sentence
    d.text((84, 660), "An executive briefing on the visitor management system\nbuilt for the Office of the Head of the Civil Service, Ghana.",
           font=ft(F_SERIF_REGULAR, 22), fill=INK_WARM, spacing=8)

    # Bottom info row
    d.text((80, H - 100), f"FOR  ·  {audience.upper()}", font=ft(F_SANS_BOLD, 13), fill=GOLD_DEEP)
    d.text((W - 280, H - 100), f"v{version}  ·  {date}", font=ft(F_SANS_BOLD, 13), fill=NEUTRAL_TEXT)
    return img


# ─── DIVIDER (opening / closing single-sentence) ─────────────────────────────

def render_divider(line: str) -> Image.Image:
    img = Image.new("RGB", (W, H), INK_DEEP)
    img = _draw_kente_overlay(img, alpha=20)
    d = ImageDraw.Draw(img)
    # Big quote mark in gold (decorative)
    d.text((150, 180), "“", font=ft(F_SERIF_BOLD, 240), fill=GOLD_SIGNATURE)

    # Center the line, wrap to width
    text_w = 1500
    text_x = (W - text_w) // 2
    font_main = ft(F_SERIF_BOLD, 48)
    lines = wrap_text(line, font_main, text_w)
    line_h = int(font_main.size * 1.25)
    total_h = len(lines) * line_h
    y0 = (H - total_h) // 2
    for i, l in enumerate(lines):
        # Center each line
        line_w = measure(l, font_main)[0]
        d.text(((W - line_w) // 2, y0 + i * line_h), l, font=font_main, fill=CREAM_PAGE)

    # Bottom mark
    d.rectangle((W // 2 - 30, H - 120, W // 2 + 30, H - 116), fill=GOLD_SIGNATURE)
    return img


# ─── TOC ─────────────────────────────────────────────────────────────────────

def render_toc(bullets: list[str], page: int, total: int) -> Image.Image:
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    _draw_eyebrow(d, 80, 80, "Contents")

    # Title
    d.text((80, 130), "Three movements.", font=ft(F_SERIF_BOLD, 84), fill=INK_DEEP)

    # Entries
    y = 360
    for i, bullet in enumerate(bullets):
        # Big numeral
        num = f"{i+1:02d}"
        d.text((80, y), num, font=ft(F_SERIF_BOLD, 110), fill=GOLD_SIGNATURE)
        # Entry title to the right
        ent_x = 320
        # Split bullet into "Title — description" if it contains a dash, else just title
        parts = bullet.split(" — ", 1)
        head = parts[0]
        body = parts[1] if len(parts) > 1 else ""
        d.text((ent_x, y + 30), head, font=ft(F_SERIF_BOLD, 32), fill=INK_DEEP)
        if body:
            d.text((ent_x, y + 80), body, font=ft(F_SERIF_ITALIC, 20), fill=INK_WARM)
        y += 200

    _draw_pagination(d, page, total)
    return img


# ─── STATEMENT (no image; text-only with pull-quote treatment) ───────────────

def _split_into_short_lines(headline: str, max_chars_per_line: int = 28) -> list[str]:
    """For statement-style headlines, prefer breaking at sentence boundaries when each
    sentence is short. Returns lines preserved as the editorial author wrote them.
    Falls back to wrapping the whole thing if no natural sentence break helps."""
    sentences = [s.strip() for s in headline.replace("? ", "?|").replace("! ", "!|").replace(". ", ".|").split("|") if s.strip()]
    if len(sentences) >= 2 and all(len(s) <= max_chars_per_line for s in sentences):
        return sentences
    return [headline]


def render_statement(headline: str, sub: str, page: int, total: int,
                     eyebrow: str = "",
                     part_num: int | None = None,
                     preview_titles: list[str] | None = None) -> Image.Image:
    """Statement slide. When part_num + preview_titles are supplied, renders as an
    explicit section opener with 'PART N' label and 'In this part' preview. Otherwise
    renders as a standalone editorial statement (used for the quote slide etc)."""
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)

    is_section_opener = part_num is not None

    # Top-left: PART label or generic eyebrow
    if is_section_opener:
        roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][min(part_num - 1, 9)]
        d.text((80, 80), f"P A R T   {roman}", font=ft(F_SANS_BOLD, 16), fill=GOLD_DEEP)
    elif eyebrow:
        _draw_eyebrow(d, 80, 80, eyebrow)

    # Editorial line-break treatment for headline
    headline_pieces = _split_into_short_lines(headline)
    max_w = 1700
    size = 96 if not is_section_opener else 84
    while size > 56:
        hl_font = ft(F_SERIF_BOLD, size)
        if all(measure(p, hl_font)[0] <= max_w for p in headline_pieces):
            break
        size -= 4
    hl_font = ft(F_SERIF_BOLD, size)

    all_lines: list[str] = []
    for piece in headline_pieces:
        if measure(piece, hl_font)[0] <= max_w:
            all_lines.append(piece)
        else:
            all_lines.extend(wrap_text(piece, hl_font, max_w))

    line_h = int(hl_font.size * 1.05)
    y0 = 170 if is_section_opener else 200
    for i, line in enumerate(all_lines):
        d.text((80, y0 + i * line_h), line, font=hl_font, fill=INK_DEEP)

    sub_y = y0 + len(all_lines) * line_h + 60
    d.rectangle((80, sub_y, 80 + 100, sub_y + 4), fill=GOLD_SIGNATURE)

    # Subtitle
    sub_font = ft(F_SERIF_ITALIC, 28 if is_section_opener else 32)
    sub_lines = wrap_text(sub, sub_font, 1500)
    sub_line_h = int(sub_font.size * 1.35)
    for i, line in enumerate(sub_lines):
        d.text((80, sub_y + 28 + i * sub_line_h), line, font=sub_font, fill=INK_WARM)

    # IN THIS PART — preview list (only for section openers)
    if is_section_opener and preview_titles:
        list_y = sub_y + 32 + len(sub_lines) * sub_line_h + 80
        d.text((80, list_y), "I N   T H I S   P A R T", font=ft(F_SANS_BOLD, 13), fill=GOLD_DEEP)
        # Gold rule beneath the eyebrow
        d.rectangle((80, list_y + 28, 80 + 60, list_y + 31), fill=GOLD_SIGNATURE)
        item_y = list_y + 56
        for i, t in enumerate(preview_titles[:5]):
            num = f"{i+1:02d}"
            d.text((80, item_y + i * 56), num, font=ft(F_SERIF_BOLD, 32), fill=GOLD_SIGNATURE)
            # Truncate long titles
            label = t if len(t) <= 60 else t[:57] + "…"
            d.text((160, item_y + 8 + i * 56), label, font=ft(F_SERIF_REGULAR, 22), fill=INK_WARM)

    _draw_pagination(d, page, total)
    return img


# ─── EVIDENCE — dispatcher + 4 layouts ───────────────────────────────────────

def render_evidence(title: str, image_path: str, bullets: list[str], caption: str, page: int, total: int, eyebrow: str = "") -> Image.Image:
    if not image_path or not Path(image_path).exists():
        return _render_evidence_placeholder(title, image_path, bullets, caption, page, total, eyebrow)
    src = Image.open(image_path).convert("RGB")
    ar = src.width / src.height
    if ar >= 1.8:
        return _evidence_ultrawide(title, src, bullets, caption, page, total, eyebrow)
    elif ar >= 1.15:
        return _evidence_landscape(title, src, bullets, caption, page, total, eyebrow)
    elif ar >= 0.85:
        return _evidence_square(title, src, bullets, caption, page, total, eyebrow)
    else:
        return _evidence_portrait(title, src, bullets, caption, page, total, eyebrow)


def _evidence_ultrawide(title, src, bullets, caption, page, total, eyebrow):
    """AR >= 1.8 — image as a wide banner; headline above, three numbered notes below."""
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    if eyebrow:
        _draw_eyebrow(d, 80, 80, eyebrow)

    # Headline
    hl_font = ft(F_SERIF_BOLD, 52)
    hl_lines = wrap_text(title, hl_font, 1700)
    for i, line in enumerate(hl_lines):
        d.text((80, 130 + i * int(hl_font.size * 1.1)), line, font=hl_font, fill=INK_DEEP)

    # Image as banner — wrapped in browser chrome
    framed = frame_screenshot(src)
    fit = fit_image_to_box(framed, 1700, 480)
    img_x = (W - fit.width) // 2
    img_y = 280
    img = composite_shadow(img, fit, img_x, img_y, blur=24, opacity=80, offset=(0, 14))
    d = ImageDraw.Draw(img)

    # Three numbered notes below
    notes_y = img_y + fit.height + 60
    col_w = 540
    col_gap = 30
    base_x = 80
    for i, bullet in enumerate(bullets[:3]):
        x = base_x + i * (col_w + col_gap)
        d.text((x, notes_y), f"{i+1:02d}", font=ft(F_SERIF_BOLD, 36), fill=GOLD_SIGNATURE)
        body_font = ft(F_SANS_REGULAR, 15)
        body_lines = wrap_text(bullet, body_font, col_w)
        for j, line in enumerate(body_lines):
            d.text((x, notes_y + 56 + j * 22), line, font=body_font, fill=INK_WARM)

    # Caption
    d.text((80, H - 60), "   ".join(caption.upper()), font=ft(F_SANS_BOLD, 11), fill=GOLD_DEEP)
    _draw_pagination(d, page, total)
    return img


def _evidence_landscape(title, src, bullets, caption, page, total, eyebrow):
    """1.15 <= AR < 1.8 — image dominates right, slim text column left."""
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    if eyebrow:
        _draw_eyebrow(d, 90, 80, eyebrow)

    # Text column — slim (~520 wide) so the image gets the room
    text_col_w = 540
    hl_font = ft(F_SERIF_BOLD, 52)
    hl_lines = wrap_text(title, hl_font, text_col_w)
    for i, line in enumerate(hl_lines):
        d.text((84, 130 + i * int(hl_font.size * 1.05)), line, font=hl_font, fill=INK_DEEP)

    sub_y = 130 + len(hl_lines) * int(hl_font.size * 1.05) + 24
    if bullets:
        sub_font = ft(F_SERIF_ITALIC, 22)
        for i, line in enumerate(wrap_text(bullets[0], sub_font, text_col_w)):
            d.text((90, sub_y + i * int(sub_font.size * 1.35)), line, font=sub_font, fill=INK_WARM)

    # Pull-quote
    pq_y = 600
    d.rectangle((90, pq_y, 90 + 60, pq_y + 4), fill=GOLD_SIGNATURE)
    if len(bullets) > 1:
        for i, line in enumerate(wrap_text(f"“{bullets[1]}”", ft(F_SERIF_ITALIC, 22), text_col_w)):
            d.text((90, pq_y + 24 + i * 30), line, font=ft(F_SERIF_ITALIC, 22), fill=INK_WARM)

    # Stat note
    if len(bullets) > 2:
        d.text((90, pq_y + 200), "A L S O", font=ft(F_SANS_BOLD, 12), fill=GOLD_DEEP)
        for j, line in enumerate(wrap_text(bullets[2], ft(F_SANS_REGULAR, 14), text_col_w)):
            d.text((90, pq_y + 224 + j * 22), line, font=ft(F_SANS_REGULAR, 14), fill=INK_WARM)

    # Image — large, right side (was 920x680 → now 1200x820 for visual dominance)
    framed = frame_screenshot(src)
    fit = fit_image_to_box(framed, 1200, 820)
    img_x = W - fit.width - 80
    img_y = (H - fit.height) // 2 + 10
    img = composite_shadow(img, fit, img_x, img_y, blur=22, opacity=80, offset=(0, 14))
    d = ImageDraw.Draw(img)

    d.text((84, H - 60), "   ".join(caption.upper()), font=ft(F_SANS_BOLD, 11), fill=GOLD_DEEP)
    _draw_pagination(d, page, total)
    return img


def _evidence_square(title, src, bullets, caption, page, total, eyebrow):
    """0.85 <= AR < 1.15 — square image takes right side big; text column slim on left."""
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    if eyebrow:
        _draw_eyebrow(d, 90, 80, eyebrow)

    # Text column — slim (~520 wide)
    text_col_w = 540
    hl_font = ft(F_SERIF_BOLD, 50)
    hl_lines = wrap_text(title, hl_font, text_col_w)
    for i, line in enumerate(hl_lines):
        d.text((84, 130 + i * int(hl_font.size * 1.05)), line, font=hl_font, fill=INK_DEEP)

    sub_y = 130 + len(hl_lines) * int(hl_font.size * 1.05) + 24
    if bullets:
        sub_font = ft(F_SERIF_ITALIC, 22)
        for i, line in enumerate(wrap_text(bullets[0], sub_font, text_col_w)):
            d.text((90, sub_y + i * int(sub_font.size * 1.35)), line, font=sub_font, fill=INK_WARM)

    # Pull-quote
    pq_y = 620
    d.rectangle((90, pq_y, 90 + 60, pq_y + 4), fill=GOLD_SIGNATURE)
    if len(bullets) > 1:
        for i, line in enumerate(wrap_text(f"“{bullets[1]}”", ft(F_SERIF_ITALIC, 20), text_col_w)):
            d.text((90, pq_y + 22 + i * 28), line, font=ft(F_SERIF_ITALIC, 20), fill=INK_WARM)

    # Stat note
    if len(bullets) > 2:
        d.text((90, pq_y + 170), "A L S O", font=ft(F_SANS_BOLD, 12), fill=GOLD_DEEP)
        for j, line in enumerate(wrap_text(bullets[2], ft(F_SANS_REGULAR, 14), text_col_w)):
            d.text((90, pq_y + 194 + j * 22), line, font=ft(F_SANS_REGULAR, 14), fill=INK_WARM)

    # Square image — significantly larger (was 840x760 → now 1100x920)
    framed = frame_screenshot(src)
    fit = fit_image_to_box(framed, 1100, 920)
    img_x = W - fit.width - 80
    img_y = (H - fit.height) // 2 + 10
    img = composite_shadow(img, fit, img_x, img_y, blur=22, opacity=80, offset=(0, 14))
    d = ImageDraw.Draw(img)

    d.text((84, H - 60), "   ".join(caption.upper()), font=ft(F_SANS_BOLD, 11), fill=GOLD_DEEP)
    _draw_pagination(d, page, total)
    return img


def _evidence_portrait(title, src, bullets, caption, page, total, eyebrow):
    """AR < 0.85 — portrait image right (narrow & tall), all text on the left."""
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    if eyebrow:
        _draw_eyebrow(d, 90, 80, eyebrow)

    # Headline
    hl_font = ft(F_SERIF_BOLD, 64)
    hl_lines = wrap_text(title, hl_font, 1050)
    for i, line in enumerate(hl_lines):
        d.text((84, 130 + i * int(hl_font.size * 1.05)), line, font=hl_font, fill=INK_DEEP)

    sub_y = 130 + len(hl_lines) * int(hl_font.size * 1.05) + 30
    if bullets:
        sub_font = ft(F_SERIF_ITALIC, 26)
        for i, line in enumerate(wrap_text(bullets[0], sub_font, 1050)):
            d.text((90, sub_y + i * int(sub_font.size * 1.35)), line, font=sub_font, fill=INK_WARM)

    # Pull-quote stacked
    pq_y = 580
    d.rectangle((90, pq_y, 90 + 60, pq_y + 4), fill=GOLD_SIGNATURE)
    if len(bullets) > 1:
        for i, line in enumerate(wrap_text(f"“{bullets[1]}”", ft(F_SERIF_ITALIC, 24), 1050)):
            d.text((90, pq_y + 26 + i * int(24 * 1.4)), line, font=ft(F_SERIF_ITALIC, 24), fill=INK_WARM)

    # Stat / third bullet
    if len(bullets) > 2:
        d.text((90, pq_y + 220), "ALSO", font=ft(F_SANS_BOLD, 12), fill=GOLD_DEEP)
        for j, line in enumerate(wrap_text(bullets[2], ft(F_SANS_REGULAR, 16), 1050)):
            d.text((90, pq_y + 244 + j * 24), line, font=ft(F_SANS_REGULAR, 16), fill=INK_WARM)

    # Image right — narrow & tall (no browser chrome for mobile views)
    fit = fit_image_to_box(src, 500, 820)
    img_x = W - fit.width - 90
    img_y = (H - fit.height) // 2 + 20
    img = composite_shadow(img, fit, img_x, img_y, blur=22, opacity=80, offset=(0, 14))
    d = ImageDraw.Draw(img)

    d.text((84, H - 60), "   ".join(caption.upper()), font=ft(F_SANS_BOLD, 11), fill=GOLD_DEEP)
    _draw_pagination(d, page, total)
    return img


def _render_evidence_placeholder(title, image_path, bullets, caption, page, total, eyebrow):
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    if eyebrow:
        _draw_eyebrow(d, 80, 80, eyebrow)
    d.text((80, 130), title, font=ft(F_SERIF_BOLD, 56), fill=INK_DEEP)
    # Big dashed rectangle
    box = (80, 280, W - 80, H - 200)
    for s in range(box[0], box[2], 14):
        d.line([(s, box[1]), (s + 8, box[1])], fill=NEUTRAL_LINE, width=2)
        d.line([(s, box[3]), (s + 8, box[3])], fill=NEUTRAL_LINE, width=2)
    for s in range(box[1], box[3], 14):
        d.line([(box[0], s), (box[0], s + 8)], fill=NEUTRAL_LINE, width=2)
        d.line([(box[2], s), (box[2], s + 8)], fill=NEUTRAL_LINE, width=2)
    name = Path(image_path).name if image_path else "image"
    d.text((W // 2 - 200, (box[1] + box[3]) // 2), f"[ REPLACE: {name} ]", font=ft(F_SANS_BOLD, 16), fill=GOLD_DEEP)
    d.text((80, H - 60), "   ".join(caption.upper()), font=ft(F_SANS_BOLD, 11), fill=GOLD_DEEP)
    _draw_pagination(d, page, total)
    return img


# ─── WOW (hero number) ───────────────────────────────────────────────────────

def render_wow(hero_number: str, label: str, page: int, total: int) -> Image.Image:
    img = Image.new("RGB", (W, H), INK_DEEP)
    img = _draw_kente_overlay(img, alpha=18)
    d = ImageDraw.Draw(img)

    is_placeholder = (isinstance(hero_number, str)
                      and hero_number.startswith("<")
                      and hero_number.endswith(">"))
    # Use "TK" (editorial convention for "to come") as a recognizable placeholder
    # instead of the em-dash, which renders as a giant gold bar at 380pt.
    display = "TK" if is_placeholder else hero_number

    # Eyebrow
    eyebrow_text = "PENDING FIGURE" if is_placeholder else "THE NUMBER"
    text = "   ".join(eyebrow_text)
    tw = measure(text, ft(F_SANS_BOLD, 14))[0]
    d.text(((W - tw) // 2, 220), text, font=ft(F_SANS_BOLD, 14), fill=GOLD_SIGNATURE)

    # Massive number — auto-scale to fit width
    target_w = 1500
    # Placeholders use a smaller scale so "TK" doesn't look like a real headline number
    max_size = 240 if is_placeholder else 380
    size = max_size
    while size > 100:
        font = ft(F_SERIF_BOLD, size)
        if measure(display, font)[0] <= target_w:
            break
        size -= 8
    font = ft(F_SERIF_BOLD, size)
    color = NEUTRAL_LINE if is_placeholder else GOLD_SIGNATURE
    nw, nh = measure(display, font)
    nx = (W - nw) // 2
    ny = (H - nh) // 2 - 40
    d.text((nx, ny), display, font=font, fill=color)

    # Caption
    cap_font = ft(F_SERIF_ITALIC, 28)
    cap_lines = wrap_text(label, cap_font, 1400)
    cap_y = ny + nh + 60
    for i, line in enumerate(cap_lines):
        lw = measure(line, cap_font)[0]
        d.text(((W - lw) // 2, cap_y + i * int(cap_font.size * 1.4)), line, font=cap_font, fill=CREAM_PAGE)

    if is_placeholder:
        msg = f"Figure pending  ·  fill {hero_number} in outline before delivery"
        mw = measure(msg, ft(F_SANS_REGULAR, 12))[0]
        d.text(((W - mw) // 2, H - 110), msg, font=ft(F_SANS_REGULAR, 12), fill=NEUTRAL_LINE)

    _draw_pagination(d, page, total, dark=True)
    return img


# ─── APPENDIX ────────────────────────────────────────────────────────────────

def render_appendix(links: list[str], related: list[str], page: int, total: int) -> Image.Image:
    img = Image.new("RGB", (W, H), CREAM_SOFT)
    d = ImageDraw.Draw(img)
    _draw_gold_rule(d)
    _draw_eyebrow(d, 80, 80, "Appendix")

    d.text((80, 130), "Where to look next.", font=ft(F_SERIF_BOLD, 76), fill=INK_DEEP)
    d.rectangle((80, 270, 180, 274), fill=GOLD_SIGNATURE)

    # Two columns
    d.text((80, 360), "L I V E", font=ft(F_SANS_BOLD, 14), fill=GOLD_DEEP)
    for i, link in enumerate(links):
        d.text((80, 400 + i * 50), link, font=ft(F_SERIF_REGULAR, 22), fill=INK_WARM)

    d.text((990, 360), "C O M P A N I O N", font=ft(F_SANS_BOLD, 14), fill=GOLD_DEEP)
    for i, rel in enumerate(related):
        for j, line in enumerate(wrap_text(rel, ft(F_SERIF_REGULAR, 22), 850)):
            d.text((990, 400 + i * 80 + j * 32), line, font=ft(F_SERIF_REGULAR, 22), fill=INK_WARM)

    # Colophon
    d.rectangle((80, H - 140, 180, H - 136), fill=GOLD_SIGNATURE)
    d.text((80, H - 110), "COLOPHON", font=ft(F_SANS_BOLD, 12), fill=GOLD_DEEP)
    d.text((80, H - 80), "Built on Cloudflare's edge  ·  Designed in the Kente Executive register.",
           font=ft(F_SERIF_ITALIC, 18), fill=INK_WARM)

    _draw_pagination(d, page, total)
    return img
