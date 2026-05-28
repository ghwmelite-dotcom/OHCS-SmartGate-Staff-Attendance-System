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
