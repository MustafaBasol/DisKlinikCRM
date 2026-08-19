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
  mappingRowVisible,
  formatPercent,
  parseUnnamedColumnIndex,
  excelColumnLetter,
} from '../../../pages/platformMigrationHelpers';
import type { ColumnPreviewSampleDto } from '../../../services/platformMigrationApi';

// ── State badge ──────────────────────────────────────────────────────────────

const STATE_BADGE: Record<MappingState, string> = {
  AUTO_CONFIDENT: 'badge-green',
  RESOLVED: 'badge-green',
  AUTO_REVIEW: 'badge-blue',
  MANUAL_REQUIRED: 'badge-yellow',
  IGNORE: 'badge-gray',
  BLOCKED: 'badge-red',
  LEGAL_BLOCKED: 'badge-red',
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
  onDestinationChange: (sourceField: string, destinationKey: string) => void;
  onTransformChange: (sourceField: string, transform: TransformName) => void;
  onComposeOrderChange: (sourceField: string, order: number) => void;
  onMarkIgnore: (sourceField: string) => void;
  onMarkBlocked: (sourceField: string) => void;
  onResetAuto: (sourceField: string) => void;
}

const MappingRow: React.FC<RowProps> = React.memo(({
  mapping, profile, samples, destinations, destinationGroups, saving, canReset,
  onDestinationChange, onTransformChange, onComposeOrderChange, onMarkIgnore, onMarkBlocked, onResetAuto,
}) => {
  const { t } = useTranslation(['platform']);
  const isLegalBlocked = mapping.state === 'LEGAL_BLOCKED';
  const isBlocked = mapping.state === 'BLOCKED';
  const isIgnored = mapping.state === 'IGNORE';
  const destSelectionLocked = isLegalBlocked || isBlocked;
  const selectedDest = mapping.destinationField ? destinations.find((d) => d.key === mapping.destinationField) : undefined;
  const nonZeroTypes = profile
    ? CANONICAL_CELL_TYPES.filter((ct) => (profile.typeCounts[ct] ?? 0) > 0)
    : [];
  const destinationDisplayLabel = (key: string, fallback: string) =>
    t(`platform:migration.mapping.destinationLabels.${key}`, { defaultValue: fallback });
  // Physical workbook coordinate (F3-DATA-MIG-TODAY-001-UI-006-R6, requirement
  // A) — deterministic from sourceIndex alone, NEVER from the (possibly
  // synthesized) header text, so a garbled or blank header can never be
  // mistaken for the column's real identity.
  const excelLetter = excelColumnLetter(mapping.sourceIndex);
  const isHeaderless = parseUnnamedColumnIndex(mapping.sourceField) !== null;
  const displayHeader = isHeaderless ? t('platform:migration.mapping.headerless') : mapping.sourceLabel;
  const previewMissingDespiteData = !!profile && profile.filledCount > 0 && (!samples || samples.length === 0);

  return (
    <tr className={`border-b border-gray-50 dark:border-gray-800 align-top ${isLegalBlocked ? 'bg-amber-50/60 dark:bg-amber-900/10' : isBlocked ? 'bg-red-50/60 dark:bg-red-900/10' : isIgnored ? 'opacity-60' : ''}`}>
      {/* Source */}
      <td className="px-3 py-3 min-w-[180px]">
        <p
          className={`text-xs font-semibold break-all ${isHeaderless ? 'italic text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}
          title={mapping.sourceField}
        >
          {displayHeader}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {t('platform:migration.mapping.excelColumn', { n: mapping.sourceIndex + 1, letter: excelLetter })}
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

      {/* State */}
      <td className="px-3 py-3 min-w-[110px]">
        <span className={STATE_BADGE[mapping.state]}>
          {t(`platform:migration.mapping.states.${mapping.state}`)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-3 py-3 min-w-[190px]">
        <div className="flex flex-col items-start gap-1">
          {!isIgnored && (
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
  const [bulkBusy, setBulkBusy] = useState<'accept' | 'validate' | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const [filter, setFilter] = useState<MappingFilterId>('all');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');

  const initialMappingsRef = useRef<Map<string, MappingDto>>(new Map());

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

  const persistMapping = useCallback((sourceField: string, updater: (row: MappingDto) => MappingDto) => {
    setSavingField(sourceField);
    setSaveError('');
    setMappings((prev) => {
      if (!prev) return prev;
      const next = prev.map((m) => (m.sourceField === sourceField ? updater(m) : m));
      const payload: MappingWritePayload[] = next.map((m) => ({
        sourceField: m.sourceField,
        destinationField: m.destinationField,
        transform: m.transform,
        composeOrder: m.composeOrder,
        state: m.state,
      }));
      api.saveMappings(run.id, payload)
        .then((res) => {
          setMappings(res.mappings);
          setValidation(res.validation);
        })
        .catch((err) => setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.saveFailed'))))
        .finally(() => setSavingField(null));
      return next;
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

  const handleMarkIgnore = useCallback((sourceField: string) => {
    persistMapping(sourceField, (m) => ({ ...m, state: 'IGNORE' }));
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
    try {
      const res = await api.acceptAutoMappings(run.id);
      setMappings(res.mappings);
      setValidation(res.validation);
    } catch (err) {
      setSaveError(getErrorMessage(err, t('platform:migration.mapping.errors.acceptFailed')));
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

  const visibleMappings = useMemo(() => {
    if (!mappings) return [];
    return mappings.filter((m) => mappingRowVisible(m, filter, query));
  }, [mappings, filter, query]);

  const canContinue = !!validation?.valid && !loading && !bulkBusy;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('platform:migration.mapping.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('platform:migration.mapping.subtitle')}</p>
        </div>
        {mappings && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs" disabled={bulkBusy !== null} onClick={handleAcceptAllSafe}>
              {bulkBusy === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              {t('platform:migration.mapping.acceptAllSafe')}
            </button>
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
                    onDestinationChange={handleDestinationChange}
                    onTransformChange={handleTransformChange}
                    onComposeOrderChange={handleComposeOrderChange}
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
              <SummaryStat label={t('platform:migration.mapping.summary.ignored')} value={validation.ignoredCount} />
            </div>
            {validation.issues.length > 0 && (
              <ul className="space-y-1.5 mt-2">
                {validation.issues.map((issue, idx) => (
                  <li key={`${issue.code}-${idx}`} className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>
                      <span className="font-mono font-semibold">{issue.code}</span>
                      {issue.sourceField ? ` — ${issue.sourceField}` : ''}
                      {': '}{issue.message}
                    </span>
                  </li>
                ))}
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

const SummaryStat: React.FC<{ label: string; value: number; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="flex items-center gap-1.5">
    <span className={`text-lg font-bold ${warn ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{value}</span>
    <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-0.5">
      <ChevronRight size={11} className="opacity-40" />
      {label}
    </span>
  </div>
);

export default MigrationMappingStep;
