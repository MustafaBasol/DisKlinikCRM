/**
 * lateral/primary.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 */

import type { PrimaryAnatomyKey, LateralToothArt } from '../anatomy.types';

export const PRIMARY_LATERAL: Readonly<Record<PrimaryAnatomyKey, LateralToothArt>> = {

  // ── PRIMARY UPPER ─────────────────────────────────────────────────────
  //
  // Every primary crown below carries the two cues that read as "primary"
  // at a glance: a bulbous crown that narrows sharply just above the
  // cervical line (pronounced cervical constriction), and a visibly shorter
  // root than the permanent equivalent. Primary molars additionally splay
  // their roots wide (markedly divergent) to straddle the developing
  // permanent premolar.

  'primary:upper:central_incisor': {
    crown:
      'M41 8.5 C40.8 7 38.5 6.3 35.5 6.5 L29 6.8 C25.8 7.2 23.5 8.5 22.7 11 ' +
      'C21.9 13.5 22.3 16.3 23.5 19 C24.2 20.6 24.5 22.2 25.5 23.5 ' +
      'C26.6 25 27.9 26.2 29.5 26.7 L37.5 26.5 C39 25.8 40.1 24.3 40.9 22.3 ' +
      'C41.7 20.2 42.1 17.7 42.1 15 C42.1 12.5 41.7 10.2 41 8.5 Z',
    roots: [
      'M25.5 27 C26.8 35 28.3 43 30 50.6 C30.3 51.3 30.7 51.3 31 50.6 ' +
        'C32.7 43 34.5 35 36.5 27 C34 25.6 28 25.6 25.5 27 Z',
    ],
    surface: 'M25 12 L38 11.5 M29 7.5 V13 M35.5 7.3 V13.3',
    cervical: 'M23 26.3 C27.5 28.5 34.5 28.5 40 25',
    widthRatio: 0.79,
    sideStrategy: 'mirror',
    simplification:
      'Cervical constriction is exaggerated beyond real proportions so it ' +
      'reads clearly at chart size; mamelon ridges are simplified to two ' +
      'straight grooves; the root apex is capped slightly rounded rather ' +
      'than a true point.',
  },

  'primary:upper:lateral_incisor': {
    crown:
      'M37.5 8.5 C37.3 7 35.3 6.3 32.7 6.5 L27.5 6.8 C24.8 7.2 22.8 8.5 22.1 10.8 ' +
      'C21.4 13 21.8 15.5 22.8 18 C23.4 19.5 23.7 21 24.6 22.2 ' +
      'C25.6 23.6 26.7 24.6 28.1 25.1 L34.9 24.9 C36.2 24.3 37.1 23 37.8 21.2 ' +
      'C38.5 19.3 38.8 17 38.8 14.6 C38.8 12.4 38.4 10.3 37.5 8.5 Z',
    roots: [
      'M25.5 26 C26.6 32.7 28 39.7 29.3 46.6 C29.6 47.2 30 47.2 30.3 46.6 ' +
        'C31.7 39.7 33.2 32.7 34.5 26 C32.3 24.7 27.7 24.7 25.5 26 Z',
    ],
    surface: 'M25 11.5 L34.5 11 M27.7 7.3 V12 M32.7 7.1 V12.3',
    cervical: 'M23 25.3 C27 27.3 32 27.3 36.3 24',
    widthRatio: 0.66,
    sideStrategy: 'mirror',
    simplification:
      'Root apex drawn with a small rounded cap rather than the slight ' +
      'curvature real primary lateral incisor roots often show near a ' +
      'genuinely fine tip.',
  },

  'primary:upper:canine': {
    crown:
      'M34.5 6.5 C36.5 7.7 38.7 10.5 39.7 13.5 C40.5 15.9 40.6 18.2 40 20.3 ' +
      'C39.4 19.2 38.3 18.7 37.2 19.4 C36 20.2 36 22.2 36.9 24.3 ' +
      'C37.5 25.7 37.4 26.9 36.6 27.7 C35.6 28.6 34.2 29 32.7 29.1 L24.5 28.9 ' +
      'C23 28.5 22 27.4 21.5 25.7 C21 24 21.3 22.3 22.3 21.1 ' +
      'C21.2 20.4 20.5 19 20.9 17 C21.5 14.3 23.3 11.5 25.7 9.7 ' +
      'C28.1 7.9 31.7 6.7 34.5 6.5 Z',
    roots: [
      'M22.5 28 C23.7 39 25.2 50 27 59.4 C27.3 60.1 27.7 60.1 28 59.4 ' +
        'C29.8 50 31.3 39 34.5 28 C31.5 26.4 25.5 26.4 22.5 28 Z',
    ],
    surface: 'M34.5 6.5 V15 M27 10.5 L34.5 6.5 L37.5 13.5',
    cervical: 'M21 27.3 C26 29.5 33 29.5 39 25.8',
    widthRatio: 0.85,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is capped slightly rounded rather than tapering to a ' +
      'true fine point.',
  },

  // Three roots, palatal first, splayed markedly wide.
  'primary:upper:first_molar': {
    crown:
      'M45 19 C44.8 13.8 41.5 10 37 9.3 C34.8 9 33.3 10.5 32.7 12.8 ' +
      'C32.3 14.3 32 14.5 32 14.5 C32 14.5 31.7 14.3 31.3 12.8 ' +
      'C30.7 10.5 29.2 8.9 27 9.2 C22.5 9.9 19.2 13.8 19 19 ' +
      'C18.8 22.7 19.8 26 21.7 28.5 C22.4 26.3 23.8 25.2 25.5 25.7 ' +
      'C27.3 26.2 27.7 28.5 26.7 31 C26.1 32.5 26.2 33.7 27.1 34.4 ' +
      'C28.2 33.7 29.4 33.3 30.7 33.4 L33.3 33.4 C34.6 33.3 35.8 33.7 36.9 34.4 ' +
      'C37.8 33.7 37.9 32.5 37.3 31 C36.3 28.5 36.7 26.2 38.5 25.7 ' +
      'C40.2 25.2 41.6 26.3 42.3 28.5 C44.2 26 45.2 22.7 45 19 Z',
    roots: [
      'M29 33.7 L35 33.7 C35.7 39 35.3 44.5 34 49.5 C33.3 52 32.4 53.3 32 53.3 ' +
        'C31.6 53.3 30.7 52 30 49.5 C28.7 44.5 28.3 39 29 33.7 Z',
      'M35.5 34 C38.5 38.5 41.5 43 42.5 48 C43 50.5 42 52.5 40.3 52.3 ' +
        'C38.7 51.8 37.5 49 36.8 45.5 C36 41.5 35.5 37.5 35.5 34 Z',
      'M28.5 34 C25.5 38.5 22.5 43 21.5 48 C21 50.5 22 52.5 23.7 52.3 ' +
        'C25.3 51.8 26.5 49 27.2 45.5 C28 41.5 28.5 37.5 28.5 34 Z',
    ],
    surface: 'M23 15 L26 20 M41 15 L38 20 M32 14.5 V22 M28 21 L32 24.5 L36 21',
    cervical: 'M20 33 C26 35.7 38 35.7 44 31.5',
    widthRatio: 0.9,
    sideStrategy: 'mirror',
    simplification:
      "The true primary upper first molar has an atypical, more " +
      'premolar-like occlusal cusp pattern; it is simplified here to a ' +
      'generic bulbous molar outline rather than its distinctive angular ' +
      'crown form.',
  },

  // Closely resembles a (smaller, shorter-rooted) permanent upper first
  // molar, as in real anatomy. Three roots, palatal first, markedly
  // divergent.
  'primary:upper:second_molar': {
    crown:
      'M48 21 C47.7 15 44 10.7 39 9.8 C36.5 9.3 34.7 10.7 33.9 13.2 ' +
      'C33.3 15 32.5 15.7 32 15.7 C31.5 15.7 30.7 15 30.1 13.2 ' +
      'C29.3 10.7 27.5 9.3 25 9.8 C20 10.7 16.3 15 16 21 ' +
      'C15.8 25 16.8 28.5 18.7 31.2 C19.6 28.7 21.2 27.3 23.2 27.9 ' +
      'C25.3 28.5 25.7 31 24.5 33.7 C23.8 35.3 24 36.6 25.1 37.3 ' +
      'C26.3 36.5 27.7 36 29.2 36.1 L34.8 36.1 C36.3 36 37.7 36.5 38.9 37.3 ' +
      'C40 36.6 40.2 35.3 39.5 33.7 C38.3 31 38.7 28.5 40.8 27.9 ' +
      'C42.8 27.3 44.4 28.7 45.3 31.2 C47.2 28.5 48.2 25 48 21 Z',
    roots: [
      'M29.5 36.4 L34.5 36.4 C35.3 42 34.8 48 33.4 53.3 ' +
        'C32.9 55.2 32.4 56.3 32 56.5 C31.6 56.3 31.1 55.2 30.6 53.3 ' +
        'C29.2 48 28.7 42 29.5 36.4 Z',
      'M36 36.7 C40 41 43 46 44.3 51.5 C44.9 54 44 56.2 42.2 56.2 ' +
        'C40.5 55.8 39 53 38 49 C36.9 44.5 36.2 40.5 36 36.7 Z',
      'M28 36.7 C24 41 21 46 19.7 51.5 C19.1 54 20 56.2 21.8 56.2 ' +
        'C23.5 55.8 25 53 26 49 C27.1 44.5 27.8 40.5 28 36.7 Z',
    ],
    surface: 'M25 15.5 L27.8 20.5 M39 15.5 L36.2 20.5 M32 15.7 V24 M27.5 24 L32 27.5 L36.5 24',
    cervical: 'M18 35 C25 38 39 38 46 33',
    widthRatio: 1.16,
    sideStrategy: 'mirror',
    simplification:
      'Closely resembles a permanent upper first molar in silhouette, as ' +
      'in real anatomy; its extra accessory cusps are simplified to the ' +
      'same ridge lines used for the permanent molar surface detail.',
  },

  // ── PRIMARY LOWER ─────────────────────────────────────────────────────

  'primary:lower:central_incisor': {
    crown:
      'M35.5 9.5 C35.3 8.2 33.5 7.5 31 7.6 L28 7.8 C25.6 8.1 23.8 9.2 23.2 11.1 ' +
      'C22.6 13 23 15.1 23.9 17.1 C24.4 18.3 24.7 19.5 25.5 20.4 ' +
      'C26.4 21.5 27.5 22.2 28.7 22.5 L33.5 22.3 C34.5 21.8 35.2 20.8 35.7 19.4 ' +
      'C36.2 17.9 36.4 16 36.4 14 C36.4 12.3 36.1 10.7 35.5 9.5 Z',
    roots: [
      'M27 23 C27.7 29 28.7 35 29.6 40.6 C29.9 41.1 30.1 41.1 30.4 40.6 ' +
        'C31.3 35 32.3 29 33 23 C31.3 22 28.7 22 27 23 Z',
    ],
    surface: 'M26.5 10.5 L34 10 M29 8 V12 M32.5 7.8 V12.2',
    cervical: 'M24.5 22.3 C27.5 23.9 31.5 23.9 34.5 21.3',
    widthRatio: 0.53,
    sideStrategy: 'mirror',
    simplification:
      'Smallest tooth in the arch; surface detail simplified to a single ' +
      'incisal ridge line, mamelons omitted as they are not visible at ' +
      'this scale; root apex capped slightly rounded rather than a true ' +
      'point.',
  },

  'primary:lower:lateral_incisor': {
    crown:
      'M37 9.5 C36.8 8.2 34.7 7.5 31.9 7.6 L28.5 7.8 C25.9 8.1 23.9 9.2 23.2 11.2 ' +
      'C22.5 13.1 22.9 15.3 23.9 17.4 C24.5 18.6 24.8 19.9 25.7 20.9 ' +
      'C26.6 22 27.9 22.7 29.2 23 L34.6 22.8 C35.7 22.3 36.6 21.2 37.1 19.7 ' +
      'C37.7 18.1 37.9 16.1 37.9 14 C37.9 12.2 37.6 10.6 37 9.5 Z',
    roots: [
      'M27 24 C27.9 31 29.1 37 30.5 43.6 C30.8 44.1 31.2 44.1 31.5 43.6 ' +
        'C32.9 37 34.1 31 35 24 C33 22.7 29 22.7 27 24 Z',
    ],
    surface: 'M26.5 11 L36 10.5 M29.5 8 V12.3 M34 7.8 V12.5',
    cervical: 'M24.5 23.3 C29 25.3 33.5 25.3 37.5 22.3',
    widthRatio: 0.63,
    sideStrategy: 'mirror',
    simplification:
      'Root apex drawn with a small rounded cap; only mesiodistal ' +
      'proportion and cervical constriction are otherwise modelled.',
  },

  'primary:lower:canine': {
    crown:
      'M33.5 6.5 C35.3 7.6 37.2 10.1 38.1 12.8 C38.8 15 38.9 17.1 38.3 19 ' +
      'C37.8 18 36.8 17.6 35.8 18.2 C34.7 18.9 34.7 20.7 35.5 22.6 ' +
      'C36 23.9 35.9 25 35.2 25.7 C34.3 26.5 33 26.9 31.7 27 L24.7 26.8 ' +
      'C23.4 26.4 22.5 25.4 22.1 23.9 C21.6 22.4 21.9 20.8 22.8 19.7 ' +
      'C21.8 19.1 21.2 17.8 21.5 16 C22 13.6 23.6 11.1 25.8 9.4 ' +
      'C28 7.7 31.1 6.6 33.5 6.5 Z',
    roots: [
      'M23 25 C24 34 25.5 43 27.4 51.4 C27.7 52 28.1 52 28.4 51.4 ' +
        'C30 43 31.5 34 33.5 25 C30.5 23.4 25.5 23.4 23 25 Z',
    ],
    surface: 'M33.5 6.5 V14.5 M26.5 10.5 L33.5 6.5 L36.5 13',
    cervical: 'M21.5 24.3 C26.5 26.5 32.5 26.5 38 22.8',
    widthRatio: 0.72,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is capped slightly rounded rather than tapering to a ' +
      'true fine point.',
  },

  // Two roots, widely divergent — the mesiobuccal cusp bulge that makes this
  // tooth the least "adult-looking" of the primary set is simplified.
  'primary:lower:first_molar': {
    crown:
      'M46.5 21 C46.2 15.5 42.7 11.3 38 10.2 C35.3 9.6 33.3 11.3 32.7 14 ' +
      'C32.4 15.3 32 15.7 32 15.7 C32 15.7 31.4 15.2 30.7 13.5 ' +
      'C29.7 11 27.2 9.7 24 10.5 C19 11.8 15.6 16 15.3 21.5 ' +
      'C15.1 25.3 16.2 28.7 18.2 31.3 C19.3 26.5 21.5 24 24.2 24.8 ' +
      'C26.5 25.5 27.3 28.3 26.3 31.5 C25.7 33.3 25.9 34.7 27 35.4 ' +
      'C28.2 34.6 29.6 34.2 31.1 34.3 L33.6 34.3 C35 34.2 36.3 34.6 37.5 35.4 ' +
      'C38.6 34.7 38.8 33.3 38.2 31.5 C37.2 28.3 38 25.5 40.3 24.8 ' +
      'C42.5 24.1 44.4 26 45.4 29.5 C46.6 27 47 24 46.5 21 Z',
    roots: [
      'M35 34.6 C39 38.5 42 43 42.5 48 C42.8 50.7 41.7 52.7 39.9 52.5 ' +
        'C38.2 52 37 49.3 36.3 45.7 C35.5 41.7 35 37.8 35 34.6 Z',
      'M29 34.6 C25 38.5 22 43 21.5 48 C21.2 50.7 22.3 52.7 24.1 52.5 ' +
        'C25.8 52 27 49.3 27.7 45.7 C28.5 41.7 29 37.8 29 34.6 Z',
    ],
    surface: 'M22 16 L25 21 M40 16 L37 21 M32 15.7 V23.5 M27.5 23.5 L32 27 L36.5 23.5',
    cervical: 'M18.5 33.5 C25 36.3 39 36.3 45 31.5',
    widthRatio: 0.98,
    sideStrategy: 'mirror',
    simplification:
      'The distinctive mesiobuccal cusp bulge and prominent mesial ' +
      'marginal ridge of this tooth — its most atypical, least ' +
      'permanent-tooth-like feature — is simplified to a generally ' +
      'widened mesial crown outline rather than a separate cusp shape.',
  },

  // Closely resembles a (smaller, shorter-rooted) permanent lower first
  // molar, as in real anatomy. Two widely divergent roots.
  'primary:lower:second_molar': {
    crown:
      'M50 23 C49.6 17 46 12.5 41.3 11.2 C38.7 10.5 36.6 12 35.7 14.7 ' +
      'C35 16.7 33.6 17.7 32 17.7 C30.4 17.7 29 16.6 28.3 14.7 ' +
      'C27.4 12 25.3 10.5 22.7 11.2 C18 12.5 14.4 17 14 23 ' +
      'C13.7 27 14.6 30.7 16.4 33.7 C17.6 30 19.9 28 22.6 28.8 ' +
      'C24.9 29.5 25.5 32.2 24.3 35.3 C23.6 37 23.8 38.3 24.9 39 ' +
      'C26.3 38.1 27.9 37.6 29.6 37.7 L34.4 37.7 C36.1 37.6 37.7 38.1 39.1 39 ' +
      'C40.2 38.3 40.4 37 39.7 35.3 C38.5 32.2 39.1 29.5 41.4 28.8 ' +
      'C44.1 28 46.4 30 47.6 33.7 C49.4 30.7 50.3 27 50 23 Z',
    roots: [
      'M38 38 C42.5 42.5 45.5 47.5 46 53 C46.3 56 44.9 58.3 42.8 58 ' +
        'C40.8 57.4 39.3 54.3 38.3 50 C37.3 45.5 37.5 41.5 38 38 Z',
      'M26 38 C21.5 42.5 18.5 47.5 18 53 C17.7 56 19.1 58.3 21.2 58 ' +
        'C23.2 57.4 24.7 54.3 25.7 50 C26.7 45.5 26.5 41.5 26 38 Z',
    ],
    surface: 'M23 15.5 L26 21 M41 15.5 L38 21 M32 17.7 V26 M27 26 L32 29.5 L37 26',
    cervical: 'M17 37 C24.5 40 39.5 40 47 35',
    widthRatio: 1.22,
    sideStrategy: 'mirror',
    simplification:
      "This tooth's silhouette closely follows the permanent lower first " +
      'molar it precedes, as in real anatomy; occlusal groove pattern ' +
      'differences between the two teeth are not modelled at this scale.',
  },
};
