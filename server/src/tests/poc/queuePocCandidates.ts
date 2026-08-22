/**
 * queuePocCandidates.ts — the two ADR-007 candidates, implemented far enough to
 * be measured against each other.
 *
 *   Candidate A — PostgreSQL outbox + in-process dispatcher.
 *       Claim semantics modelled on the pattern already working in production:
 *       clinicBulkExportPackage.claimQueuedClinicBulkExportJobs() uses a guarded
 *       per-row status transition, NOT SELECT ... FOR UPDATE SKIP LOCKED. Both
 *       are implemented here so the comparison is measured rather than asserted.
 *
 *   Candidate B — BullMQ + Redis.
 *
 * Two things are deliberately shared by both candidates, because they are the
 * point of the experiment:
 *
 *   1. performSideEffect() — business idempotency lives in PostgreSQL, keyed by
 *      a domain idempotency key, for BOTH candidates. This is how the PoC can
 *      demonstrate queue-outbox-poc-design.md §9's claim that BullMQ's own
 *      jobId/dedupe is a transport property and NOT business idempotency.
 *
 *   2. The real production tenantContext primitive is imported, not
 *      reimplemented. runAsTenant/runAsSystem here are the same functions the
 *      application uses, so the tenant-reconstruction evidence is about the
 *      real mechanism rather than a lookalike.
 *
 * Test-only. Never imported by a runtime path.
 */

import { randomUUID, createHash } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import {
  Queue,
  Worker,
  UnrecoverableError,
  RedisConnection,
  createIORedisClient,
  type Job,
  type RedisOptions,
} from 'bullmq';
import { Redis as IORedis, type RedisOptions as IORedisOptions } from 'ioredis';
import {
  runAsTenant,
  runAsSystem,
  requireTenantContext,
  type TenantClinicScope,
} from '../../tenancy/tenantContext.js';

export type Candidate = 'postgres-outbox' | 'bullmq';
export type ClaimMode = 'guarded-update' | 'skip-locked';

/** Envelope carried by BOTH candidates. Identifiers only — never a domain snapshot. */
export interface JobEnvelope {
  eventId: string;
  eventType: string;
  /** Consumers reject versions they do not support; never "deserialize whatever exists". */
  eventVersion: number;
  organizationId: string;
  clinicId: string | null;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
  correlationId: string;
  occurredAt: string;
}

export const SUPPORTED_EVENT_VERSION = 1;

/**
 * Fields permitted in a queue/outbox payload. Enforced, not merely documented:
 * assertMinimalPayload() rejects anything else, which is what makes the KVKK
 * data-minimisation claim testable.
 */
export const ALLOWED_PAYLOAD_FIELDS = Object.freeze([
  'appointmentId',
  'reminderKind',
  'scheduledForIso',
]);

export class PayloadMinimizationError extends Error {
  constructor(public readonly offendingFields: string[]) {
    super(`payload contains non-minimal fields: ${offendingFields.join(', ')}`);
    this.name = 'PayloadMinimizationError';
  }
}

export function assertMinimalPayload(payload: Record<string, unknown>): void {
  const offenders = Object.keys(payload).filter((k) => !ALLOWED_PAYLOAD_FIELDS.includes(k));
  if (offenders.length > 0) throw new PayloadMinimizationError(offenders);
}

export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

// ---------------------------------------------------------------------------
// Shared side effect — the correctness instrument.
// ---------------------------------------------------------------------------

export type SideEffectOutcome = 'executed' | 'suppressed-duplicate';

/**
 * The "external delivery". Must run inside a TENANT context: it calls
 * requireTenantContext() and refuses to act for a different organization than
 * the one the envelope claims, which is the cross-tenant negative test.
 */
