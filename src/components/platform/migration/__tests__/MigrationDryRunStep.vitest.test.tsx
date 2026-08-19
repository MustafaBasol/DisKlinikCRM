/**
 * MigrationDryRunStep.vitest.test.tsx — F3-DATA-MIG-TODAY-001-UI-002-R3
 *
 * PR #454 added `DryRunSummary.legalExclusions` and MigrationDryRunStep.tsx
 * dereferenced it directly (`dryRun.legalExclusions.length`, `.map(...)`).
 * A DryRunSummary persisted before #454 has no `legalExclusions` key at all
 * (not `[]` — `undefined`), so resuming a pre-existing run white-screened
 * with "Cannot read properties of undefined (reading 'length')" before the
 * operator could rerun the dry run or navigate away.
 *
 * These tests pin: a legacy summary renders without throwing, its stored
 * `executable`/counters/blockers are shown verbatim (never reinterpreted),
 * and the legal-exclusion panel is simply absent rather than crashing or
 * fabricating an empty-but-present panel. Current summaries (empty and
 * populated `legalExclusions`) are pinned separately so the new panel keeps
 * working and never leaks a raw source value.
 *
 * i18n is mocked to echo keys — same pattern as
 * src/pages/platform/__tests__/PlatformBackups.recovery.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import MigrationDryRunStep from '../MigrationDryRunStep';
import type { DryRunSummaryDto, MigrationRunDto } from '../../../../services/platformMigrationApi';

const mockT = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: 'en' } }),
}));

const RUN: MigrationRunDto = {
  id: 'run-legacy-1',
  status: 'DRY_RUN_COMPLETE',
  organizationId: 'org-1',
  clinicId: 'clinic-1',
};

const CURRENT_SUMMARY: DryRunSummaryDto = {
  generatedAt: new Date(0).toISOString(),
  totalSourceRows: 100,
  parsedRows: 100,
  validRows: 90,
  warningRows: 3,
  blockedRows: 0,
  invalidRows: 2,
  duplicateSourceRows: 1,
  ambiguousRows: 0,
  manualReviewRows: 0,
  unresolvedMappings: 0,
  referenceMappingBlockers: 0,
  legalBlockers: 0,
  expectedCreateCount: 88,
  expectedReuseCount: 2,
  expectedSkippedCount: 10,
  identityClassifications: { VALID: 90, INVALID_LEGACY: 0, AMBIGUOUS: 0, DUPLICATE_SOURCE: 0, MANUAL_REVIEW: 0, ABSENT: 10 },
  rowClasses: {
    VALID_NEW: 88, VALID_MATCHED: 2, NORMALIZED: 0, AMBIGUOUS: 0, MAPPING_REQUIRED: 0,
    INVALID: 2, DUPLICATE_SOURCE: 1, DUPLICATE_DESTINATION: 0, SKIPPED_BY_POLICY: 0, BLOCKED: 0,
  },
  blockers: [],
  legalExclusions: [],
  warnings: [{ code: 'ROW_VALUE_INVALID', message: 'Some rows have odd values.', affectedRows: 3 }],
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
  durationMs: 42,
};

/** A pre-#454 persisted summary: no `legalExclusions` key at all. */
function legacySummary(): DryRunSummaryDto {
  const { legalExclusions, ...rest } = CURRENT_SUMMARY;
  void legalExclusions;
  return rest as DryRunSummaryDto;
}

function makeApi(dryRun: DryRunSummaryDto | null) {
  return {
    getRun: vi.fn().mockResolvedValue({ run: RUN, reconciliation: null, dryRun }),
    getProgress: vi.fn(),
    dryRun: vi.fn(),
  } as unknown as import('../../../../services/platformMigrationApi').MigrationApiClient;
}

const noop = () => undefined;

