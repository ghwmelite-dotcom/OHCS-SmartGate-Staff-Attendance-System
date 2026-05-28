"""Builds the Staff Attendance executive deck."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "staff-attendance.md",
        output_path=ROOT / "output" / "staff-attendance-v0.pptx",
        deck_id="STAFF",
        deck_title="Staff Attendance",
    )
    print(f"Built {out}")
