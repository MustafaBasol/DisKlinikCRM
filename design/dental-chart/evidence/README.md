# Visual evidence — DENTAL-CHART-ASSET-R3

Screenshots of the REAL components rendering deterministic fixtures, captured
from `odontogram-harness.html` (see `src/devHarness/`). The harness imports
`Odontogram`, `ToothGlyph` and `ToothDetailPanel` directly with no API, no auth
and no router, so these are pictures of the shipped implementation rather than
mock-ups of it.

Reproduce with `npm run dev`, then `/odontogram-harness.html?scene=<id>`.

## Before

| file | what it shows |
|---|---|
| `before/01_matrix_adult_BEFORE.jpg` | The R2 artwork this task replaced, same scene as `after/01`. |

The before/after pair is the point: same component, same fixtures, same scene
id. What changed is the artwork registry and the material rendering.

Quantified alongside it: the R2 artwork failed **10 of the 14** assertions in
`odontogramProportions.test.ts` — no cervical constriction anywhere, upper
molar CEJs up to 15 units off their anatomical position, crown and root
different widths at the junction. The current artwork passes **19 of 19**.

## After

| file | scene | what it demonstrates |
|---|---|---|
| `after/01_morphology_matrix_adult.jpg` | `matrix-adult` | One tooth per permanent family, upper and lower. Incisor / canine / premolar / molar are visibly different drawings, not one repeated icon. |
| `after/02_morphology_matrix_primary.jpg` | `matrix-primary` | The deciduous set: bulbous crowns, narrow root trunks, high furcations, divergent roots. No primary tooth reads as a small permanent one, and there are no primary premolars. |
| `after/03_full_adult_arch.jpg` | `adult-empty` | All 32 permanent teeth, no statuses. Frameless, dual-view, R/L markers, quadrant chips, FDI numbers, occlusal midline. |
| `after/04_adult_arch_statuses.jpg` | `adult-status` | Representative statuses across both arches and all four quadrants. |
| `after/05_full_primary_arch_statuses.jpg` | `primary-status` | All 20 primary teeth with statuses. |
| `after/06_selected_tooth_detail_panel.jpg` | `selected-detail` | Selection spanning both views of tooth 16, plus the detail panel: status, quick-status grid, notes, treatment timeline. |
| `after/07_narrow_viewport_620px.jpg` | `narrow` | 16 teeth per row at 620px. Everything stays legible and in register. |
| `after/08_restorations_crown_missing_implant.jpg` | `restorations` | Crown restoration with its margin line, missing teeth as dashed ghosts with an X, and implants seated on the tooth's own cervical line. |
| `after/09_left_right_pairing.jpg` | `sides-closeup` | Contralateral pairs side by side (16/26, 13/23, 14/24, 46/36, 43/33). Antimeres really are mirror images, so mirroring is correct anatomy rather than a shortcut — and the forms are asymmetric enough that the mirror is visible. |
| `after/10_fullscreen_presentation.jpg` | `fullscreen` | Presentation size, the mode a dentist uses to show a patient. |
| `after/11_asset_contact_sheet.jpg` | — | `design/dental-chart/asset-contact-sheet.html`: all 104 exported SVGs in arch reading order. |
| `after/12_dark_mode_adult_arch.jpg` | `adult-status` + `.dark` | The enamel/dentin palette under dark mode. |

## What these do NOT show

- The chart inside the authenticated patient page. The harness renders the
  same components with injected records; routing, fetching and permissions are
  unchanged by this work and are covered by their own tests.
- Print output. Not in scope for this task.