describe('MigrationDryRunStep — legacy DryRunSummary backward compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A. renders a legacy summary (no legalExclusions key) without throwing, honours stored executable, and omits the legal-exclusion panel', async () => {
    const api = makeApi(legacySummary());

    render(
      <MigrationDryRunStep
        run={RUN}
        api={api}
        onRunUpdated={noop}
        onNext={noop}
        nextStep={7}
        onBack={noop}
      />,
    );

    await waitFor(() => expect(api.getRun).toHaveBeenCalledWith('run-legacy-1'));

    // Stored counters/status render verbatim.
    await screen.findAllByText('90'); // validRows
    expect(screen.getByText('platform:migration.dryRun.executableYes')).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: /platform:migration.dryRun.continue/ });
    expect(continueBtn).not.toBeDisabled();

    // Other blocker/warning panels still render.
    expect(screen.getByText('platform:migration.dryRun.warnings')).toBeInTheDocument();
    expect(screen.getByText('Some rows have odd values.', { exact: false })).toBeInTheDocument();

    // The legal-exclusion panel must be absent, not crashed-into-existence.
    expect(screen.queryByText('platform:migration.dryRun.legalExclusions.title')).not.toBeInTheDocument();
  });

  it('A2. a legacy summary with executable=false still gates Continue and shows blockers, unreinterpreted', async () => {
    const legacyBlocked: DryRunSummaryDto = {
      ...legacySummary(),
      executable: false,
      blockers: [{ code: 'MAPPING_REQUIRED', message: '2 source column(s) still need a mapping decision.', affectedRows: 2 }],
    };
    const api = makeApi(legacyBlocked);

    render(<MigrationDryRunStep run={RUN} api={api} onRunUpdated={noop} onNext={noop} nextStep={7} onBack={noop} />);

    await waitFor(() => expect(api.getRun).toHaveBeenCalled());

    expect(screen.getByText('platform:migration.dryRun.executableNo')).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: /platform:migration.dryRun.continue/ });
    expect(continueBtn).toBeDisabled();
    expect(screen.getByText('platform:migration.dryRun.blockers')).toBeInTheDocument();
    expect(screen.getByText(/2 source column\(s\) still need a mapping decision/)).toBeInTheDocument();
    expect(screen.queryByText('platform:migration.dryRun.legalExclusions.title')).not.toBeInTheDocument();
  });

  it('B1. a current summary with legalExclusions=[] renders without the panel', async () => {
    const api = makeApi({ ...CURRENT_SUMMARY, legalExclusions: [] });

    render(<MigrationDryRunStep run={RUN} api={api} onRunUpdated={noop} onNext={noop} nextStep={7} onBack={noop} />);

    await waitFor(() => expect(api.getRun).toHaveBeenCalled());
    await screen.findAllByText('90');
    expect(screen.queryByText('platform:migration.dryRun.legalExclusions.title')).not.toBeInTheDocument();
  });

  it('B2. a current summary with legalExclusions renders the panel, listing only field names/codes — never a raw sample value', async () => {
    const api = makeApi({
      ...CURRENT_SUMMARY,
      legalBlockers: 2,
      legalExclusions: [
        { code: 'LEGAL_BLOCKED', message: 'This source column holds special-category content.', affectedRows: 1, fieldName: 'KANGURUBU' },
        { code: 'LEGAL_BLOCKED', message: 'This source column holds special-category content.', affectedRows: 1, fieldName: 'ONEMLINOT' },
      ],
    });

    render(<MigrationDryRunStep run={RUN} api={api} onRunUpdated={noop} onNext={noop} nextStep={7} onBack={noop} />);

    await waitFor(() => expect(api.getRun).toHaveBeenCalled());

    expect(await screen.findByText('platform:migration.dryRun.legalExclusions.title')).toBeInTheDocument();
    expect(screen.getByText('KANGURUBU')).toBeInTheDocument();
    expect(screen.getByText('ONEMLINOT')).toBeInTheDocument();

    // A legal exclusion alone must not gate executable/Continue.
    expect(screen.getByText('platform:migration.dryRun.executableYes')).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: /platform:migration.dryRun.continue/ });
    expect(continueBtn).not.toBeDisabled();

    // Field names/codes only — no free-text cell value ever appears (fixture
    // carries none, and this pins that the component doesn't add one).
    const panel = screen.getByText('platform:migration.dryRun.legalExclusions.title').closest('div')!.parentElement!;
    expect(panel.textContent).not.toMatch(/CONFIDENTIAL|litigation|blood group/i);
  });
});
