/**
 * exportToothSvgs.ts — DENTAL-CHART-ASSET-R3 (Lane G)
 *
 * Generates 104 standalone `.svg` files — one lateral view and one occlusal
 * view for every permanent (32) and primary (20) tooth — from the SAME
 * anatomy registries and bounds math the running app uses to draw the
 * odontogram (`ToothGlyph.tsx`). This is deliberately NOT 104 hand-drawn
 * files:
 *
 *   - ONE SOURCE OF TRUTH. The crown/root/surface paths live exactly once,
 *     in `lateralGeometry.ts` / `occlusalGeometry.ts`. A hand-maintained
 *     second copy of 52 teeth would drift from the app the first time an
 *     artist tweaked a curve without remembering to re-export it by hand.
 *   - MIRRORING IS ANATOMY. Every artwork entry is authored once, for the
 *     tooth's patient-RIGHT side (see `anatomy.types.ts`); the left side and
 *     the opposite arch are produced by the SAME `<g transform>` math the
 *     renderer applies. Re-deriving that transform here (rather than baking
 *     mirrored coordinates into a second hand-drawn file) is what keeps
 *     tooth 11 and tooth 21 genuine reflections of one another instead of
 *     two independently-maintained drawings that can quietly diverge.
 *   - DRIFT IS CAUGHT BY A TEST, NOT BY EYEBALLING A DIFF. Because this
 *     script re-reads the live registries every run,
 *     `__tests__/toothSvgAssets.test.ts` can regenerate in memory and diff
 *     against the committed files byte-for-byte — the moment an artwork lane
 *     changes a path and forgets to re-run `npm run assets:teeth`, the test
 *     fails instead of the exported assets silently going stale.
 *
 * This script owns NO artwork of its own: it reads `getLateralArt` /
 * `getOcclusalArt` / `getLateralViewBox` / `getOcclusalCrop` through their
 * public API and lays out whatever geometry those return. It does not
 * recompute bounds, does not invent colours outside `toothPalette.ts`, and
 * does not know what an artwork lane changed.
 *
 * STATUS: every export is the BASE "no record" anatomy — plain crown/root
 * materials, no clinical status tint, no missing/implant overlay. Status is
 * a presentation layer applied at render time in the app (see
 * `anatomy.types.ts`); baking one status into a static asset would make the
 * exported file wrong the moment the tooth's real status changed, so these
 * files intentionally show the tooth as if no procedure record existed yet.
 *
 * DETERMINISM. No timestamps, no random ids, no locale-dependent formatting.
 * All computed coordinates come from `lateralBounds.ts` / `occlusalBounds.ts`,
 * which already round to 2 decimal places; nothing in this file re-rounds or
 * recomputes a coordinate independently. Output uses `\n` line endings only.
 * Re-running this script with unchanged registries reproduces byte-identical
 * files — the whole output directory is wiped and rewritten every run so a
 * renamed/removed tooth cannot leave a stale orphan file behind.
 *
 * Run with: npm run assets:teeth  (== tsx scripts/dental-assets/exportToothSvgs.ts)
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERMANENT_FDI, PRIMARY_FDI } from '../../src/components/dentalChart.types';
import { getToothIdentity } from '../../src/components/odontogram/toothIdentity';
import type { ToothIdentity } from '../../src/components/odontogram/toothIdentity';
import { getLateralArt } from '../../src/components/odontogram/lateralGeometry';
import { getOcclusalArt } from '../../src/components/odontogram/occlusalGeometry';
import { getLateralViewBox } from '../../src/components/odontogram/lateralBounds';
import { getOcclusalCrop } from '../../src/components/odontogram/occlusalBounds';
import {
  LATERAL_VIEWBOX,
  OCCLUSAL_VIEWBOX,
  OCCLUSAL_SURFACE_NAMES,
} from '../../src/components/odontogram/anatomy.types';
import type {
  LateralToothArt,
  OcclusalToothArt,
  OcclusalSurfaceName,
  SideStrategy,
} from '../../src/components/odontogram/anatomy.types';
import {
  TOOTH_MATERIAL_HEX,
  TOOTH_STROKE_WIDTH,
  TOOTH_STROKE_OPACITY,
} from '../../src/components/odontogram/toothPalette';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** design/dental-chart/final-svg, resolved from this file's own location so
 *  it works regardless of the process's current working directory. */
export const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, '../../design/dental-chart/final-svg');

type View = 'lateral' | 'occlusal';
/** "adult" is the on-disk/on-filename segment for the PERMANENT dentition —
 *  see the task brief; `ToothIdentity.dentition` itself stays 'permanent'. */
type DentitionDir = 'adult' | 'primary';

export interface GeneratedFile {
  /** Forward-slash relative path, e.g. "adult/lateral/tooth_11_adult_lateral.svg". */
  relativePath: string;
  content: string;
}

