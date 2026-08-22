# Odontogram artwork authoring guide — DENTAL-CHART-ASSET-R3

This is the shared specification every artwork lane authors against. It exists
because the 52 registry entries are written by several people in parallel and
the single biggest failure mode is not a bad tooth — it is 52 *individually
plausible* teeth that do not agree with each other about scale, so the finished
arch reads as a collage instead of a dentition.

Read this file, `anatomy.types.ts`, and the reference plate for your family
before you move a coordinate.

---

## 0. What "professional" means here, concretely

The R2 artwork failed a clinical eye for four specific, fixable reasons. Every
one of them is a rule below, not a matter of taste:

1. **No cervical constriction.** The crowns were widest at the gum line, so the
   crown and root read as one continuous lozenge. A real tooth has a *neck*:
   the crown bulges out at its contact points and pinches back in at the CEJ.
2. **Crown and root drawn as one material.** In every clinical illustration
   the enamel crown is white and the root is warmer dentin/cementum. The R3
   renderer draws them differently; the artwork must give it a clean CEJ to
   split on (§4).
3. **Roots too short and too blunt.** Most teeth are roughly two-thirds root
   by length. R2 drew them about half, with rounded club ends, which is the
   single strongest "cartoon tooth" signal. Do not overcorrect into straight
   chords: see §3.2, and note that the first R3 attempt at this file's own
   tables produced numerically perfect polygons that had to be redrawn.
4. **Made-up proportions.** Every tooth was drawn to fill the same box, so a
   lower central incisor was as wide as a first molar. §2 fixes this with one
   table derived from published mean crown dimensions.

Do not fix these by adding detail. Added detail at 60px is noise. Fix them by
getting the **silhouette** right.

---

## 1. Non-negotiable technical constraints

- **Path commands: `M`, `L`, `C`, `H`, `V`, `Z` only, absolute/UPPERCASE only.**
  The registry test parses paths with a deliberately small parser. Lowercase
  (relative) commands, `S`, `Q`, `T`, and `A` make it fail loudly. This is not
  a limitation to work around — cubics through explicit points are what keeps
  every silhouette editable and mirror-safe.
- **Never pre-apply a transform.** Author for the patient's RIGHT side, lower
  jaw orientation. The renderer flips and mirrors. See `anatomy.types.ts`.
- **Mesial is at LARGE x. Distal is at small x.** Every entry must be
  genuinely asymmetric about `x = 32`, or `sideStrategy: 'mirror'` becomes a
  no-op and the left quadrant becomes a relabelled copy of the right — the
  exact defect this whole workstream exists to fix. A test enforces it.
- **No colour, no status, no opacity in the artwork.** Status is a
  presentation layer applied over anatomy.
- **`simplification` must be a specific, honest admission** of where your
  drawing departs from textbook morphology. Boilerplate is worse than an
  empty string, because the delivery report quotes these verbatim.
- Coordinates to **one decimal place**. More is false precision at 60px.

---

## 2. The shared coordinate system

This is the part that makes 52 independently drawn teeth agree.

### 2.1 Lateral view — `viewBox="0 0 64 88"`

Crown at the top (small y), apex at the bottom (large y), for *every* entry
including upper teeth. Three horizontal reference lines per tooth:

| line | value |
|---|---|
| `INCISAL_Y` — crown's outer (occlusal/incisal) edge | **always `4.0`** |
| `CERVIX_Y` — the CEJ | per-tooth, table below |
| `APEX_Y` — deepest root apex | per-tooth, table below |

`INCISAL_Y = 4.0` for every tooth is a hard rule. The renderer crops each
tooth's viewBox anchored on its own crown edge, so a shared start value is
what lets a reviewer compare two entries by reading the numbers.

Scales used to build the tables: permanent **2.9 units/mm**, primary
**3.8 units/mm** (the primary arch is cropped to its own window, so it is
drawn larger per mm to fill it; proportions *within* the primary set stay
true). Dimensions are published mean crown/root lengths and mesiodistal crown
widths.

**Permanent — lateral**

