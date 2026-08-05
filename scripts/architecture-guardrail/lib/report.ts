/**
 * F2-GUARDRAIL-IMPL-001 — report assembly.
 *
 * The only place deterministic sorting and the final JSON shape are
 * decided. `generatedAt` and `executionMetadata.durationMs` are the only
 * fields allowed to vary between two runs over the same commit/config —
 * every other field (findings, summary, baselineComparison) must be
 * byte-for-byte identical (see docs/program/evidence/F2-GUARDRAIL-IMPL-001_*
 * "TIMESTAMP RULE" section for the deterministic-comparison method this
 * separation enables: strip `generatedAt` and `executionMetadata.durationMs`
 * before diffing two report runs).
 */
import type {
  BaselineComparison,
  ExecutionMetadata,
  Finding,
  GuardrailReport,
  ReportError,
  ReportWarning,
} from './types.js';
import type { RawFinding } from './edgeExtraction.js';
import { redactSecrets } from './redact.js';

export const SCHEMA_VERSION = '1.0.0';

const TENANT_SCOPE_DISCLAIMER = [
  'Static findings from this guardrail are advisory signals only.',
  'Absence of findings is not proof of tenant isolation.',
  'Runtime tenant tests, authorization tests, ORM guards, and any future row-level security remain independent controls that this tool does not replace.',
  'Raw SQL and dynamic Prisma access may require explicit human review; this tool does not analyze either in this version.',
];

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.callerPath !== b.callerPath) return a.callerPath.localeCompare(b.callerPath);
    if (a.callerSymbol !== b.callerSymbol) return a.callerSymbol.localeCompare(b.callerSymbol);
    if (a.targetModelOrSymbol !== b.targetModelOrSymbol) {
      return a.targetModelOrSymbol.localeCompare(b.targetModelOrSymbol);
    }
    return a.id.localeCompare(b.id);
  });
}

function sortByFilePathThenMessage<T extends { filePath: string | null; message: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aPath = a.filePath ?? '';
    const bPath = b.filePath ?? '';
    if (aPath !== bPath) return aPath.localeCompare(bPath);
    return a.message.localeCompare(b.message);
  });
}

export interface BuildReportInput {
  generatedAt: string | null;
  repositorySha: string | null;
  scanRoots: string[];
  excludePatterns: string[];
  toolVersion: string;
  rawFindings: RawFinding[];
  baselineStatusById: Map<string, { status: 'EXISTING' | 'NEW'; baselineEdgeId: string | null }>;
  baselineComparison: BaselineComparison | null;
  errors: ReportError[];
  warnings: ReportWarning[];
  executionMetadata: ExecutionMetadata;
}

export function buildReport(input: BuildReportInput): GuardrailReport {
  const findings: Finding[] = input.rawFindings.map((raw) => {
    const baselineStatus = input.baselineStatusById.get(raw.id) ?? { status: 'NEW' as const, baselineEdgeId: null };
    return {
      id: raw.id,
      callerPath: raw.callerPath,
      callerSymbol: raw.callerSymbol,
      ownerDomain: raw.ownerDomain,
      targetModelOrSymbol: raw.targetModelOrSymbol,
      accessKind: raw.accessKind,
      callerDomain: raw.callerDomain,
      baselineStatus: baselineStatus.status,
      baselineEdgeId: baselineStatus.baselineEdgeId,
    };
  });

  const sortedFindings = sortFindings(findings);
  const redactedErrors = sortByFilePathThenMessage(
    input.errors.map((e) => ({ ...e, message: redactSecrets(e.message) })),
  );
  const redactedWarnings = sortByFilePathThenMessage(
    input.warnings.map((w) => ({ ...w, message: redactSecrets(w.message) })),
  );

  const newFindings = sortedFindings.filter((f) => f.baselineStatus === 'NEW').length;
  const existingFindings = sortedFindings.filter((f) => f.baselineStatus === 'EXISTING').length;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    deterministic: input.generatedAt === null,
    repositorySha: input.repositorySha,
    scope: {
      scanRoots: [...input.scanRoots].sort((a, b) => a.localeCompare(b)),
      excludePatterns: [...input.excludePatterns].sort((a, b) => a.localeCompare(b)),
    },
    configurationVersion: '1.0.0',
    toolVersion: input.toolVersion,
    summary: {
      totalFindings: sortedFindings.length,
      newFindings,
      existingFindings,
      errorCount: redactedErrors.length,
      warningCount: redactedWarnings.length,
    },
    findings: sortedFindings,
    errors: redactedErrors,
    warnings: redactedWarnings,
    baselineComparison: input.baselineComparison,
    executionMetadata: input.executionMetadata,
    tenantScopeDisclaimer: TENANT_SCOPE_DISCLAIMER,
  };
}
