/**
 * toothGeometry.ts — DENTAL-CHART-UX-001
 *
 * Anatomical SVG path data for the dental chart, extracted as a pure module so
 * the geometry can be unit-tested (every shape/dentition/jaw combination must
 * yield a drawable crown and at least one root) without mounting React.
 *
 * WHY THIS REPLACES THE OLD `TOOTH_PATHS`
 * ---------------------------------------
 * The previous chart drew each tooth as ONE closed silhouette per shape
 * category — a rounded blob with a couple of leg-like stubs. Clinics read that
 * as a placeholder icon, not a tooth. The upgrade here is structural rather
 * than decorative: a real tooth is a *crown* (enamel, cusps) joined at the
 * cervical line to one or more *roots*, and the root count is the single most
 * recognisable anatomical cue in a chart — upper molars have three roots,
 * lower molars two, anteriors one. Splitting the silhouette into
 * `crown` + `roots[]` is what makes the drawing read as dental rather than
 * generic, and it is also what lets the `implant` status swap the roots for a
 * fixture while keeping the crown (which is exactly what an implant-supported
 * crown is).
 *
 * COORDINATE SYSTEM — deliberately unchanged from the old implementation
 * ---------------------------------------------------------------------
 * All paths are authored in the existing `viewBox="0 0 64 88"` space, in
 * LOWER-JAW orientation: crown at the top (small y), roots hanging down
 * (large y), cervical line at y≈40. ToothIcon flips upper teeth with the
 * pre-existing `translate(0 88) scale(1 -1)` transform, so keeping this
 * viewBox and this orientation means the flip, the sizing classes, and the
 * hit-area geometry all keep working untouched.
 *
 * HIT AREA: none of this affects clickability. The clickable element is the
 * wrapping <button> in ToothIcon, not the path — the SVG is `pointer-events`
 * -irrelevant decoration inside it. Adding anatomical detail therefore cannot
 * shrink or fragment the tap target, which is what usually goes wrong when a
 * chart is made "more realistic".
 */

export type ToothShape = 'molar' | 'premolar' | 'canine' | 'incisor';

/**
 * Which dentition a tooth belongs to. `permanent` = adult (FDI quadrants 1-4),
 * `primary` = deciduous / süt dişi (FDI quadrants 5-8).
 */
export type Dentition = 'permanent' | 'primary';

export interface ToothGeometry {
  /** Closed outline of the clinical crown. Always non-empty. */
  crown: string;
  /**
   * One closed path per root, in draw order (palatal/lingual root first so the
   * buccal roots overlap it, mimicking depth). Always at least one entry.
   */
  roots: string[];
  /**
   * Open stroke path hinting at the occlusal/incisal anatomy — cusp ridges for
   * posteriors, mamelon grooves for incisors. Purely a surface detail; drawn
   * with a low opacity so it never competes with the status colour.
   */
  surface: string;
  /** Open stroke path along the cervical line (crown/root junction). */
  cervical: string;
}

/**
 * Endosseous implant fixture, drawn INSTEAD of the roots for `implant` status.
 * Shape-agnostic on purpose: a fixture looks the same whichever tooth it
 * replaces, and hard-coding one path avoids four near-identical variants.
 */
/**
 * SUPERSEDED by `odontogram/restorationGeometry.ts` — do not use in new code.
 *
 * These three paths hard-code coordinates from the era when every tooth in the
 * chart shared one generic outline whose cervical line sat around y = 34-40.
 * R3 gives each tooth its own CEJ (y = 23.0 to y = 36.0) and its own cervical
 * width, so a fixed fixture floats in the gap above a detached crown and a
 * fixed margin lands off the tooth entirely on short-crowned molars — both
 * observed before the derived versions replaced them.
 *
 * Kept only because `dentalChartHelpers.test.ts` still pins them alongside the
 * rest of the R1 geometry it covers. Nothing in the rendered chart reads them.
 */
