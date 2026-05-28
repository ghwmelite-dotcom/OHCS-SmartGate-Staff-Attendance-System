"""Builds Deck 03 · Staff Attendance Spotlight."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "03-staff-attendance-spotlight.md",
        output_path=ROOT / "output" / "03-staff-attendance-spotlight-v0.pptx",
        deck_id="03",
        deck_title="Staff Attendance",
    )
    print(f"Built {out}")
