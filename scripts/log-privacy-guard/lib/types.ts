/**
 * F3-IMPL-007 — Sensitive Runtime Logging Regression Guard: shared types.
 * See docs/program/evidence/F3-IMPL-007_SENSITIVE_RUNTIME_LOGGING_REGRESSION_GUARD.md
 */

export type RuleId =
  | 'RAW_ERROR_OBJECT'
  | 'ERROR_DANGEROUS_PROPERTY'
  | 'MESSAGE_CONTENT'
  | 'DIRECT_PII_FIELD';

export const ALL_RULE_IDS: readonly RuleId[] = [
  'RAW_ERROR_OBJECT',
  'ERROR_DANGEROUS_PROPERTY',
  'MESSAGE_CONTENT',
  'DIRECT_PII_FIELD',
];

export interface ScanRootsConfig {
  schemaVersion: string;
  provenance: string;
  roots: string[];
  fileExtensions: string[];
  excludePatterns: string[];
}

export interface Violation {
  ruleId: RuleId;
  file: string;
  line: number;
  column: number;
  snippet: string;
  fingerprint: string;
  remediation: string;
}

export interface SuppressedViolation extends Violation {
  suppressionReason: string;
}

export interface BaselineExceptionEntry {
  file: string;
  line: number;
  ruleId: RuleId;
  fingerprint: string;
  reason: string;
  addedDate: string;
  addedBy?: string;
}

export interface FileScanError {
  file: string;
  message: string;
}

export interface ScanResult {
  violations: Violation[];
  grandfathered: Violation[];
  suppressed: SuppressedViolation[];
  staleExceptions: BaselineExceptionEntry[];
  duplicateExceptions: BaselineExceptionEntry[];
  filesScanned: number;
  errors: FileScanError[];
  durationMs: number;
}

export const REMEDIATION: Record<RuleId, string> = {
  RAW_ERROR_OBJECT:
    "Do not pass a raw caught error to a logging sink. Use safeErrorFields(err)/safeErrorLog(err) (server/src/utils/safeError.ts, utils/logger.ts) or, matching this codebase's mail-catch sibling convention, `err instanceof Error ? err.name : 'FallbackLabel'`.",
  ERROR_DANGEROUS_PROPERTY:
    'err.message/err.stack/err.cause can carry request-derived or environment content. Use safeErrorFields(err)/safeErrorLog(err) instead, or log only err.name/err.code.',
  MESSAGE_CONTENT:
    'Do not log raw inbound/outbound message text/body/payload content. Use an existing summarizer (e.g. summarizeTextForLog) or log only a length/hash/id, never the content itself.',
  DIRECT_PII_FIELD:
    'Do not log a raw email/phone value directly. Use the existing redaction helper (e.g. redactPhone) or log only a non-reversible identifier.',
};
