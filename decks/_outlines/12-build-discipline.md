## [cover]
title: The Build Discipline
subtitle: Spec, plan, execute — every time
tier: thematic
audience: Executive Leadership
version: 0
date: 2026-05-28

## [divider]
line: The polish you can feel is the by-product of a process you can read.

## [toc]
- The discipline — every feature has a spec
- The artefact — `docs/superpowers/`
- The result — code you can trust

## [statement]
headline: Every feature has a spec.
sub: Before code, a written design. Before tasks, an approved plan.

## [evidence]
title: The spec/plan tree
image: ../_assets/screenshots/S28-docs-tree.png
bullets:
    - One spec per feature.
    - One plan per spec.
    - Both committed to the repo.
caption: docs/superpowers/, captured today.

## [evidence]
title: A representative spec
image: ../_assets/screenshots/S29-spec-rendered.png
bullets:
    - Goal, architecture, requirements.
    - Approved by the user before any code is touched.
    - Lives in the repo forever — audit trail by default.
caption: docs/superpowers/specs/2026-04-18-security-hardening-design.md.

## [evidence]
title: A representative plan
image: ../_assets/screenshots/S30-plan-rendered.png
bullets:
    - Atomic tasks — 2 to 5 minutes each.
    - Test before code where it makes sense.
    - Commit after every task.
caption: docs/superpowers/plans/...

## [wow]
hero: <N14>
label: Design specs in the repo. Each one a feature shipped with intention.

## [statement]
headline: The retrace fix was specced, planned, executed.
sub: Geofence precision — a single 30-minute design conversation, then atomic tasks until done.

## [evidence]
title: The retrace fix in code
image: ../_assets/screenshots/S17-geofence-commit.png
bullets:
    - Spec written, plan written, commit landed — same day.
    - Reviewable as a unit.
    - Reversible if needed.
caption: Commit 59b564a.

## [statement]
headline: Lines of TypeScript across packages/.
sub: <N15> lines. Strict mode throughout. No `any` without justification.

## [statement]
headline: The discipline is the moat.
sub: Another team could ship the same features. They couldn't ship them this carefully without writing it down first.

## [divider]
line: The system is good because the process was patient.

## [appendix]
links:
    - github.com/ghwmelite-dotcom/OHCS-SmartGate-Staff-Attendance-System/tree/main/docs/superpowers
related:
    - Deck 04 · Security & Trust
    - Deck 07 · GPS Geofence Precision
