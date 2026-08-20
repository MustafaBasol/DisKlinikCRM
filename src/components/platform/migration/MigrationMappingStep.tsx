import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  Lock,
  Search,
  RotateCcw,
  Ban,
  EyeOff,
  Wand2,
  ShieldCheck,
  ArrowRight,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type {
  MappingDto,
  DestinationFieldDto,
  MappingValidationDto,
  MappingWritePayload,
  TransformName,
  SourceColumnProfileDto,
  MappingState,
} from '../../../services/platformMigrationApi';
import { DESTINATION_GROUPS, CANONICAL_CELL_TYPES } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';
import {
  MAPPING_FILTER_IDS,
  type MappingFilterId,
  type OperatorMappingStatus,
  operatorMappingStatus,
  operatorNeedsAction,
  mappingRowVisible,
  formatPercent,
  isHeaderlessMapping,
  excelColumnCoordinate,
  canApproveMapping,
} from '../../../pages/platformMigrationHelpers';
import type { ColumnPreviewSampleDto } from '../../../services/platformMigrationApi';

// ── Operator status badge ────────────────────────────────────────────────────

/**
 * The badge renders the OPERATOR vocabulary (F3-DATA-MIG-TODAY-001-R12), not
 * the engine's eight-state machine. See `operatorMappingStatus` for why, and
 * for the exact projection. The internal state is still available — it is shown
 * underneath in small type for support, and it is what every server-side rule
 * continues to decide on.
 */
/**
 * The order the summary line reads in: what arrives first, what is kept, what
 * is still owed, then the two "nothing happens here" buckets, then errors.
 * NEEDS_REVIEW is deliberately not in this list — it has the headline number of
 * its own immediately to the left, and printing it twice would suggest two
 * different figures.
 */
const OPERATOR_SUMMARY_ORDER: readonly OperatorMappingStatus[] = [
  'MATCHED',
  'PRESERVED',
  'IGNORED',
  'EMPTY',
  'ERROR',
];

const OPERATOR_BADGE: Record<OperatorMappingStatus, string> = {
  MATCHED: 'badge-green',
  PRESERVED: 'badge-blue',
  // Amber, deliberately NOT red: a column awaiting a decision is unfinished
  // work, not a fault. Red is reserved for a column that carries data and
  // cannot proceed at all.
  NEEDS_REVIEW: 'badge bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-200',
  EMPTY: 'badge-gray',
  IGNORED: 'badge-gray',
  ERROR: 'badge-red',
};

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  mapping: MappingDto;
  profile: SourceColumnProfileDto | undefined;
  samples: ColumnPreviewSampleDto[] | undefined;
  destinations: DestinationFieldDto[];
  destinationGroups: readonly string[];
  saving: boolean;
  canReset: boolean;
  /**
   * True while this row is the target an operator jumped to from a validation
   * issue. MUST be a declared prop: MappingRow is React.memo'd, so a highlight
   * driven by anything the memo comparison cannot see would never repaint.
   */
  isFocusTarget: boolean;
  /** Registers/unregisters this row's <tr> so the step can scroll it into view. */
  registerRowRef: (sourceField: string, el: HTMLTableRowElement | null) => void;
  onDestinationChange: (sourceField: string, destinationKey: string) => void;
  onTransformChange: (sourceField: string, transform: TransformName) => void;
  onComposeOrderChange: (sourceField: string, order: number) => void;
  onApproveMapping: (sourceField: string) => void;
  onMarkIgnore: (sourceField: string) => void;
  onMarkBlocked: (sourceField: string) => void;
  onResetAuto: (sourceField: string) => void;
}

