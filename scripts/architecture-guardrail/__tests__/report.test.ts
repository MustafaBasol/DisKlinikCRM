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

  h.section('report: locale-independent (code-unit) sorting for non-ASCII values (review findings 3 & 4)');

  h.test('findings with Turkish non-ASCII callerPath values sort by exact UTF-16 code-unit order, not locale collation', () => {
    // ç=U+00E7(231) < ö=U+00F6(246) < ü=U+00FC(252) < ğ=U+011F(287) < İ=U+0130(304) < ı=U+0131(305) < ş=U+015F(351)
    // A locale-aware (especially tr-TR) collation would not produce this order for ı/İ/i.
    const chars = ['ş', 'ç', 'İ', 'ö', 'ı', 'ü', 'ğ'];
    const findings: RawFinding[] = chars.map((c, i) =>
      rawFinding({ id: `id-${i}`, callerPath: `server/src/routes/${c}.ts`, callerSymbol: 'x' }),
    );
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: [],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: findings,
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    const sortedChars = report.findings.map((f) => f.callerPath.slice('server/src/routes/'.length, -'.ts'.length));
    h.assertDeepEqual(sortedChars, ['ç', 'ö', 'ü', 'ğ', 'İ', 'ı', 'ş'], 'must sort by raw UTF-16 code-unit value');
  });

  h.test('non-ASCII callerSymbol values sort by code-unit order at the second sort key', () => {
    const findings: RawFinding[] = [
      rawFinding({ id: 'id-s', callerPath: 'server/src/routes/a.ts', callerSymbol: 'şymbol' }),
      rawFinding({ id: 'id-c', callerPath: 'server/src/routes/a.ts', callerSymbol: 'çymbol' }),
      rawFinding({ id: 'id-o', callerPath: 'server/src/routes/a.ts', callerSymbol: 'öymbol' }),
    ];
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: [],
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
      ['id-c', 'id-o', 'id-s'],
      'ç < ö < ş by code-unit value, same callerPath forces the tie-break to callerSymbol',
    );
  });

  h.test('scope.scanRoots sorts non-ASCII entries by code-unit order', () => {
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: ['şroot', 'çroot', 'öroot'],
      excludePatterns: [],
      toolVersion: '1.0.0',
      rawFindings: [],
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    h.assertDeepEqual(report.scope.scanRoots, ['çroot', 'öroot', 'şroot'], 'ç < ö < ş by code-unit value');
  });

  h.test('scope.excludePatterns sorts non-ASCII entries by code-unit order', () => {
    const report = buildReport({
      generatedAt: null,
      repositorySha: null,
      scanRoots: [],
      excludePatterns: ['ğpattern', 'ıpattern', 'İpattern'],
      toolVersion: '1.0.0',
      rawFindings: [],
      baselineStatusById: new Map(),
      baselineComparison: null,
      errors: [],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    h.assertDeepEqual(
      report.scope.excludePatterns,
      ['ğpattern', 'İpattern', 'ıpattern'],
      'ğ=U+011F(287) < İ=U+0130(304) < ı=U+0131(305) by code-unit value',
    );
  });

  h.test('errors/warnings sort by filePath using code-unit order for non-ASCII values', () => {
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
        { code: 'E', message: 'a', filePath: 'server/src/routes/ş.ts' },
        { code: 'E', message: 'a', filePath: 'server/src/routes/ç.ts' },
        { code: 'E', message: 'a', filePath: 'server/src/routes/ö.ts' },
      ],
      warnings: [],
      executionMetadata: BASE_EXEC_META,
    });
    h.assertDeepEqual(
      report.errors.map((e) => e.filePath),
      ['server/src/routes/ç.ts', 'server/src/routes/ö.ts', 'server/src/routes/ş.ts'],
      'ç < ö < ş by code-unit value',
    );
  });

  h.test('two deterministic report builds over the same non-ASCII input (reversed order) are byte-identical', () => {
    const chars = ['ş', 'ç', 'ö', 'ü', 'ğ', 'ı', 'İ'];
    const findings: RawFinding[] = chars.map((c, i) =>
      rawFinding({ id: `id-${i}`, callerPath: `server/src/routes/${c}.ts` }),
    );
    const build = () =>
      buildReport({
        generatedAt: null,
        repositorySha: null,
        scanRoots: ['şroot', 'çroot', 'ğroot'],
        excludePatterns: ['ıpattern', 'İpattern'],
        toolVersion: '1.0.0',
        rawFindings: [...findings].reverse(),
        baselineStatusById: new Map(),
        baselineComparison: null,
        errors: [
          { code: 'E', message: 'şmessage', filePath: 'server/src/routes/ç.ts' },
          { code: 'E', message: 'çmessage', filePath: 'server/src/routes/ç.ts' },
        ],
        warnings: [],
        executionMetadata: BASE_EXEC_META,
      });
    const first = JSON.stringify(build());
    const second = JSON.stringify(build());
    h.assertEqual(first, second, 'two independent builds over the same non-ASCII input must be byte-identical');
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
