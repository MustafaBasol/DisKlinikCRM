/**
 * PlatformMigration.resume.vitest.test.tsx — F3-DATA-MIG-TODAY-001-UI-002-R3
 *
 * C. RESUME FLOW: resuming a pre-existing run (arriving via
 * `location.state.runId`, the same path the migration history table uses)
 * whose persisted DryRunSummary predates PR #454 (no `legalExclusions` key)
 * must reach the dry-run screen — not a white screen. This exercises the
 * real init effect, the real stepForStatus routing, and the real
 * MigrationDryRunStep render, with only the API transport and i18n mocked.
 *
 * Mocking pattern follows src/pages/PatientDetail.vitest.test.tsx.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import PlatformMigration from '../PlatformMigration';
import type { DryRunSummaryDto, MigrationRunDto } from '../../../services/platformMigrationApi';

const mockT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && 'id' in opts) return `${key}:${opts.id}`;
  return key;
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: { runId: 'run-legacy-1' } }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../context/PlatformAuthContext', () => ({
  usePlatformApi: () => ({}),
}));

const LEGACY_RUN: MigrationRunDto = {
  id: 'run-legacy-1',
  status: 'DRY_RUN_COMPLETE',
  organizationId: 'org-1',
  clinicId: 'clinic-1',
};

/** Pre-#454 persisted DryRunSummary: no `legalExclusions` key at all. */
const LEGACY_DRY_RUN_SUMMARY = {
  generatedAt: new Date(0).toISOString(),
  totalSourceRows: 100,
  parsedRows: 100,
  validRows: 90,
  warningRows: 0,
  blockedRows: 0,
  invalidRows: 0,
  duplicateSourceRows: 0,
  ambiguousRows: 0,
  manualReviewRows: 0,
  unresolvedMappings: 0,
  referenceMappingBlockers: 0,
  legalBlockers: 0,
  expectedCreateCount: 90,
  expectedReuseCount: 0,
  expectedSkippedCount: 10,
  identityClassifications: { VALID: 90, INVALID_LEGACY: 0, AMBIGUOUS: 0, DUPLICATE_SOURCE: 0, MANUAL_REVIEW: 0, ABSENT: 10 },
  rowClasses: {
    VALID_NEW: 90, VALID_MATCHED: 0, NORMALIZED: 0, AMBIGUOUS: 0, MAPPING_REQUIRED: 0,
    INVALID: 0, DUPLICATE_SOURCE: 0, DUPLICATE_DESTINATION: 0, SKIPPED_BY_POLICY: 0, BLOCKED: 0,
  },
  blockers: [],
  // legalExclusions intentionally absent — this is the pre-#454 shape.
  warnings: [],
  planLimit: {
    sourceActivePatientCount: 90,
    destinationCurrentCount: 0,
    expectedResultingCount: 90,
    organizationPatientCap: null,
    clinicPatientCap: null,
    effectiveCap: null,
    effectiveCapSource: 'none',
    allowed: true,
    overrideMechanism: 'Contact billing.',
  },
  sharedPhoneImpact: {
    destinationSharedBefore: 0,
    destinationSharedAfter: 0,
    preExistingFlippedToAmbiguous: 0,
    sourceRowsSharingPhone: 0,
  },
  executable: true,
  durationMs: 10,
} as unknown as DryRunSummaryDto;

const getRun = vi.fn().mockResolvedValue({
  run: LEGACY_RUN,
  reconciliation: null,
  dryRun: LEGACY_DRY_RUN_SUMMARY,
});

vi.mock('../../../services/platformMigrationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/platformMigrationApi')>();
  return {
    ...actual,
    // Only `getRun` is exercised by this resume path (status DRY_RUN_COMPLETE
    // never polls progress); every other method is intentionally absent so an
    // unexpected call fails loudly instead of silently no-op'ing.
    createMigrationApi: () => ({ getRun }),
  };
});

describe('PlatformMigration — resuming a pre-#454 run', () => {
  it('reaches the dry-run screen without throwing when the persisted summary has no legalExclusions', async () => {
    render(<PlatformMigration />);

    await waitFor(() => expect(getRun).toHaveBeenCalledWith('run-legacy-1'));

    // The dry-run screen rendered — not a white screen, not the init spinner.
    expect(await screen.findByText('platform:migration.dryRun.title')).toBeInTheDocument();
    expect(screen.getByText('platform:migration.resumedNotice:run-lega')).toBeInTheDocument();

    // Legacy stored data renders verbatim; executable is followed, not reinterpreted.
    await screen.findAllByText('90');
    expect(screen.getByText('platform:migration.dryRun.executableYes')).toBeInTheDocument();
    expect(screen.queryByText('platform:migration.dryRun.legalExclusions.title')).not.toBeInTheDocument();
  });
});
