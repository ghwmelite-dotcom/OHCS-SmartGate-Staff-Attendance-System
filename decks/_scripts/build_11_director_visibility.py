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
