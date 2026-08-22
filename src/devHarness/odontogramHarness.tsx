/**
 * odontogramHarness.tsx — DENTAL-CHART-UX-001-R2 visual evidence harness
 *
 * Renders the REAL odontogram components against deterministic fixtures, with
 * no API, no auth and no router, so the delivery evidence is a screenshot of
 * the actual implementation rather than a mock-up of it.
 *
 * Usage: `npm run dev`, then /odontogram-harness.html?scene=<id>&w=<px>
 *
 * TEST TOOLING. Nothing under src/components or src/pages may import this.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../i18n/config';
import '../index.css';
import { Odontogram, ToothGlyph, getToothIdentity } from '../components/odontogram';
import { getLateralArt } from '../components/odontogram/lateralGeometry';
import ToothDetailPanel from '../components/ToothDetailPanel';
import type { Dentition, ToothRecord } from '../components/dentalChart.types';
import {
  formatCurrency,
  formatDateTime,
  NO_RECORDS,
  PERMANENT_RECORDS,
  PRIMARY_RECORDS,
  procedureMapFrom,
  PROCEDURES,
  RESTORATION_RECORDS,
} from './harnessData';

const params = new URLSearchParams(window.location.search);
const scene = params.get('scene') ?? 'adult-empty';
const widthParam = params.get('w');

const PROCEDURE_MAP = procedureMapFrom(PROCEDURES);
const EMPTY_PROCEDURES = new Map<number, never[]>();

/**
 * Mirrors how Odontogram sizes a column: ONE uniform width for every tooth.
 * Scaling each glyph by its own widthRatio here would be a misleading
 * comparison — it shrinks a narrow tooth vertically too, so a lower incisor
 * would look far shorter than a molar, which is not what the chart renders.
 */
const MATRIX_GLYPH_WIDTH = 74;
function glyphWidth(_fdi: number, base = MATRIX_GLYPH_WIDTH): number {
  return base;
}

