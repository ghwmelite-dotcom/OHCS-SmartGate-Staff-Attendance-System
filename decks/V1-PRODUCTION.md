# v1 Production Loop

When a deck's manifest hits 100% complete (every screenshot captured, every metric filled, every quote in), follow this loop to produce the v1.

## 1. Place captured screenshots

Per the manifest, save each captured screenshot to:

```
decks/_assets/screenshots/<ID>-<short-name>.png
```

Match the IDs in the manifest exactly. Examples:
- `S08-clockin-success.png`
- `S14-daily-summary.png`
- `S21-offline-banner.png`

Image references in the outline files use relative paths like `../_assets/screenshots/S08-clockin-success.png` and are resolved at build time.

## 2. Fill numbers and quotes in the outline

Edit the deck's outline at `decks/_outlines/NN-<name>.md`. Replace every `<N##>` and `<Q##>` token with the value from the manifest. Example:

```diff
- hero: <N03>
+ hero: 12,847
- label: Verified clock-ins recorded to date.
+ label: Verified clock-ins recorded to date.
```

## 3. Rebuild as v1

Edit the per-deck builder at `decks/_scripts/build_NN_<name>.py` and change the output filename from `-v0.pptx` to `-v1.pptx`. Run:

```powershell
$env:PYTHONPATH = (Resolve-Path "decks/_scripts").Path
python decks/_scripts/build_NN_<name>.py
python decks/_scripts/verify_deck.py "decks/output/NN-<name>-v1.pptx" <expected_slides>
```

Expected slide counts are in each deck's manifest (`**Slide count target:**`).

## 4. Regenerate the suite cover

```powershell
python decks/_scripts/build_suite_cover.py
```

## 5. Commit

```powershell
git add decks/_outlines/NN-<name>.md decks/_scripts/build_NN_<name>.py decks/output/NN-<name>-v1.pptx decks/output/_SUITE-COVER.pdf decks/_assets/screenshots/
git commit -m "feat(decks): deck NN <Title> v1 — real assets"
```

## 6. Mark manifest delivered

In `decks/_manifests/NN-<name>.md`, tick the `delivered` checkbox at the top.

```powershell
git add decks/_manifests/NN-<name>.md
git commit -m "manifests(decks): deck NN delivered"
```

---

## Asset coverage cheat sheet

The aggregate asset list is `decks/_manifests/_INDEX.md`. Capture each screenshot once — multiple decks may consume the same asset.

Major asset clusters:

- **Reception flow** (S01-S07): one Playwright session against `ohcs-smartgate.pages.dev` covers decks 01, 02, 09, 11.
- **Clock-in flow** (S08-S13, S21, S25, S26, S36): one Playwright session against `staff-attendance.pages.dev` covers decks 01, 03, 04, 05, 07, 08, 10.
- **Notifications** (S05, S14, S15, S32): screenshots from the host's / director's Telegram and from iOS lockscreen.
- **Code excerpts** (S17-S20, S28-S31): VS Code, repo, or GitHub views.
- **Admin / observability** (S33-S35): D1 console + `/api/admin/health/push` JSON.
- **Numbers** (N01-N15): one batch D1 query session.
- **Quotes** (Q01-Q06): stakeholder outreach.
