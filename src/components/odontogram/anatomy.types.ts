/**
 * anatomy.types.ts — DENTAL-CHART-UX-001-R2
 *
 * The contract between the people who DRAW teeth and the component that
 * RENDERS them. Nothing in this file knows about clinical status, records,
 * tenants or React: artwork is anatomy, status is a presentation layer applied
 * on top of it (see section I of the task). Baking a colour or a state into a
 * path would make every future status change an artwork change.
 *
 * ── CANONICAL AUTHORING ORIENTATION ────────────────────────────────────────
 *
 * Both views are authored ONCE, for a tooth of the patient's RIGHT side, and
 * transformed into the other three quadrants by the renderer. Authors must not
 * pre-apply any of these transforms.
 *
 * LATERAL (buccal/facial) view — viewBox "0 0 64 88":
 *   - crown at the TOP (small y), root apices at the BOTTOM (large y);
 *     i.e. authored in LOWER-JAW orientation, unchanged from R1 so the
 *     existing flip, sizing and hit-area code keeps working;
 *   - cervical line at y around 36-42;
 *   - MESIAL (towards the midline) is at LARGE x, DISTAL at small x.
 *     This is the axis that R1 had no concept of, and it is the whole reason
 *     the R1 chart read as one repeated icon: a tooth drawn symmetrically
 *     about x=32 looks identical to its own mirror image, so the right and
 *     left quadrants could not be told apart.
 *   - The renderer applies "translate(0 88) scale(1 -1)" for UPPER teeth and
 *     "translate(64 0) scale(-1 1)" for LEFT-side teeth.
 *
 * OCCLUSAL / INCISAL view — viewBox "0 0 64 64":
 *   - BUCCAL (cheek/lip side) at the TOP (small y), LINGUAL/PALATAL at the
 *     bottom (large y);
 *   - MESIAL at LARGE x, DISTAL at small x — same axis convention as the
 *     lateral view, so one horizontal mirror flips BOTH views consistently;
 *   - The renderer mirrors horizontally for LEFT-side teeth and flips
 *     vertically for the LOWER arch, so that in the finished chart the buccal
 *     surface of every tooth points AWAY from the occlusal midline — which is
 *     how a paper odontogram is read.
 *
 * ── WHY MIRRORING IS ANATOMY, NOT A SHORTCUT ───────────────────────────────
 *
 * Contralateral teeth are antimeres: tooth 13 and tooth 23 genuinely ARE
 * mirror images of one another, so producing the left side by reflecting the
 * right side is anatomically correct rather than a saving. The thing that is
 * NOT acceptable is authoring a mesiodistally symmetric form, because then the
 * reflection is a no-op and the two quadrants become the same picture. Every
 * sideStrategy 'mirror' entry therefore carries an obligation: the form must
 * have a real mesial/distal difference. 'symmetric' is reserved for the
 * handful of forms where the lateral silhouette genuinely has no useful
 * mesiodistal asymmetry at chart size, and it must be justified in a comment.
 */

import type { Dentition } from '../toothGeometry';
import type { ToothArch, ToothFamily, ToothIdentity } from './toothIdentity';

/**
 * Families that exist in the deciduous arch. Excluding the premolars and the
 * third molar at TYPE level is what makes it impossible to ship an artwork
 * registry containing a primary premolar — the single most visible way a
 * paediatric odontogram can be wrong.
 */
export type PrimaryToothFamily = Exclude<
  ToothFamily,
  'first_premolar' | 'second_premolar' | 'third_molar'
>;

export type PermanentAnatomyKey = `permanent:${ToothArch}:${ToothFamily}`;
export type PrimaryAnatomyKey = `primary:${ToothArch}:${PrimaryToothFamily}`;

/**
 * Key into either artwork registry. The union is deliberately exact: a
 * Record<AnatomyKey, T> is 16 permanent + 10 primary = 26 entries and the
 * compiler rejects both a missing entry and an impossible one.
 */
export type AnatomyKey = PermanentAnatomyKey | PrimaryAnatomyKey;

export type AnatomyRegistry<T> = Readonly<Record<AnatomyKey, T>>;

/** How the left side of the arch is produced from the authored right side. */
export type SideStrategy =
  /** Reflect horizontally. Correct for any form with real mesiodistal shape. */
  | 'mirror'
  /**
   * Draw identically on both sides. Only legitimate where the silhouette has
   * no meaningful mesiodistal asymmetry at chart size; every use must say why
   * in a comment next to the entry.
   */
  | 'symmetric';

