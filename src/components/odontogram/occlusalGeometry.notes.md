# occlusalGeometry.ts — design notes (Lane C)

## Corner/edge scheme

Every crown is authored from four **outer** corners — `DB` (distobuccal),
`MB` (mesiobuccal), `ML` (mesiolingual), `DL` (distolingual) — walked
clockwise, each edge optionally carrying extra points for cusp tips,
marginal-ridge bulges, or a cingulum, plus four **inner** corners
(`DBi`/`MBi`/`MLi`/`DLi`) forming the central table/incisal-edge band.

- `outline` = all four outer edges walked round.
- `central` = the four inner corners walked round (straight `L`s, unchanged
  by the curve round below).
- Each peripheral surface (`buccal`, `mesial`, `lingual`, `distal`) = its
  outer edge, closed by cutting straight in to the two matching inner
  corners and back to the edge's start point.

Because every surface shares its corner vertices with its neighbours
exactly, the five regions tile the outline by construction — no gap, no
overlap — independent of how ornate the outer edge gets (extra cusp points
just add more vertices to walk, the closing rule doesn't change). This was
verified for all 26 entries: the shoelace area of `outline` matches the
summed shoelace area of the five `surfaces` to within floating-point
rounding for every tooth.

## Refinement round: curved outer edges (post-review)

The first drop used straight `L` chords for the four outer edges, which read
as faceted "cut-gem" polygons once the occlusal row was magnified in the
renderer's shared crop. Fix: every outer edge is now a run of cubic Bezier
(`C`) commands computed by a uniform Catmull-Rom → Bezier conversion around
the full closed loop of outline points (standard 1/6-tension formula), so
the curve still passes exactly through every corner and cusp/notch/bulge
point that was there before — nothing was deleted or repositioned, only the
connective tissue between points changed from a straight line to an arc.
`central` and `detail` were not touched.

The tiling contract survives this unchanged because each peripheral
surface's outer-edge run is not independently re-curved — it is the exact
same JS string as the corresponding run inside `outline` (computed once per
edge, reused verbatim in both places). Flattening every `C` into line
segments and comparing the shoelace area of `outline` against the summed
area of the five `surfaces` gives a worst-case mismatch of **0.0000%**
across all 26 entries (both sides flatten the identical string, so any
mismatch would be a bug in the flattening, not the geometry). A direct
substring check (does `outline` contain, verbatim, the `C`-command run each
surface uses for its edge) also passes for all 26 × 4 peripheral surfaces.

Third molars and the primary upper first molar curve too, but their control
points were authored irregular/asymmetric to begin with (fused cusps,
off-centre bumps), so they still read as the more irregular, less
"textbook" forms real third molars and that atypical primary molar are —
curving didn't regularize them.

## Coordinates were hand-designed, then hand-assembled by a formula

Every corner, cusp bump, and inner-table point in this file is a
deliberate anatomical choice (cusp count, asymmetry direction, relative
footprint size — see the per-family comments in `occlusalGeometry.ts` and
the task brief). A throwaway Node script (not part of the repo) applied the
corner-walking rule above to turn those chosen points into path strings
mechanically, so a transcription slip couldn't silently break the tiling
contract; the resulting path data was reviewed per tooth before being
placed in the object literal. Nothing in the shipped file is generated at
import time — `OCCLUSAL_ART` is a plain object literal.

## Footprint sizing

Relative outline size follows Wheeler's average crown-dimension ordering
(mesiodistal × buccolingual), scaled into the 64×64 viewBox with the
permanent upper/lower first molars as the largest entries and lower
incisors as the smallest. Verified: `permanent:lower:first_molar` outline
area > `permanent:lower:second_premolar` > `permanent:lower:central_incisor`
(958.5 > 390.0 > 136.0 in view-box units², shoelace on the outline path).

## Asymmetry

All 26 entries use `sideStrategy: 'mirror'` with genuine mesiodistal
asymmetry (mesial-side corners/cusps placed differently from distal-side
ones), including the lower incisors, whose real asymmetry is minimal — they
are still broken by at least ~1-2 units so the mirrored left quadrant is
not a pixel-identical no-op. No entry uses `'symmetric'`.

## What's deliberately not modelled

See the `simplification` string on each entry (quoted verbatim in the
delivery report). In general: exact anastomosing fissure patterns are
idealised to 2-5 straight strokes, minor accessory cusps (Carabelli) are a
mark rather than a separate facet, and root/pulpal anatomy is out of scope
for this file entirely (occlusal view only).
