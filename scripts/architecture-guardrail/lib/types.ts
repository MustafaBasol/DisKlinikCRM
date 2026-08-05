/**
 * F2-GUARDRAIL-IMPL-001 — shared types for the exact-edge architecture
 * guardrail. See docs/program/evidence/F2-SEC-003_SECURITY_GATE_RECONCILIATION.md
 * section 6 for the authorized scope this implements, and
 * docs/program/evidence/F2-GUARDRAIL-IMPL-001_* for this task's own evidence.
 */

/** The exact-edge tuple frozen by PR #313, adopted unchanged by F2-GUARDRAIL-PREP-010-D. */
export interface ExactEdgeTuple {
  callerPath: string;
  callerSymbol: string;
  ownerDomain: string;
  targetModelOrSymbol: string;
  accessKind: 'import';
}

export interface Finding extends ExactEdgeTuple {
  id: string;
  callerDomain: string;
  baselineStatus: 'EXISTING' | 'NEW';
  baselineEdgeId: string | null;
}

export type Severity = 'info';

export interface ScanRootsConfig {
  schemaVersion: string;
  provenance: string;
  roots: string[];
  fileExtensions: string[];
  excludePatterns: string[];
}

export interface DomainMapConfig {
  schemaVersion: string;
  provenance: Record<string, unknown>;
  scanRootPrefixes: string[];
  fileCount: number;
  files: Record<string, string>;
}

export interface BaselineEntry {
  baselineEdgeId: string;
  classification: string;
  risk: string;
  callerPathExact: string | null;
  callerPathGlob: string | null;
  callerSymbol: string | null;
  ownerDomain: string;
  targetModelOrSymbol: string;
  accessKind: string;
}

export interface BaselineComparison {
  baselineSource: string;
  baselineEdgeCount: number;
  matchKeyFields: string[];
  matchKeyLimitation: string;
  newCount: number;
  existingCount: number;
  resolvedCount: number;
  resolvedBaselineEdgeIds: string[];
}

export interface ReportError {
  code: string;
  message: string;
  filePath: string | null;
}

export interface ReportWarning {
  code: string;
  message: string;
  filePath: string | null;
}

export interface ExecutionMetadata {
  scanRootsUsed: string[];
  filesDiscovered: number;
  filesParsed: number;
  filesSkipped: number;
  codeGraphUsed: false;
  codeGraphLimitationNote: string;
  durationMs: number;
}

export interface GuardrailReport {
  schemaVersion: string;
  generatedAt: string | null;
  deterministic: boolean;
  repositorySha: string | null;
  scope: {
    scanRoots: string[];
    excludePatterns: string[];
  };
  configurationVersion: string;
  toolVersion: string;
  summary: {
    totalFindings: number;
    newFindings: number;
    existingFindings: number;
    errorCount: number;
    warningCount: number;
  };
  findings: Finding[];
  errors: ReportError[];
  warnings: ReportWarning[];
  baselineComparison: BaselineComparison | null;
  executionMetadata: ExecutionMetadata;
  tenantScopeDisclaimer: string[];
}
