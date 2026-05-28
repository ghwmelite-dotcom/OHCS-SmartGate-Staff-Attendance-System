"""Builds Deck 05 · Offline-First Resilience."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "05-offline-resilience.md",
        output_path=ROOT / "output" / "05-offline-resilience-v0.pptx",
        deck_id="05",
        deck_title="Offline-First Resilience",
    )
    print(f"Built {out}")
