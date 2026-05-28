"""Builds Deck 12 · The Build Discipline."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "12-build-discipline.md",
        output_path=ROOT / "output" / "12-build-discipline-v0.pptx",
        deck_id="12",
        deck_title="The Build Discipline",
    )
    print(f"Built {out}")
