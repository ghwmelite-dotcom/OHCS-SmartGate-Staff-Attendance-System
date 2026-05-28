"""Generates 13 per-deck manifest .md stubs from the template."""
from pathlib import Path

MANIFESTS = Path(__file__).parent.parent / "_manifests"

DECKS = [
    ("01", "flagship",                       "The Story So Far",                        18, "flagship",  "<N03> · clock-ins to date"),
    ("02", "smartgate-spotlight",            "SmartGate — Visitor Management",          20, "smartgate", "<N02> · visitors checked in on an average day"),
    ("03", "staff-attendance-spotlight",     "Staff Attendance — Clocking In, Honestly", 20, "staff",    "<N04>% first-try GPS success"),
    ("04", "security-and-trust",             "Security & Trust",                        16, "thematic",  "0 third-party push services"),
    ("05", "offline-resilience",             "Offline-First Resilience",                14, "thematic",  "<N10> queued mutations replayed"),
    ("06", "notifications-engine",           "The Notifications Engine",                14, "thematic",  "<N09>% push delivery success"),
    ("07", "geofence-precision",             "GPS Geofence Precision",                  14, "thematic",  "<N04>% first-try GPS success"),
    ("08", "kente-executive-design",         "Kente Executive — A Civic Design Language", 16, "thematic", "Type pair specimen — Playfair + DM Sans"),
    ("09", "reception-workflow",             "Reception Workflow",                      14, "thematic",  "<N01> visitors checked in since launch"),
    ("10", "staff-experience",               "The Staff Experience",                    14, "thematic",  "<N03> clock-ins recorded"),
    ("11", "director-visibility",            "Director Visibility",                     12, "thematic",  "<N07> directorate heads receiving the daily summary"),
    ("12", "build-discipline",               "The Build Discipline",                    14, "thematic",  "<N14> specs in the repo"),
    ("13", "roadmap-care-continues",         "Roadmap — Care Continues",                12, "thematic",  "6 roadmap items, each specced"),
]

TEMPLATE = """# Deck {num} · {title} — Asset Manifest

**Status:** ☐ draft  ☐ assets gathered  ☐ produced  ☐ delivered
**Slide count target:** {slides}
**Audience:** Executive Leadership
**Tier:** {tier}
**Wow moment:** {wow}

---

## 1 · Screenshots needed

Pull from `_INDEX.md`. Tick here AND in `_INDEX.md` once captured.

| Local ref | Index ID | Description | Status |
|-----------|----------|-------------|--------|
| (fill from outline `image:` lines) | | | ☐ |

## 2 · Numbers needed

| Local ref | Index ID | Description | Status |
|-----------|----------|-------------|--------|
| (fill from outline `<N##>` tokens) | | | ☐ |

## 3 · Quotes / sign-off needed

| Local ref | Index ID | Description | Status |
|-----------|----------|-------------|--------|
| (fill from outline `<Q##>` tokens) | | | ☐ |

## 4 · Anything else this deck needs

- (deck-specific notes)

---

**Delivery gate:** This deck cannot move from v0 → v1 until every ☐ above is ✓.
"""


def main():
    MANIFESTS.mkdir(exist_ok=True)
    for num, slug, title, slides, tier, wow in DECKS:
        path = MANIFESTS / f"{num}-{slug}.md"
        path.write_text(
            TEMPLATE.format(num=num, title=title, slides=slides, tier=tier, wow=wow),
            encoding="utf-8",
        )
    template_path = MANIFESTS / "_TEMPLATE.md"
    template_path.write_text(
        TEMPLATE.format(num="NN", title="<Deck Title>", slides="NN", tier="thematic", wow="<describe>"),
        encoding="utf-8",
    )
    print(f"Wrote {len(DECKS)} per-deck manifests + _TEMPLATE.md to {MANIFESTS}")


if __name__ == "__main__":
    main()
