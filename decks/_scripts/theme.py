"""Kente Executive design tokens for OHCS presentation suite."""
from pptx.util import Pt, Emu
from pptx.dml.color import RGBColor

INK_DEEP        = RGBColor(0x0E, 0x14, 0x11)
INK_WARM        = RGBColor(0x1A, 0x17, 0x14)
CREAM_PAGE      = RGBColor(0xF6, 0xF1, 0xE7)
CREAM_SOFT      = RGBColor(0xFB, 0xF7, 0xEF)
GOLD_SIGNATURE  = RGBColor(0xC9, 0xA1, 0x4A)
GOLD_DEEP       = RGBColor(0x8B, 0x6B, 0x22)
GREEN_SMARTGATE = RGBColor(0x1A, 0x4D, 0x2E)
RED_ALERT       = RGBColor(0x7A, 0x1F, 0x1F)
NEUTRAL_LINE    = RGBColor(0xD8, 0xCF, 0xBE)

FONT_DISPLAY = "Playfair Display"
FONT_BODY    = "DM Sans"

SIZE_DISPLAY_COVER     = Pt(60)
SIZE_DISPLAY_STATEMENT = Pt(44)
SIZE_SECTION_TITLE     = Pt(32)
SIZE_BODY              = Pt(18)
SIZE_CAPTION           = Pt(11)
SIZE_HERO_NUMBER       = Pt(220)

SLIDE_WIDTH_EMU  = Emu(12192000)
SLIDE_HEIGHT_EMU = Emu(6858000)

OUTER_MARGIN_EMU = Emu(457200)
SAFE_INSET_EMU   = Emu(762000)
GUTTER_EMU       = Emu(304800)

TIER_STRIPS = {
    "flagship":  "kente-strip-flagship.png",
    "smartgate": "kente-strip-smartgate.png",
    "staff":     "kente-strip-staff.png",
    "thematic":  "kente-strip-thematic.png",
}

TIER_COVER_ACCENT = {
    "flagship":  GOLD_SIGNATURE,
    "smartgate": GOLD_SIGNATURE,
    "staff":     GREEN_SMARTGATE,
    "thematic":  GOLD_SIGNATURE,
}
