# occlusalGeometry.ts — design notes (Lane C)

## Corner/edge scheme

Every crown is authored from four **outer** corners — `DB` (distobuccal),
`MB` (mesiobuccal), `ML` (mesiolingual), `DL` (distolingual) — walked
clockwise, each edge optionally carrying extra points for cusp tips,
marginal-ridge bulges, or a cingulum, plus four **inner** corners
(`DBi`/`MBi`/`MLi`/`DLi`) forming the central table/incisal-edge band.

- `outline` = all four outer edges walked round.
- `central` = the four inner corners walked round.
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