| key | `CERVIX_Y` | `APEX_Y` | crown MD width | root count |
|---|---|---|---|---|
| `permanent:upper:central_incisor` | 34.5 | 72.0 | 24.6 | 1 |
| `permanent:upper:lateral_incisor` | 30.0 | 68.0 | 18.9 | 1 |
| `permanent:upper:canine` | 33.0 | 82.0 | 21.8 | 1 |
| `permanent:upper:first_premolar` | 28.5 | 69.0 | 20.3 | 2 |
| `permanent:upper:second_premolar` | 28.5 | 70.5 | 20.3 | 1 |
| `permanent:upper:first_molar` | 26.0 | 64.0 | 29.0 | 3 |
| `permanent:upper:second_molar` | 24.5 | 59.0 | 26.1 | 3 |
| `permanent:upper:third_molar` | 23.0 | 55.0 | 24.7 | 3 |
| `permanent:lower:central_incisor` | 30.0 | 66.0 | 14.5 | 1 |
| `permanent:lower:lateral_incisor` | 31.5 | 72.0 | 16.0 | 1 |
| `permanent:lower:canine` | 36.0 | 82.0 | 20.3 | 1 |
| `permanent:lower:first_premolar` | 28.5 | 69.0 | 20.3 | 1 |
| `permanent:lower:second_premolar` | 27.0 | 69.0 | 20.3 | 1 |
| `permanent:lower:first_molar` | 26.0 | 66.5 | 31.9 | 2 |
| `permanent:lower:second_molar` | 24.5 | 62.0 | 30.5 | 2 |
| `permanent:lower:third_molar` | 24.5 | 56.0 | 29.0 | 2 |

**Primary — lateral**

| key | `CERVIX_Y` | `APEX_Y` | crown MD width | root count |
|---|---|---|---|---|
| `primary:upper:central_incisor` | 27.0 | 65.0 | 24.7 | 1 |
| `primary:upper:lateral_incisor` | 25.5 | 69.0 | 19.4 | 1 |
| `primary:upper:canine` | 29.0 | 80.0 | 26.6 | 1 |
| `primary:upper:first_molar` | 23.5 | 61.5 | 27.7 | 3 |
| `primary:upper:second_molar` | 26.0 | 70.5 | 31.2 | 3 |
| `primary:lower:central_incisor` | 23.0 | 57.0 | 16.0 | 1 |
| `primary:lower:lateral_incisor` | 24.0 | 60.0 | 15.6 | 1 |
| `primary:lower:canine` | 27.0 | 71.0 | 19.0 | 1 |
| `primary:lower:first_molar` | 27.0 | 64.0 | 29.3 | 2 |
| `primary:lower:second_molar` | 25.0 | 68.0 | 37.6 | 2 |

Crown MD width is the width **at the contact points** (the widest part of the
crown), centred on `x = 32` but *not* symmetric about it — see §3.

`widthRatio` should be set to `crown MD width / 24.6` (the permanent upper
central incisor). It is currently informational metadata only — column pitch
is uniform — but keep it truthful.

### 2.2 Occlusal / incisal view — `viewBox="0 0 64 64"`

Buccal at the top (small y), lingual/palatal at the bottom (large y). Mesial
at large x, distal at small x. Footprint centred on `(32, 32)`.

Scales: permanent **4.4 units/mm**, primary **4.8 units/mm**.

**Permanent — occlusal footprint (MD width × BL depth, in units)**

| key | MD (x extent) | BL (y extent) |
|---|---|---|
| `permanent:upper:central_incisor` | 37.4 | 30.8 |
| `permanent:upper:lateral_incisor` | 28.6 | 26.4 |
| `permanent:upper:canine` | 33.0 | 35.2 |
| `permanent:upper:first_premolar` | 30.8 | 39.6 |
| `permanent:upper:second_premolar` | 30.8 | 39.6 |
| `permanent:upper:first_molar` | 44.0 | 48.4 |
| `permanent:upper:second_molar` | 39.6 | 48.4 |
| `permanent:upper:third_molar` | 37.4 | 44.0 |
| `permanent:lower:central_incisor` | 22.0 | 26.4 |
| `permanent:lower:lateral_incisor` | 24.2 | 28.6 |
| `permanent:lower:canine` | 30.8 | 33.0 |
| `permanent:lower:first_premolar` | 30.8 | 33.0 |
| `permanent:lower:second_premolar` | 30.8 | 35.2 |
| `permanent:lower:first_molar` | 48.4 | 46.2 |
| `permanent:lower:second_molar` | 46.2 | 44.0 |
| `permanent:lower:third_molar` | 44.0 | 41.8 |

**Primary — occlusal footprint**

| key | MD (x extent) | BL (y extent) |
|---|---|---|
| `primary:upper:central_incisor` | 31.2 | 24.0 |
| `primary:upper:lateral_incisor` | 24.5 | 19.2 |
| `primary:upper:canine` | 33.6 | 33.6 |
| `primary:upper:first_molar` | 35.0 | 40.8 |
| `primary:upper:second_molar` | 39.4 | 48.0 |
| `primary:lower:central_incisor` | 20.2 | 19.2 |
| `primary:lower:lateral_incisor` | 19.7 | 19.2 |
| `primary:lower:canine` | 24.0 | 23.0 |
| `primary:lower:first_molar` | 37.0 | 33.6 |
| `primary:lower:second_molar` | 47.5 | 41.8 |

