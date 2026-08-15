/**
 * storageGate.test.ts — F4-CI-L4-STORAGE-GATE-001 regression coverage.
 *
 * Docker-free. Proves the Layer 4 storage path can no longer report success
 * without positive evidence that the storage suite actually executed, and
 * that the disposable off-host topology did not weaken production policy.
 *
 * The centrepiece is the MUTATION/NEGATIVE proof section at the bottom: the
 * verbatim summary shape a vacuous run produces is fed to the gate and must
 * be rejected. If someone later re-introduces the fail-open behaviour, that
 * section goes red.
 *
 * Run: npx tsx scripts/test-runtime/__tests__/storageGate.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  evaluateExecutionProof,
  noReceiptProof,
  parseExecutionReceipt,
  storageExecutionProofRequirements,
  STORAGE_MINIMUM_EXECUTED,
  STORAGE_REQUIRED_MEMBER_IDS,
  STORAGE_SUITE_NAME,
  type ExecutionReceipt,
  type ExecutionReceiptEntry,
} from '../lib/executionProof.js';
import {
  validateStorageRunSummary,
  STORAGE_TEST_SCRIPT_NAME,
} from '../lib/storageRunSummary.js';
import {
  combineOutcome,
  EXIT_NO_EXECUTION_PROOF,
  EXIT_ABNORMAL_TERMINATION,
  type ExecutionProofOutcome,
} from '../lib/outcome.js';
import { assertSafeMinioEndpoint, isPrivateIpv4Address, ProductionEndpointGuardError } from '../lib/guard.js';
import { parseContainerNetworkAddress } from '../lib/docker.js';
import { selectReadyMinioEndpoint, type MinioReadinessProbe } from '../lib/minio.js';

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

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
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
/** Asserts that at least one failure message mentions the given fragment. */
function assertFailureMentions(failures: string[], fragment: string, msg: string) {
  if (!failures.some((f) => f.toLowerCase().includes(fragment.toLowerCase()))) {
    throw new Error(`${msg}: no failure mentioned "${fragment}" — got ${JSON.stringify(failures)}`);
  }
}

const RUN_ID = '20260815T140000Z-deadbeef-1234';

function entry(id: string, status: 'passed' | 'failed' = 'passed'): ExecutionReceiptEntry {
  return { id, name: `case ${id}`, status };
}

/** A receipt that satisfies the contract, so each test can mutate one thing. */
function goodReceipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  const entries: ExecutionReceiptEntry[] = [
    ...STORAGE_REQUIRED_MEMBER_IDS.map((id) => entry(id)),
    ...Array.from({ length: Math.max(0, STORAGE_MINIMUM_EXECUTED - STORAGE_REQUIRED_MEMBER_IDS.length) }, (_, i) => ({
      name: `extra case ${i}`,
      status: 'passed' as const,
    })),
  ];
  return {
    suite: STORAGE_SUITE_NAME,
    runId: RUN_ID,
    startedAt: '2026-08-15T14:00:00.000Z',
    finishedAt: '2026-08-15T14:03:00.000Z',
    passed: entries.filter((e) => e.status === 'passed').length,
    failed: entries.filter((e) => e.status === 'failed').length,
    entries,
    ...overrides,
  };
}

function goodSummary(): Record<string, unknown> {
  const receipt = goodReceipt();
  return {
    runId: RUN_ID,
    profile: 'storage',
    containerNames: ['nmtest-pg-storage-x', 'nmtest-minio-storage-x'],
    networkName: 'nmtest-net-storage-x',
    hostPorts: { postgres: 32768, minio: 32769 },
    databaseName: 'nmtest_storage_x',
    migration: { code: 0, step: 'ok' },
    test: { scriptName: STORAGE_TEST_SCRIPT_NAME, code: 0 },
    minio: {
      addressMode: 'container-network',
      endpointHost: '172.18.0.3',
      endpointPort: '9000',
      offHostClassification: true,
    },
    executionProof: {
      required: true,
      satisfied: true,
      executedCount: receipt.entries.length,
      failures: [],
      suite: STORAGE_SUITE_NAME,
      passedCount: receipt.passed,
      failedCount: receipt.failed,
      missingRequiredMemberIds: [],
    },
    cleanup: { success: true, errors: [] },
    outcome: { exitCode: 0, reasons: ['tests passed', 'cleanup succeeded'] },
  };
}

