import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseZap, Loader2, AlertCircle, History, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';
import { createMigrationApi, type MigrationRunDto } from '../../services/platformMigrationApi';
import { getErrorMessage } from '../../utils/errors';
import { MIGRATION_STEPS, stepForStatus, isTerminalRunStatus, type MigrationStepNumber } from '../platformMigrationHelpers';
import MigrationStepper from '../../components/platform/migration/MigrationStepper';
import MigrationTargetStep from '../../components/platform/migration/MigrationTargetStep';
import MigrationUploadStep from '../../components/platform/migration/MigrationUploadStep';
import MigrationAnalyzeStep from '../../components/platform/migration/MigrationAnalyzeStep';
import MigrationMappingStep from '../../components/platform/migration/MigrationMappingStep';
import MigrationReferenceStep from '../../components/platform/migration/MigrationReferenceStep';
import MigrationDryRunStep from '../../components/platform/migration/MigrationDryRunStep';
import MigrationConfirmStep from '../../components/platform/migration/MigrationConfirmStep';
import MigrationProgressStep from '../../components/platform/migration/MigrationProgressStep';
import MigrationResultsStep from '../../components/platform/migration/MigrationResultsStep';

const PlatformMigration: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const rawApi = usePlatformApi();
  const api = useMemo(() => createMigrationApi(rawApi), [rawApi]);
  const location = useLocation();
  const navigate = useNavigate();

  const [run, setRun] = useState<MigrationRunDto | null>(null);
  const [step, setStep] = useState<MigrationStepNumber>(MIGRATION_STEPS.TARGET);
  const [maxReachedStep, setMaxReachedStep] = useState<MigrationStepNumber>(MIGRATION_STEPS.TARGET);
  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState('');
  const [resumedNotice, setResumedNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setInitLoading(true);
      setInitError('');
      try {
        const stateRunId = (location.state as { runId?: string } | null)?.runId;
        if (stateRunId) {
          const detail = await api.getRun(stateRunId);
          if (cancelled) return;
          const target = stepForStatus(detail.run.status);
          setRun(detail.run);
          setStep(target);
          setMaxReachedStep(target);
          setResumedNotice(true);
          return;
        }

        const list = await api.listRuns({ page: 1, limit: 5 });
        if (cancelled) return;
        const active = list.data.find((r) => !isTerminalRunStatus(r.status));
        if (active) {
          const target = stepForStatus(active.status);
          setRun(active);
          setStep(target);
          setMaxReachedStep(target);
          setResumedNotice(true);
        }
      } catch (err) {
        if (!cancelled) setInitError(getErrorMessage(err, t('platform:migration.errors.loadRunFailed')));
      } finally {
        if (!cancelled) setInitLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunCreated = useCallback((newRun: MigrationRunDto) => {
    setRun(newRun);
    setResumedNotice(false);
    setStep(MIGRATION_STEPS.UPLOAD);
    setMaxReachedStep(MIGRATION_STEPS.UPLOAD);
  }, []);

  const handleRunUpdated = useCallback((updated: MigrationRunDto) => {
    setRun(updated);
  }, []);

  const handleNext = useCallback((nextStep: MigrationStepNumber) => {
    setStep(nextStep);
    setMaxReachedStep((prev) => (nextStep > prev ? nextStep : prev));
  }, []);

  const handleBack = useCallback((targetStep: MigrationStepNumber) => {
    setStep(targetStep);
  }, []);

  const handleStartNew = () => {
    setRun(null);
    setResumedNotice(false);
    setStep(MIGRATION_STEPS.TARGET);
    setMaxReachedStep(MIGRATION_STEPS.TARGET);
  };

  const renderStep = () => {
    if (!run || step === MIGRATION_STEPS.TARGET) {
      return <MigrationTargetStep api={api} onRunCreated={handleRunCreated} />;
    }

    const common = { run, api, onRunUpdated: handleRunUpdated, onNext: handleNext, onBack: handleBack };

    switch (step) {
      case MIGRATION_STEPS.UPLOAD:
        return <MigrationUploadStep {...common} nextStep={MIGRATION_STEPS.ANALYZE} />;
      case MIGRATION_STEPS.ANALYZE:
        return <MigrationAnalyzeStep {...common} nextStep={MIGRATION_STEPS.MAPPING} />;
      case MIGRATION_STEPS.MAPPING:
        return <MigrationMappingStep {...common} nextStep={MIGRATION_STEPS.REFERENCE} />;
      case MIGRATION_STEPS.REFERENCE:
        return <MigrationReferenceStep {...common} nextStep={MIGRATION_STEPS.DRY_RUN} />;
      case MIGRATION_STEPS.DRY_RUN:
        return <MigrationDryRunStep {...common} nextStep={MIGRATION_STEPS.CONFIRM} />;
      case MIGRATION_STEPS.CONFIRM:
        return <MigrationConfirmStep {...common} nextStep={MIGRATION_STEPS.PROGRESS} />;
      case MIGRATION_STEPS.PROGRESS:
        return <MigrationProgressStep {...common} nextStep={MIGRATION_STEPS.RESULTS} />;
      case MIGRATION_STEPS.RESULTS:
        return <MigrationResultsStep run={run} api={api} onRunUpdated={handleRunUpdated} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <DatabaseZap size={24} className="text-primary-500" />
          {t('platform:migration.title')}
        </h1>
        <div className="flex items-center gap-2">
          {run && (
            <button
              type="button"
              onClick={handleStartNew}
              className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Plus size={14} />
              {t('platform:migration.newRun')}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/platform/migration/history')}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            <History size={14} />
            {t('platform:migration.viewHistory')}
          </button>
        </div>
      </div>

      {initLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={28} className="animate-spin text-primary-500" />
        </div>
      ) : initError ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
          <AlertCircle size={18} />
          <span>{initError}</span>
        </div>
      ) : (
        <>
          {resumedNotice && run && (
            <div className="flex items-center gap-2 text-sm text-primary-800 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 rounded-lg px-4 py-2.5">
              <AlertCircle size={15} className="shrink-0" />
              {t('platform:migration.resumedNotice', { id: run.id.slice(0, 8) })}
            </div>
          )}

          {run && (
            <MigrationStepper currentStep={step} maxReachedStep={maxReachedStep} onStepClick={handleBack} />
          )}

          <div>{renderStep()}</div>
        </>
      )}
    </div>
  );
};

export default PlatformMigration;