function Stage({
  title,
  children,
  width,
}: {
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  const resolved = widthParam ? Number(widthParam) : width;
  return (
    <div className="min-h-screen bg-slate-100 p-4 dark:bg-gray-950">
      <div
        data-harness-scene={scene}
        style={resolved ? { width: `${resolved}px` } : undefined}
        className="mx-auto rounded-2xl bg-white p-5 shadow-sm dark:bg-gray-900"
      >
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

/** The chart exactly as Odontogram renders it, with injected records. */
function ChartScene({
  title,
  dentition,
  records,
  width,
  size = 'regular',
  selectedTooth = null,
}: {
  title: string;
  dentition: Dentition;
  records: Map<number, ToothRecord>;
  width?: number;
  size?: 'regular' | 'large' | 'presentation';
  selectedTooth?: number | null;
}) {
  return (
    <Stage title={title} width={width}>
      <Odontogram
        dentition={dentition}
        records={records}
        procedureMap={PROCEDURE_MAP}
        selectedTooth={selectedTooth}
        onSelect={() => undefined}
        size={size}
        patientMode={false}
      />
    </Stage>
  );
}

/**
 * Morphology matrix: one tooth per family, upper row and lower row, at
 * presentation size with the family name under each. This is the shot that
 * proves incisor/canine/premolar/molar are actually different drawings rather
 * than one repeated icon.
 */
function MorphologyMatrix({ dentition }: { dentition: Dentition }) {
  const { t } = useTranslation(['patients']);
  // Right-side quadrant of each arch, distal -> mesial, so the matrix reads in
  // the same order as the chart itself.
  const upper = dentition === 'primary' ? [55, 54, 53, 52, 51] : [18, 17, 16, 15, 14, 13, 12, 11];
  const lower = dentition === 'primary' ? [85, 84, 83, 82, 81] : [48, 47, 46, 45, 44, 43, 42, 41];

  const renderRow = (teeth: number[], label: string) => (
    <div className="mb-8">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex items-end gap-4">
        {teeth.map((fdi) => {
          const identity = getToothIdentity(fdi);
          return (
            <div key={fdi} className="flex w-[84px] flex-col items-center justify-end gap-1.5">
              <ToothGlyph
                fdi={fdi}
                width={glyphWidth(fdi)}
                isSelected={false}
                size="presentation"
                tabIndex={-1}
                onSelect={() => undefined}
              />
              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{fdi}</span>
              <span className="max-w-[90px] text-center text-[10px] leading-tight text-slate-500">
                {t(`patients:dentalChart.toothFamily.${identity.family}`, {
                  defaultValue: identity.family,
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Stage
      title={`morphology matrix — ${dentition}`}
      width={dentition === 'primary' ? 760 : 1120}
    >
      {renderRow(upper, 'Upper right quadrant')}
      {renderRow(lower, 'Lower right quadrant')}
    </Stage>
  );
}

/** Same tooth family, right vs left, so mirroring can be judged directly. */
function SideComparison() {
  const pairs: [number, number][] = [
    [16, 26],
    [13, 23],
    [14, 24],
    [46, 36],
    [43, 33],
  ];
  return (
    <Stage title="left vs right morphology (patient right | patient left)" width={900}>
      <div className="flex flex-wrap gap-10">
        {pairs.map(([right, left]) => (
          <div key={`${right}-${left}`} className="flex items-start gap-3">
            <div className="flex flex-col items-center gap-1.5">
              <ToothGlyph fdi={right} width={glyphWidth(right)} isSelected={false} size="presentation" tabIndex={-1} onSelect={() => undefined} />
              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{right}</span>
              <span className="text-[10px] text-slate-500">R</span>
            </div>
            <div className="mt-6 h-20 w-px bg-slate-200 dark:bg-gray-700" />
            <div className="flex flex-col items-center gap-1.5">
              <ToothGlyph fdi={left} width={glyphWidth(left)} isSelected={false} size="presentation" tabIndex={-1} onSelect={() => undefined} />
              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{left}</span>
              <span className="text-[10px] text-slate-500">L</span>
            </div>
          </div>
        ))}
      </div>
    </Stage>
  );
}

/** Big close-up of a few teeth so lateral/occlusal alignment can be judged. */
function DualViewCloseup() {
  return (
    <Stage title="lateral + occlusal alignment (upper 16-11, lower 46-41)" width={880}>
      <div className="mb-10">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Upper right</p>
        <div className="flex items-end gap-6" style={{ zoom: 1.8 }}>
          {[16, 15, 14, 13, 12, 11].map((fdi) => (
            <ToothGlyph key={fdi} fdi={fdi} width={glyphWidth(fdi)} isSelected={false} size="presentation" tabIndex={-1} onSelect={() => undefined} />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Lower right</p>
        <div className="flex items-start gap-6" style={{ zoom: 1.8 }}>
          {[46, 45, 44, 43, 42, 41].map((fdi) => (
            <ToothGlyph key={fdi} fdi={fdi} width={glyphWidth(fdi)} isSelected={false} size="presentation" tabIndex={-1} onSelect={() => undefined} />
          ))}
        </div>
      </div>
    </Stage>
  );
}

/** Crown / implant / missing, magnified, next to untreated neighbours. */
function RestorationCloseup() {
  return (
    <Stage title="crown / missing / implant" width={1180}>
      <div style={{ zoom: 1.45 }}>
        <Odontogram
          dentition="permanent"
          records={RESTORATION_RECORDS}
          procedureMap={EMPTY_PROCEDURES as never}
          selectedTooth={null}
          onSelect={() => undefined}
          size="regular"
          patientMode={false}
        />
      </div>
    </Stage>
  );
}

/** Chart + real ToothDetailPanel side by side, mirroring the app layout. */
function SelectedWithPanel({ fdi }: { fdi: number }) {
  return (
    <Stage title={`selected tooth ${fdi} + detail panel (incl. timeline)`} width={1320}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Odontogram
            dentition="permanent"
            records={PERMANENT_RECORDS}
            procedureMap={PROCEDURE_MAP}
            selectedTooth={fdi}
            onSelect={() => undefined}
            size="regular"
            patientMode={false}
          />
        </div>
        <ToothDetailPanel
          selectedTooth={fdi}
          record={PERMANENT_RECORDS.get(fdi)}
          procedures={PROCEDURE_MAP.get(fdi) ?? []}
          editStatus={PERMANENT_RECORDS.get(fdi)?.status ?? 'planned'}
          editNote={PERMANENT_RECORDS.get(fdi)?.note ?? ''}
          canEdit
          patientMode={false}
          saving={false}
          formatDateTime={formatDateTime}
          formatCurrency={formatCurrency}
          onStatusChange={() => undefined}
          onQuickStatusSave={() => undefined}
          onNoteChange={() => undefined}
          onSave={() => undefined}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </Stage>
  );
}

const SCENES: Record<string, () => JSX.Element> = {
  'adult-empty': () => (
    <ChartScene title="adult odontogram — no statuses" dentition="permanent" records={NO_RECORDS} width={1180} />
  ),
  'adult-status': () => (
    <ChartScene title="adult odontogram — representative statuses" dentition="permanent" records={PERMANENT_RECORDS} width={1180} />
  ),
  'primary-empty': () => (
    <ChartScene title="primary odontogram — no statuses" dentition="primary" records={NO_RECORDS} width={900} />
  ),
  'primary-status': () => (
    <ChartScene title="primary odontogram — representative statuses" dentition="primary" records={PRIMARY_RECORDS} width={900} />
  ),
  'matrix-adult': () => <MorphologyMatrix dentition="permanent" />,
  'matrix-primary': () => <MorphologyMatrix dentition="primary" />,
  'dual-closeup': DualViewCloseup,
  'sides-closeup': SideComparison,
  'patient-detail-scale': () => (
    <ChartScene title="patient detail content width (~900px)" dentition="permanent" records={PERMANENT_RECORDS} width={900} />
  ),
  fullscreen: () => (
    <ChartScene
      title="fullscreen presentation size"
      dentition="permanent"
      records={PERMANENT_RECORDS}
      width={1760}
      size="presentation"
    />
  ),
  'selected-detail': () => <SelectedWithPanel fdi={16} />,
  restorations: RestorationCloseup,
  narrow: () => (
    <ChartScene title="narrow viewport (620px)" dentition="permanent" records={PERMANENT_RECORDS} width={620} />
  ),
};

const Scene = SCENES[scene] ?? SCENES['adult-empty'];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* ToothDetailPanel links to /treatment-cases/:id, so a router is required. */}
    <MemoryRouter>
      <Scene />
    </MemoryRouter>
  </React.StrictMode>,
);

setTimeout(() => {
  document.documentElement.setAttribute('data-harness-ready', 'true');
}, 400);