// ─── Execution receipt parsing ───────────────────────────────────────────────
section('Execution receipt parsing (strict, never repairs a bad receipt into a good one)');

test('a well-formed receipt parses', () => {
  const parsed = parseExecutionReceipt(JSON.stringify(goodReceipt()));
  assert(parsed.ok, 'well-formed receipt must parse');
  assertEqual(parsed.receipt.suite, STORAGE_SUITE_NAME, 'suite round-trips');
});

test('non-JSON content is rejected', () => {
  const parsed = parseExecutionReceipt('this is not json');
  assert(!parsed.ok, 'garbage must not parse');
});

test('a JSON array (not an object) is rejected', () => {
  const parsed = parseExecutionReceipt('[]');
  assert(!parsed.ok, 'a JSON array is not a receipt');
});

test('an empty JSON object is rejected rather than defaulted to zero-everything', () => {
  const parsed = parseExecutionReceipt('{}');
  assert(!parsed.ok, '{} must not parse into a receipt');
});

test('a receipt whose counters disagree with its own entries is rejected', () => {
  const receipt = goodReceipt();
  const parsed = parseExecutionReceipt(JSON.stringify({ ...receipt, passed: receipt.passed + 5 }));
  assert(!parsed.ok, 'self-inconsistent counters must be rejected');
});

test('a receipt entry with an unknown status is rejected', () => {
  const receipt = goodReceipt();
  const mutated = { ...receipt, entries: [{ name: 'x', status: 'skipped' }] };
  const parsed = parseExecutionReceipt(JSON.stringify(mutated));
  assert(!parsed.ok, 'an unrecognised status must be rejected, not treated as a pass');
});

// ─── Execution proof evaluation ──────────────────────────────────────────────
section('Execution proof: no-execution can never be satisfied');

test('a complete, matching receipt satisfies the proof', () => {
  const proof = evaluateExecutionProof(goodReceipt(), storageExecutionProofRequirements(RUN_ID));
  assert(proof.satisfied, `expected satisfied proof, got failures: ${proof.failures.join('; ')}`);
  assertEqual(proof.failedCount, 0, 'no failed cases');
});

test('ZERO executed test cases is NOT a pass', () => {
  const receipt = goodReceipt({ entries: [], passed: 0, failed: 0 });
  const proof = evaluateExecutionProof(receipt, storageExecutionProofRequirements(RUN_ID));
  assert(!proof.satisfied, 'an empty receipt must not satisfy the proof');
  assertEqual(proof.executedCount, 0, 'executed count is zero');
  assertFailureMentions(proof.failures, 'zero executed', 'zero-execution must be named explicitly');
});

test('a receipt below the minimum executed count is NOT a pass', () => {
  const entries = STORAGE_REQUIRED_MEMBER_IDS.map((id) => entry(id));
  const receipt = goodReceipt({ entries, passed: entries.length, failed: 0 });
  const proof = evaluateExecutionProof(receipt, storageExecutionProofRequirements(RUN_ID));
  assert(!proof.satisfied, 'a truncated run must not satisfy the proof');
  assertFailureMentions(proof.failures, 'below the required minimum', 'minimum-count failure must be named');
});

test('a receipt from a DIFFERENT run is NOT accepted as this run\'s proof', () => {
  const proof = evaluateExecutionProof(goodReceipt({ runId: 'some-earlier-run' }), storageExecutionProofRequirements(RUN_ID));
  assert(!proof.satisfied, 'a stale receipt must not satisfy the proof');
  assertFailureMentions(proof.failures, 'not this run', 'run-id binding failure must be named');
});

test('a receipt from a different suite is NOT accepted', () => {
  const proof = evaluateExecutionProof(goodReceipt({ suite: 'someOtherSuite' }), storageExecutionProofRequirements(RUN_ID));
  assert(!proof.satisfied, 'a foreign suite receipt must not satisfy the proof');
});

test('any failed test case fails the proof', () => {
  const receipt = goodReceipt();
  const entries = receipt.entries.map((e, i) => (i === 0 ? { ...e, status: 'failed' as const } : e));
  const mutated = goodReceipt({
    entries,
    passed: entries.filter((e) => e.status === 'passed').length,
    failed: entries.filter((e) => e.status === 'failed').length,
  });
  const proof = evaluateExecutionProof(mutated, storageExecutionProofRequirements(RUN_ID));
  assert(!proof.satisfied, 'a failed case must fail the proof');
});