const MappingRow: React.FC<RowProps> = React.memo(({
  mapping, profile, samples, destinations, destinationGroups, saving, canReset, isFocusTarget, registerRowRef,
  onDestinationChange, onTransformChange, onComposeOrderChange, onApproveMapping, onMarkIgnore, onMarkBlocked, onResetAuto,
}) => {
  const { t } = useTranslation(['platform']);
  const isLegalBlocked = mapping.state === 'LEGAL_BLOCKED';
  const isBlocked = mapping.state === 'BLOCKED';
  const isIgnored = mapping.state === 'IGNORE';
  /*
   * "Eşlemeyi Onayla" — F3-DATA-MIG-TODAY-001-R12-UX-CLOSURE. Offered only when
   * the row is SENSITIVE_REVIEW_REQUIRED and its already-proposed destination
   * would actually validate; see canApproveMapping's own doc for why each
   * check is there. LEGAL_BLOCKED rows never reach this branch — the server
   * independently refuses any edit to a stored LEGAL_BLOCKED row regardless of
   * what this UI-side check decides.
   */
  const canApprove = canApproveMapping(mapping, destinations);
  /*
   * ONLY the legal gate locks destination selection.
   *
   * SENSITIVE_REVIEW_REQUIRED is deliberately NOT part of this lock: the whole
   * point of that state is that the operator picks/approves a destination.
   *
   * BLOCKED was removed from this lock by F3-DATA-MIG-TODAY-001-R11. BLOCKED is
   * a SYSTEM RECOMMENDATION ("we found no destination for this column"), not a
   * decision — and locking the dropdown turned that recommendation into an
   * irreversible verdict. A column carrying real data (SUBEDOSYANO: 9,105
   * values; UNVANI: 14,890) could be recommended-blocked and the operator had
   * no way to route it anywhere, so the only path forward was silent data loss.
   * Re-selecting a destination moves the row BLOCKED -> RESOLVED through
   * handleDestinationChange, which the backend accepts; a BLOCKED row that
   * still carries a destination is rejected by validateMapping, and that
   * invariant is unchanged here.
   *
   * LEGAL_BLOCKED stays locked, and is not even rendered as a <select> below:
   * lifting a legal gate is a program-owner decision, never a mapping choice.
   * The server enforces this independently — the mapping PUT route refuses any
   * attempt to move a stored LEGAL_BLOCKED row — so this is the UI half of a
   * fail-closed pair, not the only guard.
   */
  const destSelectionLocked = isLegalBlocked;
  const selectedDest = mapping.destinationField ? destinations.find((d) => d.key === mapping.destinationField) : undefined;
  const nonZeroTypes = profile
    ? CANONICAL_CELL_TYPES.filter((ct) => (profile.typeCounts[ct] ?? 0) > 0)
    : [];
  const destinationDisplayLabel = (key: string, fallback: string) =>
    t(`platform:migration.mapping.destinationLabels.${key}`, { defaultValue: fallback });
  // Physical workbook coordinate (F3-DATA-MIG-TODAY-001-UI-006-R6, requirement
  // A) — deterministic from sourceIndex alone, NEVER from the (possibly
  // synthesized) header text, so a garbled or blank header can never be
  // mistaken for the column's real identity. Rendered in the single
  // convention `AQ (43)`: letter first, 1-based physical number in brackets.
  const coordinate = excelColumnCoordinate(mapping.sourceIndex);
  // Authoritative headerless test — the server's persisted `sourceHeader`,
  // not the shape of the synthesized `sourceField` (see isHeaderlessMapping).
  const isHeaderless = isHeaderlessMapping(mapping);
  const operatorStatus = operatorMappingStatus(mapping, profile);
  // PRIMARY identity line: the operator's own workbook header, verbatim.
  // A synthesized `COLUMN_<n>` must NEVER surface here as if it were a real
  // header — it stays in the `title=` tooltip for support/debugging only.
  const displayHeader = isHeaderless
    ? t('platform:migration.mapping.headerless')
    : (mapping.sourceHeader ?? mapping.sourceLabel ?? mapping.sourceField);
  const previewMissingDespiteData = !!profile && profile.filledCount > 0 && (!samples || samples.length === 0);

  return (
    <tr
      ref={(el) => registerRowRef(mapping.sourceField, el)}
      tabIndex={-1}
      aria-current={isFocusTarget ? 'true' : undefined}
      /*
       * Row tint follows the OPERATOR status, not the engine state (R12). The
       * old rule painted every BLOCKED row red and every LEGAL_BLOCKED row
       * amber; on the first customer's workbook that was 24 alarming rows, 24
       * of which held zero values. A column with nothing in it now reads as
       * what it is — settled and unremarkable — and red is spent only where
       * something really is wrong.
       */
      className={`border-b border-gray-50 dark:border-gray-800 align-top outline-none ${isFocusTarget ? 'ring-2 ring-inset ring-primary-500 bg-primary-50/40 dark:bg-primary-900/20' : ''} ${operatorStatus === 'ERROR' ? 'bg-red-50/60 dark:bg-red-900/10' : operatorStatus === 'NEEDS_REVIEW' ? 'bg-amber-50/50 dark:bg-amber-900/10' : operatorStatus === 'EMPTY' || operatorStatus === 'IGNORED' ? 'opacity-60' : ''}`}
    >
      {/* Source */}
      <td className="px-3 py-3 min-w-[180px]">
        <p
          className={`text-sm font-semibold break-all ${isHeaderless ? 'italic text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}
          title={mapping.sourceField}
        >
          {displayHeader}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {t('platform:migration.mapping.excelColumn', { n: coordinate.number, letter: coordinate.letter })}
        </p>
        {samples && samples.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 border-l-2 border-gray-100 dark:border-gray-800 pl-1.5">
            {samples.map((s) => (
              <li
                key={s.rowNumber}
                className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate max-w-[220px]"
                title={s.value}
              >
                {t('platform:migration.mapping.sampleRow', { row: s.rowNumber, value: s.value })}
              </li>
            ))}
          </ul>
        )}
        {previewMissingDespiteData && (
          <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400 italic max-w-[220px]">
            {t('platform:migration.mapping.previewUnavailable')}
          </p>
        )}
      </td>

      {/* Profile */}
      <td className="px-3 py-3 min-w-[150px]">
        {profile ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div className="h-full bg-primary-500" style={{ width: `${Math.round(profile.fillRate * 100)}%` }} />
              </div>
              <span className="text-[11px] text-gray-500 shrink-0 w-9 text-right">{formatPercent(profile.fillRate)}</span>
            </div>
            <p className="text-[11px] text-gray-400">
              {t('platform:migration.mapping.distinctCount', { n: profile.distinctCount })} · {t('platform:migration.mapping.maxLength', { n: profile.maxLength })}
            </p>
            {nonZeroTypes.length > 0 && (
              <p className="text-[10px] text-gray-400 truncate" title={nonZeroTypes.map((ct) => `${ct}:${profile.typeCounts[ct]}`).join(' ')}>
                {nonZeroTypes.map((ct) => `${t(`platform:migration.mapping.cellTypes.${ct}`)} ${profile.typeCounts[ct]}`).join(' · ')}
              </p>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>
        )}
      </td>

      {/* Destination */}
      <td className="px-3 py-3 min-w-[220px]">
        {isLegalBlocked ? (
          <div className="text-amber-700 dark:text-amber-400">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Lock size={13} />
              {t('platform:migration.mapping.legalGate')}
            </div>
            <p className="text-[11px] mt-1 font-normal">
              {t('platform:migration.mapping.legalReason', {
                reason: mapping.policyNote || t(`platform:migration.mapping.reasons.${mapping.reason}`, { defaultValue: mapping.reason }),
              })}
            </p>
          </div>
        ) : (
          <select
            className="input-field text-xs py-1.5"
            value={mapping.destinationField ?? ''}
            disabled={saving || destSelectionLocked}
            onChange={(e) => onDestinationChange(mapping.sourceField, e.target.value)}
          >
            <option value="">{t('platform:migration.mapping.noDestination')}</option>
            {destinationGroups.map((group) => {
              const inGroup = destinations.filter((d) => d.group === group);
              if (inGroup.length === 0) return null;
              return (
                <optgroup key={group} label={t(`platform:migration.mapping.groups.${group}`)}>
                  {inGroup.map((d) => (
                    <option key={d.key} value={d.key}>{destinationDisplayLabel(d.key, d.label)}{d.required ? ' *' : ''}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        )}
        {selectedDest && selectedDest.allowedTransforms.length > 1 && (
          <select
            className="input-field text-xs py-1 mt-1.5"
            value={mapping.transform ?? ''}
            disabled={saving || destSelectionLocked}
            onChange={(e) => onTransformChange(mapping.sourceField, e.target.value as TransformName)}
          >
            {selectedDest.allowedTransforms.map((tr) => (
              <option key={tr} value={tr}>{t(`platform:migration.mapping.transforms.${tr}`, { defaultValue: tr })}</option>
            ))}
          </select>
        )}
        {selectedDest?.allowsComposition && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[11px] text-gray-400">{t('platform:migration.mapping.composeOrder')}</span>
            <input
              type="number"
              min={1}
              className="input-field text-xs py-1 w-14"
              value={mapping.composeOrder ?? 1}
              disabled={saving}
              onChange={(e) => onComposeOrderChange(mapping.sourceField, Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        )}
      </td>

      {/* Confidence + reason */}
      <td className="px-3 py-3 min-w-[150px]">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className={`h-full ${mapping.confidence >= 80 ? 'bg-green-500' : mapping.confidence >= 40 ? 'bg-amber-500' : 'bg-gray-400'}`}
              style={{ width: `${Math.max(0, Math.min(100, mapping.confidence))}%` }}
            />
          </div>
          <span className="text-[11px] text-gray-500 shrink-0 w-7 text-right">{mapping.confidence}</span>
        </div>
        <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          {t(`platform:migration.mapping.reasons.${mapping.reason}`, { defaultValue: mapping.reason })}
        </span>
      </td>

      {/* State — operator vocabulary, with the engine state kept for support */}
      <td className="px-3 py-3 min-w-[130px]">
        <span className={OPERATOR_BADGE[operatorStatus]}>
          {t(`platform:migration.mapping.operatorStates.${operatorStatus}`)}
        </span>
        <p
          className="text-[10px] text-gray-400 mt-1 font-mono"
          title={t('platform:migration.mapping.internalStateHint')}
        >
          {mapping.state}
        </p>
      </td>

      {/* Actions */}
      <td className="px-3 py-3 min-w-[190px]">
        <div className="flex flex-col items-start gap-1">
          {/*
            * Offered ONLY for a SENSITIVE_REVIEW_REQUIRED row whose proposed
            * destination already validates (canApproveMapping above). Before
            * this button existed, approving a correct suggestion meant
            * temporarily choosing a different destination and then choosing
            * the right one again just to trigger a save — this sends the SAME
            * destination/transform/composeOrder with only `state` changed.
            */}
          {canApprove && (
            <button
              type="button"
              aria-label={t('platform:migration.mapping.actions.approve')}
              title={t('platform:migration.mapping.actions.approveHint')}
              disabled={saving}
              onClick={() => onApproveMapping(mapping.sourceField)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-green-200 dark:border-green-800 text-[11px] font-medium text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40"
            >
              <CheckCircle2 size={12} />
              {t('platform:migration.mapping.actions.approve')}
            </button>
          )}
          {/*
            * `!isLegalBlocked` added by F3-DATA-MIG-TODAY-001-R11. Ignoring a
            * legally-gated column would relabel a KVKK Art. 6 exclusion as an
            * ordinary operator exclusion and drop it from the LEGAL_BLOCKED
            * tally the dry run reports. The mapping PUT route now refuses the
            * write outright, so leaving the button visible would only offer an
            * action that always fails.
            */}
          {!isIgnored && !isLegalBlocked && (
            <button
              type="button"
              aria-label={t('platform:migration.mapping.actions.ignore')}
              title={t('platform:migration.mapping.actions.ignoreHint')}
              disabled={saving}
              onClick={() => onMarkIgnore(mapping.sourceField)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
            >
              <EyeOff size={12} />
              {t('platform:migration.mapping.actions.ignore')}
            </button>
          )}
          {!isBlocked && !isLegalBlocked && (
            <button
              type="button"
              aria-label={t('platform:migration.mapping.actions.block')}
              title={t('platform:migration.mapping.actions.blockHint')}
              disabled={saving}
              onClick={() => onMarkBlocked(mapping.sourceField)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
            >
              <Ban size={12} />
              {t('platform:migration.mapping.actions.block')}
            </button>
          )}
          {canReset && !isLegalBlocked && (
            <button
              type="button"
              aria-label={t('platform:migration.mapping.actions.reset')}
              title={t('platform:migration.mapping.actions.resetHint')}
              disabled={saving}
              onClick={() => onResetAuto(mapping.sourceField)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-40"
            >
              <RotateCcw size={12} />
              {t('platform:migration.mapping.actions.reset')}
            </button>
          )}
          {saving && <Loader2 size={13} className="animate-spin text-gray-400 self-center" />}
        </div>
      </td>
    </tr>
  );
});
MappingRow.displayName = 'MappingRow';

// ── Step ──────────────────────────────────────────────────────────────────────

const MigrationMappingStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep }) => {
  const { t } = useTranslation(['platform']);
  const [mappings, setMappings] = useState<MappingDto[] | null>(null);
  const [destinations, setDestinations] = useState<DestinationFieldDto[]>([]);
  const [validation, setValidation] = useState<MappingValidationDto | null>(null);
  const [profiles, setProfiles] = useState<Record<number, SourceColumnProfileDto>>({});
  const [previews, setPreviews] = useState<Record<number, ColumnPreviewSampleDto[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [bulkBusy, setBulkBusy] = useState<'accept' | 'exclusions' | 'validate' | null>(null);
  const [bulkNotice, setBulkNotice] = useState('');
  const [advancing, setAdvancing] = useState(false);

  const [filter, setFilter] = useState<MappingFilterId>('all');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  /**
   * Which row a validation issue sent the operator to. `nonce` exists so that
   * clicking the SAME issue twice re-runs the scroll/focus effect instead of
   * being swallowed as an identical state value.
   */
  const [focusTarget, setFocusTarget] = useState<{ sourceField: string; nonce: number } | null>(null);

  const initialMappingsRef = useRef<Map<string, MappingDto>>(new Map());
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Debounce the free-text filter so the list doesn't re-derive per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setQuery(queryInput), 250);
    return () => clearTimeout(handle);
  }, [queryInput]);

  const fetchAll = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.allSettled([
      api.getMappings(run.id),
      api.analyze(run.id, run.sheetIndex ?? undefined),
    ]).then(([mapRes, analysisRes]) => {
      if (mapRes.status === 'fulfilled') {
        setMappings(mapRes.value.mappings);
        setDestinations(mapRes.value.destinations);
        setValidation(mapRes.value.validation);
        initialMappingsRef.current = new Map(mapRes.value.mappings.map((m) => [m.sourceField, m]));
      } else {
        setError(getErrorMessage(mapRes.reason, t('platform:migration.mapping.errors.loadFailed')));
      }
      if (analysisRes.status === 'fulfilled') {
        const byIndex: Record<number, SourceColumnProfileDto> = {};
        for (const p of analysisRes.value.analysis.profiles) byIndex[p.index] = p;
        setProfiles(byIndex);
        const previewByIndex: Record<number, ColumnPreviewSampleDto[]> = {};
        for (const p of analysisRes.value.analysis.columnPreviews ?? []) previewByIndex[p.index] = p.samples;
        setPreviews(previewByIndex);
        onRunUpdated(analysisRes.value.run);
      }
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, run.id, run.sheetIndex, t]);

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Save ONE row's decision. F3-DATA-MIG-TODAY-001-R12.
   *
   * THE PRODUCTION DEFECT THIS REPLACES. This function used to update the row
   * locally and then serialise EVERY mapping — `next.map(...)` — into the PUT
   * body. The server's legal gate treated the presence of a column in that body
   * as an attempt to edit it, so the first customer's two untouched
   * LEGAL_BLOCKED consent columns were in every save and every save was
   * rejected with HTTP 400. Changing SUBEDOSYANO, or anything else, was
   * impossible; repeated clicks produced repeated 400s.
   *
   * Sending only the edited row is the honest description of what the operator
   * did, and it also removes an ordering hazard the full-collection save had:
   * two quick edits each sent a full snapshot, so the second overwrote the
   * first's row with the stale copy it had been holding.
   *
   * The server is still the authority. It diffs the submitted row against its
   * own stored row and refuses a genuine legal-gate edit regardless of payload
   * size, so this is not the thing keeping the gate closed — see
   * mappingWriteDiff.ts.
   */
  const persistMapping = useCallback((sourceField: string, updater: (row: MappingDto) => MappingDto) => {
    setSavingField(sourceField);
    setSaveError('');
    setMappings((prev) => {
      if (!prev) return prev;
      const current = prev.find((m) => m.sourceField === sourceField);
      if (!current) {
        setSavingField(null);
        return prev;
      }
      const edited = updater(current);
      const payload: MappingWritePayload[] = [{
        sourceField: edited.sourceField,
        destinationField: edited.destinationField,
        transform: edited.transform,
        composeOrder: edited.composeOrder,
        state: edited.state,
      }];
      api.saveMappings(run.id, payload)
        .then((res) => {
          setMappings(res.mappings);
          setValidation(res.validation);
        })
        .catch((err) => setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.saveFailed'))))
        .finally(() => setSavingField(null));
      return prev.map((m) => (m.sourceField === sourceField ? edited : m));
    });
  }, [api, run.id, t]);

  const handleDestinationChange = useCallback((sourceField: string, destinationKey: string) => {
    const dest = destinationKey ? destinations.find((d) => d.key === destinationKey) : undefined;
    persistMapping(sourceField, (m) => ({
      ...m,
      destinationField: dest?.key ?? null,
      destinationLabel: dest?.label ?? null,
      transform: dest?.allowedTransforms[0] ?? null,
      composeOrder: dest?.allowsComposition ? (m.composeOrder ?? 1) : null,
      reason: 'MANUAL',
      confidence: dest ? 100 : 0,
      state: dest ? 'RESOLVED' : 'MANUAL_REQUIRED',
    }));
  }, [destinations, persistMapping]);

  const handleTransformChange = useCallback((sourceField: string, transform: TransformName) => {
    persistMapping(sourceField, (m) => ({ ...m, transform }));
  }, [persistMapping]);

  const handleComposeOrderChange = useCallback((sourceField: string, order: number) => {
    persistMapping(sourceField, (m) => ({ ...m, composeOrder: order }));
  }, [persistMapping]);

  /**
   * "Yok say" (ignore). F3-DATA-MIG-TODAY-001-R12-UX-CLOSURE.
   *
   * THE PRODUCTION DEFECT THIS FIXES. This updater used to change only `state`,
   * leaving destinationField/transform/composeOrder exactly as they were. For a
   * column the engine had already proposed a destination for (KANGURUBU ->
   * patient.bloodGroup), that sent IGNORE alongside the untouched destination in
   * the SAME PUT payload — and because `persistMapping` always sends the full
   * four-field tuple, the server wrote destinationField verbatim, producing a
   * row that was simultaneously "ignored" and still mapped
   * (MAPPING_INVALID — "marked ignored but still carries destination"). The
   * operator had no way to reach a clean ignored row without opening the
   * dropdown and clearing it by hand first.
   *
   * The four fields are cleared in the SAME updater, so `persistMapping` sends
   * them in the SAME PUT row and the server writes them in the SAME
   * `updateMany` — atomically, not as two decisions that could observe a
   * half-written row in between.
   */
  const handleMarkIgnore = useCallback((sourceField: string) => {
    persistMapping(sourceField, (m) => ({
      ...m,
      state: 'IGNORE',
      destinationField: null,
      destinationLabel: null,
      transform: null,
      composeOrder: null,
    }));
  }, [persistMapping]);

  /**
   * "Eşlemeyi Onayla" — approve a SENSITIVE_REVIEW_REQUIRED row's ALREADY
   * proposed destination without altering it. F3-DATA-MIG-TODAY-001-R12-UX-CLOSURE.
   *
   * Only offered when `canApproveMapping` says the row's current
   * destination/transform/composeOrder would already validate (see the
   * MappingRow render above), so this never needs to touch any of the three.
   * Reuses `persistMapping`, i.e. the SAME PUT /mappings + semantic-diff
   * machinery every other edit goes through: the server treats the
   * SENSITIVE_REVIEW_REQUIRED -> RESOLVED state change alone as a semantic
   * change (mappingWriteDiff.ts), writes exactly this one row, and stamps
   * decidedByPlatformAdminId/decidedAt — the same audit record a manual
   * re-selection of the same destination already produces today. No new
   * endpoint, no new server-side trust: a LEGAL_BLOCKED row is never offered
   * this action, and even a hand-crafted request against it is still refused
   * by the existing legal gate (assertPlanHasNoLegallyGatedEdits).
   */
  const handleApproveMapping = useCallback((sourceField: string) => {
    persistMapping(sourceField, (m) => ({ ...m, state: 'RESOLVED' }));
  }, [persistMapping]);

  const handleMarkBlocked = useCallback((sourceField: string) => {
    persistMapping(sourceField, (m) => ({ ...m, state: 'BLOCKED' }));
  }, [persistMapping]);

  const handleResetAuto = useCallback((sourceField: string) => {
    const original = initialMappingsRef.current.get(sourceField);
    if (!original) return;
    persistMapping(sourceField, () => original);
  }, [persistMapping]);

  const handleAcceptAllSafe = async () => {
    setBulkBusy('accept');
    setSaveError('');
    setBulkNotice('');
    try {
      const res = await api.acceptAutoMappings(run.id);
      setMappings(res.mappings);
      setValidation(res.validation);
      setBulkNotice(t('platform:migration.mapping.bulk.acceptedNotice', { n: res.accepted }));
    } catch (err) {
      setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.acceptFailed')));
    } finally {
      setBulkBusy(null);
    }
  };

  /**
   * Confirm every column the SYSTEM recommends excluding that still carries
   * data (F3-DATA-MIG-TODAY-001-R12).
   *
   * WHY THIS EXISTS. The data-loss gate refuses to accept a system-recommended
   * IGNORE as a decision — nobody chose it — so each such column needed a human
   * to open it and re-save it. Eight columns on the first customer's workbook,
   * and no way to see them as a set.
   *
   * WHY IT IS STILL A DECISION AND NOT A BYPASS. The list is computed from what
   * is ON SCREEN, sent explicitly, and shown to the operator first (the button
   * names the count, and the `empty` chip proves the rest are empty). Columns
   * with NO data are deliberately left out: the gate already treats a measured
   * zero as nothing to lose, so confirming them would be a click that records
   * a decision about nothing.
   */
  const handleConfirmExclusions = async () => {
    if (confirmableExclusions.length === 0) return;
    setBulkBusy('exclusions');
    setSaveError('');
    setBulkNotice('');
    try {
      const res = await api.confirmExclusions(run.id, confirmableExclusions.map((m) => m.sourceField));
      setMappings(res.mappings);
      setValidation(res.validation);
      setBulkNotice(t('platform:migration.mapping.bulk.confirmedNotice', { n: res.confirmed }));
    } catch (err) {
      setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.confirmFailed')));
    } finally {
      setBulkBusy(null);
    }
  };

  const handleValidate = async () => {
    setBulkBusy('validate');
    setSaveError('');
    try {
      const res = await api.validateMappings(run.id);
      setValidation(res);
    } catch (err) {
      setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.validateFailed')));
    } finally {
      setBulkBusy(null);
    }
  };

  const handleContinue = async () => {
    setAdvancing(true);
    setSaveError('');
    try {
      const detail = await api.getRun(run.id);
      onRunUpdated(detail.run);
      onNext(nextStep);
    } catch (err) {
      setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.loadFailed')));
    } finally {
      setAdvancing(false);
    }
  };

  const registerRowRef = useCallback((sourceField: string, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(sourceField, el);
    else rowRefs.current.delete(sourceField);
  }, []);

  /**
   * Navigate from a validation issue to the column it is about. STRICTLY a
   * navigation: it never touches a mapping's state, destination, transform or
   * compose order, and never triggers a save.
   *
   * Both `query` AND `queryInput` are cleared: clearing only the debounced
   * `query` would let the 250ms debounce effect immediately re-apply the stale
   * input text and hide the row again a quarter-second after we scrolled to it.
   */
  const handleJumpToRow = useCallback((sourceField: string | undefined) => {
    if (!sourceField) return;
    const target = (mappings ?? []).find((m) => m.sourceField === sourceField);
    if (!target) return; // Unknown column — do nothing at all, never throw.
    setFilter('all');
    setQueryInput('');
    setQuery('');
    setFocusTarget((prev) => ({ sourceField, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [mappings]);

  /**
   * Scroll/focus runs in an effect, NOT in the click handler: the row may be
   * filtered out at click time, so the DOM node only exists after the filter
   * reset above has re-rendered the table. An effect is committed after that
   * render, which is exactly the moment the node is available.
   */
  useEffect(() => {
    if (!focusTarget) return;
    const el = rowRefs.current.get(focusTarget.sourceField);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    const handle = setTimeout(() => setFocusTarget(null), 2000);
    return () => clearTimeout(handle);
  }, [focusTarget]);

  const visibleMappings = useMemo(() => {
    if (!mappings) return [];
    return mappings.filter((m) => mappingRowVisible(m, filter, query, profiles[m.sourceIndex]));
  }, [mappings, filter, query, profiles]);

  /**
   * The whole sheet, counted in the operator's vocabulary. One pass, so the
   * summary bar, the "remaining work" figure and the bulk-action button all
   * read from the same classification the badges use.
   */
  const operatorTally = useMemo(() => {
    const counts: Record<OperatorMappingStatus, number> = {
      MATCHED: 0, PRESERVED: 0, NEEDS_REVIEW: 0, EMPTY: 0, IGNORED: 0, ERROR: 0,
    };
    let remaining = 0;
    for (const m of mappings ?? []) {
      const status = operatorMappingStatus(m, profiles[m.sourceIndex]);
      counts[status]++;
      if (operatorNeedsAction(status)) remaining++;
    }
    return { counts, remaining };
  }, [mappings, profiles]);

  /**
   * Columns eligible for the bulk exclusion confirmation: recommended for
   * exclusion (IGNORE / BLOCKED) AND carrying MEASURED data.
   *
   * The fill test is `> 0` on a profile that EXISTS. A column nobody measured
   * is not swept in — the server-side gate treats unmeasured as unproven and
   * blocks on it, so bulk-confirming one here would record a decision the gate
   * would (correctly) still refuse to honour.
   */
  const confirmableExclusions = useMemo(
    () =>
      (mappings ?? []).filter((m) => {
        if (m.state !== 'IGNORE' && m.state !== 'BLOCKED') return false;
        const profile = profiles[m.sourceIndex];
        return !!profile && profile.filledCount > 0;
      }),
    [mappings, profiles],
  );

  const canContinue = !!validation?.valid && !loading && !bulkBusy;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('platform:migration.mapping.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('platform:migration.mapping.subtitle')}</p>
        </div>
        {mappings && (
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn-secondary text-xs" disabled={bulkBusy !== null} onClick={handleAcceptAllSafe}>
              {bulkBusy === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              {t('platform:migration.mapping.acceptAllSafe')}
            </button>
            {/* Only offered when there is something to confirm; a button that
                does nothing is worse than no button. The count is in the label
                so the operator knows the size of what they are agreeing to. */}
            {confirmableExclusions.length > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={bulkBusy !== null}
                title={t('platform:migration.mapping.bulk.confirmExclusionsHint')}
                onClick={handleConfirmExclusions}
              >
                {bulkBusy === 'exclusions' ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
                {t('platform:migration.mapping.bulk.confirmExclusions', { n: confirmableExclusions.length })}
              </button>
            )}
            <button type="button" className="btn-secondary text-xs" disabled={bulkBusy !== null} onClick={handleValidate}>
              {bulkBusy === 'validate' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              {t('platform:migration.mapping.validateMapping')}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      ) : mappings && validation ? (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t('platform:migration.mapping.searchPlaceholder')}
                className="pl-7 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 w-52"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {MAPPING_FILTER_IDS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                    filter === f
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {t(`platform:migration.mapping.filters.${f}`)}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400 ml-auto">
              {t('platform:migration.mapping.rowsShown', { shown: visibleMappings.length, total: mappings.length })}
            </span>
          </div>

          {/*
            * THE HEADLINE THE OPERATOR ACTUALLY NEEDS. Not "26 unresolved
            * mappings" in engine vocabulary but "how many columns are still
            * waiting for you", with everything else already accounted for. On
            * the first customer's workbook this reads 4 after the two bulk
            * actions: three special-category columns and one unknown header.
            */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 px-4 py-3 mb-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${operatorTally.remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {operatorTally.remaining}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {t('platform:migration.mapping.remainingWork')}
              </span>
            </div>
            <span className="text-xs text-gray-400">·</span>
            {OPERATOR_SUMMARY_ORDER.map((status) => (
              <span key={status} className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-800 dark:text-gray-100">{operatorTally.counts[status]}</span>{' '}
                {t(`platform:migration.mapping.operatorStates.${status}`)}
              </span>
            ))}
          </div>

          {bulkNotice && (
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-lg p-2.5 mb-3 text-sm">
              <ShieldCheck size={14} />
              {bulkNotice}
            </div>
          )}

          {saveError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5 mb-3 text-sm">
              <AlertCircle size={14} />
              {saveError}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">{t('platform:migration.mapping.columns.source')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.mapping.columns.profile')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.mapping.columns.destination')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.mapping.columns.confidence')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.mapping.columns.state')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.mapping.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleMappings.map((m) => (
                  <MappingRow
                    key={m.sourceField}
                    mapping={m}
                    profile={profiles[m.sourceIndex]}
                    samples={previews[m.sourceIndex]}
                    destinations={destinations}
                    destinationGroups={DESTINATION_GROUPS}
                    saving={savingField === m.sourceField}
                    canReset={initialMappingsRef.current.has(m.sourceField)}
                    isFocusTarget={focusTarget?.sourceField === m.sourceField}
                    registerRowRef={registerRowRef}
                    onDestinationChange={handleDestinationChange}
                    onTransformChange={handleTransformChange}
                    onComposeOrderChange={handleComposeOrderChange}
                    onApproveMapping={handleApproveMapping}
                    onMarkIgnore={handleMarkIgnore}
                    onMarkBlocked={handleMarkBlocked}
                    onResetAuto={handleResetAuto}
                  />
                ))}
                {visibleMappings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-400 py-10 text-sm">{t('platform:migration.mapping.noRows')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Validation summary bar */}
          <div className={`mt-4 rounded-xl border p-4 ${validation.valid ? 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10' : 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/10'}`}>
            <div className="flex flex-wrap gap-4 mb-2">
              <SummaryStat label={t('platform:migration.mapping.summary.mapped')} value={validation.mappedCount} />
              <SummaryStat label={t('platform:migration.mapping.summary.unresolved')} value={validation.unresolvedCount} warn={validation.unresolvedCount > 0} />
              <SummaryStat label={t('platform:migration.mapping.summary.blocked')} value={validation.blockedCount} warn={validation.blockedCount > 0} />
              <SummaryStat label={t('platform:migration.mapping.summary.legalBlocked')} value={validation.legalBlockedCount} warn={validation.legalBlockedCount > 0} />
              <SummaryStat
                label={t('platform:migration.mapping.summary.sensitiveReview')}
                value={validation.sensitiveReviewCount ?? 0}
                attention={(validation.sensitiveReviewCount ?? 0) > 0}
              />
              <SummaryStat label={t('platform:migration.mapping.summary.ignored')} value={validation.ignoredCount} />
            </div>
            {validation.issues.length > 0 && (
              <ul className="space-y-1.5 mt-2">
                {validation.issues.map((issue, idx) => {
                  const text = (
                    <>
                      <span className="font-mono font-semibold">{issue.code}</span>
                      {issue.sourceField ? ` — ${issue.sourceField}` : ''}
                      {': '}{issue.message}
                    </>
                  );
                  return (
                    <li key={`${issue.code}-${idx}`} className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      {/* An issue that names a column is a navigation affordance:
                          a real, keyboard-reachable button that reveals and
                          focuses that row. An issue with no sourceField has
                          nowhere to go and stays plain text. */}
                      {issue.sourceField ? (
                        <button
                          type="button"
                          onClick={() => handleJumpToRow(issue.sourceField)}
                          title={t('platform:migration.mapping.jumpToRow')}
                          className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {text}
                          <span className="sr-only"> — {t('platform:migration.mapping.jumpToRow')}</span>
                        </button>
                      ) : (
                        <span>{text}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!validation.valid && (
              <p className="text-xs font-semibold text-red-700 dark:text-red-300 mt-2">
                {t('platform:migration.mapping.cannotContinue')}
              </p>
            )}
          </div>

          <button
            type="button"
            className="btn-primary w-full justify-center mt-4"
            disabled={!canContinue || advancing}
            onClick={handleContinue}
          >
            {advancing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {t('platform:migration.mapping.continue')}
          </button>
        </>
      ) : null}
    </div>
  );
};

/**
 * `warn` = red (something is wrong). `attention` = amber (a human still has to
 * look at this, but nothing is broken) — used by the sensitive-review count,
 * which must not read as an error the way legal blocks do.
 */
const SummaryStat: React.FC<{ label: string; value: number; warn?: boolean; attention?: boolean }> = ({ label, value, warn, attention }) => (
  <div className="flex items-center gap-1.5">
    <span className={`text-lg font-bold ${warn ? 'text-red-600 dark:text-red-400' : attention ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>{value}</span>
    <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-0.5">
      <ChevronRight size={11} className="opacity-40" />
      {label}
    </span>
  </div>
);

export default MigrationMappingStep;
