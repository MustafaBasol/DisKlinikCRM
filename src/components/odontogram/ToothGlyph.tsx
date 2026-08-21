/**
 * ToothGlyph.tsx — DENTAL-CHART-UX-001-R2 (Lane A: visual system)
 *
 * Renders ONE tooth, both views (lateral + occlusal), frameless: a transparent
 * <button> containing two stacked SVGs and nothing else — no card, no tile, no
 * filled rectangle. Status is applied as a presentation layer (tint + outline)
 * over the anatomy that Lane B (lateralGeometry.ts) and Lane C
 * (occlusalGeometry.ts) supply; nothing here bakes a colour into a path.
 *
 * TRANSFORM CONTRACT (see anatomy.types.ts for the full explanation):
 *
 *   LATERAL  upper arch:            translate(0 88) scale(1 -1)
 *            left + sideStrategy=mirror: translate(64 0) scale(-1 1)
 *            (both compose on one <g> when a tooth is upper-left)
 *
 *   OCCLUSAL left + sideStrategy=mirror: translate(64 0) scale(-1 1)
 *            lower arch:            translate(0 64) scale(1 -1)
 *            (both compose on one <g> when a tooth is lower-left)
 *
 * The two reflections operate on independent axes, so composition order does
 * not change the result; the order below simply matches the order the
 * contract lists them in.
 *
 * REFINEMENT PASS (post Lane B/C integration) — three sizing/scale defects
 * fixed here, all via module-scope-memoised bounding-box math (never parsed
 * per render — see lateralBounds.ts / occlusalBounds.ts):
 *   - `width` is now supplied by the caller (Odontogram resolves one shared
 *     px width per arch column) instead of computed independently per tooth,
 *     so the rendered glyph actually fills its column — no more whitespace.
 *   - the lateral SVG's `viewBox` is cropped per tooth so every crown's
 *     outer edge sits the same distance from its own box edge — a shared
 *     baseline instead of per-family jitter — and rendered at a FIXED pixel
 *     height (independent of `width`) with `preserveAspectRatio="none"", so
 *     vertical scale never varies by tooth.
 *   - the occlusal SVG's `viewBox` is cropped to that tooth's own outline
 *     bounding box, so a small anterior tooth fills its box instead of
 *     rendering as a speck; its rendered box keeps the padded bbox's own
 *     aspect ratio, sized off the shared `width` (which is itself driven by
 *     widthRatio), so molars still read larger than incisors.
 */
import React, { useMemo } from 'react';
import { Activity, AlertTriangle, Check, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TOOTH_STATUS_META, ToothRecord, ToothStatus } from '../dentalChart.types';
import { getToothIdentity } from './toothIdentity';
import { getLateralArt } from './lateralGeometry';
import { getOcclusalArt } from './occlusalGeometry';
import { OCCLUSAL_SURFACE_NAMES, type OcclusalSurfaceName, type SideStrategy } from './anatomy.types';
import type { ToothIdentity } from './toothIdentity';
import { CROWN_MARGIN_PATH, IMPLANT_FIXTURE_PATH, IMPLANT_THREAD_PATH } from '../toothGeometry';
import { getLateralCrownBBox, getLateralViewBox } from './lateralBounds';
import { getOcclusalCrop } from './occlusalBounds';

export type ChartSize = 'regular' | 'large' | 'presentation';

/** Fixed rendered pixel height for the lateral view — constant per size so
 *  every tooth shares one vertical scale (see lateralBounds.ts). */
const LATERAL_HEIGHT: Record<ChartSize, number> = {
  regular: 86,
  large: 118,
  presentation: 160,
};

const NUMBER_BADGE_SIZE: Record<ChartSize, number> = {
  regular: 15,
  large: 18,
  presentation: 22,
};

function statusFallback(status: ToothStatus): string {
  return TOOTH_STATUS_META[status].fallback;
}

function surfaceLabelKey(name: OcclusalSurfaceName, identity: ToothIdentity): string {
  if (name === 'lingual') return identity.arch === 'upper' ? 'palatal' : 'lingual';
  if (name === 'central') return identity.isPosterior ? 'central' : 'incisal';
  return name;
}

const SURFACE_FALLBACK: Record<string, string> = {
  mesial: 'Mesial',
  distal: 'Distal',
  buccal: 'Buccal',
  lingual: 'Lingual',
  palatal: 'Palatal',
  central: 'Occlusal',
  incisal: 'Incisal',
};

// Base (no-status) contrast — bumped in the refinement pass; the old
// slate-400/slate-500 pairing nearly disappeared against a plain workspace.
const DEFAULT_STROKE_CLASS = 'stroke-slate-500 dark:stroke-slate-300';
const DEFAULT_FILL_CLASS = 'fill-white dark:fill-gray-700/70';