for (const requiredId of STORAGE_REQUIRED_MEMBER_IDS) {
  test(`dropping required member "${requiredId}" fails the proof`, () => {
    const full = goodReceipt();
    const entries = full.entries.filter((e) => e.id !== requiredId);
    const mutated = goodReceipt({
      entries,
      passed: entries.filter((e) => e.status === 'passed').length,
      failed: entries.filter((e) => e.status === 'failed').length,
    });
    const proof = evaluateExecutionProof(mutated, storageExecutionProofRequirements(RUN_ID));
    assert(!proof.satisfied, `omitting ${requiredId} must fail the proof`);
    assert(proof.missingRequiredMemberIds.includes(requiredId), `${requiredId} must be reported as missing`);
  });
}

test('a required member that ran but FAILED counts as missing (executed is not enough — it must pass)', () => {
  const target = STORAGE_REQUIRED_MEMBER_IDS[0];
  const full = goodReceipt();
  const entries = full.entries.map((e) => (e.id === target ? { ...e, status: 'failed' as const } : e));
  const mutated = goodReceipt({
    entries,
    passed: entries.filter((e) => e.status === 'passed').length,
    failed: entries.filter((e) => e.status === 'failed').length,
  });
  const proof = evaluateExecutionProof(mutated, storageExecutionProofRequirements(RUN_ID));
  assert(!proof.satisfied, 'a failed required member must fail the proof');
  assert(proof.missingRequiredMemberIds.includes(target), 'a failed required member counts as missing');
});

test('noReceiptProof is always unsatisfied and reports why', () => {
  const proof = noReceiptProof('no receipt file');
  assertEqual(proof.satisfied, false, 'must be unsatisfied');
  assertEqual(proof.executedCount, 0, 'zero executed');
  assertEqual(proof.failures.length, 1, 'reason is carried');
});

// ─── combineOutcome fail-closed behaviour ────────────────────────────────────
section('Outcome combination: a green test exit code is no longer sufficient');

const cleanOk = { success: true, errors: [] };
const cleanFail = { success: false, errors: ['network "x": still in use'] };

function proofOutcome(over: Partial<ExecutionProofOutcome> = {}): ExecutionProofOutcome {
  return { required: true, satisfied: true, executedCount: 24, failures: [], ...over };
}

test('tests exit 0 + satisfied proof + clean cleanup -> exit 0', () => {
  const outcome = combineOutcome({ ranTests: true, testExitCode: 0 }, cleanOk, proofOutcome());
  assertEqual(outcome.exitCode, 0, 'a fully proven run passes');
});

test('tests exit 0 + UNSATISFIED proof -> non-zero, with the dedicated no-proof code', () => {
  const outcome = combineOutcome(
    { ranTests: true, testExitCode: 0 },
    cleanOk,
    proofOutcome({ satisfied: false, executedCount: 0, failures: ['receipt records zero executed test cases'] }),
  );
  assertEqual(outcome.exitCode, EXIT_NO_EXECUTION_PROOF, 'an unproven run must not pass');
  assertFailureMentions(outcome.reasons, 'execution proof NOT satisfied', 'the reason must say so plainly');
});

test('a real test failure keeps its own exit code even when the proof is also unsatisfied', () => {
  const outcome = combineOutcome(
    { ranTests: true, testExitCode: 3 },
    cleanOk,
    proofOutcome({ satisfied: false, failures: ['receipt records 2 failed test case(s)'] }),
  );
  assertEqual(outcome.exitCode, 3, 'the real test exit code stays primary');
});

test('an unproven run that ALSO failed cleanup still fails, and reports both', () => {
  const outcome = combineOutcome(
    { ranTests: true, testExitCode: 0 },
    cleanFail,
    proofOutcome({ satisfied: false, failures: ['no receipt'] }),
  );
  assert(outcome.exitCode !== 0, 'must not pass');
  assertFailureMentions(outcome.reasons, 'execution proof NOT satisfied', 'proof failure reported');
  assertFailureMentions(outcome.reasons, 'cleanup failed', 'cleanup failure reported separately');
});