export interface LateralToothArt {
  /** Closed outline of the clinical crown. Required, non-empty. */
  crown: string;
  /**
   * One closed path per root, in draw order — palatal/lingual root FIRST so
   * the buccal roots paint over it and the trifurcation reads as depth.
   * Required, at least one entry.
   */
  roots: string[];
  /** Open strokes: cusp ridges, developmental grooves, mamelons. */
  surface: string;
  /** Open stroke along the cervical line (crown/root junction). */
  cervical: string;
  /**
   * Relative mesiodistal crown width, where 1.0 is a permanent upper central
   * incisor. Drives the column width in the arch so molars are visibly wider
   * than incisors instead of every tooth sitting in an identical box.
   */
  widthRatio: number;
  sideStrategy: SideStrategy;
  /**
   * Free text stating any deliberate simplification of the real morphology,
   * so the delivery report can list them honestly instead of implying the
   * drawing is a textbook illustration. Empty string when none.
   */
  simplification: string;
}

/**
 * The five addressable regions of an occlusal/incisal view.
 *
 * FUTURE SURFACE CHARTING IS THE ENTIRE POINT OF THIS SHAPE. Each field is a
 * CLOSED path that tiles the crown outline, and the renderer emits each one as
 * its own element carrying data-surface. Persisting per-surface findings later
 * therefore needs a fill colour and a click handler, not a redraw — and this
 * task deliberately adds NO database field for it.
 */
export interface OcclusalSurfaces {
  mesial: string;
  distal: string;
  buccal: string;
  /**
   * The tongue-facing surface. Called PALATAL on upper teeth and LINGUAL on
   * lower ones; one field carries both because it is one surface, and the
   * renderer picks the right word for the accessible label from the arch.
   */
  lingual: string;
  /**
   * The occlusal table on posteriors, the incisal edge zone on anteriors.
   * Named once so a future surface chart has a fifth addressable region
   * without a posterior/anterior special case.
   */
  central: string;
}

export const OCCLUSAL_SURFACE_NAMES = [
  'mesial',
  'distal',
  'buccal',
  'lingual',
  'central',
] as const;

export type OcclusalSurfaceName = (typeof OCCLUSAL_SURFACE_NAMES)[number];

export interface OcclusalToothArt {
  /**
   * Closed outline of the whole crown seen from the occlusal/incisal aspect.
   * Drawn as the stroked silhouette; the surface tiles sit inside it.
   */
  outline: string;
  /** Individually addressable surface regions — see OcclusalSurfaces. */
  surfaces: OcclusalSurfaces;
  /**
   * Open strokes for the fissure pattern (central/mesiobuccal/distolingual
   * grooves on molars, the central groove on premolars, the incisal edge on
   * anteriors). Detail only — never load-bearing for surface addressing.
   */
  detail: string;
  sideStrategy: SideStrategy;
  simplification: string;
}

/** Canonical viewBox strings. Renderers must not invent their own. */
export const LATERAL_VIEWBOX = '0 0 64 88';
export const OCCLUSAL_VIEWBOX = '0 0 64 64';

/**
 * Registry key for a tooth.
 *
 * The primary branch narrows the family to the five deciduous ones. That
 * narrowing can only fail for an FDI that getToothIdentity already treated as
 * out-of-range, in which case the second primary molar is the safest stand-in
 * (it is the largest deciduous crown, so nothing renders clipped).
 */
export function anatomyKeyFor(identity: ToothIdentity): AnatomyKey {
  if (identity.dentition === 'primary') {
    const family: PrimaryToothFamily =
      identity.family === 'first_premolar' ||
      identity.family === 'second_premolar' ||
      identity.family === 'third_molar'
        ? 'second_molar'
        : identity.family;
    return `primary:${identity.arch}:${family}`;
  }
  return `permanent:${identity.arch}:${identity.family}`;
}

/** Every key a complete registry must contain, useful for exhaustive tests. */
export function allAnatomyKeys(): AnatomyKey[] {
  const arches: ToothArch[] = ['upper', 'lower'];
  const permanentFamilies: ToothFamily[] = [
    'central_incisor',
    'lateral_incisor',
    'canine',
    'first_premolar',
    'second_premolar',
    'first_molar',
    'second_molar',
    'third_molar',
  ];
  const primaryFamilies: PrimaryToothFamily[] = [
    'central_incisor',
    'lateral_incisor',
    'canine',
    'first_molar',
    'second_molar',
  ];

  const keys: AnatomyKey[] = [];
  for (const arch of arches) {
    for (const family of permanentFamilies) keys.push(`permanent:${arch}:${family}`);
    for (const family of primaryFamilies) keys.push(`primary:${arch}:${family}`);
  }
  return keys;
}

/** Narrow helper kept here so registries never re-implement it. */
export function dentitionOfKey(key: AnatomyKey): Dentition {
  return key.startsWith('primary:') ? 'primary' : 'permanent';
}
