/**
 * Odontogram.tsx — DENTAL-CHART-UX-001-R2 (Lane A: frameless layout)
 *
 * PURELY PRESENTATIONAL. Every tooth comes in as props (`records`,
 * `procedureMap`) — this component does no fetching, so it can be mounted in
 * a screenshot harness with injected data.
 *
 * Layout, read top to bottom (the "mirrored vertical stack around the
 * occlusal midline" from the task brief):
 *
 *   upper quadrant chips
 *   upper lateral row      \  both live inside each ToothGlyph, stacked
 *   upper occlusal row     /  lateral-then-occlusal for the upper arch
 *   upper FDI numbers
 *   thin midline separator
 *   lower FDI numbers
 *   lower occlusal row     \  stacked occlusal-then-lateral for the lower
 *   lower lateral row      /  arch, so the mirror is exact around the line
 *   lower quadrant chips
 *
 * Teeth sit directly on the page — no card, no border, no filled tile per
 * tooth. The only rectangle anywhere is the dashed selection frame that
 * ToothGlyph draws around a selected tooth's lateral+occlusal pair.
 *
 * Keyboard: roving tabindex — the arch is ONE tab stop. Arrow Left/Right walk
 * the row (crossing the midline into the other quadrant is just the next
 * array index, since each row is built as [...rightQuadrant, ...leftQuadrant]
 * in screen left-to-right order already). Arrow Up/Down jump to the same
 * column index in the other arch. Home/End go to the row ends.
 *
 * SIZING (refinement pass) — column widths are now resolved PX values, not
 * `fr` proportions: each arch position gets `BASE_WIDTH[size] *
 * max(upperRatio, lowerRatio)`, the same number handed to ToothGlyph so the
 * button actually fills its column instead of floating inside a wider,
 * flex-centred cell. At `regular` size across a 16-tooth adult arch this
 * puts molars around 62-71px wide with a few px of gap between teeth —
 * dense, not sparse. Columns are shared between the upper and lower arch
 * (whichever of the two is wider at that position wins) so both arches and
 * the R/L markers stay in register.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROCEDURE_STATUS_META, ToothRecord, TreatmentProcedure, Dentition } from '../dentalChart.types';
import ToothGlyph, { getGlyphLateralWidth, ChartSize } from './ToothGlyph';
import { getToothIdentity } from './toothIdentity';
import { getLateralArt } from './lateralGeometry';
import { getUpperRow, getLowerRow } from './chartOrder';

export interface OdontogramProps {
  dentition: Dentition;
  records: Map<number, ToothRecord>;
  procedureMap: Map<number, TreatmentProcedure[]>;
  selectedTooth: number | null;
  onSelect: (fdi: number) => void;
  size: ChartSize;
  patientMode: boolean;
}

const MIN_WIDTH = 28;
// Tight, even pitch: adjacent teeth in a real arch nearly touch, and every
// px of gutter here is a px the 16-tooth adult arch cannot spend on anatomy.
const COLUMN_GAP: Record<ChartSize, number> = { regular: 2, large: 3, presentation: 4 };

const MARKER_WIDTH: Record<ChartSize, number> = {
  regular: 28,
  large: 38,
  presentation: 52,
};

// Prominent, high-contrast — the primary orientation cue, not a decoration.
const MARKER_TEXT_CLASS: Record<ChartSize, string> = {
  regular: 'text-2xl',
  large: 'text-3xl',
  presentation: 'text-5xl',
};
const MARKER_COLOR_CLASS = 'text-slate-800 dark:text-slate-100';

const NUMBER_TEXT_CLASS: Record<ChartSize, string> = {
  regular: 'text-[11px]',
  large: 'text-xs',
  presentation: 'text-sm',
};

// Fixed height reserved for the procedure-dot strip under every FDI number,
// whether or not that tooth has procedures — this is what keeps every
// number in the row on one baseline (see task item 7).
const DOT_ROW_HEIGHT: Record<ChartSize, number> = { regular: 6, large: 7, presentation: 9 };

const CHIP_TEXT_CLASS: Record<ChartSize, string> = {
  regular: 'text-[10px]',
  large: 'text-[11px]',
  presentation: 'text-xs',
};

function Chip({ children, emphasis, size }: { children: React.ReactNode; emphasis?: boolean; size: ChartSize }) {
  return (
    <span
      className={[
        'rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide',
        CHIP_TEXT_CLASS[size],
        emphasis
          ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-slate-400',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

function Marker({ label, size, ariaLabel }: { label: string; size: ChartSize; ariaLabel: string }) {
  return (
    <span
      aria-label={ariaLabel}
      style={{ alignSelf: 'center' }}
      className={['flex items-center justify-center font-black', MARKER_TEXT_CLASS[size], MARKER_COLOR_CLASS].join(' ')}
    >
      {label}
    </span>
  );
}

const Odontogram: React.FC<OdontogramProps> = ({
  dentition,
  records,
  procedureMap,
  selectedTooth,
  onSelect,
  size,
  patientMode,
}) => {
  const { t } = useTranslation(['patients']);

  const upperRow = useMemo(() => getUpperRow(dentition), [dentition]);
  const lowerRow = useMemo(() => getLowerRow(dentition), [dentition]);

  // ONE uniform column width for the whole arch.
  //
  // Column pitch is even and every tooth renders into an identically sized
  // box; the visible width difference between a molar and an incisor comes
  // from the ARTWORK Lane B drew inside that shared box. Deriving the pitch
  // from per-tooth `widthRatio` instead looked plausible but was wrong twice
  // over: it made the gaps uneven, and it forced the glyph to scale x and y by
  // different factors, which visibly stretched narrow crowns. `widthRatio`
  // remains part of the artwork contract (and is asserted by the anatomy
  // tests) — it is simply not what drives the grid.
  const columnWidth = useMemo(
    () => Math.max(MIN_WIDTH, getGlyphLateralWidth(dentition, size)),
    [dentition, size],
  );
  const columnWidths = useMemo(
    () => upperRow.map(() => columnWidth),
    [upperRow, columnWidth],
  );

  const gridTemplateColumns = useMemo(
    () => `${MARKER_WIDTH[size]}px ${columnWidths.map((w) => `${w}px`).join(' ')} ${MARKER_WIDTH[size]}px`,
    [columnWidths, size],
  );
  const baseGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns,
    columnGap: COLUMN_GAP[size],
    justifyContent: 'center',
  };

  // Within a tooth's glyph, the crown "seam" (where the lateral and
  // occlusal views meet) sits at a FIXED distance from whichever end of the
  // button holds the lateral view (constant height) — the occlusal view's
  // height varies per family. So: the upper row (lateral-then-occlusal)
  // must be TOP-aligned to keep that seam level across the row, and the
  // lower row (occlusal-then-lateral) must be BOTTOM-aligned — otherwise
  // the crowns visibly jitter again, just from the occlusal side this time.
  const upperGridStyle: React.CSSProperties = { ...baseGridStyle, alignItems: 'start' };
  const lowerGridStyle: React.CSSProperties = { ...baseGridStyle, alignItems: 'end' };
  const numberGridStyle: React.CSSProperties = { ...baseGridStyle, alignItems: 'start' };

  // ── Roving tabindex + arrow-key navigation ────────────────────────────────
  const buttonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [focusedFdi, setFocusedFdi] = useState<number>(() => selectedTooth ?? upperRow[0]);

  useEffect(() => {
    const allTeeth = new Set([...upperRow, ...lowerRow]);
    if (!allTeeth.has(focusedFdi)) {
      setFocusedFdi(selectedTooth !== null && allTeeth.has(selectedTooth) ? selectedTooth : upperRow[0]);
    }
    // Only re-run when the tooth set itself changes (dentition switch); the
    // selection/focus state is intentionally allowed to drift from
    // selectedTooth afterwards (focus and selection are related but not the
    // same thing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upperRow, lowerRow]);

  const registerRef = useCallback(
    (fdi: number) => (el: HTMLButtonElement | null) => {
      if (el) buttonRefs.current.set(fdi, el);
      else buttonRefs.current.delete(fdi);
    },
    [],
  );

  const handleFocusTooth = useCallback((event: React.FocusEvent<HTMLButtonElement>) => {
    const fdi = Number(event.currentTarget.dataset.toothFdi);
    if (!Number.isNaN(fdi)) setFocusedFdi(fdi);
  }, []);

  const handleKeyDownNav = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const fdi = Number(event.currentTarget.dataset.toothFdi);
      if (Number.isNaN(fdi)) return;

      const inUpper = upperRow.includes(fdi);
      const row = inUpper ? upperRow : lowerRow;
      const index = row.indexOf(fdi);
      let nextFdi: number | undefined;

      switch (event.key) {
        case 'ArrowLeft':
          nextFdi = row[Math.max(0, index - 1)];
          break;
        case 'ArrowRight':
          nextFdi = row[Math.min(row.length - 1, index + 1)];
          break;
        case 'ArrowUp':
          nextFdi = inUpper ? fdi : (upperRow[Math.min(index, upperRow.length - 1)] as number);
          break;
        case 'ArrowDown':
          nextFdi = !inUpper ? fdi : (lowerRow[Math.min(index, lowerRow.length - 1)] as number);
          break;
        case 'Home':
          nextFdi = row[0];
          break;
        case 'End':
          nextFdi = row[row.length - 1];
          break;
        default:
          return;
      }

      if (nextFdi === undefined) return;
      event.preventDefault();
      setFocusedFdi(nextFdi);
      buttonRefs.current.get(nextFdi)?.focus();
    },
    [upperRow, lowerRow],
  );

  const handleSelect = useCallback(
    (fdi: number) => {
      setFocusedFdi(fdi);
      onSelect(fdi);
    },
    [onSelect],
  );

  const rightShort = t('patients:dentalChart.orientation.rightShort', { defaultValue: 'R' });
  const leftShort = t('patients:dentalChart.orientation.leftShort', { defaultValue: 'L' });
  const rightLabel = t('patients:dentalChart.orientation.rightLabel', { defaultValue: "Patient's right" });
  const leftLabel = t('patients:dentalChart.orientation.leftLabel', { defaultValue: "Patient's left" });
  const upperRightQuadrant = t('patients:dentalChart.orientation.upperRightQuadrant', { defaultValue: 'Upper Right' });
  const upperLeftQuadrant = t('patients:dentalChart.orientation.upperLeftQuadrant', { defaultValue: 'Upper Left' });
  const lowerRightQuadrant = t('patients:dentalChart.orientation.lowerRightQuadrant', { defaultValue: 'Lower Right' });
  const lowerLeftQuadrant = t('patients:dentalChart.orientation.lowerLeftQuadrant', { defaultValue: 'Lower Left' });
  const upperJaw = t('patients:dentalChart.upperJaw', { defaultValue: 'Upper Jaw' });
  const lowerJaw = t('patients:dentalChart.lowerJaw', { defaultValue: 'Lower Jaw' });
  const dualHint = t('patients:dentalChart.view.dualHint', { defaultValue: 'Top row lateral, bottom row occlusal.' });

  const renderToothRow = (row: number[], isUpper: boolean) => (
    <div
      style={isUpper ? upperGridStyle : lowerGridStyle}
      role="group"
      aria-label={isUpper ? upperJaw : lowerJaw}
      className="px-0.5"
    >
      <Marker label={rightShort} size={size} ariaLabel={rightLabel} />
      {row.map((fdi, index) => (
        <ToothGlyph
          key={fdi}
          ref={registerRef(fdi)}
          fdi={fdi}
          record={records.get(fdi)}
          isSelected={selectedTooth === fdi}
          width={columnWidths[index]}
          size={size}
          patientMode={patientMode}
          tabIndex={fdi === focusedFdi ? 0 : -1}
          onSelect={handleSelect}
          onKeyDownNav={handleKeyDownNav}
          onFocusTooth={handleFocusTooth}
        />
      ))}
      <Marker label={leftShort} size={size} ariaLabel={leftLabel} />
    </div>
  );

  const renderNumberRow = (row: number[]) => (
    <div style={numberGridStyle} className="px-0.5" aria-hidden="true">
      <span />
      {row.map((fdi, index) => {
        const procedures = patientMode ? [] : procedureMap.get(fdi) ?? [];
        return (
          <div key={fdi} className="flex flex-col items-center" style={{ width: columnWidths[index] }}>
            <span className={`font-semibold tabular-nums text-slate-500 dark:text-slate-400 ${NUMBER_TEXT_CLASS[size]}`}>
              {fdi}
            </span>
            {/* Fixed-height slot reserved whether or not this tooth has
                procedures, so every number in the row sits on one baseline. */}
            <div
              className="flex max-w-full flex-wrap items-center justify-center gap-0.5"
              style={{ height: DOT_ROW_HEIGHT[size] }}
            >
              {procedures.slice(0, 4).map((procedure) => (
                <span
                  key={procedure.id}
                  className={`h-1 w-1 rounded-full ${PROCEDURE_STATUS_META[procedure.status]?.dot ?? 'bg-gray-400'}`}
                />
              ))}
            </div>
          </div>
        );
      })}
      <span />
    </div>
  );

  return (
    <div className="w-full overflow-x-auto">
      <div className="mx-auto flex min-w-fit flex-col gap-1 py-1">
        <div className="flex items-center justify-center gap-1.5">
          <Chip size={size}>{upperRightQuadrant}</Chip>
          <Chip size={size} emphasis>
            {upperJaw}
          </Chip>
          <Chip size={size}>{upperLeftQuadrant}</Chip>
        </div>

        {renderToothRow(upperRow, true)}
        {renderNumberRow(upperRow)}

        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-0.5">
          <div className="h-px flex-1 border-t border-dashed border-slate-300 dark:border-gray-600" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{dualHint}</span>
          <div className="h-px flex-1 border-t border-dashed border-slate-300 dark:border-gray-600" />
        </div>

        {renderNumberRow(lowerRow)}
        {renderToothRow(lowerRow, false)}

        <div className="flex items-center justify-center gap-1.5">
          <Chip size={size}>{lowerRightQuadrant}</Chip>
          <Chip size={size} emphasis>
            {lowerJaw}
          </Chip>
          <Chip size={size}>{lowerLeftQuadrant}</Chip>
        </div>
      </div>
    </div>
  );
};

export default Odontogram;
