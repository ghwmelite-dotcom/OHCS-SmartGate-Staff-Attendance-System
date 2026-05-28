"""Builds Deck 10 · The Staff Experience."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "10-staff-experience.md",
        output_path=ROOT / "output" / "10-staff-experience-v0.pptx",
        deck_id="10",
        deck_title="The Staff Experience",
    )
    print(f"Built {out}")
