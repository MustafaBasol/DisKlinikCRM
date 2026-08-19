/**
 * platformMigrationApi.ts — typed client + shared DTOs for the Platform Admin
 * Migration Center (F3-DATA-MIG-TODAY).
 *
 * Every type here is derived from the server-side canonical contract at
 * `server/src/services/migration/contracts.ts`. That file is the authority; this
 * module is its browser-side projection. Keep the two in sync — the migration
 * subsystem's whole safety story rests on a single vendor-neutral contract.
 *
 * PRIVACY: nothing in these shapes carries PII/PHI. Errors carry CODES, counts
 * carry NUMBERS, classifications carry ENUM-LIKE STRINGS — never a cell value.
 * The UI must never invent a field that would.
 *
 * All requests go through the platform axios instance (cookie auth + CSRF
 * interceptor from PlatformAuthContext). There is no token in JS.
 */

import type { AxiosInstance } from 'axios';

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export const MIGRATION_RUN_STATUSES = [
  'CREATED',
  'UPLOADED',
  'ANALYZED',
  'MAPPING_REQUIRED',
  'MAPPING_READY',
  'DRY_RUN_RUNNING',
  'DRY_RUN_COMPLETE',
  'BLOCKED',
  'READY',
  'RUNNING',
  'PARTIAL_FAILURE',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type MigrationRunStatus = (typeof MIGRATION_RUN_STATUSES)[number];

/** Statuses from which no further transition is possible except a fresh run. */
export const TERMINAL_RUN_STATUSES: readonly MigrationRunStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const MIGRATION_BATCH_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
] as const;

export type MigrationBatchStatus = (typeof MIGRATION_BATCH_STATUSES)[number];

