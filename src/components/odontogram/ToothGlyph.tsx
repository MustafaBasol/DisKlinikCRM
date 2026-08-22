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
import React, { useId, useMemo } from 'react';
import { Activity, AlertTriangle, Check, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TOOTH_STATUS_META, ToothRecord, ToothStatus } from '../dentalChart.types';
import { getToothIdentity } from './toothIdentity';
import { getLateralArt } from './lateralGeometry';
import { getOcclusalArt } from './occlusalGeometry';
import { OCCLUSAL_SURFACE_NAMES, type OcclusalSurfaceName, type SideStrategy } from './anatomy.types';
import type { ToothIdentity } from './toothIdentity';
import { CROWN_MARGIN_PATH, IMPLANT_FIXTURE_PATH, IMPLANT_THREAD_PATH } from '../toothGeometry';
import type { Dentition } from '../toothGeometry';
import { getLateralAspect, getLateralCrownBBox, getLateralViewBox } from './lateralBounds';
import { getOcclusalCrop } from './occlusalBounds';
import { TOOTH_MATERIAL_CLASS, TOOTH_MATERIAL_HEX, TOOTH_STROKE_OPACITY, TOOTH_STROKE_WIDTH } from './toothPalette';

export type ChartSize = 'regular' | 'large' | 'presentation';

/** Fixed rendered pixel height for the lateral view — constant per size so
 *  every tooth shares one vertical scale (see lateralBounds.ts). */
const LATERAL_HEIGHT: Record<ChartSize, number> = {
  regular: 86,
  large: 118,
  presentation: 160,
};

/**
 * The occlusal view is a SUPPORTING view: it must be legible but must never
 * out-weigh the lateral row. Fixed fraction of the lateral height rather than
 * a share of the column width, so the ratio holds at every chart size.
 */
const OCCLUSAL_HEIGHT_RATIO = 0.46;

/**
 * The px width one tooth column needs at this size.
 *
 * Every tooth in an arch gets the SAME column width and the same rendered SVG
 * box; the visible width difference between a molar and an incisor comes from
 * the artwork drawn inside that shared box, which is how a paper odontogram
 * works and what keeps the column pitch even. Exported so Odontogram lays out
 * the grid from exactly the number the glyph renders at.
 */
export function getGlyphLateralWidth(dentition: Dentition, size: ChartSize): number {
  return Math.round(LATERAL_HEIGHT[size] * getLateralAspect(dentition));
}

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

// Two-tone material defaults (R3): an UNTINTED tooth already reads as enamel
// crown over dentin root instead of one flat fill — see toothPalette.ts, the
// single source for these. Kept as four separate defaults (crown/root/
// cervical/surface) rather than one shared constant because that is exactly
// the stroke-weight hierarchy the palette documents: a flat hierarchy is what
// made the R2 glyphs read as line-art icons.
const DEFAULT_CROWN_STROKE_CLASS = TOOTH_MATERIAL_CLASS.enamelStroke;
const DEFAULT_ROOT_STROKE_CLASS = TOOTH_MATERIAL_CLASS.dentinStroke;
const DEFAULT_CERVICAL_STROKE_CLASS = TOOTH_MATERIAL_CLASS.cervicalStroke;
const DEFAULT_SURFACE_STROKE_CLASS = TOOTH_MATERIAL_CLASS.surfaceStroke;

