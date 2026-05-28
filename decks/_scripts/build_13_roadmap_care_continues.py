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