export const IMPLANT_FIXTURE_PATH =
  'M27.4 39 L36.6 39 L35.2 72.5 C35 77 29 77 28.8 72.5 Z';

/** Thread lines drawn over IMPLANT_FIXTURE_PATH. */
export const IMPLANT_THREAD_PATH =
  'M28.3 46 H35.7 M28.6 52 H35.4 M28.9 58 H35.1 M29.2 64 H34.8 M29.5 70 H34.5';

/**
 * Margin of a full-coverage crown restoration. For `crown` status the whole
 * clinical crown is filled (that is what full coverage means) and this line
 * marks the preparation margin near the cervical third.
 */
export const CROWN_MARGIN_PATH = 'M18 33.5 C24 36.5 40 36.5 46 33.5';

// ─── Permanent dentition ────────────────────────────────────────────────────

const PERMANENT_CROWN: Record<ToothShape, string> = {
  // Three buccal cusps, widest crown of the arch, clear cervical taper.
  molar:
    'M15 21 C15 13 18.5 9 22.5 9 C25.3 9 26.6 11.6 27.4 14.4 C28 16.6 30 17 32 17 ' +
    'C34 17 36 16.6 36.6 14.4 C37.4 11.6 38.7 9 41.5 9 C45.5 9 49 13 49 21 ' +
    'L48.5 32 C48 38.5 41.5 42 32 42 C22.5 42 16 38.5 15.5 32 Z',
  // Two cusps (buccal + lingual) separated by the central groove.
  premolar:
    'M18.5 22 C18.5 14 21.5 9.5 25 9.5 C27.8 9.5 29.3 12.5 30 16 ' +
    'C30.6 18.5 33.4 18.5 34 16 C34.7 12.5 36.2 9.5 39 9.5 C42.5 9.5 45.5 14 45.5 22 ' +
    'L45 33 C44.5 38.5 39.5 41.5 32 41.5 C24.5 41.5 19.5 38.5 19 33 Z',
  // Single pointed cusp — the tallest crown in the arch.
  canine:
    'M20.5 25 C20.5 17 23.5 11 27.5 8 C29.5 6.3 30.8 5.5 32 5.5 ' +
    'C33.2 5.5 34.5 6.3 36.5 8 C40.5 11 43.5 17 43.5 25 ' +
    'L43 33 C42.5 38.5 38.5 41.5 32 41.5 C25.5 41.5 21.5 38.5 21 33 Z',
  // Flat incisal edge, widest incisally and tapering to the cervix.
  incisor:
    'M20 12 C20 9 22 7.5 25 7.5 L39 7.5 C42 7.5 44 9 44 12 ' +
    'L43 32 C42.5 38 38.5 41.5 32 41.5 C25.5 41.5 21.5 38 21 32 Z',
};

const PERMANENT_SURFACE: Record<ToothShape, string> = {
  molar: 'M22.5 11.5 L25 18 M41.5 11.5 L39 18 M32 17.5 V26',
  premolar: 'M25 12 L27.5 19 M39 12 L36.5 19 M32 18 V25',
  canine: 'M32 6.5 V18 M26.5 14 L32 9 L37.5 14',
  incisor: 'M23 10 H41 M28 9 V15 M32 9 V16 M36 9 V15',
};

/** Single conical root shared by permanent incisors. */
const PERMANENT_INCISOR_ROOT =
  'M22 41 C22.5 54 25 68 29.5 79 C30.7 82 33.3 82 34.5 79 C39 68 41.5 54 42 41 Z';

/** Canine root — the longest root in the mouth, hence the deeper apex. */
const PERMANENT_CANINE_ROOT =
  'M21.5 41 C22 56 25 72 29.5 83 C30.7 86 33.3 86 34.5 83 C39 72 42 56 42.5 41 Z';

const PERMANENT_PREMOLAR_ROOT =
  'M21.5 41 C22 54 24.5 67 28.5 78 C30 81.3 34 81.3 35.5 78 C39.5 67 42 54 42.5 41 Z';