// Status tint composes with the material fill rather than replacing it: a
// second, fill-only path reusing the SAME `d` as the material path, painted
// over it at reduced opacity, so a `treated` tooth still reads as enamel/
// dentin with a colour wash rather than a solid status-coloured blob.
// Deliberately not in toothPalette.ts — that module documents itself as "not
// a status palette", so the composition rule lives here, next to the only
// code that knows both material and status exist. A plain number (applied
// via inline `style`) rather than a Tailwind opacity utility class, since the
// value (0.6) is not on Tailwind's default opacity scale.
const STATUS_TINT_OPACITY = 0.6;

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
  const isMissing = status === 'missing';
  const isImplant = status === 'implant';
  // Full-coverage crown restoration REPLACES the enamel (it is a different
  // material, not a tint of enamel); every other status TINTS the material —
  // see the two-path (base + overlay) rendering below.
  const isCrownRestoration = status === 'crown';

  // Status recolours crown, root, cervical and surface strokes TOGETHER (see
  // AUTHORING.md §4) rather than each keeping its own material-default tone;
  // the material defaults only apply when there is no status.
  const crownStrokeClass = meta?.stroke ?? DEFAULT_CROWN_STROKE_CLASS;
  const rootStrokeClass = meta?.stroke ?? DEFAULT_ROOT_STROKE_CLASS;
  const cervicalStrokeClass = meta?.stroke ?? DEFAULT_CERVICAL_STROKE_CLASS;
  const surfaceStrokeClass = meta?.stroke ?? DEFAULT_SURFACE_STROKE_CLASS;
  const crownFillClass = isCrownRestoration ? 'fill-indigo-200 dark:fill-indigo-500/40' : undefined;

  const transform = lateralTransform(identity, art.sideStrategy);
  const viewBox = useMemo(() => getLateralViewBox(identity, art), [identity, art]);
  const crownBBox = useMemo(() => getLateralCrownBBox(identity, art), [identity, art]);
  // Globally unique per mounted SVG (not per fdi) — safe with 52 glyphs x 2
  // views on one page, and safe across multiple Odontogram instances, unlike
  // an id built from `fdi` which repeats across separate chart instances.
  // `useId()` alone is not safe to drop into a FuncIRI: React 18 formats it as
  // `:r1:`, and a colon inside `url(#...)` is a documented cross-browser
  // hazard (it also makes the id unusable with querySelector/CSS). Chrome
  // resolves it, which is exactly why the bug would ship unnoticed. Stripping
  // the delimiters keeps the uniqueness guarantee and costs nothing.
  const gradientId = `enamel-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Base enamel fill: a subtle vertical gradient, translucent at the incisal
  // edge (y=0 of the crown's own bounding box, i.e. `art.crown`'s smallest
  // authored y) and opaque toward the cervical line (bbox y=1) — the crown
  // "thickens" toward the gum line the way real enamel translucency reads.
  // Skipped for the crown-restoration and missing cases, which never use it.
  const useEnamelGradient = !isMissing && !isCrownRestoration;

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-hidden="true"
      data-view="lateral"
      data-tooth-fdi={fdi}
    >
      <title>{viewLabel}</title>
      {useEnamelGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {/* Light value read from TOOTH_MATERIAL_HEX (the exporter's own
                literal) so the two never drift apart. The dark override has
                no exported counterpart — TOOTH_MATERIAL_HEX is light-only by
                design (see toothPalette.ts) — so it is a literal here, kept
                in sync with TOOTH_MATERIAL_CLASS.enamelFill's `dark:` value
                by hand; a Tailwind class must be a static string for the JIT
                scanner to see it, so it cannot be built from that constant. */}
            <stop offset="0%" stopColor={TOOTH_MATERIAL_HEX.enamelFill} stopOpacity={0.55} className="dark:[stop-color:#e8eef2]" />
            <stop offset="100%" stopColor={TOOTH_MATERIAL_HEX.enamelFill} stopOpacity={1} className="dark:[stop-color:#e8eef2]" />
          </linearGradient>
        </defs>
      )}
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
            {/* Roots FIRST (underneath) in the dentin material — a root's
                path starts ~2 units above the CEJ precisely so the crown
                painted after it overlaps the seam; paint order does the
                work, nothing here clips. */}
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
                <React.Fragment key={index}>
                  <path
                    d={rootPath}
                    className={`${TOOTH_MATERIAL_CLASS.dentinFill} ${rootStrokeClass}`}
                    strokeWidth={TOOTH_STROKE_WIDTH.root}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Status tint OVER the dentin fill, not instead of it —
                      same `d`, fill-only, reduced opacity. */}
                  {meta && (
                    <path d={rootPath} className={meta.fill} style={{ opacity: STATUS_TINT_OPACITY }} />
                  )}
                </React.Fragment>
              ))
            )}

            {/* Crown OVER the roots, in the enamel material. */}
            <path
              d={art.crown}
              fill={useEnamelGradient ? `url(#${gradientId})` : undefined}
              className={isCrownRestoration ? `${crownFillClass} ${crownStrokeClass}` : crownStrokeClass}
              strokeWidth={TOOTH_STROKE_WIDTH.crown}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {!isCrownRestoration && meta && (
              <path d={art.crown} className={meta.fill} style={{ opacity: STATUS_TINT_OPACITY }} />
            )}

            <path
              d={art.surface}
              className={surfaceStrokeClass}
              strokeWidth={TOOTH_STROKE_WIDTH.surface}
              style={{ opacity: TOOTH_STROKE_OPACITY.surface }}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={art.cervical}
              className={cervicalStrokeClass}
              strokeWidth={TOOTH_STROKE_WIDTH.cervical}
              style={{ opacity: TOOTH_STROKE_OPACITY.cervical }}
              fill="none"
              strokeLinecap="round"
            />

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
  height: number;
  viewLabel: string;
  t: ReturnType<typeof useTranslation>['t'];
}

