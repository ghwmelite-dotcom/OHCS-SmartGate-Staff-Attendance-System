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
