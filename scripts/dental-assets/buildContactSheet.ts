/**
 * buildContactSheet.ts — DENTAL-CHART-ASSET-R3
 *
 * Emits `design/dental-chart/asset-contact-sheet.html`: every one of the 104
 * exported tooth SVGs on one page, grouped by dentition/view and laid out in
 * anatomical arch order.
 *
 * WHY THIS EXISTS
 * ---------------
 * A directory of 104 SVG files is not reviewable. The defects that matter in a
 * tooth asset set are almost all COMPARATIVE — a molar that is accidentally
 * narrower than its neighbour, a quadrant whose mirror did not take, a primary
 * tooth that drifted toward permanent proportions — and none of them are
 * visible one file at a time. Seeing an arch in order, side by side, is what
 * makes them obvious in seconds.
 *
 * The sheet inlines every SVG rather than linking it, so the file can be
 * opened straight off disk, mailed to a dentist for sign-off, or attached to a
 * review with no server and no asset paths to break.
 *
 * It is a REVIEW artefact, not an application asset. Nothing under src/
 * imports it, and it deliberately lives outside `final-svg/` so it never
 * appears to the exporter's drift guard as a stray file in an output
 * directory.
 *
 * Run with: npm run assets:teeth:sheet
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMANENT_FDI, PRIMARY_FDI } from '../../src/components/dentalChart.types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DESIGN_ROOT = path.resolve(__dirname, '../../design/dental-chart');
const SVG_ROOT = path.join(DESIGN_ROOT, 'final-svg');
const OUTPUT = path.join(DESIGN_ROOT, 'asset-contact-sheet.html');

type Dentition = 'adult' | 'primary';
type View = 'lateral' | 'occlusal';

/**
 * Screen order, patient's right first — the same left-to-right reading order
 * the chart itself uses, so a defect spotted here maps straight onto a tooth
 * in the running app rather than needing to be re-found.
 */
function archRows(dentition: Dentition): { label: string; fdis: number[] }[] {
  if (dentition === 'adult') {
    return [
      { label: 'Upper arch — patient right (18→11) then patient left (21→28)', fdis: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] },
      { label: 'Lower arch — patient right (48→41) then patient left (31→38)', fdis: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] },
    ];
  }
  return [
    { label: 'Upper arch — patient right (55→51) then patient left (61→65)', fdis: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65] },
    { label: 'Lower arch — patient right (85→81) then patient left (71→75)', fdis: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75] },
  ];
}

function relPath(fdi: number, dentition: Dentition, view: View): string {
  return path.join(dentition, view, `tooth_${fdi}_${dentition}_${view}.svg`);
}

/**
 * Strip the standalone document's own sizing so the sheet's CSS controls the
 * cell size. The exported files are deliberately fixed-size for use as assets;
 * a contact sheet needs them fluid.
 */
function inlineSvg(source: string): string {
  return source
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace('<svg ', '<svg class="glyph" ')
    .trim();
}

async function buildSection(dentition: Dentition, view: View): Promise<string> {
  const rows = await Promise.all(
    archRows(dentition).map(async (row) => {
      const cells = await Promise.all(
        row.fdis.map(async (fdi) => {
          const file = path.join(SVG_ROOT, relPath(fdi, dentition, view));
          const svg = await readFile(file, 'utf8');
          return `<figure class="cell"><div class="art">${inlineSvg(svg)}</div><figcaption>${fdi}</figcaption></figure>`;
        }),
      );
      return `<h3>${row.label}</h3><div class="row">${cells.join('')}</div>`;
    }),
  );
  const viewWord = view === 'lateral' ? 'Lateral (buccal/facial)' : 'Occlusal / incisal';
  const dentitionWord = dentition === 'adult' ? 'Permanent (adult)' : 'Primary (deciduous)';
  return `<section><h2>${dentitionWord} — ${viewWord}</h2>${rows.join('')}</section>`;
}

async function main() {
  const sections: string[] = [];
  for (const dentition of ['adult', 'primary'] as const) {
    for (const view of ['lateral', 'occlusal'] as const) {
      sections.push(await buildSection(dentition, view));
    }
  }

  const total = (PERMANENT_FDI.length + PRIMARY_FDI.length) * 2;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NoraMedi — tooth asset contact sheet</title>
<style>
  :root { color-scheme: light; --ink:#1e293b; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:var(--bg); color:var(--ink);
         font:14px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { max-width:1200px; margin:0 auto 28px; }
  h1 { font-size:20px; margin:0 0 6px; letter-spacing:-0.01em; }
  header p { margin:0; color:var(--muted); max-width:70ch; }
  section { max-width:1200px; margin:0 auto 34px; background:#fff; border:1px solid var(--line);
            border-radius:12px; padding:20px 24px 24px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted);
       margin:0 0 4px; font-weight:600; }
  h3 { font-size:12px; font-weight:500; color:var(--muted); margin:18px 0 8px; }
  .row { display:flex; gap:6px; align-items:flex-end; overflow-x:auto; padding-bottom:4px; }
  .cell { margin:0; flex:1 1 0; min-width:46px; text-align:center; }
  .art { display:flex; align-items:flex-end; justify-content:center; height:132px; }
  .glyph { max-width:100%; max-height:100%; }
  figcaption { margin-top:6px; font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; }
  footer { max-width:1200px; margin:0 auto; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>Tooth asset contact sheet — ${total} SVGs</h1>
  <p>Every exported asset, inlined, in chart reading order (patient's right first).
     Generated from <code>design/dental-chart/final-svg/</code> by
     <code>npm run assets:teeth:sheet</code> — a review artefact, not an application asset.
     Regenerate it after any change to the artwork registries.</p>
</header>
${sections.join('\n')}
<footer>Assets are hand-authored vector paths built against the shared coordinate system in
  <code>design/dental-chart/AUTHORING.md</code>. Contralateral teeth are genuine mirror images,
  which is correct anatomy: antimeres.</footer>
</body>
</html>
`;

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, html, 'utf8');
  console.log(`Wrote contact sheet for ${total} assets to ${path.relative(process.cwd(), OUTPUT)}`);
}

void main();
