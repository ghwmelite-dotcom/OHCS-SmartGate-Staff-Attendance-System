"""Builds Deck 09 · Reception Workflow."""
from pathlib import Path
from build_deck import build

ROOT = Path(__file__).parent.parent

if __name__ == "__main__":
    out = build(
        outline_path=ROOT / "_outlines" / "09-reception-workflow.md",
        output_path=ROOT / "output" / "09-reception-workflow-v0.pptx",
        deck_id="09",
        deck_title="Reception Workflow",
    )
    print(f"Built {out}")
