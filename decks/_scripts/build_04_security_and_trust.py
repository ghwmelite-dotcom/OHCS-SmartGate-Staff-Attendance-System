"""Builds Deck 04 · Security & Trust."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent
DECK_ID = "04"
DECK_TITLE = "Security & Trust"

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "04-security-and-trust.md",
        output_path=ROOT / "output" / "04-security-and-trust-v0.pptx",
        deck_id=DECK_ID,
        deck_title=DECK_TITLE,
    )
    print(f"Built {out}")