export const MIGRATION_ERROR_CODES = [
  'FILE_MISSING',
  'FILE_UNSUPPORTED',
  'FILE_CORRUPTED',
  'FILE_TOO_LARGE',
  'FILE_ENCRYPTED',
  'FILE_SIGNATURE_MISMATCH',
  'SHEET_INVALID',
  'SHEET_EMPTY',
  'HEADER_MISSING',
  'HEADER_DUPLICATE',
  'MAPPING_REQUIRED',
  'MAPPING_INVALID',
  'MAPPING_TYPE_INCOMPATIBLE',
  'MAPPING_DESTINATION_COLLISION',
  'MAPPING_COMPOSITION_UNSUPPORTED',
  'REFERENCE_UNRESOLVED',
  'LEGAL_BLOCKED',
  'ROW_REQUIRED_FIELD_MISSING',
  'ROW_VALUE_INVALID',
  'IDENTITY_INVALID',
  'IDENTITY_AMBIGUOUS',
  'DUPLICATE_SOURCE_RECORD',
  'DESTINATION_CONFLICT',
  'PLAN_LIMIT_EXCEEDED',
  'BATCH_FAILED',
  'DATABASE_ERROR',
  'EXECUTION_ALREADY_RUNNING',
  'EXECUTION_CANCELLED',
  'MIGRATION_STATE_INVALID',
  'IDENTITY_CRYPTO_NOT_CONFIGURED',
  'ORGANIZATION_NOT_FOUND',
  'CLINIC_NOT_FOUND',
  'ORG_CLINIC_MISMATCH',
  'RUN_NOT_FOUND',
  'REPORT_NOT_AVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type MigrationErrorCode = (typeof MIGRATION_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Source model / analysis
// ---------------------------------------------------------------------------

export type SourceFileFormat = 'xls' | 'xlsx';

export type CanonicalCellType = 'empty' | 'string' | 'number' | 'date' | 'boolean' | 'error';

export const CANONICAL_CELL_TYPES: readonly CanonicalCellType[] = [
  'string',
  'number',
  'date',
  'boolean',
  'empty',
  'error',
];

export interface AnalysisSheetDto {
  name: string;
  index: number;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
}

export interface AnalysisHeaderDto {
  original: string;
  normalized: string;
  index: number;
}

export interface SourceColumnProfileDto {
  index: number;
  header: string;
  filledCount: number;
  totalRows: number;
  /** 0..1 */
  fillRate: number;
  distinctCount: number;
  typeCounts: Record<CanonicalCellType, number>;
  maxLength: number;
}

/**
 * Sanitized, server-masked sample values for one source column — the one
 * deliberate exception to this file's "nothing here carries PII/PHI" rule.
 * Masking is applied server-side (columnPreview.ts) before this DTO exists;
 * the UI must render `samples` as-is and must never fetch or display a raw
 * cell value through any other channel.
 */
export interface AnalysisColumnPreviewDto {
  index: number;
  samples: string[];
}

export interface MigrationAnalysisDto {
  sheetName: string;
  sheetIndex: number;
  sheets: AnalysisSheetDto[];
  totalSourceRows: number;
  headerColumnCount: number;
  format: SourceFileFormat;
  /** Structural, non-blocking observations. Codes only. */
  warnings: string[];
  headers: AnalysisHeaderDto[];
  profiles: SourceColumnProfileDto[];
  columnPreviews: AnalysisColumnPreviewDto[];
}

// ---------------------------------------------------------------------------
// Destination catalog
// ---------------------------------------------------------------------------

export const DESTINATION_GROUPS = [
  'provenance',
  'identity',
  'name',
  'contact',
  'address',
  'clinical',
  'operational',
] as const;

export type DestinationGroup = (typeof DESTINATION_GROUPS)[number];

export type DestinationValueType =
  | 'string'
  | 'phone'
  | 'email'
  | 'date'
  | 'enum'
  | 'identity'
  | 'provenance'
  | 'reference';

export const TRANSFORM_NAMES = [
  'trim',
  'trim_collapse',
  'lower_trim',
  'phone_tr',
  'date_excel_serial',
  'gender_tr',
  'deleted_to_status',
  'compose_address',
  'chart_number',
  'identity_tckn',
  'provenance_source_id',
  'practitioner_reference',
] as const;

export type TransformName = (typeof TRANSFORM_NAMES)[number];

export interface DestinationFieldDto {
  key: string;
  label: string;
  group: DestinationGroup;
  type: DestinationValueType;
  required: boolean;
  allowedTransforms: TransformName[];
  allowsComposition: boolean;
  enumValues?: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export const MAPPING_STATES = [
  'AUTO_CONFIDENT',
  'AUTO_REVIEW',
  'MANUAL_REQUIRED',
  'BLOCKED',
  'IGNORE',
  'LEGAL_BLOCKED',
  'RESOLVED',
] as const;

export type MappingState = (typeof MAPPING_STATES)[number];

export const MAPPING_REASONS = [
  'EXACT_HEADER',
  'ALIAS',
  'NORMALIZED',
  'FIRST_CUSTOMER_MATRIX',
  'SAVED_TEMPLATE',
  'MANUAL',
  'NO_DESTINATION',
  'LEGAL_GATE',
  'VENDOR_INTERNAL',
  'SUMMARY_NOT_TRANSACTION',
  'SEMANTICS_UNRESOLVED',
  'UNKNOWN_HEADER',
] as const;

export type MappingReason = (typeof MAPPING_REASONS)[number];

/**
 * One source column's mapping decision.
 *
 * NOTE ON `state`: the wire contract for this feature names the field `state`
 * while the server-side `MappingSuggestion` names it `mappingState`. Reads are
 * normalized through `normalizeMapping()` so either spelling is accepted;
 * writes always send `state` (plus `mappingState` for symmetry) so a backend
 * built against either spelling keeps working.
 */
export interface MappingDto {
  sourceField: string;
  sourceLabel: string;
  sourceIndex: number;
  sourceNormalized: string;
  destinationField: string | null;
  destinationLabel: string | null;
  transform: TransformName | null;
  composeOrder: number | null;
  /** 0..100, deterministic. */
  confidence: number;
  reason: MappingReason;
  state: MappingState;
}

export interface MappingValidationIssueDto {
  code: MigrationErrorCode;
  message: string;
  sourceField?: string;
  destinationField?: string;
}

export interface MappingValidationDto {
  valid: boolean;
  issues: MappingValidationIssueDto[];
  unresolvedCount: number;
  blockedCount: number;
  legalBlockedCount: number;
  ignoredCount: number;
  mappedCount: number;
}

export interface MappingsResponse {
  mappings: MappingDto[];
  destinations: DestinationFieldDto[];
  validation: MappingValidationDto;
}

export interface MappingWritePayload {
  sourceField: string;
  destinationField: string | null;
  transform: TransformName | null;
  composeOrder: number | null;
  state: MappingState;
}

// ---------------------------------------------------------------------------
// Reference mapping
// ---------------------------------------------------------------------------

export const REFERENCE_MAP_STATUSES = [
  'UNMAPPED',
  'MAPPED_APPROVED',
  'MAPPED_IGNORED',
  'CONFLICTED',
] as const;

export type ReferenceMapStatus = (typeof REFERENCE_MAP_STATUSES)[number];

export type ReferenceEntityType = 'practitioner' | 'staff_user' | 'service' | 'branch';

export interface ReferenceValueDto {
  sourceValue: string;
  rowCount: number;
  status: ReferenceMapStatus;
  destinationId: string | null;
  destinationLabel: string | null;
}

export interface ReferenceCandidateDto {
  id: string;
  name: string;
  role: string;
}

export interface ReferenceMapResponse {
  required: boolean;
  entityType: ReferenceEntityType;
  values: ReferenceValueDto[];
  candidates: ReferenceCandidateDto[];
}

export interface ReferenceWriteEntry {
  entityType: ReferenceEntityType;
  sourceValue: string;
  destinationId: string | null;
  status: ReferenceMapStatus;
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export const IDENTITY_CLASSIFICATIONS = [
  'VALID',
  'INVALID_LEGACY',
  'AMBIGUOUS',
  'DUPLICATE_SOURCE',
  'MANUAL_REVIEW',
  'ABSENT',
] as const;

export type IdentityClassification = (typeof IDENTITY_CLASSIFICATIONS)[number];

export const DRY_RUN_ROW_CLASSES = [
  'VALID_NEW',
  'VALID_MATCHED',
  'NORMALIZED',
  'AMBIGUOUS',
  'MAPPING_REQUIRED',
  'INVALID',
  'DUPLICATE_SOURCE',
  'DUPLICATE_DESTINATION',
  'SKIPPED_BY_POLICY',
  'BLOCKED',
] as const;

export type DryRunRowClass = (typeof DRY_RUN_ROW_CLASSES)[number];

export interface DryRunBlockerDto {
  code: MigrationErrorCode;
  /** Safe, human-readable explanation. Never PII. */
  message: string;
  affectedRows: number;
  fieldName?: string;
}

export interface PlanLimitReportDto {
  sourceActivePatientCount: number;
  destinationCurrentCount: number;
  expectedResultingCount: number;
  organizationPatientCap: number | null;
  clinicPatientCap: number | null;
  effectiveCap: number | null;
  effectiveCapSource: 'organization_plan' | 'clinic_column' | 'none';
  allowed: boolean;
  /** Plain text naming the audited Platform Admin route that raises the cap. */
  overrideMechanism: string;
}

export interface SharedPhoneImpactDto {
  destinationSharedBefore: number;
  destinationSharedAfter: number;
  preExistingFlippedToAmbiguous: number;
  sourceRowsSharingPhone: number;
}

export interface DryRunSummaryDto {
  generatedAt: string;
  totalSourceRows: number;
  parsedRows: number;
  validRows: number;
  warningRows: number;
  blockedRows: number;
  invalidRows: number;
  duplicateSourceRows: number;
  ambiguousRows: number;
  manualReviewRows: number;
  unresolvedMappings: number;
  referenceMappingBlockers: number;
  legalBlockers: number;
  expectedCreateCount: number;
  expectedReuseCount: number;
  expectedSkippedCount: number;
  identityClassifications: Record<IdentityClassification, number>;
  rowClasses: Record<DryRunRowClass, number>;
  blockers: DryRunBlockerDto[];
  /** Decided legal-policy exclusions — never counted toward `executable=false`. */
  legalExclusions: DryRunBlockerDto[];
  warnings: DryRunBlockerDto[];
  planLimit: PlanLimitReportDto;
  sharedPhoneImpact: SharedPhoneImpactDto;
  /** True when execution may proceed. */
  executable: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationDto {
  generatedAt: string;
  sourceTotal: number;
  eligibleTotal: number;
  attemptedTotal: number;
  created: number;
  reused: number;
  manualReview: number;
  skipped: number;
  failed: number;
  blocked: number;
  destinationCountBefore: number;
  destinationCountAfter: number;
  destinationCountDelta: number;
  provenanceRows: number;
  identityRows: number;
  batchTotals: {
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
    cancelled: number;
  };
  provenanceResolves: boolean;
  tenantScopeClean: boolean;
  balanced: boolean;
  imbalanceDetail?: string;
}

// ---------------------------------------------------------------------------
// Run + progress
// ---------------------------------------------------------------------------

/**
 * The run header the API returns everywhere a run is referenced.
 *
 * The wire contract does not enumerate this object's fields, so every field the
 * UI does not strictly need to render a stage is optional/nullable and rendered
 * through an explicit "—" fallback. A backend that omits one of them degrades a
 * cell, never the screen.
 */
export interface MigrationRunDto {
  id: string;
  status: MigrationRunStatus;
  organizationId: string;
  organizationName?: string | null;
  clinicId: string;
  clinicName?: string | null;
  /** Server-generated safe filename. The operator's original name is never echoed. */
  safeFileName?: string | null;
  fileSizeBytes?: number | null;
  format?: SourceFileFormat | null;
  sheetName?: string | null;
  sheetIndex?: number | null;
  totalSourceRows?: number | null;
  processedRows?: number | null;
  createdRows?: number | null;
  matchedRows?: number | null;
  skippedRows?: number | null;
  failedRows?: number | null;
  warningRows?: number | null;
  blockedRows?: number | null;
  duplicateRows?: number | null;
  batchCount?: number | null;
  batchSize?: number | null;
  referenceMappingRequired?: boolean | null;
  initiatedByEmail?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelRequestedAt?: string | null;
  lastErrorCode?: MigrationErrorCode | null;
  lastErrorMessage?: string | null;
}

export interface MigrationBatchDto {
  batchNumber: number;
  status: MigrationBatchStatus;
  rowStart: number;
  rowEnd: number;
  processedRows: number;
  createdRows: number;
  matchedRows: number;
  failedRows: number;
  skippedRows: number;
  warningRows: number;
  retryCount: number;
  errorCode?: MigrationErrorCode | null;
  errorSummary?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface MigrationProgressDto {
  status: MigrationRunStatus;
  currentBatch: number;
  totalBatches: number;
  processedRows: number;
  createdRows: number;
  matchedRows: number;
  skippedRows: number;
  failedRows: number;
  warningRows: number;
  blockedRows: number;
  startedAt?: string | null;
  completedAt?: string | null;
  elapsedMs?: number | null;
  lastErrorCode?: MigrationErrorCode | null;
  lastErrorMessage?: string | null;
  cancelRequestedAt?: string | null;
  batches: MigrationBatchDto[];
  /** Not in the wire contract; present when the backend echoes it. */
  totalSourceRows?: number | null;
}

// ---------------------------------------------------------------------------
// Targets / history / audit
// ---------------------------------------------------------------------------

export interface MigrationTargetClinic {
  id: string;
  name: string;
}

export interface MigrationTargetOrganization {
  id: string;
  name: string;
  clinics: MigrationTargetClinic[];
}

export interface MigrationTargetsResponse {
  organizations: MigrationTargetOrganization[];
}

export interface MigrationRunDetailResponse {
  run: MigrationRunDto;
  reconciliation: ReconciliationDto | null;
  dryRun: DryRunSummaryDto | null;
}

export interface MigrationRunListResponse {
  data: MigrationRunDto[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface MigrationAuditEventDto {
  action: string;
  outcome: string;
  createdAt: string;
  actorEmail?: string | null;
  /** Safe metadata only — ids, counts, codes. Never a cell value. */
  safeMetadata?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Normalizers (tolerant reads — the UI must never crash on a shape drift)
// ---------------------------------------------------------------------------

/** Accepts `state` or the server-side `mappingState` spelling. */
export function normalizeMapping(raw: MappingDto & { mappingState?: MappingState }): MappingDto {
  return {
    ...raw,
    state: raw.state ?? raw.mappingState ?? 'MANUAL_REQUIRED',
  };
}

export function normalizeMappings(
  raw: (MappingDto & { mappingState?: MappingState })[] | null | undefined,
): MappingDto[] {
  return Array.isArray(raw) ? raw.map(normalizeMapping) : [];
}

/** A validation object that is always safe to render, even before the first call. */
export const EMPTY_MAPPING_VALIDATION: MappingValidationDto = {
  valid: false,
  issues: [],
  unresolvedCount: 0,
  blockedCount: 0,
  legalBlockedCount: 0,
  ignoredCount: 0,
  mappedCount: 0,
};

export function normalizeValidation(raw: MappingValidationDto | null | undefined): MappingValidationDto {
  if (!raw) return EMPTY_MAPPING_VALIDATION;
  return {
    valid: !!raw.valid,
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    unresolvedCount: raw.unresolvedCount ?? 0,
    blockedCount: raw.blockedCount ?? 0,
    legalBlockedCount: raw.legalBlockedCount ?? 0,
    ignoredCount: raw.ignoredCount ?? 0,
    mappedCount: raw.mappedCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE = '/platform/migrations';

export function createMigrationApi(api: AxiosInstance) {
  return {
    async listTargets(signal?: AbortSignal): Promise<MigrationTargetsResponse> {
      const res = await api.get<MigrationTargetsResponse>(`${BASE}/targets`, { signal });
      return { organizations: res.data?.organizations ?? [] };
    },

    async createRun(organizationId: string, clinicId: string): Promise<MigrationRunDto> {
      const res = await api.post<{ run: MigrationRunDto }>(`${BASE}/runs`, { organizationId, clinicId });
      return res.data.run;
    },

    async uploadFile(runId: string, file: File): Promise<MigrationRunDto> {
      const form = new FormData();
      form.append('file', file);
      // Content-Type must be left unset so the browser writes the multipart boundary.
      const res = await api.post<{ run: MigrationRunDto }>(`${BASE}/runs/${runId}/upload`, form, {
        headers: { 'Content-Type': undefined },
      });
      return res.data.run;
    },

    async analyze(
      runId: string,
      sheetIndex?: number,
    ): Promise<{ run: MigrationRunDto; analysis: MigrationAnalysisDto }> {
      const res = await api.post<{ run: MigrationRunDto; analysis: MigrationAnalysisDto }>(
        `${BASE}/runs/${runId}/analyze`,
        sheetIndex === undefined ? {} : { sheetIndex },
      );
      return res.data;
    },

    async getMappings(runId: string, signal?: AbortSignal): Promise<MappingsResponse> {
      const res = await api.get<MappingsResponse>(`${BASE}/runs/${runId}/mappings`, { signal });
      return {
        mappings: normalizeMappings(res.data?.mappings),
        destinations: res.data?.destinations ?? [],
        validation: normalizeValidation(res.data?.validation),
      };
    },

    async saveMappings(
      runId: string,
      mappings: MappingWritePayload[],
    ): Promise<{ mappings: MappingDto[]; validation: MappingValidationDto }> {
      const res = await api.put<MappingsResponse>(`${BASE}/runs/${runId}/mappings`, {
        mappings: mappings.map((m) => ({ ...m, mappingState: m.state })),
      });
      return {
        mappings: normalizeMappings(res.data?.mappings),
        validation: normalizeValidation(res.data?.validation),
      };
    },

    async acceptAutoMappings(
      runId: string,
    ): Promise<{ mappings: MappingDto[]; validation: MappingValidationDto; accepted: number }> {
      const res = await api.post<MappingsResponse & { accepted: number }>(
        `${BASE}/runs/${runId}/mappings/accept-auto`,
      );
      return {
        mappings: normalizeMappings(res.data?.mappings),
        validation: normalizeValidation(res.data?.validation),
        accepted: res.data?.accepted ?? 0,
      };
    },

    async validateMappings(runId: string): Promise<MappingValidationDto> {
      const res = await api.post<{ validation: MappingValidationDto }>(
        `${BASE}/runs/${runId}/mappings/validate`,
      );
      return normalizeValidation(res.data?.validation);
    },

    async getReferences(runId: string, signal?: AbortSignal): Promise<ReferenceMapResponse> {
      const res = await api.get<ReferenceMapResponse>(`${BASE}/runs/${runId}/references`, { signal });
      return {
        required: !!res.data?.required,
        entityType: res.data?.entityType ?? 'practitioner',
        values: res.data?.values ?? [],
        candidates: res.data?.candidates ?? [],
      };
    },

    async saveReferences(runId: string, entries: ReferenceWriteEntry[]): Promise<ReferenceValueDto[]> {
      const res = await api.put<{ values: ReferenceValueDto[] }>(`${BASE}/runs/${runId}/references`, {
        entries,
      });
      return res.data?.values ?? [];
    },

    async dryRun(runId: string): Promise<{ run: MigrationRunDto; dryRun: DryRunSummaryDto }> {
      const res = await api.post<{ run: MigrationRunDto; dryRun: DryRunSummaryDto }>(
        `${BASE}/runs/${runId}/dry-run`,
      );
      return res.data;
    },

    async execute(runId: string, batchSize?: number): Promise<MigrationRunDto> {
      const res = await api.post<{ run: MigrationRunDto }>(`${BASE}/runs/${runId}/execute`, {
        confirm: true,
        ...(batchSize ? { batchSize } : {}),
      });
      return res.data.run;
    },

    async getProgress(runId: string, signal?: AbortSignal): Promise<MigrationProgressDto> {
      const res = await api.get<MigrationProgressDto>(`${BASE}/runs/${runId}/progress`, { signal });
      return { ...res.data, batches: res.data?.batches ?? [] };
    },

    async cancel(runId: string): Promise<MigrationRunDto> {
      const res = await api.post<{ run: MigrationRunDto }>(`${BASE}/runs/${runId}/cancel`);
      return res.data.run;
    },

    async retryFailed(runId: string): Promise<{ run: MigrationRunDto; retriedBatches: number }> {
      const res = await api.post<{ run: MigrationRunDto; retriedBatches: number }>(
        `${BASE}/runs/${runId}/retry-failed`,
      );
      return { run: res.data.run, retriedBatches: res.data?.retriedBatches ?? 0 };
    },

    async resume(runId: string): Promise<MigrationRunDto> {
      const res = await api.post<{ run: MigrationRunDto }>(`${BASE}/runs/${runId}/resume`);
      return res.data.run;
    },

    async getRun(runId: string, signal?: AbortSignal): Promise<MigrationRunDetailResponse> {
      const res = await api.get<MigrationRunDetailResponse>(`${BASE}/runs/${runId}`, { signal });
      return {
        run: res.data.run,
        reconciliation: res.data?.reconciliation ?? null,
        dryRun: res.data?.dryRun ?? null,
      };
    },

    async listRuns(
      params: { page?: number; limit?: number; organizationId?: string; status?: string },
      signal?: AbortSignal,
    ): Promise<MigrationRunListResponse> {
      const res = await api.get<MigrationRunListResponse>(`${BASE}/runs`, { params, signal });
      return {
        data: res.data?.data ?? [],
        total: res.data?.total ?? 0,
        page: res.data?.page ?? 1,
        limit: res.data?.limit ?? 25,
        pages: res.data?.pages ?? 1,
      };
    },

    async downloadReport(runId: string, kind: 'success' | 'failure'): Promise<Blob> {
      const res = await api.get<Blob>(`${BASE}/runs/${runId}/reports/${kind}`, {
        responseType: 'blob',
      });
      return res.data as Blob;
    },

    async getAudit(runId: string, signal?: AbortSignal): Promise<MigrationAuditEventDto[]> {
      const res = await api.get<{ events: MigrationAuditEventDto[] }>(`${BASE}/runs/${runId}/audit`, {
        signal,
      });
      return res.data?.events ?? [];
    },
  };
}

export type MigrationApiClient = ReturnType<typeof createMigrationApi>;
