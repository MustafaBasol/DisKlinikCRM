/**
 * occlusal/primary.ts — DENTAL-CHART-ASSET-R3 (Lane E)
 *
 * One author-owned slice of the OCCLUSAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * ── WHY THIS FILE WAS REWRITTEN (R3) ────────────────────────────────────
 * The R2 silhouettes here were rounded blobs at a roughly uniform size, so a
 * primary lower central incisor read as only slightly smaller than a primary
 * second molar and the two atypical primary first molars looked like small,
 * regular permanent molars — the single biggest "this is not a paediatric
 * chart" tell a clinician can spot. Every outline below was rebuilt from
 * eight-to-nine anatomically named points (DB/MB/ML/DL corners plus
 * mid-edge/cusp feature points) run through a Catmull-Rom-through-points
 * curve fit, then affine-scaled per tooth so its footprint lands on the
 * AUTHORING.md §2.2 PRIMARY table. Each outer edge is built ONCE as a plain
 * JS string and that exact string is reused, byte-for-byte, inside the one
 * peripheral surface that owns it — never re-typed — which is what makes the
 * five surfaces tile the outline with zero gap/overlap (verified by a
 * throwaway shoelace-area script; see the lane's delivery report).
 *
 * What makes these read as DECIDUOUS rather than permanent, tooth by tooth:
 * - The primary upper first molar is drawn atypical and narrow (its §2.2
 *   footprint is buccolingually DEEPER than it is mesiodistally wide, the
 *   opposite of every other molar in either dentition), with an extra
 *   "mbBulge" point punched out just before the mesiobuccal corner so the
 *   outline itself — not just the detail strokes — shows the swelling.
 * - The primary lower first molar is elongated mesiodistally with the same
 *   mesiobuccal-bulge device, plus a strong transverse-ridge detail stroke.
 * - Both primary second molars are drawn to resemble their respective
 *   PERMANENT FIRST molar (rhomboidal + oblique ridge upper; pentagonal +
 *   Y-fissure lower, with the three buccal cusps closer to equal size), but
 *   at the smaller §2.2 footprint and without a hypocone/Carabelli mark.
 * - The four anteriors and two canines are wide, shallow wedges/diamonds
 *   with a deliberately prominent lingual cingulum bulge (its own named loop
 *   point, not a detail-only flourish) and a real mesial/distal asymmetry
 *   (sharper mesioincisal corner, more rounded distoincisal corner).
 */

import type { PrimaryAnatomyKey, OcclusalToothArt } from '../anatomy.types';