// Missing status: previously just faded everything to opacity-35, which read
// as "very light" rather than "absent". Now: normal-contrast dashed ghost
// outline (no fade) plus a bold X drawn from the crown/outline bbox.
const MISSING_STROKE_CLASS = 'stroke-slate-500 dark:stroke-slate-300';
const MISSING_MARK_CLASS = 'stroke-slate-600 dark:stroke-slate-200';

function lateralTransform(identity: ToothIdentity, sideStrategy: SideStrategy): string | undefined {
  const parts: string[] = [];
  if (identity.arch === 'upper') parts.push('translate(0 88) scale(1 -1)');
  if (identity.side === 'left' && sideStrategy === 'mirror') parts.push('translate(64 0) scale(-1 1)');
  return parts.length ? parts.join(' ') : undefined;
}

function occlusalTransform(identity: ToothIdentity, sideStrategy: SideStrategy): string | undefined {
  const parts: string[] = [];
  if (identity.side === 'left' && sideStrategy === 'mirror') parts.push('translate(64 0) scale(-1 1)');
  if (identity.arch === 'lower') parts.push('translate(0 64) scale(1 -1)');
  return parts.length ? parts.join(' ') : undefined;
}

function ToothStatusMark({ status, size }: { status?: ToothStatus; size: ChartSize }) {
  if (!status || status === 'missing') return null;

  const px = NUMBER_BADGE_SIZE[size];
  const baseClass =
    'flex items-center justify-center rounded-full border bg-white shadow-sm dark:bg-gray-800';
  const style = { height: px, width: px };
  const iconSize = Math.round(px * 0.62);

  if (status === 'planned') {
    return <span className={`${baseClass} border-amber-200 text-amber-600`} style={style} />;
  }
  if (status === 'in_progress') {
    return (
      <span className={`${baseClass} border-blue-200 text-blue-600`} style={style}>
        <Activity size={iconSize} strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'treated') {
    return (
      <span className={`${baseClass} border-emerald-200 bg-emerald-500 text-white`} style={style}>
        <Check size={iconSize} strokeWidth={3} />
      </span>
    );
  }
  if (status === 'issue') {
    return (
      <span className={`${baseClass} border-red-200 text-red-600`} style={style}>
        <AlertTriangle size={iconSize} strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'crown') {
    return (
      <span className={`${baseClass} border-indigo-200 text-indigo-600`} style={style}>
        <Crown size={iconSize} strokeWidth={2.4} />
      </span>
    );
  }
  // implant
  return (
    <span className={`${baseClass} border-purple-200 bg-purple-500 text-white`} style={style}>
      <span className="block h-1.5 w-1.5 rounded-full bg-white" />
    </span>
  );
}

interface LateralViewProps {
  fdi: number;
  identity: ToothIdentity;
  status?: ToothStatus;
  width: number;
  height: number;
  viewLabel: string;
}

const LateralView: React.FC<LateralViewProps> = ({ fdi, identity, status, width, height, viewLabel }) => {
  const art = useMemo(() => getLateralArt(identity), [identity]);
  const meta = status ? TOOTH_STATUS_META[status] : null;
  const strokeClass = meta?.stroke ?? DEFAULT_STROKE_CLASS;
  const fillClass = meta?.fill ?? DEFAULT_FILL_CLASS;
  // Full-coverage crown restoration fills the WHOLE clinical crown.
  const crownFillClass = status === 'crown' ? 'fill-indigo-200 dark:fill-indigo-500/40' : fillClass;
  const isMissing = status === 'missing';
  const isImplant = status === 'implant';
  const transform = lateralTransform(identity, art.sideStrategy);
  const viewBox = useMemo(() => getLateralViewBox(identity, art), [identity, art]);
  const crownBBox = useMemo(() => getLateralCrownBBox(identity, art), [identity, art]);

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      data-view="lateral"
      data-tooth-fdi={fdi}
    >
      <title>{viewLabel}</title>
      <g transform={transform}>
        {isMissing ? (
          <>
            <path
              d={art.crown}
              className={`fill-none ${MISSING_STROKE_CLASS}`}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {art.roots.map((rootPath, index) => (
              <path
                key={index}
                d={rootPath}
                className={`fill-none ${MISSING_STROKE_CLASS}`}
                strokeWidth={1.6}
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* Bold, unmistakable absence mark, sized from this tooth's own
                crown bbox so it always precisely overlays the crown. */}
            <path
              d={`M${crownBBox.minX} ${crownBBox.minY} L${crownBBox.maxX} ${crownBBox.maxY} M${crownBBox.maxX} ${crownBBox.minY} L${crownBBox.minX} ${crownBBox.maxY}`}
              className={MISSING_MARK_CLASS}
              strokeWidth={2.6}
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            {isImplant ? (
              <>
                <path
                  d={IMPLANT_FIXTURE_PATH}
                  className="fill-purple-200 stroke-purple-600 dark:fill-purple-500/40 dark:stroke-purple-300"
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                />
                <path
                  d={IMPLANT_THREAD_PATH}
                  className="stroke-purple-600 opacity-70 dark:stroke-purple-200"
                  strokeWidth={1.1}
                  strokeLinecap="round"
                  fill="none"
                />
              </>
            ) : (
              art.roots.map((rootPath, index) => (
                <path
                  key={index}
                  d={rootPath}
                  className={`${fillClass} ${strokeClass} opacity-85`}
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))
            )}

            <path
              d={art.crown}
              className={`${crownFillClass} ${strokeClass}`}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            <path d={art.surface} className={`${strokeClass} opacity-50`} strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <path d={art.cervical} className={`${strokeClass} opacity-40`} strokeWidth={1.1} fill="none" strokeLinecap="round" />

            {status === 'crown' && (
              <path
                d={CROWN_MARGIN_PATH}
                className="stroke-indigo-600 dark:stroke-indigo-200"
                strokeWidth={1.6}
                strokeLinecap="round"
                fill="none"
              />
            )}
          </>
        )}
      </g>

      {/*
        Status marks that must stay upright regardless of jaw flip OR side
        mirror — they live OUTSIDE the transformed group on purpose.
      */}
      {status === 'treated' && (
        <path
          d="M23 38 L30 45 L44 28"
          className="stroke-emerald-600 dark:stroke-emerald-200"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
};

interface OcclusalViewProps {
  fdi: number;
  identity: ToothIdentity;
  status?: ToothStatus;
  width: number;
  viewLabel: string;
  t: ReturnType<typeof useTranslation>['t'];
}

const OcclusalView: React.FC<OcclusalViewProps> = ({ fdi, identity, status, width, viewLabel, t }) => {
  const art = useMemo(() => getOcclusalArt(identity), [identity]);
  const meta = status ? TOOTH_STATUS_META[status] : null;
  const strokeClass = meta?.stroke ?? DEFAULT_STROKE_CLASS;
  const fillClass = meta?.fill ?? DEFAULT_FILL_CLASS;
  const isMissing = status === 'missing';
  const isImplant = status === 'implant';
  const outlineFillClass =
    status === 'crown'
      ? 'fill-indigo-200 dark:fill-indigo-500/40'
      : isImplant
        ? 'fill-purple-100 dark:fill-purple-500/30'
        : fillClass;
  const transform = occlusalTransform(identity, art.sideStrategy);
  const crop = useMemo(() => getOcclusalCrop(identity), [identity]);
  const height = Math.round(width * crop.aspect);

  return (
    <svg
      viewBox={crop.viewBox}
      width={width}
      height={height}
      role="img"
      aria-hidden="true"
      data-view="occlusal"
      data-tooth-fdi={fdi}
    >
      <title>{viewLabel}</title>
      <g transform={transform}>
        {isMissing ? (
          <path
            d={art.outline}
            className={`fill-none ${MISSING_STROKE_CLASS}`}
            strokeWidth={1.8}
            strokeDasharray="4 3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <path
              d={art.outline}
              className={`${outlineFillClass} ${strokeClass}`}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {OCCLUSAL_SURFACE_NAMES.map((name) => {
              const key = surfaceLabelKey(name, identity);
              return (
                <path
                  key={name}
                  d={art.surfaces[name]}
                  data-surface={name}
                  data-tooth-fdi={fdi}
                  style={{ pointerEvents: 'none' }}
                  className={status ? `${fillClass} opacity-70` : 'fill-slate-400/15 dark:fill-slate-300/20'}
                >
                  <title>
                    {t(`patients:dentalChart.surface.${key}`, { defaultValue: SURFACE_FALLBACK[key] ?? key })}
                  </title>
                </path>
              );
            })}

            <path d={art.detail} className={`${strokeClass} opacity-45`} strokeWidth={1} fill="none" strokeLinecap="round" />
          </>
        )}
      </g>
    </svg>
  );
};

export interface ToothGlyphProps {
  fdi: number;
  record?: ToothRecord;
  isSelected: boolean;
  /** Resolved shared column width (px) — same value for every tooth at this
   *  arch position, so the button fills its grid column exactly. */
  width: number;
  size?: ChartSize;
  patientMode?: boolean;
  /** When false, only the lateral view renders (kept for future density modes). */
  showOcclusal?: boolean;
  /** Roving-tabindex value: 0 for the one focusable tooth in the arch, -1 otherwise. */
  tabIndex: number;
  onSelect: (fdi: number) => void;
  onKeyDownNav?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocusTooth?: (event: React.FocusEvent<HTMLButtonElement>) => void;
}

const ToothGlyphInner = React.forwardRef<HTMLButtonElement, ToothGlyphProps>(
  (
    {
      fdi,
      record,
      isSelected,
      width,
      size = 'regular',
      patientMode = false,
      showOcclusal = true,
      tabIndex,
      onSelect,
      onKeyDownNav,
      onFocusTooth,
    },
    ref,
  ) => {
    const { t } = useTranslation(['patients']);
    const identity = useMemo(() => getToothIdentity(fdi), [fdi]);
    const status = record?.status;
    const isUpper = identity.arch === 'upper';

    const statusText = status
      ? t(`patients:dentalChart.status.${status}`, { defaultValue: statusFallback(status) })
      : t('patients:dentalChart.patientNoRecord', {
          defaultValue: 'No procedure record has been added for this tooth yet.',
        });
    const title = record ? `${fdi}: ${statusText}${record.note ? ` - ${record.note}` : ''}` : statusText;

    const lateralLabel = t('patients:dentalChart.view.lateral', { defaultValue: 'Lateral view' });
    const occlusalLabel = t('patients:dentalChart.view.occlusal', { defaultValue: 'Occlusal view' });

    const lateralHeight = LATERAL_HEIGHT[size];

    const lateralNode = (
      <LateralView
        key="lateral"
        fdi={fdi}
        identity={identity}
        status={status}
        width={width}
        height={lateralHeight}
        viewLabel={lateralLabel}
      />
    );
    const occlusalNode = showOcclusal ? (
      <OcclusalView key="occlusal" fdi={fdi} identity={identity} status={status} width={width} viewLabel={occlusalLabel} t={t} />
    ) : null;

    // The status badge anchors to the CROWN seam — the edge where the
    // lateral and occlusal views meet in the stack (bottom of the lateral
    // block for the upper arch, top of it for the lower arch; see
    // lateralBounds.ts for why the crown always lands on that edge). It is
    // positioned with a small POSITIVE inset (never a negative one) so it
    // never bleeds into a neighbouring tooth's column.
    const badge = status && status !== 'missing' ? <ToothStatusMark status={status} size={size} /> : null;

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={isSelected}
        aria-label={title}
        title={title}
        data-tooth-fdi={fdi}
        data-tooth-dentition={identity.dentition}
        tabIndex={tabIndex}
        onClick={() => onSelect(fdi)}
        onKeyDown={onKeyDownNav}
        onFocus={onFocusTooth}
        style={{ minHeight: 44, width }}
        className={[
          'group relative flex flex-col items-center rounded-md border-0 bg-transparent p-0 outline-none',
          'transition-transform duration-150 hover:-translate-y-0.5',
          'focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900',
        ].join(' ')}
      >
        {isUpper ? (
          <>
            <div className="relative">
              {lateralNode}
              {badge && <div className="pointer-events-none absolute bottom-0.5 right-0.5">{badge}</div>}
            </div>
            {occlusalNode}
          </>
        ) : (
          <>
            {occlusalNode}
            <div className="relative">
              {lateralNode}
              {badge && <div className="pointer-events-none absolute top-0.5 right-0.5">{badge}</div>}
            </div>
          </>
        )}

        {/* The ONLY rectangle anywhere in the chart: a dashed frame that spans
            both views together when this tooth is selected. */}
        {isSelected && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1 rounded-md border-2 border-dashed border-primary-500 dark:border-primary-300"
          />
        )}
      </button>
    );
  },
);
ToothGlyphInner.displayName = 'ToothGlyphInner';

function areEqual(prev: ToothGlyphProps, next: ToothGlyphProps): boolean {
  return (
    prev.fdi === next.fdi &&
    prev.record === next.record &&
    prev.isSelected === next.isSelected &&
    prev.width === next.width &&
    prev.size === next.size &&
    prev.patientMode === next.patientMode &&
    prev.showOcclusal === next.showOcclusal &&
    prev.tabIndex === next.tabIndex &&
    prev.onSelect === next.onSelect &&
    prev.onKeyDownNav === next.onKeyDownNav &&
    prev.onFocusTooth === next.onFocusTooth
  );
}

const ToothGlyph = React.memo(ToothGlyphInner, areEqual);

export default ToothGlyph;
