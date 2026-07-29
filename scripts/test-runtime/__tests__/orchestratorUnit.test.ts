/**
 * Focused unit tests for the disposable-runtime orchestrator's pure logic.
 * No Docker required — these test naming/sanitization, port-JSON parsing,
 * production-endpoint guards, redaction, label generation, stale-TTL
 * selection, cleanup exit-status combination, profile validation, and
 * command-argument construction in isolation.
 *
 * Run: npx tsx scripts/test-runtime/__tests__/orchestratorUnit.test.ts
 */
import {
  generateRunId,
  containerName,
  networkName,
  databaseName,
  dbUsername,
  bucketName,
  generateAccessKeyId,
} from '../lib/naming.js';
import { parsePortBindings } from '../lib/docker.js';
import {
  assertSafeDatabaseUrl,
  assertSafeMinioEndpoint,
  assertNoInheritedOverride,
  isLoopbackHost,
  matchesProductionHostPattern,
  ProductionEndpointGuardError,
} from '../lib/guard.js';
import { redactConnectionUrl, redactSecret, redactEnvForLogging } from '../lib/redact.js';
import { buildLabels, labelArgs, labelFilterArgs } from '../lib/labels.js';
import { isStale, resolveStaleTtlHours, combineOutcome, DEFAULT_STALE_TTL_HOURS } from '../lib/outcome.js';
import { assertValidProfile, InvalidProfileError, isValidInjectFailureMode } from '../lib/profiles.js';

let passed = 0;
let failed = 0;

function section(name: string) {
  console.log(`\n${name}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertThrows(fn: () => void, msg: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${msg}: expected to throw`);
}

// ─── Run ID generation / sanitization ───────────────────────────────────────
section('Run ID generation and name sanitization');

test('generateRunId produces a distinct runId and ISO createdAt on each call', () => {
  const a = generateRunId();
  const b = generateRunId();
  assert(a.runId !== b.runId, 'two calls must not collide');
  assert(!Number.isNaN(Date.parse(a.createdAt)), 'createdAt must be a valid ISO timestamp');
});

test('generateRunId is deterministic given fixed now/pid (for testability)', () => {
  const fixedNow = new Date('2026-07-29T12:00:00.000Z');
  const a = generateRunId(fixedNow, 1234);
  const b = generateRunId(fixedNow, 1234);
  // same now+pid, but random suffix differs -> still must differ (never reused)
  assert(a.runId !== b.runId, 'random suffix must vary even with fixed now/pid');
  assert(a.runId.startsWith('20260729T120000Z-'), `expected timestamp prefix, got ${a.runId}`);
});

test('containerName is lowercase, dash-safe, and bounded to 63 chars', () => {
  const name = containerName('pg', 'postgres', 'ABC-123_weird!!chars');
  assert(/^[a-z0-9-]+$/.test(name), `unexpected characters in ${name}`);
  assert(name.length <= 63, `too long: ${name.length}`);
  assert(name.startsWith('nmtest-pg-postgres-'), `expected prefix, got ${name}`);
});

test('networkName is distinct per scope/runId pair', () => {
  const a = networkName('postgres', 'run-a');
  const b = networkName('storage', 'run-b');
  assert(a !== b, 'different scope/runId must produce different network names');
});

test('databaseName is a valid Postgres-safe identifier (lowercase, underscore, no leading digit, <=63 bytes)', () => {
  const name = databaseName('storage', '20260729T120000Z-deadbeef-999');
  assert(/^[a-z_][a-z0-9_]*$/.test(name), `not a valid identifier: ${name}`);
  assert(name.length <= 63, `too long: ${name.length}`);
});

test('databaseName never starts with a digit even if inputs would otherwise produce one', () => {
  const name = databaseName('9scope', '9runid');
  assert(/^[a-z_]/.test(name), `must not start with a digit: ${name}`);
});

test('dbUsername is sanitized the same way as databaseName', () => {
  const name = dbUsername('storage', 'Run!!ID--123');
  assert(/^[a-z_][a-z0-9_]*$/.test(name), `not a valid identifier: ${name}`);
});

test('bucketName satisfies S3 bucket naming rules (lowercase, hyphen, 3-63 chars, alnum start/end)', () => {
  const name = bucketName('storage', '20260729T120000Z-deadbeef-1');
  assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name), `invalid bucket name: ${name}`);
  assert(name.length >= 3 && name.length <= 63, `length out of range: ${name.length}`);
});

test('bucketName pads short inputs up to the 3-character minimum', () => {
  const name = bucketName('', '');
  assert(name.length >= 3, `bucket name too short: "${name}"`);
});