test('cleanup outcome is still reported on the proof-failure path (cleanup is never skipped by a failure)', () => {
  const outcome = combineOutcome(
    { ranTests: true, testExitCode: 0 },
    cleanOk,
    proofOutcome({ satisfied: false, failures: ['no receipt'] }),
  );
  assertFailureMentions(outcome.reasons, 'cleanup succeeded', 'cleanup result must still be present');
});

test('setup failure before tests -> still exit 1, proof block does not mask it', () => {
  const outcome = combineOutcome(
    { ranTests: false, testExitCode: null, setupFailureReason: 'Docker is not available' },
    cleanOk,
    proofOutcome({ satisfied: false, executedCount: 0, failures: ['never ran'] }),
  );
  assertEqual(outcome.exitCode, 1, 'setup failure keeps exit 1');
});

test('profiles without a proof contract are unaffected (required:false is informational)', () => {
  const outcome = combineOutcome(
    { ranTests: true, testExitCode: 0 },
    cleanOk,
    { required: false, satisfied: false, executedCount: 0, failures: ['n/a'] },
  );
  assertEqual(outcome.exitCode, 0, 'postgres profiles keep their existing behaviour');
});

test('combineOutcome with no proof argument at all keeps the pre-existing contract', () => {
  assertEqual(combineOutcome({ ranTests: true, testExitCode: 0 }, cleanOk).exitCode, 0, 'back-compatible');
});

// ─── Summary gate ────────────────────────────────────────────────────────────
section('CI summary gate: missing/invalid/vacuous summaries fail closed');

test('a complete, honest summary passes the gate', () => {
  const result = validateStorageRunSummary(goodSummary(), { requireOffHostShapedDestination: true });
  assert(result.valid, `expected valid, got: ${result.failures.join('; ')}`);
});

test('a non-object summary fails', () => {
  assertEqual(validateStorageRunSummary(null).valid, false, 'null is not a summary');
  assertEqual(validateStorageRunSummary('{}').valid, false, 'a string is not a summary');
  assertEqual(validateStorageRunSummary([]).valid, false, 'an array is not a summary');
});

test('a summary with test:null (the command never ran) fails', () => {
  const result = validateStorageRunSummary({ ...goodSummary(), test: null });
  assert(!result.valid, 'test:null must fail');
  assertFailureMentions(result.failures, 'never invoked', 'the reason must name the un-invoked command');
});

test('a summary with migration:null fails', () => {
  const result = validateStorageRunSummary({ ...goodSummary(), migration: null });
  assert(!result.valid, 'migration:null must fail');
});

test('a summary with no executionProof block at all fails', () => {
  const summary = goodSummary();
  delete summary.executionProof;
  const result = validateStorageRunSummary(summary);
  assert(!result.valid, 'a summary with no proof block must fail');
  assertFailureMentions(result.failures, 'executionProof is missing', 'must name the missing proof');
});

test('a summary whose executionProof.executedCount is 0 fails', () => {
  const summary = goodSummary();
  summary.executionProof = { ...(summary.executionProof as object), executedCount: 0 };
  const result = validateStorageRunSummary(summary);
  assert(!result.valid, 'zero executed must fail');
});

test('a summary whose executionProof.satisfied is false fails', () => {
  const summary = goodSummary();
  summary.executionProof = { ...(summary.executionProof as object), satisfied: false, failures: ['no receipt'] };
  assertEqual(validateStorageRunSummary(summary).valid, false, 'unsatisfied proof must fail');
});

test('a summary whose executionProof.required is false fails (the storage profile must always demand proof)', () => {
  const summary = goodSummary();
  summary.executionProof = { ...(summary.executionProof as object), required: false };
  assertEqual(validateStorageRunSummary(summary).valid, false, 'proof must be mandatory for storage');
});

test('a summary reporting missing required members fails', () => {
  const summary = goodSummary();
  summary.executionProof = { ...(summary.executionProof as object), missingRequiredMemberIds: ['s3-independent-read-back'] };
  const result = validateStorageRunSummary(summary);
  assert(!result.valid, 'missing members must fail');
  assertFailureMentions(result.failures, 's3-independent-read-back', 'the missing member must be named');
});

test('a summary with a non-zero outcome exit code fails', () => {
  const summary = goodSummary();
  summary.outcome = { exitCode: 1, reasons: ['tests failed with exit code 1'] };
  assertEqual(validateStorageRunSummary(summary).valid, false, 'non-zero outcome must fail');
});

