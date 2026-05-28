"""Builds Deck 07 · GPS Geofence Precision."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "07-geofence-precision.md",
        output_path=ROOT / "output" / "07-geofence-precision-v0.pptx",
        deck_id="07",
        deck_title="GPS Geofence Precision",
    )
    print(f"Built {out}")