export async function performSideEffect(
  pool: Pool,
  candidate: Candidate,
  envelope: JobEnvelope,
  workerId: string,
): Promise<SideEffectOutcome> {
  const ctx = requireTenantContext();

  if (ctx.organizationId !== envelope.organizationId) {
    throw new Error(
      `CROSS_TENANT_REFUSED: context org ${ctx.organizationId} may not act for ${envelope.organizationId}`,
    );
  }
  if (envelope.clinicId && ctx.clinicScope.kind === 'EXPLICIT') {
    if (!ctx.clinicScope.clinicIds.includes(envelope.clinicId)) {
      throw new Error(
        `CROSS_CLINIC_REFUSED: clinic ${envelope.clinicId} outside scope [${ctx.clinicScope.clinicIds.join(',')}]`,
      );
    }
  }

  const inserted = await pool.query(
    `INSERT INTO poc_side_effect
       (idempotency_key, candidate, organization_id, clinic_id, event_id, worker_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [envelope.idempotencyKey, candidate, envelope.organizationId, envelope.clinicId, envelope.eventId, workerId],
  );
  const outcome: SideEffectOutcome = inserted.rowCount === 1 ? 'executed' : 'suppressed-duplicate';

  await pool.query(
    `INSERT INTO poc_side_effect_attempt (idempotency_key, candidate, outcome, worker_id)
     VALUES ($1,$2,$3,$4)`,
    [envelope.idempotencyKey, candidate, outcome, workerId],
  );
  return outcome;
}

/** Scope for a claimed job, derived from the row, never from client input. */
export function scopeFor(envelope: JobEnvelope): TenantClinicScope {
  return envelope.clinicId
    ? { kind: 'EXPLICIT', clinicIds: [envelope.clinicId] }
    : { kind: 'ORGANIZATION_WIDE' };
}

/**
 * Re-enter tenant execution for a job. This is the queue-boundary crossing that
 * AsyncLocalStorage cannot do for us.
 *
 * The `async () =>` wrapper is deliberate: handing runAsTenant a lazy thenable
 * (e.g. `() => pool.query(...)`) loses the context.
 */
export async function runJobAsTenant<T>(envelope: JobEnvelope, fn: () => Promise<T>): Promise<T> {
  return runAsTenant(
    {
      organizationId: envelope.organizationId,
      clinicScope: scopeFor(envelope),
      actor: { kind: 'SERVICE', id: null },
      correlationId: envelope.correlationId,
    },
    async () => fn(),
  );
}

export class PoisonError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PoisonError';
  }
}

/** Handler contract shared by both candidates so the workload is identical. */
export type Handler = (envelope: JobEnvelope, payload: Record<string, unknown>) => Promise<void>;

export interface HandlerOptions {
  /** Throw before the side effect (transient failure). */
  failBeforeEffect?: (attempt: number, envelope: JobEnvelope) => boolean;
  /** Throw AFTER the side effect but before finalisation (the crash-gap case). */
  crashAfterEffect?: (attempt: number, envelope: JobEnvelope) => boolean;
  /** Permanent, non-retryable. */
  poison?: (envelope: JobEnvelope) => boolean;
  delayMs?: number;
}

export function buildHandler(
  pool: Pool,
  candidate: Candidate,
  workerId: string,
  opts: HandlerOptions = {},
): (envelope: JobEnvelope, payload: Record<string, unknown>, attempt: number) => Promise<void> {
  return async (envelope, payload, attempt) => {
    if (envelope.eventVersion !== SUPPORTED_EVENT_VERSION) {
      throw new PoisonError(
        `UNSUPPORTED_EVENT_VERSION: got ${envelope.eventVersion}, support ${SUPPORTED_EVENT_VERSION}`,
        'UNSUPPORTED_EVENT_VERSION',
      );
    }
    try {
      assertMinimalPayload(payload);
    } catch (err) {
      throw new PoisonError(`MALFORMED_PAYLOAD: ${(err as Error).message}`, 'MALFORMED_PAYLOAD');
    }
    if (opts.poison?.(envelope)) {
      throw new PoisonError('POISON_EVENT: permanently unprocessable', 'POISON_EVENT');
    }
    if (opts.failBeforeEffect?.(attempt, envelope)) {
      throw new Error('TRANSIENT_BEFORE_EFFECT');
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));

    await runJobAsTenant(envelope, async () => {
      await performSideEffect(pool, candidate, envelope, workerId);
    });

    if (opts.crashAfterEffect?.(attempt, envelope)) {
      throw new Error('CRASH_AFTER_SIDE_EFFECT');
    }
  };
}

// ===========================================================================
// Candidate A — PostgreSQL outbox + in-process dispatcher
// ===========================================================================

export interface PublishInput {
  organizationId: string;
  clinicId: string | null;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

/**
 * The atomicity claim: business row and outbox row commit in ONE transaction.
 * If the business write fails, no event exists; if the transaction rolls back,
 * neither exists. This is what separates an outbox from "commit, then publish".
 */
export async function publishInTransaction(
  pool: Pool,
  input: PublishInput,
  opts: { failAfterBusinessWrite?: boolean } = {},
): Promise<string> {
  assertMinimalPayload(input.payload);
  const client: PoolClient = await pool.connect();
  const eventId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO poc_appointment (id, organization_id, clinic_id, patient_ref)
       VALUES ($1,$2,$3,$4)`,
      [input.aggregateId, input.organizationId, input.clinicId ?? 'unknown', `patient-${input.aggregateId}`],
    );
    if (opts.failAfterBusinessWrite) {
      throw new Error('SIMULATED_FAILURE_AFTER_BUSINESS_WRITE');
    }
    await client.query(
      `INSERT INTO poc_outbox_event
         (id, event_type, event_version, aggregate_type, aggregate_id,
          organization_id, clinic_id, payload, idempotency_key, max_attempts)
       VALUES ($1,$2,$3,'appointment',$4,$5,$6,$7,$8,$9)`,
      [
        eventId,
        input.eventType,
        input.eventVersion ?? SUPPORTED_EVENT_VERSION,
        input.aggregateId,
        input.organizationId,
        input.clinicId,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        input.maxAttempts ?? 3,
      ],
    );
    await client.query('COMMIT');
    return eventId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

interface OutboxRow {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_id: string;
  organization_id: string;
  clinic_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempt_count: number;
  max_attempts: number;
}

const toEnvelope = (row: OutboxRow, correlationId: string): JobEnvelope => ({
  eventId: row.id,
  eventType: row.event_type,
  eventVersion: row.event_version,
  organizationId: row.organization_id,
  clinicId: row.clinic_id,
  aggregateType: 'appointment',
  aggregateId: row.aggregate_id,
  idempotencyKey: row.idempotency_key,
  correlationId,
  occurredAt: new Date().toISOString(),
});

export interface DispatcherOptions {
  claimMode?: ClaimMode;
  batchSize?: number;
  leaseMs?: number;
  baseBackoffMs?: number;
  /** Per-tenant in-flight cap. The fairness control. */
  perTenantConcurrency?: number;
  handlerOptions?: HandlerOptions;
}

export class PostgresOutboxDispatcher {
  readonly id: string;
  private running = false;
  private stopping = false;
  private loop?: Promise<void>;
  readonly claimLatenciesMs: number[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly opts: DispatcherOptions = {},
  ) {
    this.id = `dispatcher-${randomUUID().slice(0, 8)}`;
  }

  /**
   * Claim a batch. Two mechanisms, both atomic across dispatchers.
   *
   * 'guarded-update' mirrors the production clinicBulkExport claim: a status
   * transition guarded by the status it expects to replace, so two dispatchers
   * cannot both win the same row.
   */
  async claim(limit: number): Promise<OutboxRow[]> {
    const started = Date.now();
    const leaseMs = this.opts.leaseMs ?? 5_000;
    const mode = this.opts.claimMode ?? 'guarded-update';

    const sql =
      mode === 'skip-locked'
        ? `
        WITH due AS (
          SELECT id FROM poc_outbox_event
           WHERE status IN ('pending','failed') AND available_at <= now()
           ORDER BY available_at
           FOR UPDATE SKIP LOCKED
           LIMIT $2
        )
        UPDATE poc_outbox_event e
           SET status='claimed', locked_at=now(), locked_by=$1,
               lease_expires_at = now() + ($3 || ' milliseconds')::interval,
               attempt_count = e.attempt_count + 1
          FROM due WHERE e.id = due.id
        RETURNING e.id, e.event_type, e.event_version, e.aggregate_id, e.organization_id,
                  e.clinic_id, e.payload, e.idempotency_key, e.attempt_count, e.max_attempts`
        : `
        UPDATE poc_outbox_event e
           SET status='claimed', locked_at=now(), locked_by=$1,
               lease_expires_at = now() + ($3 || ' milliseconds')::interval,
               attempt_count = e.attempt_count + 1
         WHERE e.id IN (
           SELECT id FROM poc_outbox_event
            WHERE status IN ('pending','failed') AND available_at <= now()
            ORDER BY available_at
            LIMIT $2
         )
           AND e.status IN ('pending','failed')
        RETURNING e.id, e.event_type, e.event_version, e.aggregate_id, e.organization_id,
                  e.clinic_id, e.payload, e.idempotency_key, e.attempt_count, e.max_attempts`;

    const res = await this.pool.query(sql, [this.id, limit, String(leaseMs)]);
    this.claimLatenciesMs.push(Date.now() - started);
    return res.rows as OutboxRow[];
  }

  /** Reclaim rows whose holder died mid-flight. */
  async recoverStaleLeases(): Promise<number> {
    const res = await this.pool.query(
      `UPDATE poc_outbox_event
          SET status='failed', locked_by=NULL, locked_at=NULL, lease_expires_at=NULL,
              last_error_code='LEASE_EXPIRED'
        WHERE status='claimed' AND lease_expires_at < now()`,
    );
    return res.rowCount ?? 0;
  }

  private async finalizeSuccess(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE poc_outbox_event
          SET status='processed', processed_at=now(), locked_by=NULL, lease_expires_at=NULL
        WHERE id=$1`,
      [id],
    );
  }

  private async finalizeFailure(row: OutboxRow, err: unknown): Promise<void> {
    const permanent = err instanceof PoisonError;
    const code = permanent ? (err as PoisonError).code : 'TRANSIENT';
    const exhausted = row.attempt_count >= row.max_attempts;

    if (permanent || exhausted) {
      await this.pool.query(
        `UPDATE poc_outbox_event
            SET status='dead', dead_lettered_at=now(), last_error_code=$2,
                locked_by=NULL, lease_expires_at=NULL
          WHERE id=$1`,
        [row.id, code],
      );
      await this.pool.query(
        `INSERT INTO poc_dead_letter
           (candidate, event_id, event_type, organization_id, clinic_id,
            attempt_count, last_error_code, payload_digest)
         VALUES ('postgres-outbox',$1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.event_type, row.organization_id, row.clinic_id, row.attempt_count, code, digest(row.payload)],
      );
      return;
    }
    // Exponential backoff with jitter.
    const base = this.opts.baseBackoffMs ?? 50;
    const backoff = Math.round(base * 2 ** (row.attempt_count - 1) * (0.5 + Math.random()));
    await this.pool.query(
      `UPDATE poc_outbox_event
          SET status='failed', last_error_code=$2, locked_by=NULL, lease_expires_at=NULL,
              available_at = now() + ($3 || ' milliseconds')::interval
        WHERE id=$1`,
      [row.id, code, String(backoff)],
    );
  }

  /**
   * Process one claimed row.
   *
   * The claim runs as SYSTEM ('background-job') because the owner is not yet
   * known — exactly the split clinicBulkExportWorker documents. Tenant
   * execution is entered per row, once the row's owner IS known.
   */
  async processRow(row: OutboxRow, handler: ReturnType<typeof buildHandler>): Promise<'ok' | 'failed'> {
    const envelope = toEnvelope(row, `corr-${row.id.slice(0, 8)}`);
    try {
      await handler(envelope, row.payload, row.attempt_count);
      await this.finalizeSuccess(row.id);
      return 'ok';
    } catch (err) {
      await this.finalizeFailure(row, err);
      return 'failed';
    }
  }

  /** Per-tenant in-flight cap: the fairness control, applied to a claimed batch. */
  private applyFairness(rows: OutboxRow[]): OutboxRow[] {
    const cap = this.opts.perTenantConcurrency;
    if (!cap) return rows;
    const seen = new Map<string, number>();
    const out: OutboxRow[] = [];
    for (const r of rows) {
      const key = `${r.organization_id}:${r.clinic_id ?? '-'}`;
      const n = seen.get(key) ?? 0;
      if (n >= cap) continue;
      seen.set(key, n + 1);
      out.push(r);
    }
    return out;
  }

  start(handler: ReturnType<typeof buildHandler>): void {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    const batchSize = this.opts.batchSize ?? 10;

    this.loop = (async () => {
      while (!this.stopping) {
        try {
          // Claim under SYSTEM context: no tenant is known yet.
          const rows = await runAsSystem(
            { reason: 'background-job', detail: 'f5-1p-poc-dispatcher' },
            async () => this.claim(batchSize),
          );
          if (rows.length === 0) {
            await runAsSystem(
              { reason: 'background-job', detail: 'f5-1p-poc-lease-recovery' },
              async () => this.recoverStaleLeases(),
            );
            await new Promise((r) => setTimeout(r, 20));
            continue;
          }
          const selected = this.applyFairness(rows);
          // Rows filtered out by fairness are released immediately.
          for (const skipped of rows.filter((r) => !selected.includes(r))) {
            await this.pool.query(
              `UPDATE poc_outbox_event SET status='pending', locked_by=NULL, lease_expires_at=NULL,
                      attempt_count = attempt_count - 1 WHERE id=$1`,
              [skipped.id],
            );
          }
          await Promise.all(selected.map((row) => this.processRow(row, handler)));
        } catch {
          await new Promise((r) => setTimeout(r, 25));
        }
      }
    })();
  }

  /** Graceful: finish the in-flight batch, then stop. */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.loop?.catch(() => {});
    this.running = false;
  }

  /** Forced: abandon in-flight work without finalising. Leases must recover it. */
  kill(): void {
    this.stopping = true;
    this.running = false;
  }
}

