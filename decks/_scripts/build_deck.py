"""Orchestrates a deck build: outline.md -> .pptx via slide_templates."""
from pathlib import Path
from pptx import Presentation

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
