import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, AlertCircle, AlertTriangle, PlayCircle, ArrowRight, ShieldCheck,
  Users, PhoneCall, Scale, Lock, CheckCircle2, XCircle, ArrowLeft,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type { DryRunSummaryDto, DryRunRowClass, IdentityClassification } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';
import { isRunInFlight, MIGRATION_STEPS } from '../../../pages/platformMigrationHelpers';
import MigrationRejectedDownload from './MigrationRejectedDownload';

const ROW_CLASS_ORDER: DryRunRowClass[] = [
  'VALID_NEW', 'VALID_MATCHED', 'NORMALIZED', 'AMBIGUOUS', 'MAPPING_REQUIRED',
  'INVALID', 'DUPLICATE_SOURCE', 'DUPLICATE_DESTINATION', 'SKIPPED_BY_POLICY', 'BLOCKED',
];

const IDENTITY_ORDER: IdentityClassification[] = ['VALID', 'INVALID_LEGACY', 'AMBIGUOUS', 'DUPLICATE_SOURCE', 'MANUAL_REVIEW', 'ABSENT'];

const Tile: React.FC<{ label: string; value: number; tone?: 'default' | 'good' | 'bad' }> = ({ label, value, tone = 'default' }) => (
  <div className={`rounded-lg border p-3 ${
    tone === 'bad'
      ? 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/10'
      : tone === 'good'
        ? 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10'
        : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40'
  }`}>
    <p className={`text-xl font-bold ${tone === 'bad' ? 'text-red-700 dark:text-red-300' : tone === 'good' ? 'text-green-700 dark:text-green-300' : 'text-gray-900 dark:text-white'}`}>{value}</p>
    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
  </div>
);