// ===========================================================================
// Connection ownership and deterministic teardown
// ===========================================================================

/**
 * Why this exists.
 *
 * Given a plain options object, BullMQ constructs its own ioredis client for
 * every Queue and every Worker, and applies a default `retryStrategy` that
 * never gives up (`bullmq/classes/redis-connection`: it always returns a delay,
 * never `null`). Closing is therefore not guaranteed to release the socket: if
 * a client happens to be mid-reconnect when `close()` runs, ioredis rejects the
 * QUIT because the stream is not writeable and `enableOfflineQueue` is false,
 * BullMQ swallows that as a connection error, and nothing ever calls
 * `disconnect()`. The client keeps retrying for the lifetime of the process.
 *
 * E05 stops Redis underneath a live queue, which is exactly that situation, so
 * one BullMQ-owned client survived every run and kept the event loop alive —
 * the PoC finished all 44 experiments, tore down its containers, and then hung
 * forever reconnecting to a Redis that no longer existed.
 *
 * The harness therefore owns every Redis connection explicitly: it creates them
 * through `RedisConnection.clientFactory` (BullMQ's documented hook for exactly
 * this), tracks them alongside the queues and workers that use them, and closes
 * all three in a defined order. Reconnection behaviour during the run is
 * unchanged — E06/E07 asserts that clients *do* reconnect — but once teardown
 * starts, the retry strategy gives up so teardown can converge.
 */

