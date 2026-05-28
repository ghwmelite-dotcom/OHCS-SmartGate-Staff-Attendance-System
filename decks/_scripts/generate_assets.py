"""Generates Kente accent strips, gold deco hairline, and Kente texture overlay."""
from PIL import Image, ImageDraw
from pathlib import Path

ASSETS = Path(__file__).parent.parent / "_assets"
ASSETS.mkdir(exist_ok=True)

INK_DEEP        = (0x0E, 0x14, 0x11)
CREAM_PAGE      = (0xF6, 0xF1, 0xE7)
GOLD_SIGNATURE  = (0xC9, 0xA1, 0x4A)
GREEN_SMARTGATE = (0x1A, 0x4D, 0x2E)

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
    img = Image.new("RGBA", (120, 1), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([(0, 0), (119, 0)], fill=GOLD_SIGNATURE + (255,), width=1)
    img.save(ASSETS / "gold-deco-hairline.png")


def kente_texture_overlay():
    alpha = 15
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
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
    print(f"Generated 6 assets in {ASSETS}")
