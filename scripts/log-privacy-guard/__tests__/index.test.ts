/**
 * F3-IMPL-007 — Sensitive Runtime Logging Regression Guard test suite.
 *
 * Run with: npx tsx scripts/log-privacy-guard/__tests__/index.test.ts
 * (registered as `npm run test:log-privacy-guard` at the repo root).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanFile } from '../lib/scanner.js';
import { computeFingerprint } from '../lib/fingerprint.js';
import { applyBaseline, validateBaselineEntries, BaselineConfigError } from '../lib/baseline.js';
import { runScan } from '../cli.js';
import type { RuleId } from '../lib/types.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const FIXTURES_DIR = join(__dirname, 'fixtures');

function scanFixture(kind: 'unsafe' | 'safe', name: string) {
  const absPath = join(FIXTURES_DIR, kind, name);
  const text = readFileSync(absPath, 'utf8');
  return scanFile(absPath, `fixtures/${kind}/${name}`, text);
}

function ruleIdsOf(violations: { ruleId: RuleId }[]): RuleId[] {
  return violations.map((v) => v.ruleId).sort();
}

async function main() {
  section('Negative fixtures — must fail (Step 6, 6 required cases)');

  await test('01: raw error spread into logger.error() -> RAW_ERROR_OBJECT', () => {
    const { violations } = scanFixture('unsafe', '01-raw-error-to-logger.ts');
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT']);
  });

  await test('02: error.message logged directly -> ERROR_DANGEROUS_PROPERTY', () => {
    const { violations } = scanFixture('unsafe', '02-error-message.ts');
    assert.deepEqual(ruleIdsOf(violations), ['ERROR_DANGEROUS_PROPERTY']);
  });

  await test('03: error.stack logged directly -> ERROR_DANGEROUS_PROPERTY', () => {
    const { violations } = scanFixture('unsafe', '03-error-stack.ts');
    assert.deepEqual(ruleIdsOf(violations), ['ERROR_DANGEROUS_PROPERTY']);
  });

  await test('04: error.cause logged directly -> ERROR_DANGEROUS_PROPERTY', () => {
    const { violations } = scanFixture('unsafe', '04-error-cause.ts');
    assert.deepEqual(ruleIdsOf(violations), ['ERROR_DANGEROUS_PROPERTY']);
  });

  await test('05: raw inbound message.text logged -> MESSAGE_CONTENT', () => {
    const { violations } = scanFixture('unsafe', '05-message-content.ts');
    assert.deepEqual(ruleIdsOf(violations), ['MESSAGE_CONTENT']);
  });

  await test('06: raw phone logged directly -> DIRECT_PII_FIELD', () => {
    const { violations } = scanFixture('unsafe', '06-direct-pii.ts');
    assert.deepEqual(ruleIdsOf(violations), ['DIRECT_PII_FIELD']);
  });

  await test('07: raw national identity number (tckn) logged directly -> DIRECT_PII_FIELD', () => {
    const { violations } = scanFixture('unsafe', '07-direct-pii-identity.ts');
    assert.deepEqual(ruleIdsOf(violations), ['DIRECT_PII_FIELD']);
  });

  await test('08: raw district + normalizedValue logged directly -> DIRECT_PII_FIELD x2', () => {
    const { violations } = scanFixture('unsafe', '08-direct-pii-address-contact.ts');
    assert.deepEqual(ruleIdsOf(violations), ['DIRECT_PII_FIELD', 'DIRECT_PII_FIELD']);
  });

  section('Positive fixtures — must NOT fail (Step 7, 6 required cases + repo baseline)');

  await test('01: safeErrorFields(err) wrapper -> zero findings', () => {
    const { violations, suppressed } = scanFixture('safe', '01-safe-error-fields.ts');
    assert.equal(violations.length, 0);
    assert.equal(suppressed.length, 0);
  });

  await test('02: boundedErrorType(err) wrapper -> zero findings', () => {
    const { violations } = scanFixture('safe', '02-bounded-error-classification.ts');
    assert.equal(violations.length, 0);
  });

  await test('03: requestId metadata -> zero findings', () => {
    const { violations } = scanFixture('safe', '03-request-id.ts');
    assert.equal(violations.length, 0);
  });

  await test('04: patientId/clinicId entity ids -> zero findings', () => {
    const { violations } = scanFixture('safe', '04-entity-ids.ts');
    assert.equal(violations.length, 0);
  });

  await test('05: count/status/boolean metadata -> zero findings', () => {
    const { violations } = scanFixture('safe', '05-count-status-boolean.ts');
    assert.equal(violations.length, 0);
  });

  await test('06: redactPhone()/summarizeTextForLog() wrapped values -> zero findings', () => {
    const { violations } = scanFixture('safe', '06-redacted-forms.ts');
    assert.equal(violations.length, 0);
  });

  await test('07: current accepted server/src baseline scans clean with the reviewed baseline exceptions applied', () => {
    const result = runScan({
      repoRoot: REPO_ROOT,
      scanRootsPath: resolve(REPO_ROOT, 'scripts/log-privacy-guard/config/scan-roots.json'),
      baselinePath: resolve(REPO_ROOT, 'scripts/log-privacy-guard/config/baseline-exceptions.json'),
      strictBaseline: false,
      json: false,
      outPath: null,
    });
    assert.equal(result.errors.length, 0, `expected no scan errors, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.duplicateExceptions.length, 0);
    assert.equal(
      result.violations.length,
      0,
      `expected zero NEW violations against current main; got ${result.violations.length}: ${JSON.stringify(
        result.violations.slice(0, 5),
      )}`,
    );
    assert.equal(
      result.staleExceptions.length,
      0,
      `expected zero stale baseline exceptions; got ${result.staleExceptions.length}`,
    );
    assert.ok(result.filesScanned > 0);
  });

  section('Inline escape hatch (log-privacy-guard:allow)');

  await test('a suppression comment with a real reason moves the finding to suppressed[], not violations[]', () => {
    const src = [
      "declare function doSomething(): void;",
      'export function fn() {',
      '  try { doSomething(); } catch (err) {',
      '    // log-privacy-guard:allow -- synthetic fixture, exercising the suppression path only',
      "    console.error('failed', err);",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations, suppressed } = scanFile('/virtual/suppressed.ts', 'virtual/suppressed.ts', src);
    assert.equal(violations.length, 0);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].ruleId, 'RAW_ERROR_OBJECT');
    assert.match(suppressed[0].suppressionReason, /synthetic fixture/);
  });

  await test('a suppression comment without a real reason (too short) does NOT suppress', () => {
    const src = [
      "declare function doSomething(): void;",
      'export function fn() {',
      '  try { doSomething(); } catch (err) {',
      '    // log-privacy-guard:allow',
      "    console.error('failed', err);",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations, suppressed } = scanFile('/virtual/unsuppressed.ts', 'virtual/unsuppressed.ts', src);
    assert.equal(suppressed.length, 0);
    assert.equal(violations.length, 1);
  });

  section('Sink scoping (no false positives from unrelated console-like/logger-like calls)');

  await test('a `logger` identifier NOT imported from utils/logger is not treated as a sink', () => {
    const src = [
      'const logger = { error: (..._args: unknown[]) => {} };',
      'export function fn() {',
      "  try { throw new Error('x'); } catch (err) {",
      "    logger.error('failed', err);",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/unrelated-logger.ts', 'virtual/unrelated-logger.ts', src);
    assert.equal(violations.length, 0);
  });

  await test('err.name / err.code (accepted-safe properties) never flag', () => {
    const src = [
      'export function fn() {',
      "  try { throw new Error('x'); } catch (err) {",
      "    console.error('failed', err instanceof Error ? err.name : 'FallbackLabel', (err as { code?: string }).code);",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/safe-props.ts', 'virtual/safe-props.ts', src);
    assert.equal(violations.length, 0);
  });

  section('Catch-clause binding tracking (F3-IMPL-007-R1, review finding 1)');

  await test('catch (e) — raw object to logger -> RAW_ERROR_OBJECT (not just err/error)', () => {
    const src = [
      'declare function doSomething(): void;',
      'export function fn() {',
      '  try { doSomething(); } catch (e) {',
      "    console.error('failed', { e });",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/catch-e.ts', 'virtual/catch-e.ts', src);
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT']);
  });

  await test('catch (ex) — ex.message to logger -> ERROR_DANGEROUS_PROPERTY (not just err/error)', () => {
    const src = [
      'declare function doSomething(): void;',
      'export function fn() {',
      '  try { doSomething(); } catch (ex) {',
      "    console.error('failed', ex.message);",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/catch-ex.ts', 'virtual/catch-ex.ts', src);
    assert.deepEqual(ruleIdsOf(violations), ['ERROR_DANGEROUS_PROPERTY']);
  });

  await test('nested catch scopes with different binding names are each tracked independently', () => {
    const src = [
      'declare function doSomething(): void;',
      'declare function doSomethingElse(): void;',
      'export function fn() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    try {',
      '      doSomethingElse();',
      '    } catch (ex) {',
      "      console.error('inner failure', ex);",
      '    }',
      "    console.error('outer failure', e);",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/nested-catch.ts', 'virtual/nested-catch.ts', src);
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT', 'RAW_ERROR_OBJECT']);
  });

  await test('shadowing: an unrelated same-named identifier outside the catch scope is not flagged', () => {
    const src = [
      'declare function doSomething(): void;',
      'declare function computeSomethingUnrelated(): string;',
      'export function fn() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      "    console.error('handled', e);",
      '  }',
      '  const e = computeSomethingUnrelated();',
      "  console.error('unrelated', e);",
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/catch-shadow.ts', 'virtual/catch-shadow.ts', src);
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT']);
    assert.equal(violations.length, 1, 'the post-catch-scope `e` must not be flagged');
  });

  section('Safe-wrapper exact allowlist (F3-IMPL-007-R1, review finding 2)');

  await test('a known exact safe helper (safeErrorFields) is still allowed', () => {
    const src = [
      'declare function doSomething(): void;',
      'function safeErrorFields(e: unknown) { return { type: "Error" }; }',
      'export function fn() {',
      '  try { doSomething(); } catch (err) {',
      "    console.error('failed', safeErrorFields(err));",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/known-safe-wrapper.ts', 'virtual/known-safe-wrapper.ts', src);
    assert.equal(violations.length, 0);
  });

  await test('an unknown redactWhatever(err) wrapper is NOT automatically trusted', () => {
    const src = [
      'declare function doSomething(): void;',
      'function redactWhatever(e: unknown) { return String(e); }',
      'export function fn() {',
      '  try { doSomething(); } catch (err) {',
      "    console.error('failed', redactWhatever(err));",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/unknown-redact-wrapper.ts', 'virtual/unknown-redact-wrapper.ts', src);
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT']);
  });

  await test('an unknown summarizeWhatever(err) wrapper is NOT automatically trusted', () => {
    const src = [
      'declare function doSomething(): void;',
      'function summarizeWhatever(e: unknown) { return String(e); }',
      'export function fn() {',
      '  try { doSomething(); } catch (err) {',
      "    console.error('failed', summarizeWhatever(err));",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile(
      '/virtual/unknown-summarize-wrapper.ts',
      'virtual/unknown-summarize-wrapper.ts',
      src,
    );
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT']);
  });

  await test('a deliberately unsafe pass-through helper cannot bypass detection merely via naming', () => {
    const src = [
      'declare function doSomething(): void;',
      'function totallyLegitHelper(e: unknown) { return e; }',
      'export function fn() {',
      '  try { doSomething(); } catch (err) {',
      "    console.error('failed', totallyLegitHelper(err));",
      '  }',
      '}',
      '',
    ].join('\n');
    const { violations } = scanFile('/virtual/unsafe-passthrough.ts', 'virtual/unsafe-passthrough.ts', src);
    assert.deepEqual(ruleIdsOf(violations), ['RAW_ERROR_OBJECT']);
  });

  section('Fingerprint (baseline-drift protection, Step 8)');

  await test('identical (file, rule, line text) always hashes identically', () => {
    const a = computeFingerprint('server/src/routes/x.ts', 'RAW_ERROR_OBJECT', "console.error('x', err);");
    const b = computeFingerprint('server/src/routes/x.ts', 'RAW_ERROR_OBJECT', "console.error('x', err);");
    assert.equal(a, b);
  });

  await test('changing the line text changes the fingerprint (an edit re-surfaces the finding)', () => {
    const a = computeFingerprint('server/src/routes/x.ts', 'RAW_ERROR_OBJECT', "console.error('x', err);");
    const b = computeFingerprint('server/src/routes/x.ts', 'RAW_ERROR_OBJECT', "console.error('y', err);");
    assert.notEqual(a, b);
  });

  await test('fingerprint is a 16-char lowercase hex string', () => {
    const fp = computeFingerprint('a.ts', 'RAW_ERROR_OBJECT', 'x');
    assert.match(fp, /^[0-9a-f]{16}$/);
  });

  section('Baseline exceptions file validation (Step 8, fail-closed)');

  await test('rejects a wildcard file path', () => {
    assert.throws(
      () =>
        validateBaselineEntries([
          {
            file: 'server/src/routes/*.ts',
            line: 1,
            ruleId: 'RAW_ERROR_OBJECT',
            fingerprint: '0123456789abcdef',
            reason: 'attempted wildcard exception',
            addedDate: '2026-08-12',
          },
        ]),
      BaselineConfigError,
    );
  });

  await test('rejects a reason shorter than 15 characters', () => {
    assert.throws(
      () =>
        validateBaselineEntries([
          {
            file: 'server/src/routes/x.ts',
            line: 1,
            ruleId: 'RAW_ERROR_OBJECT',
            fingerprint: '0123456789abcdef',
            reason: 'too short',
            addedDate: '2026-08-12',
          },
        ]),
      BaselineConfigError,
    );
  });

  await test('rejects duplicate fingerprints', () => {
    const entry = {
      file: 'server/src/routes/x.ts',
      line: 1,
      ruleId: 'RAW_ERROR_OBJECT' as const,
      fingerprint: '0123456789abcdef',
      reason: 'duplicate fingerprint test entry, intentionally repeated',
      addedDate: '2026-08-12',
    };
    assert.throws(() => validateBaselineEntries([entry, { ...entry }]), BaselineConfigError);
  });

  await test('rejects an unknown ruleId', () => {
    assert.throws(
      () =>
        validateBaselineEntries([
          {
            file: 'server/src/routes/x.ts',
            line: 1,
            ruleId: 'NOT_A_REAL_RULE',
            fingerprint: '0123456789abcdef',
            reason: 'unknown rule id used deliberately in this test',
            addedDate: '2026-08-12',
          },
        ]),
      BaselineConfigError,
    );
  });

  await test('accepts a well-formed entry', () => {
    const entries = validateBaselineEntries([
      {
        file: 'server/src/routes/x.ts',
        line: 1,
        ruleId: 'RAW_ERROR_OBJECT',
        fingerprint: '0123456789abcdef',
        reason: 'well-formed baseline exception entry for this unit test',
        addedDate: '2026-08-12',
      },
    ]);
    assert.equal(entries.length, 1);
  });

  section('applyBaseline (Step 5/8 semantics)');

  await test('a violation matching a baseline fingerprint is grandfathered, not a new violation', () => {
    const v = {
      ruleId: 'RAW_ERROR_OBJECT' as const,
      file: 'a.ts',
      line: 1,
      column: 1,
      snippet: 'x',
      fingerprint: 'aaaaaaaaaaaaaaaa',
      remediation: 'x',
    };
    const baseline = [
      {
        file: 'a.ts',
        line: 1,
        ruleId: 'RAW_ERROR_OBJECT' as const,
        fingerprint: 'aaaaaaaaaaaaaaaa',
        reason: 'accepted baseline entry for this unit test scenario',
        addedDate: '2026-08-12',
      },
    ];
    const { newViolations, grandfathered, staleExceptions } = applyBaseline([v], baseline);
    assert.equal(newViolations.length, 0);
    assert.equal(grandfathered.length, 1);
    assert.equal(staleExceptions.length, 0);
  });

  await test('a baseline entry whose fingerprint no longer matches anything is reported stale', () => {
    const baseline = [
      {
        file: 'a.ts',
        line: 1,
        ruleId: 'RAW_ERROR_OBJECT' as const,
        fingerprint: 'bbbbbbbbbbbbbbbb',
        reason: 'stale baseline entry for this unit test scenario',
        addedDate: '2026-08-12',
      },
    ];
    const { newViolations, staleExceptions } = applyBaseline([], baseline);
    assert.equal(newViolations.length, 0);
    assert.equal(staleExceptions.length, 1);
  });

  await test('a violation with no matching baseline entry is a new violation (fails the gate)', () => {
    const v = {
      ruleId: 'RAW_ERROR_OBJECT' as const,
      file: 'a.ts',
      line: 1,
      column: 1,
      snippet: 'x',
      fingerprint: 'cccccccccccccccc',
      remediation: 'x',
    };
    const { newViolations } = applyBaseline([v], []);
    assert.equal(newViolations.length, 1);
  });

  section('Real baseline-exceptions.json is well-formed and every entry is exact (no wildcards)');

  await test('config/baseline-exceptions.json parses and validates', () => {
    const raw = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'scripts/log-privacy-guard/config/baseline-exceptions.json'), 'utf8'),
    );
    const entries = validateBaselineEntries(raw);
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.ok(!e.file.includes('*'), `baseline entry must not use a wildcard path: ${e.file}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (readdirSync(join(FIXTURES_DIR, 'unsafe')).length < 6) {
    throw new Error('expected at least 6 unsafe fixtures (Step 6 minimum)');
  }
  if (readdirSync(join(FIXTURES_DIR, 'safe')).length < 6) {
    throw new Error('expected at least 6 safe fixtures (Step 7 minimum)');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