/** Lower molars: two roots (mesial + distal). */
const PERMANENT_LOWER_MOLAR_ROOTS = [
  'M18.5 40.5 C16.5 51 15.5 63 17.5 75 C18.4 79.5 22.2 79.5 23.2 75 C25.2 63 25.8 51 26.2 40.5 Z',
  'M37.8 40.5 C38.2 51 38.8 63 40.8 75 C41.8 79.5 45.6 79.5 46.5 75 C48.5 63 47.5 51 45.5 40.5 Z',
];

/**
 * Upper molars: three roots. The palatal root is listed FIRST so it renders
 * behind the two buccal roots, which is what gives the trifurcation its depth.
 */
const PERMANENT_UPPER_MOLAR_ROOTS = [
  'M28.5 40.5 L35.5 40.5 C36 52 35.2 64 33.6 74.5 C32.9 78 31.1 78 30.4 74.5 C28.8 64 28 52 28.5 40.5 Z',
  'M17 40.5 C14 51 12.5 62.5 14.5 74 C15.4 78 19.2 78 20.2 74 C22.2 62.5 23.5 51 24.5 40.5 Z',
  'M39.5 40.5 C40.5 51 41.8 62.5 43.8 74 C44.8 78 48.6 78 49.5 74 C51.5 62.5 50 51 47 40.5 Z',
];

// ─── Primary dentition ──────────────────────────────────────────────────────
//
// Primary teeth are not just "smaller adult teeth". The two cues that make a
// paediatric chart read as paediatric at a glance are (1) a bulbous crown with
// a pronounced cervical ridge, and (2) markedly divergent roots — primary
// molar roots splay wide to straddle the developing permanent premolar
// underneath. Both are exaggerated slightly here for legibility at chart size.

const PRIMARY_CROWN: Record<ToothShape, string> = {
  molar:
    'M16 20 C16 13 20 9.5 23.5 9.5 C26.2 9.5 27.4 12 28.2 14.5 ' +
    'C28.8 16.5 30.4 17 32 17 C33.6 17 35.2 16.5 35.8 14.5 ' +
    'C36.6 12 37.8 9.5 40.5 9.5 C44 9.5 48 13 48 20 ' +
    'C48 27.5 46.5 33.5 44.5 36 C41.5 39.5 22.5 39.5 19.5 36 C17.5 33.5 16 27.5 16 20 Z',
  // Primary dentition has no premolars; this entry exists only so the record is
  // total. getPrimaryToothShape never returns 'premolar' for a primary FDI.
  premolar:
    'M18.5 21 C18.5 14 21.5 10 25 10 C27.8 10 29.3 13 30 16.2 ' +
    'C30.6 18.5 33.4 18.5 34 16.2 C34.7 13 36.2 10 39 10 C42.5 10 45.5 14 45.5 21 ' +
    'C45.5 28 44 33.5 42 36 C39.2 39.3 24.8 39.3 22 36 C20 33.5 18.5 28 18.5 21 Z',
  canine:
    'M21.5 21 C21.5 15 24.5 10.5 28 8 C30 6.6 31 6 32 6 ' +
    'C33 6 34 6.6 36 8 C39.5 10.5 42.5 15 42.5 21 ' +
    'C42.5 28 41 33.5 39.5 36 C37.8 38.8 26.2 38.8 24.5 36 C23 33.5 21.5 28 21.5 21 Z',
  incisor:
    'M20.5 16 C20.5 11 23 9 32 9 C41 9 43.5 11 43.5 16 ' +
    'C43.5 25 42 32 40 35.5 C38.3 38.5 25.7 38.5 24 35.5 C22 32 20.5 25 20.5 16 Z',
};

const PRIMARY_SURFACE: Record<ToothShape, string> = {
  molar: 'M23.5 12 L26 17.5 M40.5 12 L38 17.5 M32 17.5 V24',
  premolar: 'M25 12.5 L27.5 19 M39 12.5 L36.5 19 M32 18 V24',
  canine: 'M32 7 V16 M27 13 L32 9 L37 13',
  incisor: 'M23 11.5 H41 M28 10 V14.5 M36 10 V14.5',
};

