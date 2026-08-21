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
 */
import React, { useMemo } from 'react';
import { Activity, AlertTriangle, Check, CircleDot, Crown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  PROCEDURE_STATUS_META,
  TOOTH_STATUS_META,
  ToothRecord,
  ToothStatus,
  TreatmentProcedure,
} from '../dentalChart.types';
import { getToothIdentity } from './toothIdentity';
import { getLateralArt } from './lateralGeometry';
import { getOcclusalArt } from './occlusalGeometry';
import {
  LATERAL_VIEWBOX,
  OCCLUSAL_VIEWBOX,
  OCCLUSAL_SURFACE_NAMES,
  type OcclusalSurfaceName,
  type SideStrategy,
} from './anatomy.types';
import type { ToothIdentity } from './toothIdentity';
import {
  CROWN_MARGIN_PATH,
  IMPLANT_FIXTURE_PATH,
  IMPLANT_THREAD_PATH,
} from '../toothGeometry';

export type ChartSize = 'regular' | 'large' | 'presentation';

/** 1.0 widthRatio maps to this many px; narrower/wider teeth scale off it. */
const BASE_WIDTH: Record<ChartSize, number> = {
  regular: 32,
  large: 42,
  presentation: 58,
};

const MIN_WIDTH = 20;

const NUMBER_BADGE_SIZE: Record<ChartSize, number> = {
  regular: 14,
  large: 16,
  presentation: 20,
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

function ToothStatusMark({ status, isUpper, size }: { status?: ToothStatus; isUpper: boolean; size: ChartSize }) {
  if (!status) return null;

  const px = NUMBER_BADGE_SIZE[size];
  const positionClass = isUpper ? '-top-1 -right-1' : '-bottom-1 -right-1';
  const baseClass = `absolute ${positionClass} flex items-center justify-center rounded-full border bg-white shadow-sm dark:bg-gray-800`;
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
  if (status === 'missing') {
    return (
      <span className={`${baseClass} border-gray-200 text-gray-500`} style={style}>
        <X size={iconSize} strokeWidth={2.5} />
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
  return (
    <span className={`${baseClass} border-purple-200 text-purple-600`} style={style}>
      <CircleDot size={iconSize} strokeWidth={2.5} />
    </span>
  );
}

interface LateralViewProps {
  fdi: number;
  identity: ToothIdentity;
  status?: ToothStatus;
  width: number;
  viewLabel: string;
}

const LateralView: React.FC<LateralViewProps> = ({ fdi, identity, status, width, viewLabel }) => {
  const art = useMemo(() => getLateralArt(identity), [identity]);
  const meta = status ? TOOTH_STATUS_META[status] : null;
  const strokeClass = meta?.stroke ?? 'stroke-slate-400 dark:stroke-slate-500';
  const fillClass = meta?.fill ?? 'fill-white dark:fill-gray-700/60';
  // Full-coverage crown restoration fills the WHOLE clinical crown.
  const crownFillClass = status === 'crown' ? 'fill-indigo-200 dark:fill-indigo-500/40' : fillClass;
  const isMissing = status === 'missing';
  const isImplant = status === 'implant';
  const transform = lateralTransform(identity, art.sideStrategy);
  const height = Math.round(width * (88 / 64));

  return (
    <svg
      viewBox={LATERAL_VIEWBOX}
      width={width}
      height={height}
      role="img"
      aria-hidden="true"
      data-view="lateral"
      className={isMissing ? 'opacity-35' : 'opacity-100'}
    >
      <title>{viewLabel}</title>
      <g transform={transform}>
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
              className={`${fillClass} ${strokeClass} opacity-75`}
              strokeWidth={isMissing ? 1.4 : 1.7}
              strokeDasharray={isMissing ? '4 3' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))
        )}

        <path
          d={art.crown}
          className={`${crownFillClass} ${strokeClass}`}
          strokeWidth={isMissing ? 1.7 : 2}
          strokeDasharray={isMissing ? '5 4' : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {!isMissing && (
          <>
            <path d={art.surface} className={`${strokeClass} opacity-40`} strokeWidth={1} fill="none" strokeLinecap="round" />
            <path d={art.cervical} className={`${strokeClass} opacity-30`} strokeWidth={1} fill="none" strokeLinecap="round" />
          </>
        )}

        {status === 'crown' && (
          <path
            d={CROWN_MARGIN_PATH}
            className="stroke-indigo-600 dark:stroke-indigo-200"
            strokeWidth={1.6}
            strokeLinecap="round"
            fill="none"
          />
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
      {isMissing && (
        <path d="M20 44 H44" className="stroke-gray-400 dark:stroke-gray-300" strokeWidth={2.6} strokeLinecap="round" />
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
  const strokeClass = meta?.stroke ?? 'stroke-slate-400 dark:stroke-slate-500';
  const fillClass = meta?.fill ?? 'fill-white dark:fill-gray-700/60';
  const isMissing = status === 'missing';
  const isImplant = status === 'implant';
  const outlineFillClass =
    status === 'crown'
      ? 'fill-indigo-200 dark:fill-indigo-500/40'
      : isImplant
        ? 'fill-purple-100 dark:fill-purple-500/30'
        : fillClass;
  const transform = occlusalTransform(identity, art.sideStrategy);
  const height = width;

  return (
    <svg
      viewBox={OCCLUSAL_VIEWBOX}
      width={width}
      height={height}
      role="img"
      aria-hidden="true"
      data-view="occlusal"
      data-tooth-fdi={fdi}
      className={isMissing ? 'opacity-35' : 'opacity-100'}
    >
      <title>{viewLabel}</title>
      <g transform={transform}>
        <path
          d={art.outline}
          className={`${outlineFillClass} ${strokeClass}`}
          strokeWidth={isMissing ? 1.4 : 1.8}
          strokeDasharray={isMissing ? '4 3' : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {!isMissing &&
          OCCLUSAL_SURFACE_NAMES.map((name) => {
            const key = surfaceLabelKey(name, identity);
            return (
              <path
                key={name}
                d={art.surfaces[name]}
                data-surface={name}
                data-tooth-fdi={fdi}
                style={{ pointerEvents: 'none' }}
                className={status ? `${fillClass} opacity-60` : 'fill-slate-400/10 dark:fill-slate-300/15'}
              >
                <title>
                  {t(`patients:dentalChart.surface.${key}`, { defaultValue: SURFACE_FALLBACK[key] ?? key })}
                </title>
              </path>
            );
          })}

        {!isMissing && (
          <path d={art.detail} className={`${strokeClass} opacity-35`} strokeWidth={0.9} fill="none" strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
};

export interface ToothGlyphProps {
  fdi: number;
  record?: ToothRecord;
  procedures?: TreatmentProcedure[];
  isSelected: boolean;
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
      procedures = [],
      isSelected,
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

    const width = Math.max(MIN_WIDTH, Math.round(BASE_WIDTH[size] * getLateralArt(identity).widthRatio));
    const procedureDotSize = size === 'presentation' ? 'h-1.5 w-1.5' : 'h-1 w-1';

    const lateralNode = (
      <LateralView key="lateral" fdi={fdi} identity={identity} status={status} width={width} viewLabel={lateralLabel} />
    );
    const occlusalNode = showOcclusal ? (
      <OcclusalView key="occlusal" fdi={fdi} identity={identity} status={status} width={width} viewLabel={occlusalLabel} t={t} />
    ) : null;

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
        style={{ minHeight: 44 }}
        className={[
          'group relative flex w-full flex-col items-center gap-0.5 rounded-md border-0 bg-transparent p-0.5 outline-none',
          'transition-transform duration-150 hover:-translate-y-0.5',
          'focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900',
        ].join(' ')}
      >
        {isUpper ? (
          <>
            {lateralNode}
            {occlusalNode}
          </>
        ) : (
          <>
            {occlusalNode}
            {lateralNode}
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

        <ToothStatusMark status={status} isUpper={isUpper} size={size} />

        {!patientMode && procedures.length > 0 && (
          <div className="flex max-w-full flex-wrap items-center justify-center gap-0.5" aria-hidden="true">
            {procedures.slice(0, 4).map((procedure) => (
              <span
                key={procedure.id}
                title={`${procedure.procedureName} (${t(`patients:dentalChart.procedureStatus.${procedure.status}`, {
                  defaultValue: PROCEDURE_STATUS_META[procedure.status]?.fallback ?? procedure.status,
                })})`}
                className={`${procedureDotSize} rounded-full ${PROCEDURE_STATUS_META[procedure.status]?.dot ?? 'bg-gray-400'}`}
              />
            ))}
          </div>
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
    prev.procedures === next.procedures &&
    prev.isSelected === next.isSelected &&
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
