import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MIGRATION_STEPS, type MigrationStepNumber } from '../../../pages/platformMigrationHelpers';

const STEP_ORDER: MigrationStepNumber[] = [
  MIGRATION_STEPS.TARGET,
  MIGRATION_STEPS.UPLOAD,
  MIGRATION_STEPS.ANALYZE,
  MIGRATION_STEPS.MAPPING,
  MIGRATION_STEPS.REFERENCE,
  MIGRATION_STEPS.DRY_RUN,
  MIGRATION_STEPS.CONFIRM,
  MIGRATION_STEPS.PROGRESS,
  MIGRATION_STEPS.RESULTS,
];

const STEP_LABEL_KEYS: Record<MigrationStepNumber, string> = {
  [MIGRATION_STEPS.TARGET]: 'platform:migration.steps.target',
  [MIGRATION_STEPS.UPLOAD]: 'platform:migration.steps.upload',
  [MIGRATION_STEPS.ANALYZE]: 'platform:migration.steps.analyze',
  [MIGRATION_STEPS.MAPPING]: 'platform:migration.steps.mapping',
  [MIGRATION_STEPS.REFERENCE]: 'platform:migration.steps.reference',
  [MIGRATION_STEPS.DRY_RUN]: 'platform:migration.steps.dryRun',
  [MIGRATION_STEPS.CONFIRM]: 'platform:migration.steps.confirm',
  [MIGRATION_STEPS.PROGRESS]: 'platform:migration.steps.progress',
  [MIGRATION_STEPS.RESULTS]: 'platform:migration.steps.results',
};

interface Props {
  currentStep: MigrationStepNumber;
  /** Highest step the operator has actually reached — lets them click back, never forward. */
  maxReachedStep: MigrationStepNumber;
  onStepClick?: (step: MigrationStepNumber) => void;
}

const MigrationStepper: React.FC<Props> = ({ currentStep, maxReachedStep, onStepClick }) => {
  const { t } = useTranslation(['platform']);

  return (
    <nav aria-label={t('platform:migration.stepperLabel')} className="w-full overflow-x-auto pb-1">
      <ol className="flex items-center min-w-max">
        {STEP_ORDER.map((step, idx) => {
          const isDone = step < currentStep;
          const isCurrent = step === currentStep;
          const isClickable = !!onStepClick && step <= maxReachedStep && step !== currentStep;
          return (
            <li key={step} className="flex items-center">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(step)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isCurrent
                    ? 'bg-primary-600 text-white'
                    : isDone
                      ? 'text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                      : 'text-gray-400 dark:text-gray-500'
                } ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0 ${
                    isCurrent
                      ? 'bg-white text-primary-700'
                      : isDone
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {isDone ? <Check size={12} /> : step}
                </span>
                {t(STEP_LABEL_KEYS[step])}
              </button>
              {idx < STEP_ORDER.length - 1 && (
                <span className={`w-4 h-px mx-1 shrink-0 ${step < currentStep ? 'bg-primary-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default MigrationStepper;