const PRIMARY_ANTERIOR_ROOT =
  'M25 37.5 C24.5 48 26 60 29 70 C30 73 33 73 34 70 C37.5 60 39.5 48 39 37.5 Z';

const PRIMARY_CANINE_ROOT =
  'M25 38 C24.5 49 26 62 29 72.5 C30 75.5 33 75.5 34 72.5 C37.5 62 39.5 49 39 38 Z';

/** Lower primary molar: two widely divergent roots. */
const PRIMARY_LOWER_MOLAR_ROOTS = [
  'M20 37.5 C15 47 11 58 11.5 69 C11.7 72.8 15.2 73 16.5 69.5 C19.5 59 23 47.5 26 38 Z',
  'M38 38 C41 47.5 44.5 59 47.5 69.5 C48.8 73 52.3 72.8 52.5 69 C53 58 49 47 44 37.5 Z',
];

/** Upper primary molar: three roots, palatal first (drawn behind). */
const PRIMARY_UPPER_MOLAR_ROOTS = [
  'M29 37.5 L35 37.5 C35.5 48 34.6 58 33.2 66.5 C32.6 69.5 31.4 69.5 30.8 66.5 C29.4 58 28.5 48 29 37.5 Z',
  'M20.5 37.5 C14.5 46 9.5 55.5 10 65 C10.2 68.8 13.8 69 15 65.6 C18 56.5 22.5 46.5 26 38 Z',
  'M38 38 C41.5 46.5 46 56.5 49 65.6 C50.2 69 53.8 68.8 54 65 C54.5 55.5 49.5 46 43.5 37.5 Z',
];

const PERMANENT_CERVICAL = 'M18.5 39.5 C24 42.5 40 42.5 45.5 39.5';
const PRIMARY_CERVICAL = 'M20 36 C25 39 39 39 44 36';

function permanentRoots(shape: ToothShape, isUpper: boolean): string[] {
  switch (shape) {
    case 'molar':
      return isUpper ? PERMANENT_UPPER_MOLAR_ROOTS : PERMANENT_LOWER_MOLAR_ROOTS;
    case 'premolar':
      return [PERMANENT_PREMOLAR_ROOT];
    case 'canine':
      return [PERMANENT_CANINE_ROOT];
    default:
      return [PERMANENT_INCISOR_ROOT];
  }
}

function primaryRoots(shape: ToothShape, isUpper: boolean): string[] {
  switch (shape) {
    case 'molar':
      return isUpper ? PRIMARY_UPPER_MOLAR_ROOTS : PRIMARY_LOWER_MOLAR_ROOTS;
    case 'canine':
      return [PRIMARY_CANINE_ROOT];
    default:
      // Primary premolars do not exist; an incisor-style single root is the
      // correct fallback for the unreachable 'premolar' case too.
      return [PRIMARY_ANTERIOR_ROOT];
  }
}

/**
 * Resolves the drawable geometry for one tooth.
 *
 * `isUpper` only changes the ROOT COUNT (upper molars are three-rooted, lower
 * molars two-rooted) — it must NOT be used to pre-flip the paths, because
 * ToothIcon already applies the jaw flip as an SVG transform.
 */
export function getToothGeometry(
  shape: ToothShape,
  dentition: Dentition,
  isUpper: boolean,
): ToothGeometry {
  if (dentition === 'primary') {
    return {
      crown: PRIMARY_CROWN[shape],
      roots: primaryRoots(shape, isUpper),
      surface: PRIMARY_SURFACE[shape],
      cervical: PRIMARY_CERVICAL,
    };
  }

  return {
    crown: PERMANENT_CROWN[shape],
    roots: permanentRoots(shape, isUpper),
    surface: PERMANENT_SURFACE[shape],
    cervical: PERMANENT_CERVICAL,
  };
}
