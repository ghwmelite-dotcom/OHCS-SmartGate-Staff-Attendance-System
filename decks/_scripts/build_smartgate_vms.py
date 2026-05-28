"""Builds the SmartGate (VMS) executive deck."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "smartgate-vms.md",
        output_path=ROOT / "output" / "smartgate-vms-v0.pptx",
        deck_id="VMS",
        deck_title="SmartGate — Visitor Management",
    )
    print(f"Built {out}")
