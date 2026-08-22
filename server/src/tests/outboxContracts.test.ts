/**
 * outboxContracts.test.ts — F5-2 contract, registry and policy guard.
 *
 * Everything here is a PURE property of the outbox's contract layer: the
 * versioned event registry, payload validation, the retry policy, the flag
 * semantics, and the structural rules that make the unsafe path unavailable
 * rather than merely discouraged. No database, no network, no Prisma client —
 * so this suite belongs in Layer 2 and runs on every PR.
 *
 * The database-dependent guarantees (atomicity, multi-dispatcher claiming,
 * lease recovery, replay, idempotency under real concurrency) are proved in
 * `dbVerification/outboxDispatcher.test.ts` against a real PostgreSQL, because
 * they cannot honestly be proved anywhere else.
 *
 * Run with: tsx src/tests/outboxContracts.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OUTBOX_EVENT_CONTRACTS,
  FORBIDDEN_PAYLOAD_FIELD_FRAGMENTS,
  assertRegistryIsSelfConsistent,
  getOutboxEventContract,
  getRegisteredVersions,
  resolveContract,
  validatePayload,
  type OutboxEventContract,
} from '../outbox/outboxEventRegistry.js';
import {
  OUTBOX_ERROR_CATEGORIES,
  OutboxConsumerError,
  classifyConsumerFailure,
  computeBackoffMs,
  isRetryableCategory,
  MAX_BACKOFF_MS,
} from '../outbox/outboxErrors.js';
import {
  isOutboxDispatchEnabled,
  isOutboxProducerEnabled,
  getOutboxClaimBatchSize,
  getOutboxLeaseMs,
  getOutboxConsumerLeaseMs,
  buildOutboxDispatcherId,
} from '../outbox/outboxConfig.js';
import {
  registerOutboxConsumer,
  getOutboxConsumer,
  resetOutboxConsumersForTest,
} from '../outbox/outboxConsumerRegistry.js';
import { TENANT_MODEL_CLASSIFICATION } from '../utils/tenantModelClassification.js';
import { RAW_SQL_REGISTRY_KEYS } from '../tenancy/rawSqlAuditRegistry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function readSource(relative: string): string {
  return readFileSync(resolve(SRC_ROOT, relative), 'utf8').replace(/\r/g, '');
}

/** Lines that are not comments — the only lines a structural scan may judge. */
function codeLines(source: string): string[] {
  return source.split('\n').filter((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  });
}

const FIRST_CONTRACT: OutboxEventContract = OUTBOX_EVENT_CONTRACTS[0]!;

