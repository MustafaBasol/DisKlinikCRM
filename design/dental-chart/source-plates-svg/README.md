# Source plate SVGs — DENTAL-CHART-ASSET-R4B

Eleven hand-traced vector reference plates, one per family group, prepared
outside this repo and used as morphology guidance while refining the vector
odontogram assets in `src/components/odontogram/lateral/` and `.../occlusal/`.
They supersede `../reference-plates/` (raster study plates, gitignored) as
the primary reference set — these are vector, higher fidelity, and small
enough to commit.

Like the raster plates they replace: **morphology guidance only**. They were
not traced into production paths and nothing under `src/` references them.
Shipped assets are still hand-authored SVG path data built against the
shared coordinate system in `../AUTHORING.md`. Each plate is a painted
illustration (thousands of tiny shading strokes per tooth, not a clean
traceable outline), so treat it the way `../AUTHORING.md` §6 already
instructs: look at the plate, understand the form, then build the silhouette
from the coordinate system — do not attempt to extract path data from it
programmatically.

```
01_permanent_upper_incisors_canine.svg    → 11, 12, 13
02_permanent_upper_premolars.svg          → 14, 15
03_permanent_upper_molars.svg             → 16, 17, 18
04_permanent_lower_incisors_canine.svg    → 41, 42, 43
05_permanent_lower_premolars.svg          → 44, 45
06_permanent_lower_molars.svg             → 46, 47, 48
07_primary_upper_incisors_canine.svg      → 51, 52, 53
08_primary_upper_molars.svg               → 54, 55
09_primary_lower_incisors_canine.svg      → 81, 82, 83
10_primary_lower_molars.svg               → 84, 85
11_permanent_upper_left_incisors_canine.svg → 21, 22, 23 (supplemental —
   left-side mirror check for plate 01; not a distinct reference)
```

## Crown/root orientation is NOT consistent across these plates — check before use

Every plate draws crown enamel in a lighter, glossier tone and root
dentin/cementum in a warmer, duller tone, with a visible seam at the CEJ —
but **which end of the image is the crown is not the same plate to plate**:

| plate | crown is at the... |
|---|---|
| 01 (permanent upper incisors/canine) | **bottom** (root points up) |
| 02 (permanent upper premolars) | top (standard) |
| 03 (permanent upper molars) | top (standard) |
| 04 (permanent lower incisors/canine) | top (standard) |
| 05 (permanent lower premolars) | top (standard) |
| 06 (permanent lower molars) | top (standard) |
| 07 (primary upper incisors/canine) | **bottom** (root points up) |
| 08 (primary upper molars) | top (standard) |
| 09 (primary lower incisors/canine) | **bottom** (root points up) |
| 10 (primary lower molars) | top (standard) |
| 11 (permanent upper left incisors/canine) | **bottom** (root points up), matches 01 |

Four of the eleven plates — every incisor/canine plate except plate 04 — are
drawn root-up/crown-down. There is no discoverable rule behind this (it is
not "upper only": plate 04 is upper... no, plate 04 is lower and standard,
while plate 09 is also lower but flipped; it is not "primary only" either).
Treat orientation as a fact to verify per plate, not something to infer from
a neighbor. Confirmed by two independent signals checked together: the
crown/root color transition, and the presence of crown-only features (cusp
facets, twin premolar cusps, the multi-root furcation) which never appear on
a root.

None of the eleven plates show roots for the anterior teeth (incisors,
canines) — those images are the crown seen from one continuous silhouette
with no root drawn at all beneath the CEJ-equivalent color seam. Root
morphology guidance for anteriors still comes only from `../AUTHORING.md`
§3.2 and the (gitignored) raster plates in `../reference-plates/`.

## R4B outcome

A full extraction pass was ruled out: each plate's paths are large painted
regions with thousands of subpaths (shading strokes), not a small number of
clean traceable outlines — confirmed by parsing the `d` attributes before
any redraw work started. The plates were instead used as intended, per
`../AUTHORING.md` §6: reviewed side-by-side against every existing crown and
occlusal silhouette in `../final-svg/`. Most families already matched well.
The concrete, plate-driven change made in R4B: the four primary anterior
occlusal outlines (`primary:upper:central_incisor`, `primary:upper:lateral_incisor`,
`primary:lower:central_incisor`, `primary:lower:lateral_incisor` in
`../../../src/components/odontogram/occlusal/primary.ts`) were redrawn
rounder/more oval — the plates show deciduous incisors reading distinctly
more bulbous than the permanent "wedge" `../AUTHORING.md` §3.4 describes,
consistent with real primary crowns having seen no occlusal wear. Everything
else reviewed (permanent crowns/roots, permanent and primary molar/premolar
silhouettes, primary canines) already matched its plate's family character
and was left unchanged rather than redrawn for its own sake.