const OcclusalView: React.FC<OcclusalViewProps> = ({ fdi, identity, status, height, viewLabel, t }) => {
  const art = useMemo(() => getOcclusalArt(identity), [identity]);
  const meta = status ? TOOTH_STATUS_META[status] : null;
  const isMissing = status === 'missing';
  // Occlusal is a plan view of the crown alone (no root split), so it takes
  // the same enamel default the lateral crown uses, and composes status the
  // same way: material fill/stroke as the base, a translucent status tint
  // OVER it — except full-coverage crown restoration, a different material
  // that replaces the enamel outright, same rule as the lateral view.
  const isCrownRestoration = status === 'crown';
  const strokeClass = meta?.stroke ?? DEFAULT_CROWN_STROKE_CLASS;
  const detailStrokeClass = meta?.stroke ?? DEFAULT_SURFACE_STROKE_CLASS;
  const outlineFillClass = isCrownRestoration
    ? 'fill-indigo-200 dark:fill-indigo-500/40'
    : TOOTH_MATERIAL_CLASS.enamelFill;
  const transform = occlusalTransform(identity, art.sideStrategy);
  const crop = useMemo(() => getOcclusalCrop(identity), [identity]);
  const width = Math.round(height / crop.aspect);

  return (
    <svg
      viewBox={crop.viewBox}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
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
              strokeWidth={TOOTH_STROKE_WIDTH.occlusalOutline}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Status tint OVER the enamel fill, not instead of it — same
                `d`, fill-only, reduced opacity. */}
            {!isCrownRestoration && meta && (
              <path d={art.outline} className={meta.fill} style={{ opacity: STATUS_TINT_OPACITY }} />
            )}

            {/* Future per-surface charting hook: each of the five surfaces
                stays its own element carrying data-surface (and data-tooth-fdi
                so a future click handler can address it directly) — no
                persisted state, no click handler, added here. */}
            {OCCLUSAL_SURFACE_NAMES.map((name) => {
              const key = surfaceLabelKey(name, identity);
              return (
                <path
                  key={name}
                  d={art.surfaces[name]}
                  data-surface={name}
                  data-tooth-fdi={fdi}
                  style={{ pointerEvents: 'none' }}
                  className={meta ? `${meta.fill} opacity-70` : 'fill-slate-400/15 dark:fill-slate-300/20'}
                >
                  <title>
                    {t(`patients:dentalChart.surface.${key}`, { defaultValue: SURFACE_FALLBACK[key] ?? key })}
                  </title>
                </path>
              );
            })}

            <path
              d={art.detail}
              className={detailStrokeClass}
              strokeWidth={TOOTH_STROKE_WIDTH.occlusalDetail}
              style={{ opacity: TOOTH_STROKE_OPACITY.occlusalDetail }}
              fill="none"
              strokeLinecap="round"
            />
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

    // Both views are sized from the FIXED height for this chart size and each
    // view's own viewBox aspect, so x and y always scale by the same factor.
    // `width` is the column box the glyph is centred in — it is deliberately
    // NOT used to scale the SVG, because varying the box width against a fixed
    // height is exactly the non-uniform scale that stretched crowns before.
    // The column width the arch resolved (responsive — see Odontogram) is the
    // one input; both view heights derive from it through each view's own
    // viewBox aspect, so x and y always scale by the same factor and the arch
    // shrinks as one picture rather than distorting when space is tight.
    const lateralWidth = width;
    const lateralHeight = Math.round(width / getLateralAspect(identity.dentition));
    const occlusalHeight = Math.round(lateralHeight * OCCLUSAL_HEIGHT_RATIO);

    const lateralNode = (
      <LateralView
        key="lateral"
        fdi={fdi}
        identity={identity}
        status={status}
        width={lateralWidth}
        height={lateralHeight}
        viewLabel={lateralLabel}
      />
    );
    const occlusalNode = showOcclusal ? (
      <OcclusalView
        key="occlusal"
        fdi={fdi}
        identity={identity}
        status={status}
        height={occlusalHeight}
        viewLabel={occlusalLabel}
        t={t}
      />
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
        data-tooth-status={status ?? undefined}
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