const trackedRedisClients = new Set<IORedis>();
const trackedQueues = new Set<Queue>();
const trackedWorkers = new Set<Worker>();
let harnessShuttingDown = false;

/** BullMQ's own default: exponential, clamped to [1s, 20s], never gives up. */
const defaultBackoffMs = (times: number) => Math.max(Math.min(Math.exp(times), 20_000), 1_000);

/**
 * Creates an ioredis client the harness owns and can always close. Reconnect
 * behaviour matches BullMQ's default until teardown begins, then stops.
 */
export function createTrackedRedis(opts: RedisOptions): IORedis {
  const client = new IORedis({
    ...(opts as IORedisOptions),
    retryStrategy: (times: number) => (harnessShuttingDown ? null : defaultBackoffMs(times)),
  });
  // BullMQ removes its own 'error' listener in close(), after which ioredis
  // reports every reconnect attempt as an unhandled error event. The owner
  // keeps a listener for the whole lifetime instead. Command failures still
  // reject normally, so experiments that assert a loud failure (E05) are
  // unaffected.
  client.on('error', () => {});
  trackedRedisClients.add(client);
  client.once('end', () => trackedRedisClients.delete(client));
  return client;
}

/**
 * Routes every connection BullMQ would create through {@link createTrackedRedis}.
 * Must be called before the first Queue or Worker is constructed.
 */