const BreakdownList: React.FC<{ title: string; entries: [string, number][]; translateKeyPrefix: string }> = ({ title, entries, translateKeyPrefix }) => {
  const { t } = useTranslation(['platform']);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</p>
      <div className="space-y-1.5">
        {entries.map(([key, n]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-300 w-40 shrink-0 truncate">{t(`${translateKeyPrefix}.${key}`, { defaultValue: key })}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className="h-full bg-primary-500" style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 w-8 text-right">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Turkish list join: "A", "A ve B", "A, B ve C". Not i18n-driven — every
 * locale this product ships (tr/en/de/fr) uses the same comma-then-"and"
 * shape, only the conjunction word differs, which the caller passes in.
 */
function joinClauses(parts: string[], conjunction: string): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`;
}

const MigrationDryRunStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep, onBack }) => {
  const { t } = useTranslation(['platform']);
  const [dryRun, setDryRun] = useState<DryRunSummaryDto | null>(null);
  const [status, setStatus] = useState(run.status);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadExisting = useCallback(() => {
    setLoading(true);
    setError('');
    api.getRun(run.id)
      .then((detail) => {
        setStatus(detail.run.status);
        onRunUpdated(detail.run);
        if (detail.dryRun) setDryRun(detail.dryRun);
        if (isRunInFlight(detail.run.status)) startPolling();
      })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.dryRun.errors.loadFailed'))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, run.id, t]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      api.getProgress(run.id)
        .then((progress) => {
          setStatus(progress.status);
          if (!isRunInFlight(progress.status)) {
            stopPolling();
            api.getRun(run.id).then((detail) => {
              onRunUpdated(detail.run);
              if (detail.dryRun) setDryRun(detail.dryRun);
            }).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 2000);
  }, [api, run.id, onRunUpdated, stopPolling]);

  useEffect(() => {
    loadExisting();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunDryRun = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await api.dryRun(run.id);
      setStatus(res.run.status);
      onRunUpdated(res.run);
      if (res.dryRun) setDryRun(res.dryRun);
      if (isRunInFlight(res.run.status)) startPolling();
    } catch (err) {
      setError(getErrorMessage(err, t('platform:migration.dryRun.errors.runFailed')));
    } finally {
      setRunning(false);
    }
  };

  const handleContinue = async () => {
    setAdvancing(true);
    setError('');
    try {
      const detail = await api.getRun(run.id);
      onRunUpdated(detail.run);
      onNext(nextStep);
    } catch (err) {
      setError(getErrorMessage(err, t('platform:migration.dryRun.errors.loadFailed')));
    } finally {
      setAdvancing(false);
    }
  };

  const inFlight = isRunInFlight(status);
  // Defensive fallback for a pre-#454 persisted DryRunSummary: the API client
  // normalizes this at the boundary (platformMigrationApi.ts), but this keeps
  // the render itself safe against any other source of a legacy-shaped DTO.
  const legalExclusions = dryRun?.legalExclusions ?? [];

  /**
   * How many source rows the rejected-row export will contain.
   *
   * PREFER THE SERVER'S NUMBER. `rejectedRows` is computed in dryRun.ts from the
   * same three row-rejection classes rowRejection.ts defines and the export
   * writer uses, so the count on screen and the rows in the downloaded file are
   * the same number by construction rather than by two implementations
   * agreeing.
   *
   * The sum is the FALLBACK for a dry run persisted before R12, which has no
   * such field. It reproduces the same three buckets from counters those
   * summaries do carry. `warningRows` is in neither: a warning row still
   * imports, and sending the operator to fix it in Excel would send them after
   * something that is not broken.
   */
  const rejectedRows = dryRun
    ? dryRun.rejectedRows ??
      dryRun.invalidRows + dryRun.duplicateSourceRows + dryRun.referenceMappingBlockers
    : 0;

  return (
    <div className="card p-5 max-w-4xl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('platform:migration.dryRun.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('platform:migration.dryRun.subtitle')}</p>

      <div className="flex items-center gap-2 mb-4 text-xs font-semibold text-primary-800 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3">
        <ShieldCheck size={15} className="shrink-0" />
        {t('platform:migration.dryRun.zeroWritesNote')}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      ) : !dryRun ? (
        <div className="space-y-4">
          {inFlight ? (
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <Loader2 size={16} className="animate-spin" />
              {t('platform:migration.dryRun.inProgress')}
            </div>
          ) : (
            <button type="button" className="btn-primary w-full justify-center" disabled={running} onClick={handleRunDryRun}>
              {running ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
              {t('platform:migration.dryRun.run')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/*
            * THE PLAIN-LANGUAGE ANSWER, FIRST (F3-DATA-MIG-TODAY-001-R12).
            *
            * The tiles below are complete and an engineer can read them, but an
            * operator arrives at this screen with exactly two questions: how
            * many patients will come across, and what happens to the ones that
            * will not. Those two numbers now lead, in words, and the fix for
            * the second is a button directly underneath rather than a support
            * request.
            */}
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 p-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="text-sm text-gray-700 dark:text-gray-200">
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">{dryRun.validRows}</span>{' '}
                {t('platform:migration.dryRun.plain.importable')}
              </span>
              <span className="text-sm text-gray-700 dark:text-gray-200">
                <span className={`text-2xl font-bold ${rejectedRows > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>{rejectedRows}</span>{' '}
                {t('platform:migration.dryRun.plain.notImportable')}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('platform:migration.dryRun.plain.ofTotal', { n: dryRun.totalSourceRows })}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {rejectedRows > 0
                ? t('platform:migration.dryRun.plain.rejectedExplain')
                : t('platform:migration.dryRun.plain.allClear')}
            </p>
          </div>

          {rejectedRows > 0 && (
            <MigrationRejectedDownload runId={run.id} api={api} rejectedRowCount={rejectedRows} />
          )}

          {/* Count tiles */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t('platform:migration.dryRun.rowTotals')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label={t('platform:migration.dryRun.fields.totalSourceRows')} value={dryRun.totalSourceRows} />
              <Tile label={t('platform:migration.dryRun.fields.parsedRows')} value={dryRun.parsedRows} />
              <Tile label={t('platform:migration.dryRun.fields.validRows')} value={dryRun.validRows} tone="good" />
              <Tile label={t('platform:migration.dryRun.fields.warningRows')} value={dryRun.warningRows} tone={dryRun.warningRows > 0 ? 'bad' : 'default'} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t('platform:migration.dryRun.expectedOutcome')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Tile label={t('platform:migration.dryRun.fields.expectedCreateCount')} value={dryRun.expectedCreateCount} tone="good" />
              <Tile label={t('platform:migration.dryRun.fields.expectedReuseCount')} value={dryRun.expectedReuseCount} />
              <Tile label={t('platform:migration.dryRun.fields.expectedSkippedCount')} value={dryRun.expectedSkippedCount} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t('platform:migration.dryRun.problems')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label={t('platform:migration.dryRun.fields.blockedRows')} value={dryRun.blockedRows} tone={dryRun.blockedRows > 0 ? 'bad' : 'default'} />
              <Tile label={t('platform:migration.dryRun.fields.invalidRows')} value={dryRun.invalidRows} tone={dryRun.invalidRows > 0 ? 'bad' : 'default'} />
              <Tile label={t('platform:migration.dryRun.fields.duplicateSourceRows')} value={dryRun.duplicateSourceRows} />
              <Tile label={t('platform:migration.dryRun.fields.ambiguousRows')} value={dryRun.ambiguousRows} />
              <Tile label={t('platform:migration.dryRun.fields.manualReviewRows')} value={dryRun.manualReviewRows} />
              <Tile label={t('platform:migration.dryRun.fields.unresolvedMappings')} value={dryRun.unresolvedMappings} tone={dryRun.unresolvedMappings > 0 ? 'bad' : 'default'} />
              <Tile label={t('platform:migration.dryRun.fields.referenceMappingBlockers')} value={dryRun.referenceMappingBlockers} tone={dryRun.referenceMappingBlockers > 0 ? 'bad' : 'default'} />
              <Tile label={t('platform:migration.dryRun.fields.legalBlockers')} value={dryRun.legalBlockers} tone={dryRun.legalBlockers > 0 ? 'bad' : 'default'} />
            </div>
          </div>

          {/* Breakdowns */}
          <div className="grid md:grid-cols-2 gap-6">
            <BreakdownList
              title={t('platform:migration.dryRun.rowClassBreakdown')}
              entries={ROW_CLASS_ORDER.map((k) => [k, dryRun.rowClasses[k] ?? 0] as [string, number])}
              translateKeyPrefix="platform:migration.dryRun.rowClasses"
            />
            <BreakdownList
              title={t('platform:migration.dryRun.identityBreakdown')}
              entries={IDENTITY_ORDER.map((k) => [k, dryRun.identityClassifications[k] ?? 0] as [string, number])}
              translateKeyPrefix="platform:migration.dryRun.identityClasses"
            />
          </div>

          {/* Blockers / warnings */}
          {dryRun.blockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">{t('platform:migration.dryRun.blockers')}</p>
              <ul className="space-y-1.5">
                {dryRun.blockers.map((b, idx) => (
                  <li key={`${b.code}-${idx}`} className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/10 rounded-lg p-2.5">
                    <XCircle size={13} className="shrink-0 mt-0.5" />
                    <span><span className="font-mono font-semibold">{b.code}</span> — {b.message} ({t('platform:migration.dryRun.affectedRows', { n: b.affectedRows })})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dryRun.warnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-500 mb-2">{t('platform:migration.dryRun.warnings')}</p>
              <ul className="space-y-1.5">
                {dryRun.warnings.map((w, idx) => (
                  <li key={`${w.code}-${idx}`} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/10 rounded-lg p-2.5">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span><span className="font-mono font-semibold">{w.code}</span> — {w.message} ({t('platform:migration.dryRun.affectedRows', { n: w.affectedRows })})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Legal-policy exclusions: a DECIDED, non-blocking state — never
              styled or worded like a technical error (see dryRun.legalExclusions). */}
          {legalExclusions.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {t('platform:migration.dryRun.legalExclusions.title', { n: dryRun.legalBlockers })}
                </h3>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300 mb-2.5">
                {t('platform:migration.dryRun.legalExclusions.note')}
              </p>
              <ul className="space-y-1">
                {legalExclusions.map((b, idx) => (
                  <li key={`${b.fieldName ?? b.code}-${idx}`} className="text-xs text-amber-800 dark:text-amber-300 font-mono">
                    {b.fieldName ?? b.code}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Plan-limit panel */}
          <div className={`rounded-xl border p-4 ${dryRun.planLimit.allowed ? 'border-gray-100 dark:border-gray-800' : 'border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/10'}`}>
            <div className="flex items-center gap-2 mb-3">
              <Scale size={16} className={dryRun.planLimit.allowed ? 'text-primary-500' : 'text-red-600'} />
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('platform:migration.dryRun.planLimit.title')}</h3>
              {dryRun.planLimit.allowed ? (
                <span className="badge-green ml-auto">{t('platform:migration.dryRun.planLimit.allowed')}</span>
              ) : (
                <span className="badge-red ml-auto">{t('platform:migration.dryRun.planLimit.blocked')}</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <PlanRow label={t('platform:migration.dryRun.planLimit.sourceActive')} value={dryRun.planLimit.sourceActivePatientCount} />
              <PlanRow label={t('platform:migration.dryRun.planLimit.destinationCurrent')} value={dryRun.planLimit.destinationCurrentCount} />
              <PlanRow label={t('platform:migration.dryRun.planLimit.expectedResulting')} value={dryRun.planLimit.expectedResultingCount} />
              <PlanRow label={t('platform:migration.dryRun.planLimit.orgCap')} value={dryRun.planLimit.organizationPatientCap ?? t('platform:migration.dryRun.planLimit.none')} />
              <PlanRow label={t('platform:migration.dryRun.planLimit.clinicCap')} value={dryRun.planLimit.clinicPatientCap ?? t('platform:migration.dryRun.planLimit.none')} />
              <PlanRow
                label={t('platform:migration.dryRun.planLimit.effectiveCap')}
                value={`${dryRun.planLimit.effectiveCap ?? t('platform:migration.dryRun.planLimit.none')} (${t(`platform:migration.dryRun.planLimit.source.${dryRun.planLimit.effectiveCapSource}`)})`}
              />
            </div>
            {!dryRun.planLimit.allowed && (
              <p className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300 mt-3 bg-white dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
                <Lock size={13} className="shrink-0 mt-0.5" />
                {dryRun.planLimit.overrideMechanism}
              </p>
            )}
          </div>

          {/* Shared-phone impact panel */}
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <PhoneCall size={16} className="text-primary-500" />
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('platform:migration.dryRun.sharedPhone.title')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <PlanRow label={t('platform:migration.dryRun.sharedPhone.destinationBefore')} value={dryRun.sharedPhoneImpact.destinationSharedBefore} />
              <PlanRow label={t('platform:migration.dryRun.sharedPhone.destinationAfter')} value={dryRun.sharedPhoneImpact.destinationSharedAfter} />
              <PlanRow label={t('platform:migration.dryRun.sharedPhone.flippedToAmbiguous')} value={dryRun.sharedPhoneImpact.preExistingFlippedToAmbiguous} />
              <PlanRow label={t('platform:migration.dryRun.sharedPhone.sourceRowsSharing')} value={dryRun.sharedPhoneImpact.sourceRowsSharingPhone} />
            </div>
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1.5">
              <Users size={12} />
              {t('platform:migration.dryRun.sharedPhone.note')}
            </p>
          </div>

          {/* Executable status + continue */}
          <div className={`flex items-center gap-2 rounded-lg p-3 text-sm font-semibold ${dryRun.executable ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
            {dryRun.executable ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {dryRun.executable ? t('platform:migration.dryRun.executableYes') : t('platform:migration.dryRun.executableNo')}
          </div>

          {!dryRun.executable && (() => {
            const otherBlockerCount = dryRun.blockers.filter(
              (b) => b.code !== 'MAPPING_REQUIRED' && b.code !== 'REFERENCE_UNRESOLVED',
            ).length;
            const clauses: string[] = [];
            if (dryRun.unresolvedMappings > 0) {
              clauses.push(t('platform:migration.dryRun.notExecutable.mappingClause', { n: dryRun.unresolvedMappings }));
            }
            if (dryRun.referenceMappingBlockers > 0) {
              clauses.push(t('platform:migration.dryRun.notExecutable.referenceClause', { n: dryRun.referenceMappingBlockers }));
            }
            if (otherBlockerCount > 0) {
              clauses.push(t('platform:migration.dryRun.notExecutable.otherClause', { n: otherBlockerCount }));
            }
            if (clauses.length === 0 && dryRun.validRows === 0) {
              clauses.push(t('platform:migration.dryRun.notExecutable.noValidRowsClause'));
            }
            const sentence = clauses.length > 0
              ? t('platform:migration.dryRun.notExecutable.summary', {
                  detail: joinClauses(clauses, t('platform:migration.dryRun.notExecutable.and')),
                })
              : t('platform:migration.dryRun.notExecutable.generic');

            return (
              <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10 p-3.5 space-y-2.5">
                <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-start gap-2">
                  <XCircle size={16} className="shrink-0 mt-0.5" />
                  {sentence}
                </p>
                <div className="flex flex-wrap gap-2">
                  {dryRun.unresolvedMappings > 0 && (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => onBack(MIGRATION_STEPS.MAPPING)}
                    >
                      <ArrowLeft size={13} />
                      {t('platform:migration.dryRun.notExecutable.backToMapping')}
                    </button>
                  )}
                  {dryRun.referenceMappingBlockers > 0 && (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => onBack(MIGRATION_STEPS.REFERENCE)}
                    >
                      <ArrowLeft size={13} />
                      {t('platform:migration.dryRun.notExecutable.backToReference')}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={running} onClick={handleRunDryRun}>
              {running ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
              {t('platform:migration.dryRun.rerun')}
            </button>
            <button
              type="button"
              className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed disabled:hover:bg-primary-600"
              disabled={!dryRun.executable || advancing}
              aria-disabled={!dryRun.executable || advancing}
              onClick={handleContinue}
            >
              {advancing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {t('platform:migration.dryRun.continue')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const PlanRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-xs text-gray-400">{label}</p>
    <p className="font-semibold text-gray-900 dark:text-white">{value}</p>
  </div>
);

export default MigrationDryRunStep;