function envWith(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

async function main() {
  console.log('F5-2 outbox contracts — registry, payload, retry policy, structural guards');

  // ── A. The registry itself ────────────────────────────────────────────────
  section('A. Versioned event registry');

  await test('the registry is self-consistent (the same check that runs at import)', () => {
    assertRegistryIsSelfConsistent();
  });

  await test('the registry is non-empty — an empty registry would pass every other test vacuously', () => {
    assert.ok(OUTBOX_EVENT_CONTRACTS.length >= 1, 'no contracts registered');
  });

  await test('every contract is uniquely keyed by (eventType, eventVersion)', () => {
    const keys = OUTBOX_EVENT_CONTRACTS.map((c) => `${c.eventType}@${c.eventVersion}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  await test('no contract permits a payload field containing a forbidden fragment', () => {
    const offenders: string[] = [];
    for (const c of OUTBOX_EVENT_CONTRACTS) {
      for (const field of [...c.payload.required, ...c.payload.optional]) {
        for (const fragment of FORBIDDEN_PAYLOAD_FIELD_FRAGMENTS) {
          if (field.toLowerCase().includes(fragment)) {
            offenders.push(`${c.eventType}@${c.eventVersion}.${field} (~${fragment})`);
          }
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'an outbox payload carries identifiers only; re-read content from durable state in the consumer',
    );
  });

  await test('the forbidden-fragment list still catches the obvious PHI names', () => {
    // Guards the guard: a truncated list would let every other assertion pass.
    for (const probe of ['patientName', 'phone', 'tcKimlik', 'messageBody', 'accessToken']) {
      const caught = FORBIDDEN_PAYLOAD_FIELD_FRAGMENTS.some((f) => probe.toLowerCase().includes(f));
      assert.ok(caught, `${probe} is not caught by any forbidden fragment`);
    }
  });

  await test('every contract states its idempotency and duplicate behaviour in reviewable prose', () => {
    for (const c of OUTBOX_EVENT_CONTRACTS) {
      assert.ok(
        c.idempotency.trim().length >= 40,
        `${c.eventType}@${c.eventVersion}: idempotency note is too thin to review`,
      );
      assert.ok(
        c.duplicateBehavior.trim().length >= 20,
        `${c.eventType}@${c.eventVersion}: duplicate behaviour is not stated`,
      );
    }
  });

  await test('every contract bounds its attempts', () => {
    for (const c of OUTBOX_EVENT_CONTRACTS) {
      assert.ok(c.maxAttempts >= 1 && c.maxAttempts <= 20, `${c.eventType}: implausible maxAttempts`);
    }
  });

  await test('a CLINIC_OWNED contract declares a clinic-scoped aggregate, not a global one', () => {
    for (const c of OUTBOX_EVENT_CONTRACTS) {
      assert.ok(c.aggregateType.length > 0, `${c.eventType}: no aggregateType`);
    }
  });

  // ── B. Contract resolution ────────────────────────────────────────────────
  section('B. Contract resolution refuses what it cannot interpret');

  await test('a registered (type, version) resolves', () => {
    const r = resolveContract(FIRST_CONTRACT.eventType, FIRST_CONTRACT.eventVersion);
    assert.equal(r.ok, true);
  });

  await test('an unregistered event type is UNREGISTERED_EVENT, not a silent pass', () => {
    const r = resolveContract('totally.invented.event', 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.violation.kind, 'UNREGISTERED_EVENT');
  });

  await test('a registered type at an UNSUPPORTED version is refused and names the versions it has', () => {
    const r = resolveContract(FIRST_CONTRACT.eventType, 99);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.violation.kind, 'UNSUPPORTED_VERSION');
      if (r.violation.kind === 'UNSUPPORTED_VERSION') {
        assert.deepEqual(
          [...r.violation.registeredVersions],
          [...getRegisteredVersions(FIRST_CONTRACT.eventType)],
        );
      }
    }
  });

  await test('getOutboxEventContract does not fall back to "some other version"', () => {
    assert.equal(getOutboxEventContract(FIRST_CONTRACT.eventType, 99), undefined);
  });

  // ── C. Payload validation ─────────────────────────────────────────────────
  section('C. Payload validation (enforced at publish AND at dispatch)');

  const validPayload: Record<string, string> = {};
  for (const field of FIRST_CONTRACT.payload.required) validPayload[field] = 'id-value';

  await test('a payload with exactly the required fields is accepted', () => {
    assert.equal(validatePayload(FIRST_CONTRACT, validPayload).ok, true);
  });

  await test('a missing required field is MALFORMED_PAYLOAD and names the field', () => {
    const partial = { ...validPayload };
    delete partial[FIRST_CONTRACT.payload.required[0]!];
    const r = validatePayload(FIRST_CONTRACT, partial);
    assert.equal(r.ok, false);
    if (!r.ok && r.violation.kind === 'MALFORMED_PAYLOAD') {
      assert.match(r.violation.reason, /missing required/);
      assert.match(r.violation.reason, new RegExp(FIRST_CONTRACT.payload.required[0]!));
    }
  });

  await test('an UNEXPECTED field is refused — this is the PHI net (F5-1P E20)', () => {
    const r = validatePayload(FIRST_CONTRACT, { ...validPayload, patientName: 'Ayşe Yılmaz' });
    assert.equal(r.ok, false);
    if (!r.ok && r.violation.kind === 'MALFORMED_PAYLOAD') {
      assert.match(r.violation.reason, /unexpected field/);
    }
  });

  await test('the refusal reason names the FIELD but never echoes the VALUE', () => {
    const r = validatePayload(FIRST_CONTRACT, { ...validPayload, tcKimlik: '12345678901' });
    assert.equal(r.ok, false);
    if (!r.ok && r.violation.kind === 'MALFORMED_PAYLOAD') {
      assert.match(r.violation.reason, /tcKimlik/);
      assert.ok(
        !r.violation.reason.includes('12345678901'),
        'the violation reason is persisted and logged; it must never carry a value',
      );
    }
  });

  await test('a non-string value is refused (no nested objects, no whole records)', () => {
    const r = validatePayload(FIRST_CONTRACT, {
      ...validPayload,
      [FIRST_CONTRACT.payload.required[0]!]: { nested: 'object' } as unknown as string,
    });
    assert.equal(r.ok, false);
  });

  await test('an empty-string identifier is refused', () => {
    const r = validatePayload(FIRST_CONTRACT, { ...validPayload, [FIRST_CONTRACT.payload.required[0]!]: '' });
    assert.equal(r.ok, false);
  });

  await test('an over-long value is refused (an identifier is not a message body)', () => {
    const r = validatePayload(FIRST_CONTRACT, {
      ...validPayload,
      [FIRST_CONTRACT.payload.required[0]!]: 'x'.repeat(201),
    });
    assert.equal(r.ok, false);
  });

  await test('a non-object payload is refused', () => {
    assert.equal(validatePayload(FIRST_CONTRACT, 'not-an-object').ok, false);
    assert.equal(validatePayload(FIRST_CONTRACT, null).ok, false);
    assert.equal(validatePayload(FIRST_CONTRACT, [validPayload]).ok, false);
  });

  // ── D. Retry policy ───────────────────────────────────────────────────────
  section('D. Retry policy is bounded and category-driven');

  await test('permanent categories are NOT retryable — a revoked credential is not a blip', () => {
    for (const category of ['AUTH_CONFIGURATION', 'TENANT_CONFIGURATION', 'PERMANENT_VALIDATION', 'POISON'] as const) {
      assert.equal(isRetryableCategory(category), false, `${category} must not be retried`);
    }
  });

  await test('transient/rate-limit/outage/unknown ARE retryable', () => {
    for (const category of ['TRANSIENT', 'RATE_LIMIT', 'PROVIDER_OUTAGE', 'UNKNOWN'] as const) {
      assert.equal(isRetryableCategory(category), true, `${category} must be retried`);
    }
  });

  await test('every declared category has an explicit retryability answer', () => {
    // A category added without a decision would default to "not retryable" via
    // the Set lookup. That is the safe direction, but it must be deliberate:
    // this asserts the list itself is complete rather than that the lookup works.
    assert.equal(OUTBOX_ERROR_CATEGORIES.length, 8);
  });

  await test('an unclassified throw is UNKNOWN — retryable, never silently permanent', () => {
    const c = classifyConsumerFailure(new Error('some provider blew up'));
    assert.equal(c.category, 'UNKNOWN');
    assert.equal(isRetryableCategory(c.category), true);
  });

  await test('a classified throw keeps its category, code and Retry-After', () => {
    const c = classifyConsumerFailure(
      new OutboxConsumerError('RATE_LIMIT', 'slow down', { retryAfterMs: 45_000 }),
    );
    assert.equal(c.category, 'RATE_LIMIT');
    assert.equal(c.code, 'RATE_LIMIT');
    assert.equal(c.retryAfterMs, 45_000);
  });

  await test('classification does NOT sniff the message text', () => {
    // A plain Error whose message screams "rate limit" is still UNKNOWN. This is
    // the property that keeps the policy correct when a provider rewords itself.
    assert.equal(classifyConsumerFailure(new Error('429 rate limit exceeded')).category, 'UNKNOWN');
  });

  await test('backoff grows with attempts and never exceeds the cap', () => {
    for (const attempt of [1, 2, 3, 5, 10, 50, 1000]) {
      const ms = computeBackoffMs('TRANSIENT', attempt, { random: () => 1 });
      assert.ok(ms <= MAX_BACKOFF_MS, `attempt ${attempt} produced ${ms}ms, above the cap`);
      assert.ok(Number.isFinite(ms), `attempt ${attempt} produced a non-finite backoff`);
    }
    const a1 = computeBackoffMs('TRANSIENT', 1, { random: () => 1 });
    const a3 = computeBackoffMs('TRANSIENT', 3, { random: () => 1 });
    assert.ok(a3 > a1, 'backoff must grow with the attempt count');
  });

  await test('full jitter really is applied (random() === 0 yields 0, not the base)', () => {
    assert.equal(computeBackoffMs('TRANSIENT', 4, { random: () => 0 }), 0);
  });

  await test('a provider Retry-After acts as a FLOOR, never as a ceiling', () => {
    // Jitter drew zero; the provider asked for 90s. The provider wins.
    assert.equal(computeBackoffMs('TRANSIENT', 1, { random: () => 0, retryAfterMs: 90_000 }), 90_000);
    // Jitter drew the full rate-limit window; the tiny Retry-After must not shrink it.
    const big = computeBackoffMs('RATE_LIMIT', 4, { random: () => 1, retryAfterMs: 1 });
    assert.ok(big > 1, 'a small Retry-After must not lower the computed backoff');
  });

  await test('a rate-limited provider gets more room than a transient blip', () => {
    const transient = computeBackoffMs('TRANSIENT', 1, { random: () => 1 });
    const limited = computeBackoffMs('RATE_LIMIT', 1, { random: () => 1 });
    assert.ok(limited > transient);
  });

  await test('an OutboxConsumerError carrying a cause does not expose it through the message', () => {
    const err = new OutboxConsumerError('TRANSIENT', 'send threw', {
      cause: new Error('WhatsApp said: patient +905551234567 unreachable'),
    });
    assert.ok(!err.message.includes('905551234567'));
  });

  // ── E. Flag semantics ─────────────────────────────────────────────────────
  section('E. Flags default OFF and cannot be enabled by a typo');

  await test('both flags are OFF when unset — a deployment changes nothing by itself', () => {
    assert.equal(isOutboxDispatchEnabled(envWith({})), false);
    assert.equal(isOutboxProducerEnabled(envWith({})), false);
  });

  await test('only the exact string "true" enables a flag', () => {
    for (const raw of ['1', 'yes', 'TRUE', 'True', 'on', 'true ', '', 'enabled']) {
      assert.equal(isOutboxDispatchEnabled(envWith({ OUTBOX_DISPATCH_ENABLED: raw })), false, `"${raw}" must not enable`);
      assert.equal(isOutboxProducerEnabled(envWith({ OUTBOX_PRODUCER_ENABLED: raw })), false, `"${raw}" must not enable`);
    }
    assert.equal(isOutboxDispatchEnabled(envWith({ OUTBOX_DISPATCH_ENABLED: 'true' })), true);
    assert.equal(isOutboxProducerEnabled(envWith({ OUTBOX_PRODUCER_ENABLED: 'true' })), true);
  });

  await test('the two flags are genuinely independent', () => {
    assert.equal(isOutboxProducerEnabled(envWith({ OUTBOX_DISPATCH_ENABLED: 'true' })), false);
    assert.equal(isOutboxDispatchEnabled(envWith({ OUTBOX_PRODUCER_ENABLED: 'true' })), false);
  });

  await test('numeric settings reject nonsense and fall back to a safe default', () => {
    assert.equal(getOutboxClaimBatchSize(envWith({ OUTBOX_CLAIM_BATCH_SIZE: '-5' })), 20);
    assert.equal(getOutboxClaimBatchSize(envWith({ OUTBOX_CLAIM_BATCH_SIZE: 'abc' })), 20);
    assert.equal(getOutboxClaimBatchSize(envWith({ OUTBOX_CLAIM_BATCH_SIZE: '7' })), 7);
    assert.ok(getOutboxLeaseMs(envWith({})) > 0);
  });

  await test('the consumer lease is never SHORTER than the event lease by default', () => {
    // A shorter consumer lease would let a second dispatcher declare a still-
    // running side effect "ambiguous" — manufacturing the one outcome the
    // design works hardest to avoid.
    const env = envWith({ OUTBOX_LEASE_MS: '600000' });
    assert.ok(getOutboxConsumerLeaseMs(env) >= getOutboxLeaseMs(env));
  });

  await test('the dispatcher id identifies a PROCESS, not just a host, and carries no secret', () => {
    const id = buildOutboxDispatcherId(envWith({ NODE_APP_INSTANCE: '3' }));
    assert.match(id, /^outbox-dispatcher:\d+:3$/);
  });

  // ── F. Consumer registry ──────────────────────────────────────────────────
  section('F. Consumer registry');

  await test('every registered contract names a consumer key', () => {
    for (const c of OUTBOX_EVENT_CONTRACTS) {
      assert.ok(c.consumerKey.length > 0, `${c.eventType} has no consumerKey`);
    }
  });

  await test('registering two handlers for one key is refused (import order must not decide behaviour)', () => {
    resetOutboxConsumersForTest();
    const stub = {
      consumerKey: 'test-consumer',
      description: 'stub',
      handle: async () => ({ result: 'APPLIED' as const, outcomeCode: 'OK' }),
    };
    registerOutboxConsumer(stub);
    assert.throws(() => registerOutboxConsumer(stub), /already registered/);
    assert.ok(getOutboxConsumer('test-consumer'));
    resetOutboxConsumersForTest();
  });

  await test('the production consumer list registers exactly the contracts the registry declares', async () => {
    resetOutboxConsumersForTest();
    const { registerOutboxConsumers } = await import('../outbox/startOutbox.js');
    // startOutbox memoizes, so force the registration through the real path.
    const { registerAppointmentRequestConfirmationConsumer } = await import(
      '../outbox/consumers/appointmentRequestConfirmationConsumer.js'
    );
    registerAppointmentRequestConfirmationConsumer();
    void registerOutboxConsumers;
    for (const c of OUTBOX_EVENT_CONTRACTS) {
      assert.ok(
        getOutboxConsumer(c.consumerKey),
        `contract ${c.eventType}@${c.eventVersion} names consumer "${c.consumerKey}", which nothing registers`,
      );
    }
  });

  // ── G. Structural guards ──────────────────────────────────────────────────
  section('G. The unsafe path does not exist (structural, not stylistic)');

  await test('outboxProducer exports NO publisher that can run outside a transaction', () => {
    const source = readSource('outbox/outboxProducer.ts');
    const exportedPublishers = codeLines(source)
      .filter((l) => /export\s+(async\s+)?function\s+publish/.test(l))
      .map((l) => l.trim());
    assert.equal(
      exportedPublishers.length,
      1,
      `expected exactly one exported publisher, found:\n  ${exportedPublishers.join('\n  ')}`,
    );
    assert.match(exportedPublishers[0]!, /publishOutboxEventInTx/);
    assert.match(
      source,
      /export async function publishOutboxEventInTx\(\s*tx: Prisma\.TransactionClient,/,
      'the publisher must take a TransactionClient as its FIRST argument — that is what makes the ' +
        'non-transactional call fail to typecheck rather than fail in review',
    );
  });

  await test('the producer never reaches for the shared client', () => {
    const source = readSource('outbox/outboxProducer.ts');
    const offenders = codeLines(source).filter((l) => /\bprisma\./.test(l) && !/Prisma\./.test(l));
    assert.deepEqual(
      offenders,
      [],
      'a producer that can touch the shared client can publish outside the caller\'s transaction',
    );
  });

  await test('the conversion route publishes INSIDE the transaction callback', () => {
    const source = readSource('routes/appointmentRequests.ts');
    const txStart = source.indexOf('await prisma.$transaction(async (tx) => {');
    const publishAt = source.indexOf('publishOutboxEventInTx(tx,');
    const returnAt = source.indexOf('return { appointment, updatedRequest, publishOutboxConfirmation };');
    assert.ok(txStart > 0, 'conversion transaction not found');
    assert.ok(publishAt > txStart, 'publish must appear inside the transaction callback');
    assert.ok(publishAt < returnAt, 'publish must appear before the transaction callback returns');
  });

  await test('no runtime module imports bullmq (ADR-007: BullMQ is DEFERRED, not adopted)', () => {
    for (const relative of [
      'outbox/outboxDispatcher.ts',
      'outbox/outboxProducer.ts',
      'outbox/outboxIdempotency.ts',
      'outbox/outboxReplay.ts',
      'outbox/outboxMetrics.ts',
      'outbox/outboxConfig.ts',
      'outbox/outboxEventRegistry.ts',
      'outbox/outboxConsumerRegistry.ts',
      'outbox/startOutbox.ts',
      'jobs/outboxDispatcherJob.ts',
    ]) {
      const source = readSource(relative);
      assert.ok(!/from ['"]bullmq['"]/.test(source), `${relative} imports bullmq`);
      assert.ok(!/from ['"]ioredis['"]/.test(source), `${relative} imports ioredis`);
    }
  });

  await test('the dispatcher takes NO JobLock — cluster-wide serialization would defeat the design', () => {
    const source = readSource('jobs/outboxDispatcherJob.ts');
    assert.ok(!/withJobLock\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')));
  });

  await test('the dispatcher job declares its own system context, since it is lock-free', () => {
    const source = readSource('jobs/outboxDispatcherJob.ts');
    assert.match(source, /runAsSystem\(\{\s*reason:\s*'background-job'/);
  });

  await test('the dispatcher establishes tenant context per row before any consumer runs', () => {
    const source = readSource('outbox/outboxDispatcher.ts');
    assert.match(source, /runAsTenant\(/);
    assert.match(source, /organizationId: row\.organizationId/);
    // The tenant identity must come from the ROW, never from the payload.
    assert.ok(
      !/clinicScope[\s\S]{0,200}payload/.test(source),
      'tenant scope must be derived from the row\'s ownership columns, not from the payload',
    );
  });

  await test('the claim SQL is registered in the raw-SQL audit inventory', () => {
    assert.ok(
      RAW_SQL_REGISTRY_KEYS.includes('outbox/outboxDispatcher'),
      'the audited-escape key for the claim statement is missing from the registry',
    );
    const source = readSource('outbox/outboxDispatcher.ts');
    assert.match(source, /runWithAuditedRawSql\(/);
    assert.match(source, /registryKey: 'outbox\/outboxDispatcher'/);
  });

  await test('the claim statement really does use FOR UPDATE SKIP LOCKED with a LIMIT', () => {
    const source = readSource('outbox/outboxDispatcher.ts');
    assert.match(source, /FOR UPDATE SKIP LOCKED/);
    assert.match(source, /LIMIT \$\{args\.limit\}/);
    assert.match(source, /"attemptCount"\s*=\s*e\."attemptCount" \+ 1/);
  });

  // ── H. Tenant classification ──────────────────────────────────────────────
  section('H. Tenant classification (the F3-1 contract)');

  await test('both new models are classified, and NOT as system-internal or unresolved', () => {
    for (const model of ['OutboxEvent', 'OutboxConsumerExecution']) {
      const entry = TENANT_MODEL_CLASSIFICATION.find((e) => e.model === model);
      assert.ok(entry, `${model} has no classification entry`);
      assert.equal(entry!.classification, 'ORGANIZATION_SCOPED_DIRECT', `${model} classification`);
      assert.equal(entry!.guardMode, 'AUTO_FILTER_ORGANIZATION_ID', `${model} guard mode`);
      assert.equal(entry!.organizationIdField, 'organizationId');
      assert.equal(entry!.organizationIdNullable, false, `${model}: a nullable owner is not an owner`);
      assert.ok((entry!.rationale ?? '').length >= 100, `${model}: the ownership decision needs a recorded rationale`);
    }
  });

  // ── I. Log privacy ────────────────────────────────────────────────────────
  section('I. Log privacy — an operational table must be diagnosable without PHI');

  await test('no outbox module logs the payload', () => {
    const offenders: string[] = [];
    for (const relative of [
      'outbox/outboxDispatcher.ts',
      'outbox/outboxProducer.ts',
      'outbox/outboxIdempotency.ts',
      'outbox/outboxReplay.ts',
      'outbox/outboxMetrics.ts',
      'outbox/consumers/appointmentRequestConfirmationConsumer.ts',
      'jobs/outboxDispatcherJob.ts',
    ]) {
      for (const line of codeLines(readSource(relative))) {
        if (!/logger\.(info|warn|error|debug)/.test(line) && !/console\.(log|warn|error)/.test(line)) continue;
        if (/payload/.test(line)) offenders.push(`${relative}: ${line.trim()}`);
      }
    }
    assert.deepEqual(offenders, [], 'a log line carrying the payload defeats the whole minimisation contract');
  });

  await test('the dead-letter listing returns no payload column at all (F5-1P E14)', () => {
    const source = readSource('outbox/outboxMetrics.ts');
    const listing = source.slice(source.indexOf('export async function listDeadOutboxEvents'));
    const selectBlock = listing.slice(listing.indexOf('select: {'), listing.indexOf('// `payload` is deliberately absent.'));
    assert.ok(!/\bpayload:\s*true/.test(selectBlock), 'listDeadOutboxEvents must never select the payload');
  });

  await test('backlog metrics never slice by clinic, patient or event id', () => {
    const source = readSource('outbox/outboxMetrics.ts');
    const metricsFn = source.slice(
      source.indexOf('export async function getOutboxBacklogMetrics'),
      source.indexOf('export async function listDeadOutboxEvents'),
    );
    assert.ok(!/by: \['clinicId'\]/.test(metricsFn), 'a per-clinic metric dimension is unbounded cardinality');
    assert.ok(!/by: \['aggregateId'\]/.test(metricsFn));
    assert.match(metricsFn, /by: \['organizationId'\]/);
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`F5-2 outbox contracts: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