// ── Transform contract (anatomy.types.ts / ToothGlyph.tsx `lateralTransform`
// / `occlusalTransform`) ─────────────────────────────────────────────────
//
// Re-derived here rather than imported because ToothGlyph.tsx does not export
// those two helpers (they are render-internal), and this script must not
// import anything from a React component module. The math is copied
// verbatim from the contract documented at the top of anatomy.types.ts and
// implemented in ToothGlyph.tsx: read both before changing either side.

function parseViewBoxSize(viewBox: string): { w: number; h: number } {
  const parts = viewBox.trim().split(/\s+/).map(Number);
  return { w: parts[2], h: parts[3] };
}

const LATERAL_AUTHORED = parseViewBoxSize(LATERAL_VIEWBOX); // { w: 64, h: 88 }
const OCCLUSAL_AUTHORED = parseViewBoxSize(OCCLUSAL_VIEWBOX); // { w: 64, h: 64 }

function lateralTransform(identity: ToothIdentity, sideStrategy: SideStrategy): string | undefined {
  const parts: string[] = [];
  if (identity.arch === 'upper') parts.push(`translate(0 ${LATERAL_AUTHORED.h}) scale(1 -1)`);
  if (identity.side === 'left' && sideStrategy === 'mirror') {
    parts.push(`translate(${LATERAL_AUTHORED.w} 0) scale(-1 1)`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

function occlusalTransform(identity: ToothIdentity, sideStrategy: SideStrategy): string | undefined {
  const parts: string[] = [];
  if (identity.side === 'left' && sideStrategy === 'mirror') {
    parts.push(`translate(${OCCLUSAL_AUTHORED.w} 0) scale(-1 1)`);
  }
  if (identity.arch === 'lower') parts.push(`translate(0 ${OCCLUSAL_AUTHORED.h}) scale(1 -1)`);
  return parts.length ? parts.join(' ') : undefined;
}

// ── Labels (title/desc/filename) ────────────────────────────────────────

function familyPhrase(family: string): string {
  return family.replace(/_/g, ' ');
}

function dentitionPhrase(identity: ToothIdentity): string {
  return identity.dentition === 'primary' ? 'primary (deciduous)' : 'permanent (adult)';
}

function surfaceLabel(name: OcclusalSurfaceName, identity: ToothIdentity): string {
  if (name === 'lingual') return identity.arch === 'upper' ? 'palatal' : 'lingual';
  if (name === 'central') return identity.isPosterior ? 'occlusal' : 'incisal';
  return name;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTitle(fdi: number, identity: ToothIdentity, view: View): string {
  const viewWord = view === 'lateral' ? 'lateral' : 'occlusal';
  return `Tooth ${fdi} — ${dentitionPhrase(identity)} ${identity.arch} ${identity.side} ${familyPhrase(identity.family)} — ${viewWord} view`;
}

function buildDesc(fdi: number, identity: ToothIdentity, view: View): string {
  const viewPhrase = view === 'lateral' ? 'lateral (buccal/facial)' : 'occlusal/incisal';
  return (
    `Standalone ${viewPhrase} anatomy for tooth ${fdi} (${dentitionPhrase(identity)}, ` +
    `${identity.arch} ${identity.side} ${familyPhrase(identity.family)}), generated from the ` +
    `app's anatomy registries. Base "no record" status only — no clinical status tint applied.`
  );
}

function relativePathFor(fdi: number, dentitionDir: DentitionDir, view: View): string {
  return `${dentitionDir}/${view}/tooth_${fdi}_${dentitionDir}_${view}.svg`;
}

// ── SVG builders ─────────────────────────────────────────────────────────

function buildLateralSvg(fdi: number, identity: ToothIdentity, art: LateralToothArt): string {
  const viewBox = getLateralViewBox(identity, art);
  const { w, h } = parseViewBoxSize(viewBox);
  const transform = lateralTransform(identity, art.sideStrategy);
  const gOpen = transform ? `<g transform="${transform}">` : '<g>';

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" data-tooth-fdi="${fdi}" data-view="lateral" role="img">`,
    `  <title>${escapeXml(buildTitle(fdi, identity, 'lateral'))}</title>`,
    `  <desc>${escapeXml(buildDesc(fdi, identity, 'lateral'))}</desc>`,
    `  ${gOpen}`,
    // Paint order matches ToothGlyph.tsx exactly: roots, then crown, then
    // surface detail, then the cervical line (see LateralView in
    // ToothGlyph.tsx — surface is drawn before cervical there).
    ...art.roots.map(
      (d, index) =>
        `    <path d="${d}" fill="${TOOTH_MATERIAL_HEX.dentinFill}" stroke="${TOOTH_MATERIAL_HEX.dentinStroke}" stroke-width="${TOOTH_STROKE_WIDTH.root}" stroke-linecap="round" stroke-linejoin="round" data-part="root" data-root-index="${index}"/>`,
    ),
    `    <path d="${art.crown}" fill="${TOOTH_MATERIAL_HEX.enamelFill}" stroke="${TOOTH_MATERIAL_HEX.enamelStroke}" stroke-width="${TOOTH_STROKE_WIDTH.crown}" stroke-linecap="round" stroke-linejoin="round" data-part="crown"/>`,
    `    <path d="${art.surface}" fill="none" stroke="${TOOTH_MATERIAL_HEX.surfaceStroke}" stroke-width="${TOOTH_STROKE_WIDTH.surface}" stroke-opacity="${TOOTH_STROKE_OPACITY.surface}" stroke-linecap="round" data-part="surface"/>`,
    `    <path d="${art.cervical}" fill="none" stroke="${TOOTH_MATERIAL_HEX.cervicalStroke}" stroke-width="${TOOTH_STROKE_WIDTH.cervical}" stroke-opacity="${TOOTH_STROKE_OPACITY.cervical}" stroke-linecap="round" data-part="cervical"/>`,
    '  </g>',
    '</svg>',
  ];
  return lines.join('\n') + '\n';
}

function buildOcclusalSvg(fdi: number, identity: ToothIdentity, art: OcclusalToothArt): string {
  const crop = getOcclusalCrop(identity);
  const { w, h } = parseViewBoxSize(crop.viewBox);
  const transform = occlusalTransform(identity, art.sideStrategy);
  const gOpen = transform ? `<g transform="${transform}">` : '<g>';

  const surfaceLines = OCCLUSAL_SURFACE_NAMES.map((name) => {
    const label = surfaceLabel(name, identity);
    // No fill/stroke on the surface regions: base status is "no record", so
    // these tiles carry only structure (data-surface, for future per-surface
    // charting — see anatomy.types.ts) and no visual tint of their own. The
    // outline + detail strokes below are what makes the crown legible.
    return (
      `    <path d="${art.surfaces[name]}" data-surface="${name}" data-tooth-fdi="${fdi}" fill="none" stroke="none">` +
      `<title>${escapeXml(label)}</title></path>`
    );
  });

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${crop.viewBox}" width="${w}" height="${h}" data-tooth-fdi="${fdi}" data-view="occlusal" role="img">`,
    `  <title>${escapeXml(buildTitle(fdi, identity, 'occlusal'))}</title>`,
    `  <desc>${escapeXml(buildDesc(fdi, identity, 'occlusal'))}</desc>`,
    `  ${gOpen}`,
    // Paint order matches ToothGlyph.tsx's OcclusalView exactly: outline,
    // then the five surface regions, then fissure/edge detail.
    `    <path d="${art.outline}" fill="${TOOTH_MATERIAL_HEX.enamelFill}" stroke="${TOOTH_MATERIAL_HEX.enamelStroke}" stroke-width="${TOOTH_STROKE_WIDTH.occlusalOutline}" stroke-linecap="round" stroke-linejoin="round" data-part="outline"/>`,
    ...surfaceLines,
    `    <path d="${art.detail}" fill="none" stroke="${TOOTH_MATERIAL_HEX.surfaceStroke}" stroke-width="${TOOTH_STROKE_WIDTH.occlusalDetail}" stroke-opacity="${TOOTH_STROKE_OPACITY.occlusalDetail}" stroke-linecap="round" data-part="detail"/>`,
    '  </g>',
    '</svg>',
  ];
  return lines.join('\n') + '\n';
}

// ── Public generation API ───────────────────────────────────────────────

/**
 * Generates all 104 files in memory (no filesystem I/O), so the regression
 * test can call this directly and diff against the committed files without
 * shelling out to a second process.
 */
export function generateAllToothSvgs(): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const allFdi: number[] = [...PERMANENT_FDI, ...PRIMARY_FDI];

  for (const fdi of allFdi) {
    const identity = getToothIdentity(fdi);
    const dentitionDir: DentitionDir = identity.dentition === 'permanent' ? 'adult' : 'primary';

    const lateralArt = getLateralArt(identity);
    files.push({
      relativePath: relativePathFor(fdi, dentitionDir, 'lateral'),
      content: buildLateralSvg(fdi, identity, lateralArt),
    });

    const occlusalArt = getOcclusalArt(identity);
    files.push({
      relativePath: relativePathFor(fdi, dentitionDir, 'occlusal'),
      content: buildOcclusalSvg(fdi, identity, occlusalArt),
    });
  }

  // Stable order regardless of iteration order above, so the returned array
  // itself is deterministic for any consumer that snapshots it directly.
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

/**
 * Writes all generated files to `outputRoot`, wiping it first so a tooth
 * that is renamed or removed from the registries cannot leave a stale file
 * behind and `git status` stays clean on a no-op regeneration.
 */
export async function writeAllToothSvgs(outputRoot: string = DEFAULT_OUTPUT_ROOT): Promise<GeneratedFile[]> {
  const files = generateAllToothSvgs();
  await rm(outputRoot, { recursive: true, force: true });
  for (const file of files) {
    const absPath = path.join(outputRoot, ...file.relativePath.split('/'));
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, file.content, 'utf8');
  }
  return files;
}

async function main(): Promise<void> {
  const files = await writeAllToothSvgs();
  console.log(`Wrote ${files.length} tooth SVG files under ${path.relative(process.cwd(), DEFAULT_OUTPUT_ROOT)}`);
}

const isMainModule = path.resolve(process.argv[1] ?? '') === __filename;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
