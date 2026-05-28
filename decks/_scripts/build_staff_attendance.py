"""Builds the Staff Attendance executive deck.

Auto-falls-back to a timestamped filename if the primary target is locked.
"""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent


def _writable(path: Path) -> bool:
    try:
        if path.exists():
            with open(path, "ab"):
                pass
        return True
    except PermissionError:
        return False


if __name__ == "__main__":
    target = ROOT / "output" / "staff-attendance-v0.pptx"
    if not _writable(target):
        from datetime import datetime
        ts = datetime.now().strftime("%H%M%S")
        target = ROOT / "output" / f"staff-attendance-v0-{ts}.pptx"
        print(f"(primary locked; writing to {target.name})")
    out = build(
        outline_path=ROOT / "_outlines" / "staff-attendance.md",
        output_path=target,
        deck_id="STAFF",
        deck_title="Staff Attendance",
    )
    print(f"Built {out}")