test('a summary for the wrong test script fails', () => {
  const summary = goodSummary();
  summary.test = { scriptName: 'server:test:disposable-db', code: 0 };
  assertEqual(validateStorageRunSummary(summary).valid, false, 'wrong script must fail');
});

test('a summary with a failed cleanup fails', () => {
  const summary = goodSummary();
  summary.cleanup = { success: false, errors: ['network "x": still in use'] };
  assertEqual(validateStorageRunSummary(summary).valid, false, 'cleanup failure must fail the gate');
});

test('a summary with no minio block fails (the destination topology must be recorded)', () => {
  const summary = goodSummary();
  delete summary.minio;
  assertEqual(validateStorageRunSummary(summary).valid, false, 'missing minio block must fail');
});

test('loopback-fallback fails the gate only where the off-host-shaped destination is required', () => {
  const summary = goodSummary();
  summary.minio = {
    addressMode: 'loopback-fallback',
    endpointHost: '127.0.0.1',
    endpointPort: '32769',
    offHostClassification: false,
  };
  assertEqual(
    validateStorageRunSummary(summary, { requireOffHostShapedDestination: true }).valid,
    false,
    'on Linux CI a silent downgrade to loopback is a coverage regression',
  );
  assertEqual(
    validateStorageRunSummary(summary, { requireOffHostShapedDestination: false }).valid,
    true,
    'on a platform without routable container networks the loopback fallback is legitimate',
  );
});

test('a summary claiming off-host while running on loopback is rejected as self-contradictory', () => {
  const summary = goodSummary();
  summary.minio = {
    addressMode: 'loopback-fallback',
    endpointHost: '127.0.0.1',
    endpointPort: '32769',
    offHostClassification: true,
  };
  const result = validateStorageRunSummary(summary);
  assert(!result.valid, 'topology and classification must agree');
  assertFailureMentions(result.failures, 'disagree', 'the contradiction must be named');
});

// ─── MUTATION / NEGATIVE PROOF ───────────────────────────────────────────────
section('MUTATION PROOF: the exact vacuous-green run this task exists to stop');

/**
 * The Layer 4 job on PR #423 (run 31888544850, job 95022748802) exited 0 in
 * 9.8s having emitted zero bytes of output and provisioned nothing. Before
 * this task, `storage-run-summary.json` was only validated `if: failure()`,
 * so nothing ever looked. This is the shape such a run can at best produce —
 * every field the OLD code populated, and nothing the new gate demands.
 */
const VACUOUS_SUMMARY_PRE_FIX = {
  runId: '20260815T141021Z-aaaaaaaa-2222',
  profile: 'storage',
  containerNames: [],
  networkName: '(none)',
  hostPorts: {},
  databaseName: 'nmtest_storage_20260815t141021z_aaaaaaaa_2222',
  migration: null,
  test: null,
  cleanup: { success: true, errors: [] },
  outcome: { exitCode: 0, reasons: ['tests passed', 'cleanup succeeded'] },
};

test('the vacuous pre-fix summary shape is REJECTED by the gate', () => {
  const result = validateStorageRunSummary(VACUOUS_SUMMARY_PRE_FIX, { requireOffHostShapedDestination: true });
  assert(!result.valid, 'a run that provisioned nothing and executed nothing must never pass the gate');
  assertFailureMentions(result.failures, 'never invoked', 'must call out the un-invoked test command');
  assertFailureMentions(result.failures, 'executionProof is missing', 'must call out the absent execution proof');
  assertFailureMentions(result.failures, 'migration is missing', 'must call out that migrations never ran');
});

test('a run with NO summary file at all cannot pass: the gate treats absence as failure', () => {
  // The CLI models "no file" as a read error; the validator models "no data".
  assertEqual(validateStorageRunSummary(undefined).valid, false, 'undefined summary must fail');
});

test('faking outcome.exitCode=0 on an otherwise-empty summary is not enough to pass', () => {
  const forged = { profile: 'storage', runId: 'x', outcome: { exitCode: 0, reasons: [] } };
  const result = validateStorageRunSummary(forged);
  assert(!result.valid, 'a green exit code with no evidence behind it must be rejected');
  assert(result.failures.length >= 3, `expected several independent findings, got ${result.failures.length}`);
});

