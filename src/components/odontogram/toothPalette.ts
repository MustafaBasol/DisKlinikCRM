/**
 * toothPalette.ts — DENTAL-CHART-ASSET-R3
 *
 * The one place that decides what an unstyled tooth is made of.
 *
 * WHY THIS EXISTS
 * ---------------
 * R3 renders the clinical crown and the root as two different MATERIALS —
 * bluish-white enamel over warm ivory dentin, split at the CEJ — because that
 * split is the single strongest "this is a clinical illustration and not an
 * icon" cue available at chart size, and it costs one extra fill. Getting it
 * consistent matters more than getting it exactly right, and it has to be
 * consistent across two very different consumers:
 *
 *   - `ToothGlyph.tsx` renders inside the app, where colour arrives as
 *     Tailwind utility classes so the whole thing follows the dark-mode
 *     variant machinery for free;
 *   - `scripts/dental-assets/exportToothSvgs.ts` writes 104 STANDALONE `.svg`
 *     files that have no stylesheet at all and therefore need literal values.
 *
 * Two hard-coded palettes would drift the first time someone warmed the dentin
 * tone, and the drift would be invisible until a designer opened an exported
 * file next to the running app. So both consumers read this module, and the
 * two representations sit on adjacent lines where a mismatch is obvious.
 *
 * NOT A STATUS PALETTE. Clinical status colour lives in `TOOTH_STATUS_META`
 * (dentalChart.types.ts) and is layered OVER these base materials. Nothing
 * here knows a status exists.
 */

/** Tailwind utility classes — the in-app representation. */
export const TOOTH_MATERIAL_CLASS = {
  /** Clinical crown. Cool, near-white, the lightest thing in the glyph. */
  enamelFill: 'fill-[#fbfdfe] dark:fill-[#e8eef2]',
  /** Root. Warm ivory, clearly but not garishly distinct from the crown. */
  dentinFill: 'fill-[#f0e6d2] dark:fill-[#c9b896]',
  /** Crown outline. Carries the silhouette, so it is the strongest stroke. */
  enamelStroke: 'stroke-slate-500 dark:stroke-slate-300',
  /** Root outline. One step back so the crown stays dominant. */
  dentinStroke: 'stroke-[#a1866a] dark:stroke-[#8a7255]',
  /** The CEJ line across the crown/root junction. */
  cervicalStroke: 'stroke-[#b39a7c] dark:stroke-[#9a8465]',
  /** Mamelons, cusp ridges, developmental grooves — texture, not structure. */
  surfaceStroke: 'stroke-slate-400 dark:stroke-slate-400',
} as const;

/**
 * Literal colours for standalone export — the SAME palette as above.
 *
 * Light-theme values only: an exported `.svg` is a design artefact opened in a
 * viewer or dropped into a document, not a themed application surface. The
 * `dark:` half of each pair above has no meaning outside the app.
 */
export const TOOTH_MATERIAL_HEX = {
  enamelFill: '#fbfdfe',
  dentinFill: '#f0e6d2',
  enamelStroke: '#64748b',
  dentinStroke: '#a1866a',
  cervicalStroke: '#b39a7c',
  surfaceStroke: '#94a3b8',
} as const;

/**
 * Stroke widths in AUTHORED path units (the 64x88 / 64x64 coordinate space),
 * shared by the app renderer and the exporter so a tooth has the same visual
 * weight in both.
 *
 * The hierarchy is load-bearing: crown outline > root outline > cervical line
 * > surface texture. A flat hierarchy is what made the R2 glyphs read as
 * line-art icons — everything shouted equally, so nothing described a form.
 */
export const TOOTH_STROKE_WIDTH = {
  crown: 1.9,
  root: 1.5,
  cervical: 1.1,
  surface: 0.9,
  occlusalOutline: 1.6,
  occlusalDetail: 0.9,
} as const;

/** Opacity for the non-structural strokes. Same rationale as the widths. */
export const TOOTH_STROKE_OPACITY = {
  cervical: 0.75,
  surface: 0.55,
  occlusalDetail: 0.5,
} as const;

export type ToothMaterialClass = typeof TOOTH_MATERIAL_CLASS;
export type ToothMaterialHex = typeof TOOTH_MATERIAL_HEX;