Stay within ±1.5 units of the tabulated extent. These numbers are the whole
reason a molar will read as bigger than an incisor: the renderer crops one
shared window across the dentition, so relative footprint is preserved
exactly as authored and *cannot* be recovered later.

---

## 3. Silhouette rules (this is where "professional" is won or lost)

### 3.1 The cervical constriction — mandatory for every lateral entry

Walking down one side of a crown you must pass three distinct x values:

```
        y = 4.0     ── incisal/occlusal edge, NARROWER than the contact point
        y ≈ 4.0 + 0.35 × crownHeight   ── HEIGHT OF CONTOUR: the widest point
        y = CERVIX_Y ── the neck: 0.72–0.80 × the crown MD width
```

- Anteriors: height of contour in the **incisal third** (≈ 0.3 of the way
  down) on the labial side.
- Posteriors: height of contour in the **cervical third** on the buccal side,
  but the crown must still pinch in over the last few units before the CEJ.
- **The crown's width at `CERVIX_Y` and the root's width at `CERVIX_Y` must be
  the same number.** This is what makes the crown and the root read as one
  tooth once they are painted in two different colours.
- **The crown contour must be curved too** — minimum 6 `C` segments, with the
  mesial and distal contours bowing outward through the height of contour and
  curving back in to the CEJ. No straight vertical sides. A 4-curve/2-line loop
  is a rounded hexagon and reads as a box.
- The incisal/occlusal edge is **narrower than the contact points**, not the
  full crown width.

### 3.2 Roots

- A root **tapers continuously** from its cervical width to a **narrow, rounded
  apex** — about 2.5-4 units across measured 2.5 units up from the tip, never a
  flat cap, never a rounded club, never a needle point.
- **Every root contour must be CURVED.** Minimum 4 `C` segments per root, and no
  straight `L` on the mesial or distal contour. This is a hard rule with a
  history: the first R3 permanent lateral pass hit every number in §2.1 exactly
  and was still rejected on sight, because its single roots contained ZERO
  curve commands. A straight-sided cone reads as a carrot, and it is the
  loudest "this was generated, not drawn" signal in the whole glyph. Measuring
  correctly is necessary and not sufficient.
- A root leaves the CEJ almost vertically, the taper accelerates through the
  middle third, and it eases into the apex. It is slightly convex overall.
- Multi-rooted teeth: draw the **root trunk** as part of each root path from
  `CERVIX_Y` down to the furcation, then diverge. The furcation sits roughly
  **0.3 of the way** from the CEJ to the apex on permanent molars, and much
  **closer to the CEJ (~0.15)** on primary molars — that high furcation plus the
  flare below it is the primary-molar signature.
- **Divergence is a lyre, not a letter V.** Roots separate at the furcation,
  reach maximum separation in the middle third, and their apices then curve
  back IN toward each other. Measured off the plates, as a fraction of that
  tooth's own crown mesiodistal width:

  | | widest separation | separation at the apices |
  |---|---|---|
  | permanent multi-rooted | 0.80 - 1.10 | 0.40 - 0.75 |
  | primary molars | 0.90 - 1.25 | 0.60 - 1.00 |

  Apex separation must always be strictly less than the widest separation.
  Note the useful consequence: because the apices turn back inward, a
  compliant root *cannot* be a straight line — the divergence rule and the
  curve rule are satisfied by the same drawing.
- **Root order in the `roots` array: palatal/lingual root FIRST.** The renderer
  paints in array order, so the first entry sits behind and the furcation reads
  as depth. Applies to upper molars, upper first premolar and primary upper
  molars.
- Upper molars are **3-rooted**: mesiobuccal and distobuccal roots make the
  visible pincer, palatal root behind and between them, drawn wider, straighter
  and slightly longer. Lower molars are **2-rooted**: mesial (broader, hooking
  distally near the apex — that hook is much of why the pair reads as anatomy)
  and distal (narrower, straighter).
- Roots must start **~2 units above `CERVIX_Y`** so the crown, painted on top,
  always overlaps them. A visible seam between crown and root is a bug.
- **Match the tangent at the CEJ, not just the width.** If the crown's contour
  arrives at the cervical line travelling in a different direction from the one
  the root's contour departs in, the junction reads as a step even when both
  widths are identical to the decimal.

### 3.3 Mesiodistal asymmetry — required, and specific

Generic asymmetry is not enough; use the real distinctions:

- **Incisors:** mesioincisal angle sharp and nearly square; distoincisal angle
  visibly rounded. Distal contour more convex, its height of contour lower
  (closer to the CEJ) than the mesial one.