export function installHarnessRedisOwnership(): void {
  RedisConnection.clientFactory = (opts: RedisOptions) =>
    createIORedisClient(createTrackedRedis(opts));
}

/** Bounds a teardown step so one stuck connection cannot hang the process. */
async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      // An unref'd timer cannot itself keep the event loop alive.
      timer.unref();
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/**
 * Closes every queue, worker and Redis client the harness created, in the only
 * order that is safe: workers first (they hold blocking connections and would
 * otherwise keep reading from a queue that is closing), then queues, then any
 * client BullMQ could not close itself.
 *
 * Idempotent, and safe to call while Redis is still running — which is the
 * point: called before the containers are destroyed, every client can still
 * complete a real QUIT instead of being stranded mid-reconnect.
 */
export async function closeAllQueueResources(): Promise<void> {
  harnessShuttingDown = true;

  const workers = [...trackedWorkers];
  trackedWorkers.clear();
  await withTimeout(Promise.all(workers.map((w) => w.close().catch(() => {}))), 15_000);

  const queues = [...trackedQueues];
  trackedQueues.clear();
  await withTimeout(Promise.all(queues.map((q) => q.close().catch(() => {}))), 15_000);

  const clients = [...trackedRedisClients];
  trackedRedisClients.clear();
  await withTimeout(
    Promise.all(
      clients.map(async (c) => {
        try {
          if (c.status === 'ready') await c.quit();
        } catch {
          // Falls through to disconnect(), which is what actually releases the
          // handle when QUIT cannot be written.
        } finally {
          // disconnect(false): release the socket and schedule no reconnect.
          c.disconnect(false);
        }
      }),
    ),
    15_000,
  );
}

