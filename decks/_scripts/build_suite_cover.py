"""Generates _SUITE-COVER.pdf — single-page contact sheet of all 13 deck covers as labelled cards."""
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

GOLD  = colors.HexColor("#C9A14A")
INK   = colors.HexColor("#0E1411")
CREAM = colors.HexColor("#F6F1E7")

PAGE_W, PAGE_H = landscape(A3)
MARGIN = 20 * mm
COLS = 4
ROWS = 4
TITLE_BAND = 30 * mm

cell_w = (PAGE_W - 2 * MARGIN) / COLS
cell_h = (PAGE_H - 2 * MARGIN - TITLE_BAND) / ROWS

c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A3))

c.setFillColor(INK)
c.rect(0, PAGE_H - TITLE_BAND, PAGE_W, TITLE_BAND, fill=1, stroke=0)
c.setFillColor(CREAM)
c.setFont("Helvetica-Bold", 22)
c.drawString(MARGIN, PAGE_H - 18 * mm, "OHCS SmartGate & Staff Attendance — Executive Presentation Suite")
c.setFont("Helvetica", 10)
c.setFillColor(GOLD)
c.drawString(MARGIN, PAGE_H - 25 * mm, "13 decks · Kente Executive design language · v0 generated 2026-05-28")

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