test('the orchestrator source keeps teardown OUTSIDE the try/catch, so cleanup still runs on any failure', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Line endings are normalised so this holds under either checkout style.
  const source = readFileSync(join(here, '..', 'orchestrator.ts'), 'utf8').replace(/\r\n/g, '\n');

  const catchIndex = source.indexOf('  } catch (err) {\n    if (!testPhase.ranTests) {');
  const teardownIndex = source.indexOf('  const cleanupResult = await teardown(cleanupTargets);');
  const proofIndex = source.indexOf('    executionProof = collectExecutionProof(receiptPath, runId);');

  assert(catchIndex > 0, 'anchor: the run-body catch block was not found in orchestrator.ts');
  assert(teardownIndex > 0, 'anchor: the unconditional teardown call was not found in orchestrator.ts');
  assert(proofIndex > 0, 'anchor: the execution-proof collection call was not found in orchestrator.ts');

  assert(teardownIndex > catchIndex, 'teardown must run after the catch block, i.e. on the failure path too');
  assert(proofIndex > catchIndex, 'proof collection must run after the catch block');
  assert(
    proofIndex < teardownIndex,
    'the receipt must be read before teardown removes its temp dir, otherwise a passing run would look unproven',
  );
});

test('every required member id is actually tagged on a case in the storage suite (the contract cannot drift silently)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const suitePath = join(here, '..', '..', '..', 'server', 'src', 'tests', 'dbVerification', 'fileBackupDbIntegration.test.ts');
  const suite = readFileSync(suitePath, 'utf8').replace(/\r\n/g, '\n');

  // The suite tags a case by passing its id as `test()`'s third argument:
  //   await test('name', async () => { ... }, 'the-id');
  const taggedIds = new Set([...suite.matchAll(/\}, '([a-z0-9-]+)'\);/g)].map((m) => m[1]));
  assert(taggedIds.size > 0, 'anchor: no tagged test ids were found in the storage suite');

  const untagged = STORAGE_REQUIRED_MEMBER_IDS.filter((id) => !taggedIds.has(id));
  assertEqual(
    untagged.join(', '),
    '',
    'every id in STORAGE_REQUIRED_MEMBER_IDS must be tagged on a real case, otherwise the gate demands a member that can never be produced and Layer 4 is permanently red',
  );

  assert(
    STORAGE_REQUIRED_MEMBER_IDS.length <= STORAGE_MINIMUM_EXECUTED,
    'the executed-count floor must be at least as large as the number of required members',
  );
});

test('the abnormal-termination trap is wired to a process exit handler with a distinct code', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', 'orchestrator.ts'), 'utf8');
  assert(source.includes("process.on('exit', (code) => {"), 'an exit handler must exist');
  assert(
    source.includes('process.exitCode = EXIT_ABNORMAL_TERMINATION;'),
    'the exit handler must force the abnormal-termination code',
  );
  assert(source.includes('runCompleted = true;'), 'a completion sentinel must be set on the normal path');
  assertEqual(EXIT_ABNORMAL_TERMINATION, 91, 'the abnormal-termination code is part of the documented contract');
});

// ─── Lane C: guard + topology ────────────────────────────────────────────────
section('Disposable off-host topology: tight identity check, no production relaxation');

test('isPrivateIpv4Address recognises exactly RFC1918 space', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '172.18.0.3']) {
    assertEqual(isPrivateIpv4Address(ip), true, `${ip} is private`);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '11.0.0.1', 'not-an-ip', '999.1.1.1']) {
    assertEqual(isPrivateIpv4Address(ip), false, `${ip} is not private RFC1918 space`);
  }
});

test('assertSafeMinioEndpoint still accepts loopback with no allow-list at all', () => {
  assertSafeMinioEndpoint('http://127.0.0.1:32769');
  assertSafeMinioEndpoint('http://localhost:32769');
});

test('assertSafeMinioEndpoint accepts this run\'s own container address', () => {
  assertSafeMinioEndpoint('http://172.18.0.3:9000', { allowedContainerAddresses: ['172.18.0.3'] });
});

