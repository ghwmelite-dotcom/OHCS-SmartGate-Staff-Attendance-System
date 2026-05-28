"""Builds Deck 02 · SmartGate Spotlight."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "02-smartgate-spotlight.md",
        output_path=ROOT / "output" / "02-smartgate-spotlight-v0.pptx",
        deck_id="02",
        deck_title="SmartGate — Visitor Management",
    )
    print(f"Built {out}")
