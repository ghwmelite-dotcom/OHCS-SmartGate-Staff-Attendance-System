"""Builds the SmartGate (VMS) executive deck.

If output target is locked (PowerPoint open), automatically falls back to a
timestamped temp filename so we never block on file locks.
"""
import sys
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
    target = ROOT / "output" / "smartgate-vms-v0.pptx"
    if not _writable(target):
        from datetime import datetime
        ts = datetime.now().strftime("%H%M%S")
        target = ROOT / "output" / f"smartgate-vms-v0-{ts}.pptx"
        print(f"(primary locked; writing to {target.name})")
    out = build(
        outline_path=ROOT / "_outlines" / "smartgate-vms.md",
        output_path=target,
        deck_id="VMS",
        deck_title="SmartGate — Visitor Management",
    )
    print(f"Built {out}")
