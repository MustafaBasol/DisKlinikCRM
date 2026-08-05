/** Covers requirement 8 (deterministic sorting), 11 (multiple findings), 19 (secret redaction), and part of 17 (JSON shape). */
import type { Harness } from './testHarness.js';
import { buildReport } from '../lib/report.js';
import type { RawFinding } from '../lib/edgeExtraction.js';
import { containsSecretPattern, redactSecrets } from '../lib/redact.js';

function rawFinding(overrides: Partial<RawFinding>): RawFinding {
  return {
    id: 'placeholder',
    callerPath: 'server/src/routes/a.ts',
    callerSymbol: 'x',
    ownerDomain: 'domain-b',
    targetModelOrSymbol: 'services/b.ts',
    accessKind: 'import',
    callerDomain: 'domain-a',
    ...overrides,
  };
}

const BASE_EXEC_META = {
  scanRootsUsed: ['server/src/routes'],
  filesDiscovered: 1,
  filesParsed: 1,
  filesSkipped: 0,
  codeGraphUsed: false as const,
  codeGraphLimitationNote: 'test',
  durationMs: 0,
};

export function registerReportTests(h: Harness): void {
  h.section('report: deterministic sorting, empty/multiple findings, secret redaction, JSON shape');

  h.test('two findings sort deterministically by callerPath, callerSymbol, targetModelOrSymbol', () => {
    const findings: RawFinding[] = [
      rawFinding({ id: 'id-2', callerPath: 'server/src/routes/z.ts', callerSymbol: 'x' }),
      rawFinding({ id: 'id-1', callerPath: 'server/src/routes/a.ts', callerSymbol: 'x' }),
    ];
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: ['server/src/routes'],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: findings,
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    h.assertDeepEqual(
      report.findings.map((f) => f.id),
      ['id-1', 'id-2'],
      'sorted by callerPath ascending regardless of input order',
    );
  });

  h.test('sorting is stable/idempotent — running twice on the same (shuffled) input gives the same order', () => {
    const findings: RawFinding[] = [
      rawFinding({ id: 'id-c', callerPath: 'server/src/routes/c.ts' }),
      rawFinding({ id: 'id-a', callerPath: 'server/src/routes/a.ts' }),
      rawFinding({ id: 'id-b', callerPath: 'server/src/routes/b.ts' }),
    ];
    const build = () =>
      buildReport({
        generatedAt: null,
        repositorySha: null,
        scanRoots: [],
        excludePatterns: [],
        toolVersion: '1.0.0',
        rawFindings: [...findings].reverse(),
        baselineStatusById: new Map(),
        baselineComparison: null,
        errors: [],
        warnings: [],
        executionMetadata: BASE_EXEC_META,
      });
    const first = build().findings.map((f) => f.id);
    const second = build().findings.map((f) => f.id);
    h.assertDeepEqual(first, second, 'two independent builds over reversed input must agree');
    h.assertDeepEqual(first, ['id-a', 'id-b', 'id-c'], 'must be sorted, not merely stable-relative-to-input');
  });

  h.test('empty findings produce a valid, well-shaped report (not null/undefined arrays)', () => {
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: [],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: [],
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    h.assertDeepEqual(report.findings, [], 'empty findings array');
    h.assertEqual(report.summary.totalFindings, 0, 'summary reflects zero findings');
    h.assert(JSON.parse(JSON.stringify(report)) !== null, 'must still serialize to valid JSON');
  });

  h.test('multiple findings with a mix of EXISTING/NEW baseline status roll up correctly into summary', () => {
    const findings: RawFinding[] = [
      rawFinding({ id: 'id-1' }),
      rawFinding({ id: 'id-2', callerPath: 'server/src/routes/b.ts' }),
      rawFinding({ id: 'id-3', callerPath: 'server/src/routes/c.ts' }),
    ];
    const baselineStatusById = new Map([
      ['id-1', { status: 'EXISTING' as const, baselineEdgeId: 'BASE-1' }],
      ['id-2', { status: 'NEW' as const, baselineEdgeId: null }],
      ['id-3', { status: 'NEW' as const, baselineEdgeId: null }],
    ]);
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: [],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: findings,
      baselineStatusById,
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    h.assertEqual(report.summary.totalFindings, 3, 'total');
    h.assertEqual(report.summary.existingFindings, 1, 'existing');
    h.assertEqual(report.summary.newFindings, 2, 'new');
  });

  h.section('report: secret redaction');

  h.test('redactSecrets masks a postgres connection string', () => {
    const redacted = redactSecrets('failed to connect to postgres://user:hunter2@db.internal:5432/prod');
    h.assert(!redacted.includes('hunter2'), 'credential must not survive redaction');
    h.assert(redacted.includes('[REDACTED]'), 'redaction marker must be present');
  });

  h.test('containsSecretPattern detects an AWS access key id', () => {
    h.assert(containsSecretPattern('AKIAABCDEFGHIJKLMNOP'), 'AKIA-prefixed key must be detected');
  });

  h.test('buildReport redacts a secret-like value embedded in an error message before it reaches the report', () => {
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: [],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: [],
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [
        {
          code: 'TEST_ERROR',
          message: 'connection failed: postgres://admin:s3cr3t@localhost:5432/db',
          filePath: null,
        },
      ],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    const serialized = JSON.stringify(report);
    h.assert(!serialized.includes('s3cr3t'), 'secret must not appear anywhere in the serialized report');
  });

  h.section('report: JSON shape');

  h.test('report has every field required by the reporting contract', () => {
    const report = buildReport({
      generatedAt: '2026-01-01T00:00:00.000Z',
      repositorySha: 'deadbeef',
      scanRoots: ['server/src/routes'],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: [],
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    for (const key of [
      'schemaVersion',
      'generatedAt',
      'repositorySha',
      'scope',
      'configurationVersion',
      'toolVersion',
      'summary',
      'findings',
      'errors',
      'warnings',
      'baselineComparison',
      'executionMetadata',
    ]) {
      h.assert(key in report, `report is missing required field "${key}"`);
    }
  });
}