- **Canines:** cusp tip displaced **mesially** off the crown midline. The
  mesial cusp slope is **shorter** than the distal slope. Root leans distally.
- **Premolars:** buccal cusp tip slightly distal of centre on the upper first
  premolar; mesial marginal-ridge developmental groove on the upper first
  premolar only.
- **Molars:** crown tapers narrower toward the distal; the distal contour is
  more rounded, the mesial more nearly flat. Buccal cervical ridge present.

### 3.4 Occlusal outlines

- These are **crown silhouettes seen from the biting surface**, not blobs.
  Cusp tips are gentle convexities on the outline, not spikes.
- Upper molars: **rhomboidal** (mesiobuccal and distolingual corners acute).
  First molar has four well-developed cusps plus the oblique ridge; the second
  molar's distolingual cusp is markedly reduced; the third molar is smaller,
  rounder, heart-shaped, effectively three-cusped.
- Lower molars: **rectangular/pentagonal**, wider mesiodistally than
  buccolingually. First molar five cusps (the fifth, distal, cusp on the
  distobuccal corner) with a Y-shaped fissure; second molar four cusps with a
  cross-shaped fissure; third molar smaller and rounder.
- Premolars: upper are **oval, longer buccolingually than mesiodistally**;
  lower first premolar is round with a much smaller lingual cusp; lower second
  premolar is squarer.
- Anteriors: incisal view is a **wedge** — wide mesiodistally, shallow
  buccolingually, with the cingulum as a bulge on the lingual edge. The canine
  is a rounded diamond with a labial point at the cusp tip.
- Primary molar occlusal outlines must **not** be scaled-down permanent
  molars: the primary upper first molar is atypical and narrow with a
  prominent mesiobuccal cervical bulge; the primary second molars resemble the
  permanent first molar of the same arch.

### 3.5 The five-surface tiling contract — do not break it

`outline` and the five `surfaces` must tile with no gap and no overlap. The
mechanism is documented at the top of `occlusalGeometry.ts` and is
**byte-identity of shared edge strings**: build the four outer edges as four
JavaScript string constants, concatenate them for `outline`, and reuse the
*same* string in the matching peripheral surface. Never re-type a curve.

This is what lets a future per-surface restorative chart plug in without a
redraw, and it is verified by a test.

---

## 4. What the renderer does with your paths

So you know what your silhouette has to survive:

- `crown` is filled **enamel white** and stroked; `roots` are filled a warmer
  **dentin** tone and stroked slightly lighter, painted *underneath* the crown.
- `cervical` is stroked faintly across the CEJ.
- `surface` strokes (mamelons, cusp ridges, developmental grooves) are drawn
  at low opacity — they are texture, not structure. If your tooth only reads
  correctly *with* them, the silhouette is wrong.
- Status recolours crown and root together; `missing` replaces everything with
  a dashed ghost outline plus an X sized from the crown bbox.

---

## 5. Self-check before you hand your files back

- [ ] Every path uses only absolute `M L C H V Z`.
- [ ] Every crown starts at `y = 4.0` and every `CERVIX_Y` / `APEX_Y` matches
      the table in §2 within ±0.5.
- [ ] Crown MD width matches the table within ±1.0, measured at the contact
      points.
- [ ] Crown width at the CEJ is 0.72–0.80 of the crown MD width, and the
      root's cervical width is the same number.
- [ ] Roots start ~2 units above `CERVIX_Y`; apex is 2.5-4 units across and
      rounded.
- [ ] Crown has >= 6 curve segments; every root has >= 4 and no straight
      segment on its mesial or distal contour.
- [ ] Multi-rooted: widest and apex separations are inside the §3.2 table, and
      the apices are closer together than the widest point.
- [ ] Your rewrite has no FEWER curve segments than the entry it replaced.
- [ ] Root count matches §2 exactly (a test pins this).
- [ ] Palatal/lingual root is first in the array where applicable.
- [ ] The crown is genuinely asymmetric about `x = 32` for a *stated*
      anatomical reason.
- [ ] Occlusal extents match §2.2 within ±1.5.
- [ ] Occlusal surfaces reuse the outline's edge strings byte-for-byte.
- [ ] `simplification` names a real, specific departure from textbook
      morphology.
- [ ] No `NaN`, no `undefined`, no `Infinity` anywhere in a path string.

---

## 6. Reference plates

`design/dental-chart/reference-plates/` — morphology guidance only.

**Do not trace them, do not embed them, do not reuse their typography or
layout.** Look at the plate, understand the form, then build the silhouette
from the coordinate system above. The plates are not committed to the
repository; see the README in that directory.
