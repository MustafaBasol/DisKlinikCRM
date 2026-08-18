import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, AlertTriangle, Building2, Stethoscope, PlayCircle, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type { DryRunSummaryDto } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';

const MigrationConfirmStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep }) => {
  const { t } = useTranslation(['platform']);
  const [dryRun, setDryRun] = useState<DryRunSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getRun(run.id)
      .then((detail) => {
        onRunUpdated(detail.run);
        setDryRun(detail.dryRun);
      })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.confirm.errors.loadFailed'))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executable = dryRun?.executable === true;

  const handleExecute = async () => {
    if (!executable || !acknowledged) return;
    setExecuting(true);
    setExecuteError('');
    try {
      const updated = await api.execute(run.id);
      onRunUpdated(updated);
      onNext(nextStep);
    } catch (err) {
      setExecuteError(getErrorMessage(err, t('platform:migration.confirm.errors.executeFailed')));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="card p-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('platform:migration.confirm.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('platform:migration.confirm.subtitle')}</p>

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
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
          <AlertTriangle size={16} />
          <span className="text-sm">{t('platform:migration.confirm.noDryRun')}</span>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Target */}
          <div className="flex flex-wrap gap-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
              <Building2 size={14} className="text-primary-500" />
              <strong>{run.organizationName ?? run.organizationId}</strong>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
              <Stethoscope size={14} className="text-primary-500" />
              <strong>{run.clinicName ?? run.clinicId}</strong>
            </div>
          </div>

          {/* Impact summary */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-green-700 dark:text-green-300">{dryRun.expectedCreateCount}</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">{t('platform:migration.confirm.willBeCreated')}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{dryRun.expectedReuseCount}</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">{t('platform:migration.confirm.willBeReused')}</p>
            </div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-2xl font-bold text-gray-700 dark:text-gray-200">{dryRun.expectedSkippedCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('platform:migration.confirm.willBeSkipped')}</p>
            </div>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t('platform:migration.confirm.impactSentence', {
              created: dryRun.expectedCreateCount,
              reused: dryRun.expectedReuseCount,
              org: run.organizationName ?? run.organizationId,
              clinic: run.clinicName ?? run.clinicId,
            })}
          </p>

          {!executable && (
            <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              {t('platform:migration.confirm.notExecutable')}
            </div>
          )}

          <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            {t('platform:migration.confirm.irreversibleNote')}
          </div>

          <label className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!executable}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            {t('platform:migration.confirm.acknowledgeCheckbox')}
          </label>

          {executeError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              <AlertCircle size={16} />
              <span className="text-sm">{executeError}</span>
            </div>
          )}

          <button
            type="button"
            className="btn-danger w-full justify-center"
            disabled={!executable || !acknowledged || executing}
            onClick={handleExecute}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            {t('platform:migration.confirm.execute')}
          </button>
        </div>
      )}
    </div>
  );
};

export default MigrationConfirmStep;
