import type { MigrationApiClient, MigrationRunDto } from '../../../services/platformMigrationApi';
import type { MigrationStepNumber } from '../../../pages/platformMigrationHelpers';

/**
 * Shared prop contract every wizard step (after Target) implements. Each step
 * owns its own data-fetch (mappings, analysis, dry-run, progress, ...) the
 * same way PlatformUsers/PlatformBackups own theirs — the wizard shell only
 * tracks which run and which step is active.
 */
export interface MigrationStepProps {
  run: MigrationRunDto;
  api: MigrationApiClient;
  /** Merge server-returned run fields (status, counts, timestamps, ...) into shell state. */
  onRunUpdated: (run: MigrationRunDto) => void;
  /** Advance to a later step, e.g. after a mutating call moves the run's status forward. */
  onNext: (step: MigrationStepNumber) => void;
  /** Step the "Continue" action of this screen leads to when it succeeds. */
  nextStep: MigrationStepNumber;
  /** Navigate back to an earlier, already-reached step. */
  onBack: (step: MigrationStepNumber) => void;
}