test('generateAccessKeyId produces a safe, prefixed hex token', () => {
  const key = generateAccessKeyId();
  assert(/^nmtest[a-f0-9]{16}$/.test(key), `unexpected access key shape: ${key}`);
});

// ─── Docker port-binding JSON parsing ───────────────────────────────────────
section('Docker port-binding parsing');

test('parsePortBindings extracts the assigned host port for a matching container port', () => {
  const json = JSON.stringify({ '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] });
  assertEqual(parsePortBindings(json, '5432'), 54321, 'expected parsed host port');
});

test('parsePortBindings throws when the container port has no binding', () => {
  const json = JSON.stringify({ '9000/tcp': [{ HostIp: '127.0.0.1', HostPort: '12345' }] });
  assertThrows(() => parsePortBindings(json, '5432'), 'missing binding must throw');
});

test('parsePortBindings throws on malformed JSON', () => {
  assertThrows(() => parsePortBindings('not-json', '5432'), 'malformed JSON must throw');
});

test('parsePortBindings throws on a non-numeric HostPort', () => {
  const json = JSON.stringify({ '5432/tcp': [{ HostPort: 'abc' }] });
  assertThrows(() => parsePortBindings(json, '5432'), 'non-numeric HostPort must throw');
});

// ─── Production-like endpoint guard ─────────────────────────────────────────
section('Production-endpoint guard');

test('isLoopbackHost accepts 127.0.0.1/localhost/::1, rejects everything else', () => {
  assert(isLoopbackHost('127.0.0.1'), '127.0.0.1 must be loopback');
  assert(isLoopbackHost('localhost'), 'localhost must be loopback');
  assert(!isLoopbackHost('10.0.0.5'), 'a LAN address must not be loopback');
  assert(!isLoopbackHost('noramedi.com'), 'a real hostname must not be loopback');
});

test('matchesProductionHostPattern flags noramedi.com and its subdomains', () => {
  assert(matchesProductionHostPattern('noramedi.com'), 'apex domain must match');
  assert(matchesProductionHostPattern('app.noramedi.com'), 'subdomain must match');
  assert(!matchesProductionHostPattern('example.invalid'), 'unrelated host must not match');
});

test('assertSafeDatabaseUrl accepts a loopback URL whose db name contains the run id', () => {
  assertSafeDatabaseUrl('postgresql://u:p@127.0.0.1:55000/nmtest_postgres_run123?schema=public', { runId: 'run123' });
});

test('assertSafeDatabaseUrl accepts a sanitized (lowercased, dash-to-underscore) db name against the raw mixed-case/dashed runId — regression for the real end-to-end bug where naming.databaseName() sanitizes but the guard compared against the raw runId verbatim', () => {
  const rawRunId = '20260729T074247Z-2e94e263-12636';
  const sanitizedDbName = databaseName('postgres', rawRunId);
  assertSafeDatabaseUrl(`postgresql://u:p@127.0.0.1:55000/${sanitizedDbName}?schema=public`, { runId: rawRunId });
});

test('assertSafeDatabaseUrl rejects a non-loopback host', () => {
  assertThrows(
    () => assertSafeDatabaseUrl('postgresql://u:p@10.0.0.9:5432/nmtest_run123', { runId: 'run123' }),
    'non-loopback host must be rejected',
  );
});

test('assertSafeDatabaseUrl rejects a known production hostname even if syntactically plausible', () => {
  assertThrows(
    () => assertSafeDatabaseUrl('postgresql://u:p@noramedi.com:5432/prod', { runId: 'run123' }),
    'production hostname must be rejected',
  );
});

test('assertSafeDatabaseUrl rejects a database name that does not carry the run identity', () => {
  assertThrows(
    () => assertSafeDatabaseUrl('postgresql://u:p@127.0.0.1:5432/some_other_db', { runId: 'run123' }),
    'db name without run identity must be rejected',
  );
});

test('assertSafeDatabaseUrl rejects a syntactically invalid URL', () => {
  assertThrows(() => assertSafeDatabaseUrl('not-a-url', { runId: 'run123' }), 'invalid URL must be rejected');
});

test('assertSafeMinioEndpoint rejects HTTPS for the local Docker profile', () => {
  assertThrows(() => assertSafeMinioEndpoint('https://127.0.0.1:9000'), 'https must be rejected for local profile');
});

test('assertSafeMinioEndpoint rejects a non-loopback host', () => {
  assertThrows(() => assertSafeMinioEndpoint('http://10.0.0.9:9000'), 'non-loopback MinIO host must be rejected');
});

test('assertSafeMinioEndpoint accepts a loopback http endpoint', () => {
  assertSafeMinioEndpoint('http://127.0.0.1:59000');
});

test('assertNoInheritedOverride rejects a pre-set DATABASE_URL from the invoking environment', () => {
  assertThrows(
    () => assertNoInheritedOverride({ DATABASE_URL: 'postgresql://fake:pass@evil.noramedi.com:5432/prod' } as NodeJS.ProcessEnv),
    'inherited DATABASE_URL must be rejected',
  );
});

test('assertNoInheritedOverride rejects a pre-set MINIO_ENDPOINT', () => {
  assertThrows(
    () => assertNoInheritedOverride({ MINIO_ENDPOINT: 'http://127.0.0.1:9000' } as NodeJS.ProcessEnv),
    'inherited MINIO_ENDPOINT must be rejected',
  );
});

test('assertNoInheritedOverride accepts a clean environment', () => {
  assertNoInheritedOverride({} as NodeJS.ProcessEnv);
});

test('guard errors are instances of ProductionEndpointGuardError', () => {
  try {
    assertSafeMinioEndpoint('https://127.0.0.1:9000');
    throw new Error('expected throw');
  } catch (err) {
    assert(err instanceof ProductionEndpointGuardError, 'must be the typed guard error');
  }
});

// ─── Redaction ───────────────────────────────────────────────────────────────
section('Credential/URL redaction');

test('redactConnectionUrl masks the password but preserves host/path shape', () => {
  const redacted = redactConnectionUrl('postgresql://myuser:supersecret@127.0.0.1:54321/mydb?schema=public');
  assert(!redacted.includes('supersecret'), 'password must never appear');
  assert(redacted.includes('myuser:***@'), 'username should remain, password replaced');
  assert(redacted.includes('127.0.0.1'), 'host should remain for diagnostics');
});

test('redactConnectionUrl handles an invalid URL without throwing', () => {
  assertEqual(redactConnectionUrl('not-a-url'), '[redacted:invalid-url]', 'invalid URL should produce a safe placeholder');
});

test('redactSecret never reveals any character of the input', () => {
  const redacted = redactSecret('topsecretvalue123');
  assert(!redacted.includes('topsecretvalue123'), 'must not leak the secret');
  assertEqual(redacted, '***redacted***', 'exact redacted marker expected');
});

test('redactSecret reports unset values distinctly from redacted ones', () => {
  assertEqual(redactSecret(undefined), '(unset)', 'unset must be distinguishable from redacted');
});

test('redactEnvForLogging redacts DATABASE_URL and *_SECRET/*_PASSWORD/*_KEY-shaped vars, leaves the rest', () => {
  const out = redactEnvForLogging({
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
    MINIO_SECRET_KEY: 'abc123',
    MINIO_ACCESS_KEY: 'keyid',
    NODE_ENV: 'test',
  });
  assert(!out.DATABASE_URL.includes('p@'), 'password must be redacted in the URL');
  assertEqual(out.MINIO_SECRET_KEY, '***redacted***', 'secret key must be redacted');
  assertEqual(out.NODE_ENV, 'test', 'non-secret vars must pass through unchanged');
});

// ─── Label generation ────────────────────────────────────────────────────────
section('Docker label generation');

test('buildLabels includes all required stable label keys', () => {
  const labels = buildLabels({ runId: 'run123', profile: 'postgres', createdAt: '2026-07-29T00:00:00.000Z' });
  assertEqual(labels['com.noramedi.test-runtime'], 'true', 'runtime label');
  assertEqual(labels['com.noramedi.test-run-id'], 'run123', 'run-id label');
  assertEqual(labels['com.noramedi.test-profile'], 'postgres', 'profile label');
  assertEqual(labels['com.noramedi.test-task'], 'F1-003-P2', 'task label default');
});

test('labelArgs produces one --label flag pair per entry', () => {
  const args = labelArgs({ a: '1', b: '2' });
  assertEqual(args.length, 4, 'two entries -> four argv tokens');
  assert(args.includes('--label'), 'must include the --label flag');
  assert(args.includes('a=1'), 'must include the key=value token');
});

test('labelFilterArgs produces docker --filter label=key=value tokens', () => {
  const args = labelFilterArgs({ 'com.noramedi.test-runtime': 'true' });
  assertEqual(JSON.stringify(args), JSON.stringify(['--filter', 'label=com.noramedi.test-runtime=true']), 'exact filter shape expected');
});

// ─── Stale-resource TTL selection ───────────────────────────────────────────
section('Stale-resource TTL');

test('resolveStaleTtlHours falls back to the documented default when unset/invalid', () => {
  assertEqual(resolveStaleTtlHours(undefined), DEFAULT_STALE_TTL_HOURS, 'default on unset');
  assertEqual(resolveStaleTtlHours('not-a-number'), DEFAULT_STALE_TTL_HOURS, 'default on invalid');
  assertEqual(resolveStaleTtlHours('-5'), DEFAULT_STALE_TTL_HOURS, 'default on non-positive');
});

test('resolveStaleTtlHours honors a valid override', () => {
  assertEqual(resolveStaleTtlHours('8'), 8, 'explicit override respected');
});

test('isStale correctly classifies resources older/younger than the TTL', () => {
  const createdAt = '2026-07-29T00:00:00.000Z';
  const nowWithinTtl = Date.parse('2026-07-29T02:00:00.000Z'); // 2h later
  const nowPastTtl = Date.parse('2026-07-29T05:00:00.000Z'); // 5h later
  assertEqual(isStale(createdAt, 4, nowWithinTtl), false, 'younger than TTL is not stale');
  assertEqual(isStale(createdAt, 4, nowPastTtl), true, 'older than TTL is stale');
});

test('isStale treats an unparsable createdAt as not stale (fail closed against accidental mass-removal)', () => {
  assertEqual(isStale('not-a-date', 4, Date.now()), false, 'unparsable timestamp must not be treated as stale');
});

// ─── Cleanup exit-status combination ────────────────────────────────────────
section('Cleanup exit-status combination');

test('successful tests + successful cleanup -> exit 0', () => {
  const outcome = combineOutcome({ ranTests: true, testExitCode: 0 }, { success: true, errors: [] });
  assertEqual(outcome.exitCode, 0, 'clean success must exit 0');
});

test('successful tests + failed cleanup -> non-zero exit (cleanup failure is fail-fatal)', () => {
  const outcome = combineOutcome({ ranTests: true, testExitCode: 0 }, { success: false, errors: ['docker rm failed'] });
  assert(outcome.exitCode !== 0, 'cleanup failure after success must force non-zero exit');
  assert(outcome.reasons.some((r) => r.includes('cleanup failed')), 'cleanup failure must be reported');
});

test('failed tests + successful cleanup -> the original test exit code is preserved', () => {
  const outcome = combineOutcome({ ranTests: true, testExitCode: 7 }, { success: true, errors: [] });
  assertEqual(outcome.exitCode, 7, 'original test exit code must be preserved verbatim');
});

test('failed tests + failed cleanup -> original test failure preserved, cleanup failure separately reported', () => {
  const outcome = combineOutcome({ ranTests: true, testExitCode: 3 }, { success: false, errors: ['network rm failed'] });
  assertEqual(outcome.exitCode, 3, 'original nonzero test exit code must be preserved, not overwritten');
  assert(outcome.reasons.some((r) => r.includes('tests failed')), 'test failure must be reported');
  assert(outcome.reasons.some((r) => r.includes('cleanup failed')), 'cleanup failure must ALSO be reported, not conflated');
});

test('setup failure before tests start -> exit 1 with a reason, regardless of cleanup outcome', () => {
  const outcome = combineOutcome(
    { ranTests: false, testExitCode: null, setupFailureReason: 'migration failed' },
    { success: true, errors: [] },
  );
  assertEqual(outcome.exitCode, 1, 'setup failure must produce a non-zero exit');
  assert(outcome.reasons.some((r) => r.includes('setup failure')), 'setup failure reason must be reported');
});

// ─── Profile validation ──────────────────────────────────────────────────────
section('Profile validation');

test('assertValidProfile accepts every documented profile', () => {
  for (const p of ['postgres', 'storage', 'verify-parallel', 'cleanup-stale']) {
    assertEqual(assertValidProfile(p), p, `profile "${p}" should be accepted`);
  }
});

test('assertValidProfile rejects an unknown profile', () => {
  try {
    assertValidProfile('nonexistent');
    throw new Error('expected throw');
  } catch (err) {
    assert(err instanceof InvalidProfileError, 'must throw the typed InvalidProfileError');
  }
});

test('assertValidProfile rejects an empty/undefined profile', () => {
  assertThrows(() => assertValidProfile(undefined), 'undefined profile must be rejected');
});

test('isValidInjectFailureMode recognizes exactly the documented failure modes', () => {
  for (const mode of ['test', 'migration', 'readiness', 'cleanup']) {
    assert(isValidInjectFailureMode(mode), `"${mode}" should be a recognized failure-injection mode`);
  }
  assert(!isValidInjectFailureMode('bogus'), 'an unrecognized mode must not validate');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'-'.repeat(60)}`);
console.log(`orchestratorUnit: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
