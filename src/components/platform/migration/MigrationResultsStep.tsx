import React, { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, Download, Scale, ShieldCheck, Building2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type { ReconciliationDto } from '../../../services/platformMigrationApi';
import { getApiErrorMessage, getErrorMessage } from '../../../utils/errors';
import { isReconciliationBalanced, statusBadgeClass } from '../../../pages/platformMigrationHelpers';
import MigrationRejectedDownload from './MigrationRejectedDownload';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const MigrationResultsStep: React.FC<Pick<MigrationStepProps, 'run' | 'api' | 'onRunUpdated'>> = ({ run, api, onRunUpdated }) => {
  const { t } = useTranslation(['platform']);
  const [reconciliation, setReconciliation] = useState<ReconciliationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<'success' | 'failure' | null>(null);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getRun(run.id)
      .then((detail) => {
        onRunUpdated(detail.run);
        setReconciliation(detail.reconciliation);
      })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.results.errors.loadFailed'))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownload = async (kind: 'success' | 'failure') => {
    setDownloading(kind);
    setDownloadError('');
    try {
      const blob = await api.downloadReport(run.id, kind);
      triggerBlobDownload(blob, `migration-${run.id}-${kind}.xlsx`);
    } catch (err) {
      setDownloadError(await getApiErrorMessage(err, t('platform:migration.results.errors.downloadFailed')));
    } finally {
      setDownloading(null);
    }
  };

  const balanced = reconciliation ? isReconciliationBalanced(reconciliation) : false;

  return (
    <div className="card p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('platform:migration.results.title')}</h2>
        <span className={statusBadgeClass(run.status)}>{t(`platform:migration.statuses.${run.status}`)}</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('platform:migration.results.subtitle')}</p>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      ) : !reconciliation ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
            <AlertCircle size={16} />
            <span className="text-sm">{t('platform:migration.results.noReconciliation')}</span>
          </div>
          {run.lastErrorMessage && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              <XCircle size={16} />
              <span className="text-sm"><span className="font-mono text-xs font-semibold">{run.lastErrorCode}</span> — {run.lastErrorMessage}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Impact tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
            <ResultTile label={t('platform:migration.results.created')} value={reconciliation.created} tone="good" />
            <ResultTile label={t('platform:migration.results.reused')} value={reconciliation.reused} />
            <ResultTile label={t('platform:migration.results.skipped')} value={reconciliation.skipped} />
            <ResultTile label={t('platform:migration.results.failed')} value={reconciliation.failed} tone={reconciliation.failed > 0 ? 'bad' : 'default'} />
            <ResultTile label={t('platform:migration.results.manualReview')} value={reconciliation.manualReview} />
            <ResultTile label={t('platform:migration.results.blocked')} value={reconciliation.blocked} tone={reconciliation.blocked > 0 ? 'bad' : 'default'} />
          </div>

          {/* Arithmetic */}
          <div className={`rounded-xl border p-4 ${balanced ? 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10' : 'border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/10'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Scale size={16} className={balanced ? 'text-green-600' : 'text-red-600'} />
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('platform:migration.results.arithmetic.title')}</h3>
              {balanced ? (
                <span className="badge-green ml-auto inline-flex items-center gap-1"><CheckCircle2 size={12} />{t('platform:migration.results.arithmetic.balanced')}</span>
              ) : (
                <span className="badge-red ml-auto inline-flex items-center gap-1"><XCircle size={12} />{t('platform:migration.results.arithmetic.imbalanced')}</span>
              )}
            </div>
            <p className="font-mono text-xs text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-800 overflow-x-auto">
              {reconciliation.eligibleTotal} ({t('platform:migration.results.arithmetic.eligible')}) {balanced ? '=' : '≠'}{' '}
              {reconciliation.created} + {reconciliation.reused} + {reconciliation.skipped} + {reconciliation.failed} + {reconciliation.manualReview} + {reconciliation.blocked}
              {' = '}
              {reconciliation.created + reconciliation.reused + reconciliation.skipped + reconciliation.failed + reconciliation.manualReview + reconciliation.blocked}
            </p>
            {!balanced && reconciliation.imbalanceDetail && (
              <p className="text-xs text-red-700 dark:text-red-300 mt-2 font-mono">{reconciliation.imbalanceDetail}</p>
            )}
          </div>

          {/* Integrity indicators */}
          <div className="grid sm:grid-cols-2 gap-3">
            <IntegrityCard
              icon={<Building2 size={15} />}
              title={t('platform:migration.results.tenantScopeClean')}
              ok={reconciliation.tenantScopeClean}
            />
            <IntegrityCard
              icon={<ShieldCheck size={15} />}
              title={t('platform:migration.results.provenanceResolves')}
              ok={reconciliation.provenanceResolves}
            />
          </div>

          {/* Destination delta */}
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <PlainStat label={t('platform:migration.results.destinationBefore')} value={reconciliation.destinationCountBefore} />
            <PlainStat label={t('platform:migration.results.destinationAfter')} value={reconciliation.destinationCountAfter} />
            <PlainStat label={t('platform:migration.results.destinationDelta')} value={`+${reconciliation.destinationCountDelta}`} />
          </div>

          {/* Batch totals */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
            <PlainStat label={t('platform:migration.results.batchTotal')} value={reconciliation.batchTotals.total} />
            <PlainStat label={t('platform:migration.results.batchSucceeded')} value={reconciliation.batchTotals.succeeded} />
            <PlainStat label={t('platform:migration.results.batchFailed')} value={reconciliation.batchTotals.failed} />
            <PlainStat label={t('platform:migration.results.batchPending')} value={reconciliation.batchTotals.pending} />
            <PlainStat label={t('platform:migration.results.batchCancelled')} value={reconciliation.batchTotals.cancelled} />
          </div>

          {downloadError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              <AlertCircle size={16} />
              <span className="text-sm">{downloadError}</span>
            </div>
          )}

          {/*
            * THE CORRECTION LOOP, AT THE END OF THE RUN TOO
            * (F3-DATA-MIG-TODAY-001-R12).
            *
            * The two reports below are RECONCILIATION artifacts and carry no
            * source values by design (migrationReports.ts). They answer "what
            * happened"; they cannot answer "what do I fix". This third download
            * is the one an operator acts on: the rows that did not arrive, with
            * their values, ready to correct and re-upload. Offered
            * unconditionally here — after an execution the operator may want it
            * even when the run reported no failures, to confirm that for
            * themselves.
            */}
          <MigrationRejectedDownload runId={run.id} api={api} />

          {/* Downloads */}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={downloading !== null} onClick={() => handleDownload('success')}>
              {downloading === 'success' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {t('platform:migration.results.downloadSuccess')}
            </button>
            <button type="button" className="btn-secondary" disabled={downloading !== null} onClick={() => handleDownload('failure')}>
              {downloading === 'failure' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {t('platform:migration.results.downloadFailure')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const ResultTile: React.FC<{ label: string; value: number; tone?: 'default' | 'good' | 'bad' }> = ({ label, value, tone = 'default' }) => (
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

const PlainStat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="font-semibold text-gray-900 dark:text-white">{value}</p>
    <p className="text-gray-400">{label}</p>
  </div>
);

const IntegrityCard: React.FC<{ icon: React.ReactNode; title: string; ok: boolean }> = ({ icon, title, ok }) => (
  <div className={`flex items-center gap-2.5 rounded-lg border p-3 ${ok ? 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10' : 'border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/10'}`}>
    <span className={ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{icon}</span>
    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 flex-1">{title}</span>
    {ok ? <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" /> : <XCircle size={16} className="text-red-600 dark:text-red-400" />}
  </div>
);

export default MigrationResultsStep;
