"""Parses an outline .md file into a list of Slide dicts.

Outline format: each slide is a markdown heading `## [type]` followed by `key: value`
lines and optional list-valued keys (indented bullet items).
"""
from pathlib import Path


def parse_outline(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    slides = []
    current = None
    current_key = None
    list_accumulator = None

    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("## ["):
            if current is not None:
                if list_accumulator is not None and current_key is not None:
                    current[current_key] = list_accumulator
                slides.append(current)
            slide_type = line[4:line.index("]")]
            current = {"type": slide_type}
            current_key = None
            list_accumulator = None
        elif current is None:
            continue
        elif line.strip().startswith("-") and current_key is not None:
            if list_accumulator is None:
                list_accumulator = []
            list_accumulator.append(line.strip()[1:].strip())
        elif ":" in line and not line.startswith(" "):
            if list_accumulator is not None and current_key is not None:
                current[current_key] = list_accumulator
                list_accumulator = None
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            current_key = key
            if value:
                current[key] = value
                current_key = None

    if current is not None:
        if list_accumulator is not None and current_key is not None:
            current[current_key] = list_accumulator
        slides.append(current)
    return slides
