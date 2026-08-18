import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, StopCircle, RotateCw, PlayCircle, Clock, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type { MigrationProgressDto, MigrationBatchStatus } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';
import { isRunInFlight, isTerminalRunStatus, statusBadgeClass } from '../../../pages/platformMigrationHelpers';

function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}s ${m}d ${s}sn`;
  if (m > 0) return `${m}d ${s}sn`;
  return `${s}sn`;
}

const BATCH_STATUS_CLASS: Record<MigrationBatchStatus, string> = {
  PENDING: 'badge-gray',
  RUNNING: 'badge-blue',
  SUCCEEDED: 'badge-green',
  FAILED: 'badge-red',
  CANCELLED: 'badge-gray',
  SKIPPED: 'badge-gray',
};

const MigrationProgressStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep }) => {
  const { t } = useTranslation(['platform']);
  const [progress, setProgress] = useState<MigrationProgressDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<'cancel' | 'retry' | 'resume' | null>(null);
  const [actionError, setActionError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(() => {
    return api.getProgress(run.id)
      .then((p) => {
        setProgress(p);
        return p;
      });
  }, [api, run.id]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      fetchOnce()
        .then((p) => {
          if (!isRunInFlight(p.status)) {
            stopPolling();
            api.getRun(run.id).then((detail) => onRunUpdated(detail.run)).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 2000);
  }, [fetchOnce, stopPolling, api, run.id, onRunUpdated]);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchOnce()
      .then((p) => { if (isRunInFlight(p.status)) startPolling(); })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.progress.errors.loadFailed'))))
      .finally(() => setLoading(false));
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    setActionBusy('cancel');
    setActionError('');
    try {
      const updated = await api.cancel(run.id);
      onRunUpdated(updated);
      await fetchOnce();
    } catch (err) {
      setActionError(getErrorMessage(err, t('platform:migration.progress.errors.cancelFailed')));
    } finally {
      setActionBusy(null);
    }
  };

  const handleRetryFailed = async () => {
    setActionBusy('retry');
    setActionError('');
    try {
      const res = await api.retryFailed(run.id);
      onRunUpdated(res.run);
      await fetchOnce();
      if (isRunInFlight(res.run.status)) startPolling();
    } catch (err) {
      setActionError(getErrorMessage(err, t('platform:migration.progress.errors.retryFailed')));
    } finally {
      setActionBusy(null);
    }
  };

  const handleResume = async () => {
    setActionBusy('resume');
    setActionError('');
    try {
      const updated = await api.resume(run.id);
      onRunUpdated(updated);
      await fetchOnce();
      if (isRunInFlight(updated.status)) startPolling();
    } catch (err) {
      setActionError(getErrorMessage(err, t('platform:migration.progress.errors.resumeFailed')));
    } finally {
      setActionBusy(null);
    }
  };

  const handleViewResults = async () => {
    try {
      const detail = await api.getRun(run.id);
      onRunUpdated(detail.run);
    } catch {
      // fall through — nextStep is still safe to visit even if this refresh fails
    }
    onNext(nextStep);
  };

  if (loading) {
    return (
      <div className="card p-6 max-w-3xl flex items-center justify-center h-40">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    );
  }

  if (error || !progress) {
    return (
      <div className="card p-6 max-w-3xl">
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error || t('platform:migration.progress.errors.loadFailed')}</span>
        </div>
      </div>
    );
  }

  const totalRows = progress.totalSourceRows ?? run.totalSourceRows ?? 0;
  const pct = totalRows > 0 ? Math.min(100, Math.round((progress.processedRows / totalRows) * 100)) : 0;
  const inFlight = isRunInFlight(progress.status);
  const terminal = isTerminalRunStatus(progress.status);
  const canCancel = inFlight;
  const canRetry = progress.status === 'PARTIAL_FAILURE';
  const canResume = progress.status === 'PARTIAL_FAILURE';

  return (
    <div className="card p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('platform:migration.progress.title')}</h2>
        <span className={statusBadgeClass(progress.status)}>{t(`platform:migration.statuses.${progress.status}`)}</span>
      </div>

      {/* Overall bar */}
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{t('platform:migration.progress.processedOf', { processed: progress.processedRows, total: totalRows })}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-4">
        <div className={`h-full transition-all ${terminal && progress.status !== 'COMPLETED' ? 'bg-red-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        <MiniStat label={t('platform:migration.progress.batch')} value={`${progress.currentBatch}/${progress.totalBatches}`} icon={<Loader2 size={13} className={inFlight ? 'animate-spin' : ''} />} />
        <MiniStat label={t('platform:migration.progress.created')} value={progress.createdRows} />
        <MiniStat label={t('platform:migration.progress.matched')} value={progress.matchedRows} />
        <MiniStat label={t('platform:migration.progress.failed')} value={progress.failedRows} danger={progress.failedRows > 0} />
        <MiniStat label={t('platform:migration.progress.skipped')} value={progress.skippedRows} />
        <MiniStat label={t('platform:migration.progress.warnings')} value={progress.warningRows} />
        <MiniStat label={t('platform:migration.progress.blocked')} value={progress.blockedRows} danger={progress.blockedRows > 0} />
        <MiniStat label={t('platform:migration.progress.elapsed')} value={formatElapsed(progress.elapsedMs)} icon={<Clock size={12} />} />
      </div>

      {progress.lastErrorMessage && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 mb-4 text-sm">
          <AlertCircle size={16} />
          <span><span className="font-mono text-xs font-semibold">{progress.lastErrorCode}</span> — {progress.lastErrorMessage}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 mb-4 text-sm">
          <AlertCircle size={16} />
          {actionError}
        </div>
      )}

      {/* Batch table */}
      {progress.batches.length > 0 && (
        <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg mb-5">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">{t('platform:migration.progress.columns.batch')}</th>
                <th className="px-3 py-2 text-left">{t('platform:migration.progress.columns.status')}</th>
                <th className="px-3 py-2 text-right">{t('platform:migration.progress.columns.rows')}</th>
                <th className="px-3 py-2 text-right">{t('platform:migration.progress.columns.retries')}</th>
                <th className="px-3 py-2 text-left">{t('platform:migration.progress.columns.error')}</th>
              </tr>
            </thead>
            <tbody>
              {progress.batches.map((b) => (
                <tr key={b.batchNumber} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="px-3 py-2 text-xs font-mono">#{b.batchNumber} <span className="text-gray-400">({b.rowStart}–{b.rowEnd})</span></td>
                  <td className="px-3 py-2"><span className={BATCH_STATUS_CLASS[b.status]}>{t(`platform:migration.batchStatuses.${b.status}`)}</span></td>
                  <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{b.processedRows}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{b.retryCount}</td>
                  <td className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    {b.errorCode ? <span className="font-mono">{b.errorCode}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-danger" disabled={!canCancel || actionBusy !== null} onClick={handleCancel}>
          {actionBusy === 'cancel' ? <Loader2 size={15} className="animate-spin" /> : <StopCircle size={15} />}
          {t('platform:migration.progress.cancel')}
        </button>
        <button type="button" className="btn-secondary" disabled={!canRetry || actionBusy !== null} onClick={handleRetryFailed}>
          {actionBusy === 'retry' ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
          {t('platform:migration.progress.retryFailed')}
        </button>
        <button type="button" className="btn-secondary" disabled={!canResume || actionBusy !== null} onClick={handleResume}>
          {actionBusy === 'resume' ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
          {t('platform:migration.progress.resume')}
        </button>
        {terminal && (
          <button type="button" className="btn-primary ml-auto" onClick={handleViewResults}>
            {progress.status === 'COMPLETED' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {t('platform:migration.progress.viewResults')}
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: React.ReactNode; danger?: boolean; icon?: React.ReactNode }> = ({ label, value, danger, icon }) => (
  <div className={`rounded-lg border p-2.5 ${danger ? 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/10' : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40'}`}>
    <p className={`text-base font-bold flex items-center gap-1.5 ${danger ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white'}`}>
      {icon}
      {value}
    </p>
    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
  </div>
);

export default MigrationProgressStep;
