"""Builds Deck 06 · The Notifications Engine."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "06-notifications-engine.md",
        output_path=ROOT / "output" / "06-notifications-engine-v0.pptx",
        deck_id="06",
        deck_title="The Notifications Engine",
    )
    print(f"Built {out}")