export const PRIMARY_OCCLUSAL: Readonly<Record<PrimaryAnatomyKey, OcclusalToothArt>> = {

  // ============================================================
  // PRIMARY — UPPER (no premolars; deciduous positions 4/5 are molars)
  // ============================================================

  /**
   * Primary upper central incisor. R4B: redrawn plumper/more oval against
   * design/dental-chart/source-plates-svg/07_primary_upper_incisors_canine.svg
   * — the traced plate shows primary incisors reading distinctly rounder
   * than the permanent "wedge" AUTHORING.md §3.4 describes (real deciduous
   * crowns are more bulbous, having seen no occlusal wear). Mesioincisal
   * corner (MB) is still drawn tighter/sharper than the more open
   * distoincisal corner (DB); a prominent cingulum bulge is its own outline
   * point on the lingual edge, not just a detail stroke.
   */
  'primary:upper:central_incisor': {
    outline: 'M18.5 25.5 C25.9 22.6 30 21 32 20.2 C34.1 20.7 38.3 21.7 46 23.5 C46.9 28.2 47.4 30.7 47.6 32 C47 33.3 45.8 35.8 43.5 40.5 C37.2 42.5 33.7 43.6 32 44.2 C30.1 43.4 26.4 41.9 19.5 39 C17.7 35.3 16.8 33.3 16.3 32.3 C16.6 31.3 17.3 29.2 18.5 25.5 Z',
    surfaces: {
      mesial: 'M46 23.5 C46.9 28.2 47.4 30.7 47.6 32 C47 33.3 45.8 35.8 43.5 40.5 L39.5 37.5 L41.1 26.5 Z',
      distal: 'M19.5 39 C17.7 35.3 16.8 33.3 16.3 32.3 C16.6 31.3 17.3 29.2 18.5 25.5 L23.2 27.8 L23.9 36.6 Z',
      buccal: 'M18.5 25.5 C25.9 22.6 30 21 32 20.2 C34.1 20.7 38.3 21.7 46 23.5 L41.1 26.5 L23.2 27.8 Z',
      lingual: 'M43.5 40.5 C37.2 42.5 33.7 43.6 32 44.2 C30.1 43.4 26.4 41.9 19.5 39 L23.9 36.6 L39.5 37.5 Z',
      central: 'M23.2 27.8 L41.1 26.5 L39.5 37.5 L23.9 36.6 Z',
    },
    detail: 'M24 24.5 L40 23.8 M27 42 L32 44.2 L37 41.3',
    sideStrategy: 'mirror',
    simplification:
      'Mamelon marks omitted (smooth incisal edge, consistent with minimal mamelon expression at this scale); the cingulum bulge is drawn as one prominent lingual point rather than a modelled fossa.',
  },

  /**
   * Primary upper lateral incisor. R4B: redrawn plumper/more oval, same
   * plate and rationale as the central incisor above — smaller, rounder
   * version of it, with the same mesial-sharp / distal-rounded asymmetry
   * and a slightly less pronounced cingulum bulge.
   */
  'primary:upper:lateral_incisor': {
    outline: 'M21 26.5 C27.1 24 30.4 22.6 32 21.9 C33.7 22.4 37 23.4 43 25.3 C43.7 29 44.1 31 44.3 32 C43.9 32.9 43 34.8 41.4 38.3 C36.2 39.9 33.4 40.8 32 41.3 C30.5 40.6 27.5 39.3 22 36.9 C20.7 34.2 20 32.7 19.7 32 C19.9 31.2 20.3 29.5 21 26.5 Z',
    surfaces: {
      mesial: 'M43 25.3 C43.7 29 44.1 31 44.3 32 C43.9 32.9 43 34.8 41.4 38.3 L38.4 36.3 L39.5 27.4 Z',
      distal: 'M22 36.9 C20.7 34.2 20 32.7 19.7 32 C19.9 31.2 20.3 29.5 21 26.5 L24.5 28.3 L25.2 35.3 Z',
      buccal: 'M21 26.5 C27.1 24 30.4 22.6 32 21.9 C33.7 22.4 37 23.4 43 25.3 L39.5 27.4 L24.5 28.3 Z',
      lingual: 'M41.4 38.3 C36.2 39.9 33.4 40.8 32 41.3 C30.5 40.6 27.5 39.3 22 36.9 L25.2 35.3 L38.4 36.3 Z',
      central: 'M24.5 28.3 L39.5 27.4 L38.4 36.3 L25.2 35.3 Z',
    },
    detail: 'M23.5 26.8 L39 26 M26 35.5 L32 41.3 L35.5 35',
    sideStrategy: 'mirror',
    simplification:
      'Drawn as a smaller, rounder version of the primary central incisor; no distinct cingulum pit, only the bulge.',
  },

  /**
   * Primary upper canine. Rounded diamond; the labial cusp tip (its own
   * outline point, not a detail mark) is displaced mesially and drawn
   * blunter than the permanent canine's, matching the primary tooth's
   * characteristically worn-looking incisal profile.
   */
  'primary:upper:canine': {
    outline: 'M19.9 29 C23.6 26 32.8 16 37.5 15.3 C42.2 14.6 46.2 21.8 47.9 24.6 C49.6 27.4 48.6 29 47.9 32.3 C47.2 35.6 46.7 41.7 43.7 44.4 C40.8 47.2 34.4 49.2 30.2 48.8 C26.1 48.4 21.3 44.8 18.8 42.2 C16.3 39.6 15 35.6 15.2 33.4 C15.4 31.2 16.2 32 19.9 29 Z',
    surfaces: {
      mesial: 'M47.9 24.6 C49.6 27.4 48.6 29 47.9 32.3 C47.2 35.6 46.7 41.7 43.7 44.4 L36.8 38.6 L38.4 31.1 Z',
      distal: 'M18.8 42.2 C16.3 39.6 15 35.6 15.2 33.4 C15.4 31.2 16.2 32 19.9 29 L27.8 32.8 L27.3 37.8 Z',
      buccal: 'M19.9 29 C23.6 26 32.8 16 37.5 15.3 C42.2 14.6 46.2 21.8 47.9 24.6 L38.4 31.1 L27.8 32.8 Z',
      lingual: 'M43.7 44.4 C40.8 47.2 34.4 49.2 30.2 48.8 C26.1 48.4 21.3 44.8 18.8 42.2 L27.3 37.8 L36.8 38.6 Z',
      central: 'M27.8 32.8 L38.4 31.1 L36.8 38.6 L27.3 37.8 Z',
    },
    detail: 'M37.5 15.3 L47.9 24.6 M37.5 15.3 L19.9 29 M32 33 L30.2 48.8',
    sideStrategy: 'mirror',
    simplification:
      "Cusp tip drawn less sharply pointed than the permanent canine's, matching the primary canine's characteristically blunter incisal profile.",
  },

  /**
   * Primary upper first molar. The famously ATYPICAL member of the whole
   * registry: NARROW (its §2.2 footprint is buccolingually deeper than it
   * is mesiodistally wide — the only molar in either dentition drawn that
   * way), with a PROMINENT MESIOBUCCAL CERVICAL BULGE as its own outline
   * point punched out just before the mesiobuccal corner, and a reduced
   * lingual half (the mesiolingual/distolingual corners pulled in relative
   * to the swollen mesiobuccal region). Deliberately neither premolar-like
   * nor a scaled-down permanent molar.
   */
  'primary:upper:first_molar': {
    outline: 'M17.2 20.6 C19.8 18.2 26 16 30.5 14.5 C35 13 41.3 11 44.4 11.8 C47.5 12.6 48.4 16.5 49.1 19.3 C49.8 22.1 49.7 24 48.4 28.8 C47.1 33.6 44.1 44 41.1 47.9 C38.1 51.8 34.3 53.1 30.5 52 C26.7 50.9 21.2 45 18.5 41.1 C15.9 37.2 14.8 32.2 14.6 28.8 C14.4 25.4 14.6 23 17.2 20.6 Z',
    surfaces: {
      mesial: 'M49.1 19.3 C49.8 22.1 49.7 24 48.4 28.8 C47.1 33.6 44.1 44 41.1 47.9 L35.3 38.5 L38.5 27.1 Z',
      distal: 'M18.5 41.1 C15.9 37.2 14.8 32.2 14.6 28.8 C14.4 25.4 14.6 23 17.2 20.6 L25.8 27.6 L26.3 35.8 Z',
      buccal: 'M17.2 20.6 C19.8 18.2 26 16 30.5 14.5 C35 13 41.3 11 44.4 11.8 C47.5 12.6 48.4 16.5 49.1 19.3 L38.5 27.1 L25.8 27.6 Z',
      lingual: 'M41.1 47.9 C38.1 51.8 34.3 53.1 30.5 52 C26.7 50.9 21.2 45 18.5 41.1 L26.3 35.8 L35.3 38.5 Z',
      central: 'M25.8 27.6 L38.5 27.1 L35.3 38.5 L26.3 35.8 Z',
    },
    detail: 'M33 24 L40 26 M42 20 L38 26 M30 40 L35 36',
    sideStrategy: 'mirror',
    simplification:
      'Fused, indistinct buccal cusps drawn as two short marks rather than separately triangulated cusps, and the single dominant mesiolingual cusp is only lightly implied — deliberately NOT modelled on either a premolar or a permanent molar, per its well-documented irregular morphology; exact cusp count is idealised.',
  },

  /**
   * Primary upper second molar. Closely resembles the permanent upper first
   * molar of the same arch: rhomboidal outline (mesiobuccal and distolingual
   * corners drawn acute, distobuccal and mesiolingual more open), oblique
   * ridge, 4 cusps — scaled down.
   */
  'primary:upper:second_molar': {
    outline: 'M22 17.5 C24.7 13.2 24 9.4 28.7 8.3 C33.4 7.2 46.9 9 50.3 10.8 C53.7 12.6 50.3 12 48.9 19.2 C47.6 26.4 46.7 48.8 42.2 54.1 C37.7 59.4 26.5 51.9 22 50.8 C17.5 49.7 16.9 50.3 15.3 47.5 C13.7 44.7 11.5 39.2 12.6 34.2 C13.7 29.2 19.3 21.8 22 17.5 Z',
    surfaces: {
      mesial: 'M50.3 10.8 C53.7 12.6 50.3 12 48.9 19.2 C47.6 26.4 46.7 48.8 42.2 54.1 L36.5 41.6 L39.9 23.4 Z',
      distal: 'M15.3 47.5 C13.7 44.7 11.5 39.2 12.6 34.2 C13.7 29.2 19.3 21.8 22 17.5 L28.1 26.2 L25.2 38.8 Z',
      buccal: 'M22 17.5 C24.7 13.2 24 9.4 28.7 8.3 C33.4 7.2 46.9 9 50.3 10.8 L39.9 23.4 L28.1 26.2 Z',
      lingual: 'M42.2 54.1 C37.7 59.4 26.5 51.9 22 50.8 C17.5 49.7 16.9 50.3 15.3 47.5 L25.2 38.8 L36.5 41.6 Z',
      central: 'M28.1 26.2 L39.9 23.4 L36.5 41.6 L25.2 38.8 Z',
    },
    detail: 'M45 15 L32 30 L22 46 M30 20 L36 38',
    sideStrategy: 'mirror',
    simplification:
      "Modelled closely on the permanent upper first molar's oblique-ridge pattern, scaled down and without a Carabelli-cusp mark, per its documented close resemblance to that tooth.",
  },

  // ============================================================
  // PRIMARY — LOWER (no premolars; deciduous positions 4/5 are molars)
  // ============================================================

  /**
   * Primary lower central incisor. R4B: redrawn plumper/more oval against
   * design/dental-chart/source-plates-svg/09_primary_lower_incisors_canine.svg
   * — same rationale as the primary upper incisors above. Smallest tooth in
   * the whole registry; real mesiodistal asymmetry is minimal but genuine
   * (mesioincisal corner still drawn tighter than distoincisal), with a
   * modest cingulum bulge.
   */
  'primary:lower:central_incisor': {
    outline: 'M23.2 26.8 C28 24.5 30.7 23.2 32 22.6 C33.3 23 36 23.8 40.8 25.3 C41.5 29 41.8 31 42 32 C41.7 32.9 41.1 34.7 40 38 C35.6 39.9 33.2 40.9 32 41.4 C30.7 40.7 28.2 39.2 23.6 36.5 C22.7 34 22.2 32.7 22 32 C22.2 31.2 22.5 29.7 23.2 26.8 Z',
    surfaces: {
      mesial: 'M40.8 25.3 C41.5 29 41.8 31 42 32 C41.7 32.9 41.1 34.7 40 38 L37.6 36.2 L38.2 27.3 Z',
      distal: 'M23.6 36.5 C22.7 34 22.2 32.7 22 32 C22.2 31.2 22.5 29.7 23.2 26.8 L25.8 28.4 L26.1 35.2 Z',
      buccal: 'M23.2 26.8 C28 24.5 30.7 23.2 32 22.6 C33.3 23 36 23.8 40.8 25.3 L38.2 27.3 L25.8 28.4 Z',
      lingual: 'M40 38 C35.6 39.9 33.2 40.9 32 41.4 C30.7 40.7 28.2 39.2 23.6 36.5 L26.1 35.2 L37.6 36.2 Z',
      central: 'M25.8 28.4 L38.2 27.3 L37.6 36.2 L26.1 35.2 Z',
    },
    detail: 'M26.5 26.3 L37.5 25.5 M28.5 37.5 L32 41.4 L35.5 37',
    sideStrategy: 'mirror',
    simplification:
      'Smallest tooth in the registry; drawn with minimal mesiodistal asymmetry since the real crown is nearly symmetric, but still genuinely broken about x=32 so the mirror is not a no-op.',
  },

  /**
   * Primary lower lateral incisor. R4B: redrawn plumper/more oval, same
   * plate and rationale as the primary lower central incisor above.
   * Slightly larger, slightly more asymmetric than the central, with a
   * marginally more pronounced cingulum bulge.
   */
  'primary:lower:lateral_incisor': {
    outline: 'M23 26.6 C28 24.3 30.7 23.1 32 22.5 C33.4 22.9 36.1 23.7 41 25.2 C41.7 28.9 42 31 42.2 32 C41.9 32.9 41.2 34.8 40 38.2 C35.6 40 33.2 41 32 41.5 C30.7 40.8 28 39.3 23.2 36.6 C22.4 34.1 22 32.7 21.8 32 C22 31.2 22.3 29.6 23 26.6 Z',
    surfaces: {
      mesial: 'M41 25.2 C41.7 28.9 42 31 42.2 32 C41.9 32.9 41.2 34.8 40 38.2 L37.6 36.3 L38.3 27.2 Z',
      distal: 'M23.2 36.6 C22.4 34.1 22 32.7 21.8 32 C22 31.2 22.3 29.6 23 26.6 L25.7 28.2 L25.8 35.2 Z',
      buccal: 'M23 26.6 C28 24.3 30.7 23.1 32 22.5 C33.4 22.9 36.1 23.7 41 25.2 L38.3 27.2 L25.7 28.2 Z',
      lingual: 'M40 38.2 C35.6 40 33.2 41 32 41.5 C30.7 40.8 28 39.3 23.2 36.6 L25.8 35.2 L37.6 36.3 Z',
      central: 'M25.7 28.2 L38.3 27.2 L37.6 36.3 L25.8 35.2 Z',
    },
    detail: 'M26.3 26.1 L37.7 25 M28.3 37.7 L32 41.5 L35.7 37.2',
    sideStrategy: 'mirror',
    simplification:
      'Drawn as a slightly larger, slightly more asymmetric version of the primary central incisor.',
  },

  /**
   * Primary lower canine. Diamond outline, blunter/more worn-looking cusp
   * tip than the permanent canine, displaced mesially like its upper
   * counterpart.
   */
  'primary:lower:canine': {
    outline: 'M23.8 29.3 C26.6 27.3 33.3 21.3 36.6 20.6 C39.9 19.9 42.6 23.3 43.6 25 C44.7 26.7 43.6 28.6 42.9 31 C42.3 33.5 41.8 37.6 39.7 39.7 C37.6 41.8 33.1 43.6 30.2 43.5 C27.4 43.4 24.3 40.9 22.6 39.1 C20.9 37.3 19.8 34.2 20 32.6 C20.2 31 21 31.3 23.8 29.3 Z',
    surfaces: {
      mesial: 'M43.6 25 C44.7 26.7 43.6 28.6 42.9 31 C42.3 33.5 41.8 37.6 39.7 39.7 L35.2 35.7 L36.7 30.1 Z',
      distal: 'M22.6 39.1 C20.9 37.3 19.8 34.2 20 32.6 C20.2 31 21 31.3 23.8 29.3 L29.1 31.8 L28.7 35.5 Z',
      buccal: 'M23.8 29.3 C26.6 27.3 33.3 21.3 36.6 20.6 C39.9 19.9 42.6 23.3 43.6 25 L36.7 30.1 L29.1 31.8 Z',
      lingual: 'M39.7 39.7 C37.6 41.8 33.1 43.6 30.2 43.5 C27.4 43.4 24.3 40.9 22.6 39.1 L28.7 35.5 L35.2 35.7 Z',
      central: 'M29.1 31.8 L36.7 30.1 L35.2 35.7 L28.7 35.5 Z',
    },
    detail: 'M36.6 20.6 L43.6 25 M36.6 20.6 L23.8 29.3 M31 33 L30.2 43.5',
    sideStrategy: 'mirror',
    simplification:
      "Cusp tip drawn blunter than the permanent canine's, matching the primary canine's characteristic worn/rounded incisal profile.",
  },

  /**
   * Primary lower first molar. The other ATYPICAL member: elongated
   * mesiodistally, with the same mesiobuccal-cervical-bulge outline device
   * as its upper counterpart (an extra point punched out just before the
   * mesiobuccal corner) and a strong transverse ridge in the detail
   * strokes. Not modelled on either a premolar or the permanent molar it
   * superficially resembles.
   */
  'primary:lower:first_molar': {
    outline: 'M15.6 24.5 C17.6 22.4 21.9 21.2 25.7 19.6 C29.5 18.1 34.5 15.4 38.4 15.2 C42.3 15 47.2 16.5 49.1 18.3 C51 20.1 50.7 21.5 49.7 25.8 C48.8 30.2 46.8 40.6 43.4 44.4 C40 48.2 33.7 49.1 29.5 48.7 C25.3 48.3 20.7 44.7 18.1 41.9 C15.5 39.1 14.1 34.9 13.7 32 C13.3 29.1 13.6 26.6 15.6 24.5 Z',
    surfaces: {
      mesial: 'M49.1 18.3 C51 20.1 50.7 21.5 49.7 25.8 C48.8 30.2 46.8 40.6 43.4 44.4 L36.5 37.4 L38.9 26.4 Z',
      distal: 'M18.1 41.9 C15.5 39.1 14.1 34.9 13.7 32 C13.3 29.1 13.6 26.6 15.6 24.5 L24.9 29 L25.9 36.3 Z',
      buccal: 'M15.6 24.5 C17.6 22.4 21.9 21.2 25.7 19.6 C29.5 18.1 34.5 15.4 38.4 15.2 C42.3 15 47.2 16.5 49.1 18.3 L38.9 26.4 L24.9 29 Z',
      lingual: 'M43.4 44.4 C40 48.2 33.7 49.1 29.5 48.7 C25.3 48.3 20.7 44.7 18.1 41.9 L25.9 36.3 L36.5 37.4 Z',
      central: 'M24.9 29 L38.9 26.4 L36.5 37.4 L25.9 36.3 Z',
    },
    detail: 'M34 21 L33 43 M40 18 L36 24',
    sideStrategy: 'mirror',
    simplification:
      'Prominent mesiobuccal cervical bulge drawn as its own outline point (its single most distinctive real trait); full cusp/fissure detail simplified to a transverse-ridge mark since this tooth is not modelled on either the premolar or the permanent molar it superficially resembles.',
  },

  /**
   * Primary lower second molar. Closely resembles the permanent lower first
   * molar of the same arch: pentagonal outline, 5-cusp Y-fissure pattern,
   * scaled down — but with its three buccal cusps (mesiobuccal, the
   * "dbBump" distal cusp, and the distobuccal corner) drawn closer to equal
   * prominence than the permanent tooth's graduated set.
   */
  'primary:lower:second_molar': {
    outline: 'M12.2 19.6 C14.9 16.7 19.9 14.7 24.5 13.3 C29.1 11.9 34.9 10.9 39.9 11.2 C44.9 11.5 52.3 13.1 54.6 15.4 C56.9 17.8 55.2 20.1 53.8 25.3 C52.4 30.5 50.2 41.9 46.1 46.5 C42 51.1 34.4 53.3 29.1 52.8 C23.8 52.3 18 47.4 14.5 43.7 C11 40.1 8.7 34.9 8.3 30.9 C7.9 26.9 9.5 22.5 12.2 19.6 Z',
    surfaces: {
      mesial: 'M54.6 15.4 C56.9 17.8 55.2 20.1 53.8 25.3 C52.4 30.5 50.2 41.9 46.1 46.5 L38.1 38 L41.9 24.3 Z',
      distal: 'M14.5 43.7 C11 40.1 8.7 34.9 8.3 30.9 C7.9 26.9 9.5 22.5 12.2 19.6 L23.2 26.2 L24.2 36.8 Z',
      buccal: 'M12.2 19.6 C14.9 16.7 19.9 14.7 24.5 13.3 C29.1 11.9 34.9 10.9 39.9 11.2 C44.9 11.5 52.3 13.1 54.6 15.4 L41.9 24.3 L23.2 26.2 Z',
      lingual: 'M46.1 46.5 C42 51.1 34.4 53.3 29.1 52.8 C23.8 52.3 18 47.4 14.5 43.7 L24.2 36.8 L38.1 38 Z',
      central: 'M23.2 26.2 L41.9 24.3 L38.1 38 L24.2 36.8 Z',
    },
    detail: 'M31 31 L20 27 M31 31 L44 25 M31 31 L30 44',
    sideStrategy: 'mirror',
    simplification:
      "Modelled closely on the permanent lower first molar's five-cusp Y-fissure pattern, scaled down, per its documented close resemblance; the small fifth (distal) cusp is drawn as its own outline bump (dbBump) close in prominence to the mesiobuccal cusp rather than the permanent tooth's more graduated set, and is not separately fissured.",
  },
};