test('assertSafeMinioEndpoint REJECTS a non-loopback address that is not this run\'s container', () => {
  assertThrows(
    () => assertSafeMinioEndpoint('http://172.18.0.4:9000', { allowedContainerAddresses: ['172.18.0.3'] }),
    'a neighbouring container address must not be reachable through the guard',
  );
  assertThrows(
    () => assertSafeMinioEndpoint('http://10.0.0.5:9000'),
    'a private address with no allow-list must be rejected',
  );
  assertThrows(
    () => assertSafeMinioEndpoint('http://198.51.100.7:9000', { allowedContainerAddresses: ['198.51.100.7'] }),
    'a PUBLIC address must be rejected even if it is somehow in the allow-list',
  );
});

test('assertSafeMinioEndpoint still rejects HTTPS and production hostnames under the new option', () => {
  assertThrows(
    () => assertSafeMinioEndpoint('https://127.0.0.1:9000', { allowedContainerAddresses: ['172.18.0.3'] }),
    'https must stay rejected',
  );
  assertThrows(
    () => assertSafeMinioEndpoint('http://backups.noramedi.com:9000', { allowedContainerAddresses: ['172.18.0.3'] }),
    'production hostnames must stay rejected',
  );
  assertThrows(() => assertSafeMinioEndpoint('not-a-url'), 'unparseable endpoints must stay rejected');
});

test('guard errors are still ProductionEndpointGuardError instances', () => {
  try {
    assertSafeMinioEndpoint('http://172.18.0.4:9000', { allowedContainerAddresses: ['172.18.0.3'] });
    throw new Error('expected a throw');
  } catch (err) {
    assert(err instanceof ProductionEndpointGuardError, 'guard rejections keep their dedicated error type');
  }
});

test('parseContainerNetworkAddress extracts the container IP on the named network', () => {
  const json = JSON.stringify({
    'nmtest-net-storage-x': { IPAddress: '172.18.0.3' },
    bridge: { IPAddress: '172.17.0.2' },
  });
  assertEqual(parseContainerNetworkAddress(json, 'nmtest-net-storage-x'), '172.18.0.3', 'named network wins');
  assertEqual(parseContainerNetworkAddress(json, 'other-net'), null, 'an unattached network yields null');
  assertEqual(parseContainerNetworkAddress('not json', 'x'), null, 'garbage yields null, never a throw');
  assertEqual(
    parseContainerNetworkAddress(JSON.stringify({ n: { IPAddress: '' } }), 'n'),
    null,
    'an empty address yields null',
  );
});

await testAsync('selectReadyMinioEndpoint prefers the container-network candidate when it answers', async () => {
  const probe: MinioReadinessProbe = async (endpoint) => ({ ready: endpoint.includes('172.18.0.3'), detail: 'x' });
  const selected = await selectReadyMinioEndpoint({
    candidates: [
      { endpoint: 'http://172.18.0.3:9000', mode: 'container-network' },
      { endpoint: 'http://127.0.0.1:32769', mode: 'loopback-fallback' },
    ],
    probe,
    timeoutMs: 100,
    pollIntervalMs: 1,
  });
  assertEqual(selected.mode, 'container-network', 'the off-host-shaped candidate wins when reachable');
});

await testAsync('selectReadyMinioEndpoint falls back to loopback when the container network is not routable', async () => {
  const probe: MinioReadinessProbe = async (endpoint) => ({ ready: endpoint.includes('127.0.0.1'), detail: 'x' });
  const selected = await selectReadyMinioEndpoint({
    candidates: [
      { endpoint: 'http://172.18.0.3:9000', mode: 'container-network' },
      { endpoint: 'http://127.0.0.1:32769', mode: 'loopback-fallback' },
    ],
    probe,
    timeoutMs: 100,
    pollIntervalMs: 1,
  });
  assertEqual(selected.mode, 'loopback-fallback', 'the honest fallback is used, not a pretend off-host claim');
});

await testAsync('selectReadyMinioEndpoint throws when nothing becomes ready (never returns a maybe)', async () => {
  const probe: MinioReadinessProbe = async () => ({ ready: false, detail: 'ECONNREFUSED' });
  let threw = false;
  try {
    await selectReadyMinioEndpoint({
      candidates: [{ endpoint: 'http://127.0.0.1:1', mode: 'loopback-fallback' }],
      probe,
      timeoutMs: 5,
      pollIntervalMs: 1,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'an unreachable destination is a hard setup failure');
});

console.log(`\n${'-'.repeat(60)}`);
console.log(`storageGate: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