/** Test seam: how many harness-owned Redis clients are still open. */
export function openRedisClientCount(): number {
  return [...trackedRedisClients].filter((c) => c.status !== 'end').length;
}

// ===========================================================================
// Candidate B — BullMQ + Redis
// ===========================================================================

export interface BullSetupOptions {
  queueName: string;
  redis: { host: string; port: number; password: string };
  concurrency?: number;
  attempts?: number;
  backoffMs?: number;
}

export const bullConnection = (redis: BullSetupOptions['redis']) => ({
  host: redis.host,
  port: redis.port,
  password: redis.password,
  // BullMQ workers require this to be null.
  maxRetriesPerRequest: null as null,
  enableOfflineQueue: false,
});

export function createBullQueue(opts: BullSetupOptions): Queue {
  const queue = new Queue(opts.queueName, { connection: bullConnection(opts.redis) });
  trackedQueues.add(queue);
  return queue;
}

export function createBullWorker(
  opts: BullSetupOptions,
  handler: ReturnType<typeof buildHandler>,
  onDeadLetter: (job: Job, err: Error) => Promise<void>,
): Worker {
  const worker = new Worker(
    opts.queueName,
    async (job: Job) => {
      const { envelope, payload } = job.data as { envelope: JobEnvelope; payload: Record<string, unknown> };
      try {
        await handler(envelope, payload, job.attemptsMade + 1);
      } catch (err) {
        // Permanent failures must not consume the retry budget.
        if (err instanceof PoisonError) {
          throw new UnrecoverableError(`${err.code}: ${err.message}`);
        }
        throw err;
      }
    },
    {
      connection: bullConnection(opts.redis),
      concurrency: opts.concurrency ?? 5,
    },
  );

  trackedWorkers.add(worker);

  worker.on('failed', (job, err) => {
    if (!job) return;
    const permanent = err.name === 'UnrecoverableError';
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (permanent || exhausted) {
      void onDeadLetter(job, err);
    }
  });

  return worker;
}

export async function enqueueBull(
  queue: Queue,
  envelope: JobEnvelope,
  payload: Record<string, unknown>,
  opts: { attempts?: number; backoffMs?: number; delay?: number; jobId?: string } = {},
): Promise<void> {
  assertMinimalPayload(payload);
  await queue.add(
    envelope.eventType,
    { envelope, payload },
    {
      // jobId is transport-level dedupe ONLY. Business idempotency is the
      // PostgreSQL unique key in performSideEffect().
      jobId: opts.jobId,
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: opts.backoffMs ?? 50 },
      delay: opts.delay,
      removeOnComplete: false,
      removeOnFail: false,
    },
  );
}

export const makeEnvelope = (input: {
  organizationId: string;
  clinicId: string | null;
  aggregateId: string;
  idempotencyKey: string;
  eventType?: string;
  eventVersion?: number;
}): JobEnvelope => ({
  eventId: randomUUID(),
  eventType: input.eventType ?? 'appointment.reminder.due',
  eventVersion: input.eventVersion ?? SUPPORTED_EVENT_VERSION,
  organizationId: input.organizationId,
  clinicId: input.clinicId,
  aggregateType: 'appointment',
  aggregateId: input.aggregateId,
  idempotencyKey: input.idempotencyKey,
  correlationId: `corr-${randomUUID().slice(0, 8)}`,
  occurredAt: new Date().toISOString(),
});
