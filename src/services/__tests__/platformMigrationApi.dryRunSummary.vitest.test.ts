/**
 * platformMigrationApi.dryRunSummary.vitest.test.ts — F3-DATA-MIG-TODAY-001-UI-002-R3
 *
 * `DryRunSummary.legalExclusions` was added by PR #454. A DryRunSummary
 * persisted before that change has no `legalExclusions` key — `undefined`,
 * not `[]`. Pins `normalizeDryRunSummary` (the API/DTO boundary normalizer)
 * directly, and pins that `createMigrationApi(...).getRun` — the one call
 * that can return a persisted, potentially pre-#454 summary — applies it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  createMigrationApi,
  normalizeDryRunSummary,
  type DryRunSummaryDto,
} from '../platformMigrationApi';

const CURRENT_SUMMARY = {
  generatedAt: new Date(0).toISOString(),
  totalSourceRows: 10,
  parsedRows: 10,
  validRows: 10,
  warningRows: 0,
  blockedRows: 0,
  invalidRows: 0,
  duplicateSourceRows: 0,
  ambiguousRows: 0,
  manualReviewRows: 0,
  unresolvedMappings: 0,
  referenceMappingBlockers: 0,
  legalBlockers: 0,
  expectedCreateCount: 10,
  expectedReuseCount: 0,
  expectedSkippedCount: 0,
  identityClassifications: { VALID: 10, INVALID_LEGACY: 0, AMBIGUOUS: 0, DUPLICATE_SOURCE: 0, MANUAL_REVIEW: 0, ABSENT: 0 },
  rowClasses: {
    VALID_NEW: 10, VALID_MATCHED: 0, NORMALIZED: 0, AMBIGUOUS: 0, MAPPING_REQUIRED: 0,
    INVALID: 0, DUPLICATE_SOURCE: 0, DUPLICATE_DESTINATION: 0, SKIPPED_BY_POLICY: 0, BLOCKED: 0,
  },
  blockers: [],
  warnings: [],
  planLimit: {
    sourceActivePatientCount: 10,
    destinationCurrentCount: 0,
    expectedResultingCount: 10,
    organizationPatientCap: null,
    clinicPatientCap: null,
    effectiveCap: null,
    effectiveCapSource: 'none' as const,
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
  durationMs: 5,
};

describe('normalizeDryRunSummary', () => {
  it('returns null for null/undefined (no dry run has run yet)', () => {
    expect(normalizeDryRunSummary(null)).toBeNull();
    expect(normalizeDryRunSummary(undefined)).toBeNull();
  });

  it('fills a missing legalExclusions with [] and changes nothing else — a pre-#454 persisted summary', () => {
    // Cast: this is exactly the pre-#454 wire shape, which the current
    // DryRunSummaryDto type (correctly) no longer allows constructing directly.
    const legacy = CURRENT_SUMMARY as unknown as DryRunSummaryDto;
    const normalized = normalizeDryRunSummary(legacy);

    expect(normalized).not.toBeNull();
    expect(normalized!.legalExclusions).toEqual([]);
    // Every other field — including executable and every counter — is untouched.
    const { legalExclusions, ...rest } = normalized!;
    void legalExclusions;
    expect(rest).toEqual(CURRENT_SUMMARY);
  });

  it('passes through an existing legalExclusions array unchanged', () => {
    const current: DryRunSummaryDto = {
      ...(CURRENT_SUMMARY as unknown as DryRunSummaryDto),
      legalExclusions: [{ code: 'LEGAL_BLOCKED', message: 'gated', affectedRows: 1, fieldName: 'KANGURUBU' }],
    };
    expect(normalizeDryRunSummary(current)!.legalExclusions).toEqual([
      { code: 'LEGAL_BLOCKED', message: 'gated', affectedRows: 1, fieldName: 'KANGURUBU' },
    ]);
  });

  it('treats a non-array legalExclusions (e.g. malformed JSON) as [] rather than throwing', () => {
    const malformed = { ...CURRENT_SUMMARY, legalExclusions: null } as unknown as DryRunSummaryDto;
    expect(normalizeDryRunSummary(malformed)!.legalExclusions).toEqual([]);
  });
});

describe('createMigrationApi(...).getRun — API/DTO boundary', () => {
  it('normalizes a legacy persisted dryRun (missing legalExclusions) from GET /migrations/runs/:id', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        run: { id: 'run-legacy-1', status: 'DRY_RUN_COMPLETE' },
        reconciliation: null,
        dryRun: CURRENT_SUMMARY, // pre-#454 shape: no legalExclusions key
      },
    });
    const axios = { get } as unknown as AxiosInstance;
    const api = createMigrationApi(axios);

    const detail = await api.getRun('run-legacy-1');

    expect(detail.dryRun).not.toBeNull();
    expect(detail.dryRun!.legalExclusions).toEqual([]);
    expect(detail.dryRun!.executable).toBe(true); // unreinterpreted
    expect(detail.dryRun!.validRows).toBe(10); // unreinterpreted
  });

  it('returns null dryRun as null (no dry run has run yet), never throws', async () => {
    const get = vi.fn().mockResolvedValue({ data: { run: { id: 'r1', status: 'MAPPING_READY' }, reconciliation: null, dryRun: null } });
    const api = createMigrationApi({ get } as unknown as AxiosInstance);

    const detail = await api.getRun('r1');
    expect(detail.dryRun).toBeNull();
  });
});
