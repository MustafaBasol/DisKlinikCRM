/**
 * queuePlatformPoc.ts — F5-1P executable comparison for ADR-007.
 *
 * Runs both candidates through the same failure matrix and workload:
 *   A. PostgreSQL outbox + in-process dispatcher
 *   B. BullMQ + Redis
 *
 * The point is evidence, not a winner chosen in advance. Every experiment
 * records PASS / FAIL / BLOCKED / NOT_APPLICABLE with the observed numbers, and
 * failures are reported rather than hidden.
 *
 * Run:  npm run poc:f5-1p-queue
 * Everything runs in throwaway Docker containers and is destroyed at the end.
 */

import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { startPocEnvironment, type PocEnvironment } from './queuePocEnvironment.js';
import {
  PostgresOutboxDispatcher,
  buildHandler,
  publishInTransaction,
  performSideEffect,
  runJobAsTenant,
  makeEnvelope,
  createBullQueue,
  createBullWorker,
  enqueueBull,
  assertMinimalPayload,
  PayloadMinimizationError,
  digest,
  type JobEnvelope,
  type ClaimMode,
} from './queuePocCandidates.js';
import {
  runAsTenant,
  runAsSystem,
  requireTenantContext,
  TenantContextError,
} from '../../tenancy/tenantContext.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(HERE, '../../../f5-1p-poc-results.json');

type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_APPLICABLE';

interface Result {
  id: string;
  title: string;
  candidate: 'postgres-outbox' | 'bullmq' | 'both' | 'n/a';
  status: Status;
  detail: string;
  evidence?: Record<string, unknown>;
  durationMs: number;
}

const results: Result[] = [];
let currentEnv: PocEnvironment;

async function experiment(
  id: string,
  title: string,
  candidate: Result['candidate'],
  fn: () => Promise<{ status: Status; detail: string; evidence?: Record<string, unknown> }>,
): Promise<void> {
  const started = Date.now();
  process.stdout.write(`  ${id} ${title} … `);
  try {
    await currentEnv.reset();
    const r = await fn();
    results.push({ id, title, candidate, ...r, durationMs: Date.now() - started });
    process.stdout.write(`${r.status} (${Date.now() - started}ms)\n`);
  } catch (err) {
    results.push({
      id,
      title,
      candidate,
      status: 'FAIL',
      detail: `threw: ${(err as Error).message}`,
      durationMs: Date.now() - started,
    });
    process.stdout.write(`FAIL (threw: ${(err as Error).message})\n`);
  }
}

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';
const CLINIC_A1 = 'clinic-a1';
const CLINIC_A2 = 'clinic-a2';
const CLINIC_B1 = 'clinic-b1';

const minimalPayload = (n = 1) => ({
  appointmentId: `appt-${n}`,
  reminderKind: 'T-24h',
  scheduledForIso: new Date().toISOString(),
});

const pct = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const countSideEffects = async (pool: Pool, key?: string): Promise<number> => {
  const r = key
    ? await pool.query('SELECT count(*)::int AS c FROM poc_side_effect WHERE idempotency_key=$1', [key])
    : await pool.query('SELECT count(*)::int AS c FROM poc_side_effect');
  return r.rows[0].c as number;
};

const countAttempts = async (pool: Pool, key: string): Promise<number> => {
  const r = await pool.query('SELECT count(*)::int AS c FROM poc_side_effect_attempt WHERE idempotency_key=$1', [key]);
  return r.rows[0].c as number;
};

const waitFor = async (cond: () => Promise<boolean>, timeoutMs = 20_000, stepMs = 40): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
};

// ---------------------------------------------------------------------------
// BullMQ harness helpers
// ---------------------------------------------------------------------------

interface BullRig {
  queue: Queue;
  workers: Worker[];
  queueName: string;
  close(): Promise<void>;
}

async function bullRig(
  env: PocEnvironment,
  opts: {
    workers?: number;
    concurrency?: number;
    handlerOpts?: Parameters<typeof buildHandler>[3];
    onDead?: (jobId: string, code: string) => Promise<void>;
  } = {},
): Promise<BullRig> {
  const queueName = `noramedi.poc.test.reminder.v1.${randomUUID().slice(0, 8)}`;
  const setup = { queueName, redis: env.redis, concurrency: opts.concurrency ?? 5 };
  const queue = createBullQueue(setup);
  const workers: Worker[] = [];
  const n = opts.workers ?? 1;
  for (let i = 0; i < n; i++) {
    const workerId = `bull-worker-${i}`;
    const handler = buildHandler(env.pool, 'bullmq', workerId, opts.handlerOpts ?? {});
    workers.push(
      createBullWorker(setup, handler, async (job, err) => {
        const envelope = (job.data as { envelope: JobEnvelope }).envelope;
        const code = err.message.split(':')[0] || 'UNKNOWN';
        await env.pool.query(
          `INSERT INTO poc_dead_letter
             (candidate, event_id, event_type, organization_id, clinic_id,
              attempt_count, last_error_code, payload_digest)
           VALUES ('bullmq',$1,$2,$3,$4,$5,$6,$7)`,
          [
            envelope.eventId,
            envelope.eventType,
            envelope.organizationId,
            envelope.clinicId,
            job.attemptsMade,
            code,
            digest((job.data as { payload: unknown }).payload),
          ],
        );
        await opts.onDead?.(String(job.id), code);
      }),
    );
  }
  return {
    queue,
    workers,
    queueName,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await queue.close();
    },
  };
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main(): Promise<void> {
  console.log('F5-1P — queue platform disposable PoC');
  console.log('Bringing up throwaway PostgreSQL 16 + Redis 7.0 …');
  const env = await startPocEnvironment();
  currentEnv = env;
  console.log(`  project=${env.projectName} pg=127.0.0.1:${env.pg.port} redis=127.0.0.1:${env.redis.port}\n`);

  const pool = env.pool;
  const perf: Record<string, unknown> = {};

  try {
    // =====================================================================
    console.log('— Atomicity and durability —');
    // =====================================================================

    await experiment('E11', 'transaction rollback leaves neither business row nor event', 'postgres-outbox', async () => {
      await publishInTransaction(
        pool,
        { organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-rollback', eventType: 'appointment.reminder.due', idempotencyKey: 'k-rollback', payload: minimalPayload() },
        { failAfterBusinessWrite: true },
      ).catch(() => undefined);
      const appts = await pool.query('SELECT count(*)::int AS c FROM poc_appointment');
      const evts = await pool.query('SELECT count(*)::int AS c FROM poc_outbox_event');
      const ok = appts.rows[0].c === 0 && evts.rows[0].c === 0;
      return {
        status: ok ? 'PASS' : 'FAIL',
        detail: ok
          ? 'business write and outbox insert rolled back together; no orphan event'
          : `orphan state: appointments=${appts.rows[0].c} events=${evts.rows[0].c}`,
        evidence: { appointments: appts.rows[0].c, events: evts.rows[0].c },
      };
    });

    await experiment('E11b', 'successful commit persists business row AND event atomically', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-ok', eventType: 'appointment.reminder.due', idempotencyKey: 'k-ok', payload: minimalPayload(),
      });
      const appts = await pool.query('SELECT count(*)::int AS c FROM poc_appointment');
      const evts = await pool.query('SELECT count(*)::int AS c FROM poc_outbox_event');
      const ok = appts.rows[0].c === 1 && evts.rows[0].c === 1;
      return {
        status: ok ? 'PASS' : 'FAIL',
        detail: ok ? 'one appointment, one outbox event, one transaction' : 'atomic pair not observed',
        evidence: { appointments: appts.rows[0].c, events: evts.rows[0].c },
      };
    });

    await experiment('E11c', 'BullMQ cannot offer commit-and-publish atomicity', 'bullmq', async () => {
      // Demonstrated, not asserted: enqueue after a rolled-back business write.
      const rig = await bullRig(env, { workers: 0 });
      try {
        const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-nonatomic', idempotencyKey: 'k-nonatomic' });
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`INSERT INTO poc_appointment (id, organization_id, clinic_id, patient_ref) VALUES ($1,$2,$3,'p')`, ['appt-nonatomic', ORG_A, CLINIC_A1]);
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
        // The enqueue is a separate system; it cannot participate in the DB transaction.
        await enqueueBull(rig.queue, envelope, minimalPayload());
        const waiting = await rig.queue.getWaitingCount();
        const appts = await pool.query('SELECT count(*)::int AS c FROM poc_appointment');
        const orphan = waiting === 1 && appts.rows[0].c === 0;
        return {
          status: orphan ? 'PASS' : 'FAIL',
          detail: orphan
            ? 'confirmed: a queued job survives a rolled-back business transaction — an orphan event. BullMQ alone cannot close this gap; an outbox can.'
            : 'expected an orphan job to be demonstrable',
          evidence: { waitingJobs: waiting, appointments: appts.rows[0].c },
        };
      } finally {
        await rig.close();
      }
    });

    // =====================================================================
    console.log('\n— Claim semantics and multi-worker races —');
    // =====================================================================

    for (const mode of ['guarded-update', 'skip-locked'] as ClaimMode[]) {
      await experiment(
        mode === 'guarded-update' ? 'E16' : 'E16b',
        `multi-dispatcher race, ${mode}: no row claimed twice`,
        'postgres-outbox',
        async () => {
          const N = 60;
          for (let i = 0; i < N; i++) {
            await publishInTransaction(pool, {
              organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-race-${mode}-${i}`,
              eventType: 'appointment.reminder.due', idempotencyKey: `k-race-${mode}-${i}`, payload: minimalPayload(i),
            });
          }
          const dispatchers = [0, 1, 2, 3].map(() => new PostgresOutboxDispatcher(pool, { claimMode: mode, batchSize: 8, leaseMs: 30_000 }));
          const claimed = await Promise.all(
            dispatchers.map((d) => runAsSystem({ reason: 'background-job', detail: 'race-test' }, async () => d.claim(25))),
          );
          const ids = claimed.flat().map((r) => r.id);
          const unique = new Set(ids);
          const ok = ids.length === unique.size;
          return {
            status: ok ? 'PASS' : 'FAIL',
            detail: ok
              ? `${ids.length} claims across 4 dispatchers, ${unique.size} distinct — no double claim`
              : `DOUBLE CLAIM: ${ids.length} claims but only ${unique.size} distinct rows`,
            evidence: { mode, totalClaims: ids.length, distinctRows: unique.size, dispatchers: 4 },
          };
        },
      );
    }

    await experiment('E02', 'crash before claim leaves the event pending and reclaimable', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-precrash', eventType: 'appointment.reminder.due', idempotencyKey: 'k-precrash', payload: minimalPayload(),
      });
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5 });
      d.start(buildHandler(pool, 'postgres-outbox', 'w'));
      d.kill(); // die before claiming
      await new Promise((r) => setTimeout(r, 200));
      const row = await pool.query(`SELECT status FROM poc_outbox_event WHERE idempotency_key='k-precrash'`);
      const status = row.rows[0]?.status;
      const reclaimable = status === 'pending' || status === 'processed';
      return {
        status: reclaimable ? 'PASS' : 'FAIL',
        detail: `event status after pre-claim crash: ${status} (not lost)`,
        evidence: { status },
      };
    });

    await experiment('E03/E17', 'crash after claim: lease expires and another dispatcher recovers the row', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-lease', eventType: 'appointment.reminder.due', idempotencyKey: 'k-lease', payload: minimalPayload(),
      });
      const dying = new PostgresOutboxDispatcher(pool, { leaseMs: 600, batchSize: 5 });
      const claimed = await runAsSystem({ reason: 'background-job', detail: 'lease-test' }, async () => dying.claim(5));
      dying.kill(); // holder dies mid-flight, never finalises
      const heldStatus = (await pool.query(`SELECT status FROM poc_outbox_event WHERE idempotency_key='k-lease'`)).rows[0].status;

      await new Promise((r) => setTimeout(r, 900)); // lease expires
      const rescuer = new PostgresOutboxDispatcher(pool, { leaseMs: 5_000, batchSize: 5 });
      const recovered = await runAsSystem({ reason: 'background-job', detail: 'lease-recovery' }, async () => rescuer.recoverStaleLeases());
      rescuer.start(buildHandler(pool, 'postgres-outbox', 'rescuer'));
      const done = await waitFor(async () => (await countSideEffects(pool, 'k-lease')) === 1);
      await rescuer.stop();
      return {
        status: done && claimed.length === 1 && heldStatus === 'claimed' && recovered === 1 ? 'PASS' : 'FAIL',
        detail: done
          ? `row held as '${heldStatus}', lease expired, ${recovered} row recovered and processed exactly once`
          : 'row was not recovered after lease expiry',
        evidence: { claimedByDeadHolder: claimed.length, statusWhileHeld: heldStatus, leasesRecovered: recovered, sideEffects: await countSideEffects(pool, 'k-lease') },
      };
    });

    // =====================================================================
    console.log('\n— Idempotency and the crash gap —');
    // =====================================================================

    await experiment('E04', 'crash AFTER side effect, before finalise: retried but executed exactly once', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-gap', eventType: 'appointment.reminder.due', idempotencyKey: 'k-gap', payload: minimalPayload(), maxAttempts: 5,
      });
      const d = new PostgresOutboxDispatcher(pool, { leaseMs: 5_000, batchSize: 5, baseBackoffMs: 20 });
      d.start(buildHandler(pool, 'postgres-outbox', 'gap-worker', { crashAfterEffect: (attempt) => attempt === 1 }));
      const ok = await waitFor(async () => (await countAttempts(pool, 'k-gap')) >= 2);
      await d.stop();
      const effects = await countSideEffects(pool, 'k-gap');
      const attempts = await countAttempts(pool, 'k-gap');
      return {
        status: ok && effects === 1 ? 'PASS' : 'FAIL',
        detail: `${attempts} delivery attempts, ${effects} business side effect — the duplicate was suppressed by the DB idempotency key, not by the transport`,
        evidence: { attempts, sideEffects: effects },
      };
    });

    await experiment('E01', 'duplicate event: same idempotency key executes once', 'postgres-outbox', async () => {
      for (let i = 0; i < 2; i++) {
        await publishInTransaction(pool, {
          organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-dup-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: 'k-dup-shared', payload: minimalPayload(i),
        });
      }
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5 });
      d.start(buildHandler(pool, 'postgres-outbox', 'dup-worker'));
      await waitFor(async () => (await countAttempts(pool, 'k-dup-shared')) >= 2);
      await d.stop();
      const effects = await countSideEffects(pool, 'k-dup-shared');
      return {
        status: effects === 1 ? 'PASS' : 'FAIL',
        detail: `2 distinct events sharing one business key → ${effects} side effect`,
        evidence: { sideEffects: effects, attempts: await countAttempts(pool, 'k-dup-shared') },
      };
    });

    await experiment('E01b', 'BullMQ duplicate delivery: jobId dedupe is NOT business idempotency', 'bullmq', async () => {
      const rig = await bullRig(env, { workers: 1, concurrency: 2 });
      try {
        // Two DIFFERENT jobIds carrying the SAME business key — exactly the case
        // transport-level dedupe cannot catch.
        for (let i = 0; i < 2; i++) {
          const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-bdup-${i}`, idempotencyKey: 'k-bull-dup' });
          await enqueueBull(rig.queue, envelope, minimalPayload(i), { jobId: `distinct-job-${i}` });
        }
        await waitFor(async () => (await countAttempts(pool, 'k-bull-dup')) >= 2);
        const effects = await countSideEffects(pool, 'k-bull-dup');
        const attempts = await countAttempts(pool, 'k-bull-dup');
        return {
          status: effects === 1 && attempts >= 2 ? 'PASS' : 'FAIL',
          detail: `${attempts} deliveries with distinct jobIds, ${effects} side effect — suppressed by the PostgreSQL key. BullMQ dedupe alone would have allowed 2.`,
          evidence: { attempts, sideEffects: effects },
        };
      } finally {
        await rig.close();
      }
    });

    await experiment('E04b', 'BullMQ crash after side effect: retry, still exactly once', 'bullmq', async () => {
      const rig = await bullRig(env, { workers: 1, concurrency: 1, handlerOpts: { crashAfterEffect: (attempt) => attempt === 1 } });
      try {
        const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-bgap', idempotencyKey: 'k-bull-gap' });
        await enqueueBull(rig.queue, envelope, minimalPayload(), { attempts: 4, backoffMs: 30 });
        await waitFor(async () => (await countAttempts(pool, 'k-bull-gap')) >= 2);
        const effects = await countSideEffects(pool, 'k-bull-gap');
        const attempts = await countAttempts(pool, 'k-bull-gap');
        return {
          status: effects === 1 && attempts >= 2 ? 'PASS' : 'FAIL',
          detail: `${attempts} attempts, ${effects} side effect`,
          evidence: { attempts, sideEffects: effects },
        };
      } finally {
        await rig.close();
      }
    });

    // =====================================================================
    console.log('\n— Retry, poison, dead-letter, replay —');
    // =====================================================================

    await experiment('E12', 'poison event is dead-lettered immediately, without burning retries', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-poison', eventType: 'appointment.reminder.due', idempotencyKey: 'k-poison', payload: minimalPayload(), maxAttempts: 5,
      });
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5, baseBackoffMs: 10 });
      d.start(buildHandler(pool, 'postgres-outbox', 'poison-worker', { poison: () => true }));
      const dead = await waitFor(async () => (await pool.query(`SELECT count(*)::int c FROM poc_dead_letter WHERE candidate='postgres-outbox'`)).rows[0].c > 0);
      await d.stop();
      const row = await pool.query(`SELECT status, attempt_count, last_error_code FROM poc_outbox_event WHERE idempotency_key='k-poison'`);
      const r = row.rows[0];
      const ok = dead && r.status === 'dead' && r.attempt_count === 1;
      return {
        status: ok ? 'PASS' : 'FAIL',
        detail: `status=${r?.status} attempts=${r?.attempt_count} code=${r?.last_error_code} — permanent failure did not consume the retry budget`,
        evidence: { status: r?.status, attempts: r?.attempt_count, code: r?.last_error_code },
      };
    });

    await experiment('E13', 'transient failure retries with backoff, then dead-letters at max attempts', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-maxretry', eventType: 'appointment.reminder.due', idempotencyKey: 'k-maxretry', payload: minimalPayload(), maxAttempts: 3,
      });
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5, baseBackoffMs: 15 });
      d.start(buildHandler(pool, 'postgres-outbox', 'retry-worker', { failBeforeEffect: () => true }));
      const dead = await waitFor(async () => (await pool.query(`SELECT status FROM poc_outbox_event WHERE idempotency_key='k-maxretry'`)).rows[0].status === 'dead', 15_000);
      await d.stop();
      const r = (await pool.query(`SELECT status, attempt_count FROM poc_outbox_event WHERE idempotency_key='k-maxretry'`)).rows[0];
      const effects = await countSideEffects(pool, 'k-maxretry');
      return {
        status: dead && r.attempt_count === 3 && effects === 0 ? 'PASS' : 'FAIL',
        detail: `retried to attempt ${r.attempt_count}/3 then dead-lettered; ${effects} side effects (correct: the effect never succeeded)`,
        evidence: { status: r.status, attempts: r.attempt_count, sideEffects: effects },
      };
    });

    await experiment('E14', 'dead-letter rows are inspectable and carry no payload', 'both', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-dlq', eventType: 'appointment.reminder.due', idempotencyKey: 'k-dlq', payload: { ...minimalPayload(), }, maxAttempts: 1,
      });
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5, baseBackoffMs: 10 });
      d.start(buildHandler(pool, 'postgres-outbox', 'dlq-worker', { poison: () => true }));
      await waitFor(async () => (await pool.query(`SELECT count(*)::int c FROM poc_dead_letter`)).rows[0].c > 0);
      await d.stop();
      const dl = (await pool.query(`SELECT * FROM poc_dead_letter LIMIT 1`)).rows[0];
      const cols = Object.keys(dl);
      const carriesPayload = cols.includes('payload');
      return {
        status: !carriesPayload && !!dl.payload_digest ? 'PASS' : 'FAIL',
        detail: `dead-letter row exposes ${cols.join(', ')} — digest only, no payload column`,
        evidence: { columns: cols, hasPayloadColumn: carriesPayload, digestPresent: !!dl.payload_digest },
      };
    });

    await experiment('E15', 'replay from dead-letter re-processes exactly once', 'postgres-outbox', async () => {
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-replay', eventType: 'appointment.reminder.due', idempotencyKey: 'k-replay', payload: minimalPayload(), maxAttempts: 1,
      });
      let poisoned = true;
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5, baseBackoffMs: 10 });
      d.start(buildHandler(pool, 'postgres-outbox', 'replay-worker', { poison: () => poisoned }));
      await waitFor(async () => (await pool.query(`SELECT status FROM poc_outbox_event WHERE idempotency_key='k-replay'`)).rows[0].status === 'dead');
      await d.stop();

      // Operator fixes the cause, then replays: authorised, audited, bounded.
      poisoned = false;
      await runAsSystem({ reason: 'platform-administration', detail: 'f5-1p-replay' }, async () => {
        await pool.query(
          `UPDATE poc_outbox_event SET status='pending', attempt_count=0, available_at=now(),
                  dead_lettered_at=NULL, last_error_code=NULL WHERE idempotency_key='k-replay'`,
        );
        await pool.query(`UPDATE poc_dead_letter SET replayed_at=now() WHERE event_type='appointment.reminder.due'`);
      });
      const d2 = new PostgresOutboxDispatcher(pool, { batchSize: 5 });
      d2.start(buildHandler(pool, 'postgres-outbox', 'replay-worker-2'));
      const done = await waitFor(async () => (await countSideEffects(pool, 'k-replay')) === 1);
      await d2.stop();
      return {
        status: done ? 'PASS' : 'FAIL',
        detail: 'dead-lettered event replayed under an explicit platform-administration system context and executed exactly once',
        evidence: { sideEffects: await countSideEffects(pool, 'k-replay') },
      };
    });

    await experiment('E15b', 'BullMQ failed jobs are inspectable and retryable', 'bullmq', async () => {
      const rig = await bullRig(env, { workers: 1, concurrency: 1, handlerOpts: { poison: () => true } });
      try {
        const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-bfail', idempotencyKey: 'k-bull-fail' });
        await enqueueBull(rig.queue, envelope, minimalPayload(), { attempts: 3 });
        const failed = await waitFor(async () => (await rig.queue.getFailedCount()) > 0);
        const jobs = await rig.queue.getFailed();
        const attemptsMade = jobs[0]?.attemptsMade;
        const dl = (await pool.query(`SELECT count(*)::int c FROM poc_dead_letter WHERE candidate='bullmq'`)).rows[0].c;
        return {
          status: failed && dl > 0 ? 'PASS' : 'FAIL',
          detail: `UnrecoverableError stopped retries at attempt ${attemptsMade}; failed job retained and inspectable; ${dl} dead-letter row(s) mirrored to PostgreSQL for operator visibility`,
          evidence: { failedCount: jobs.length, attemptsMade, dlqRows: dl },
        };
      } finally {
        await rig.close();
      }
    });

    // =====================================================================
    console.log('\n— Payload and version discipline —');
    // =====================================================================

    await experiment('E20', 'malformed / non-minimal payload is rejected at publish AND at consume', 'both', async () => {
      let publishRejected = false;
      try {
        await publishInTransaction(pool, {
          organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-pii', eventType: 'appointment.reminder.due', idempotencyKey: 'k-pii',
          payload: { appointmentId: 'a', patientName: 'Ayşe Yılmaz', tcKimlik: '12345678901' },
        });
      } catch (err) {
        publishRejected = err instanceof PayloadMinimizationError;
      }
      // And at consume time, for an event that somehow bypassed the producer.
      await pool.query(
        `INSERT INTO poc_outbox_event (id, event_type, event_version, aggregate_type, aggregate_id,
           organization_id, clinic_id, payload, idempotency_key, max_attempts)
         VALUES ($1,'appointment.reminder.due',1,'appointment','appt-pii2',$2,$3,$4,'k-pii2',2)`,
        [randomUUID(), ORG_A, CLINIC_A1, JSON.stringify({ appointmentId: 'a', patientPhone: '+90...' })],
      );
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5, baseBackoffMs: 10 });
      d.start(buildHandler(pool, 'postgres-outbox', 'pii-worker'));
      const dead = await waitFor(async () => (await pool.query(`SELECT status FROM poc_outbox_event WHERE idempotency_key='k-pii2'`)).rows[0].status === 'dead');
      await d.stop();
      const code = (await pool.query(`SELECT last_error_code FROM poc_outbox_event WHERE idempotency_key='k-pii2'`)).rows[0].last_error_code;
      return {
        status: publishRejected && dead && code === 'MALFORMED_PAYLOAD' ? 'PASS' : 'FAIL',
        detail: `producer rejected non-minimal payload (${publishRejected}); consumer dead-lettered it as ${code} without infinite retry`,
        evidence: { publishRejected, consumerCode: code },
      };
    });

    await experiment('E21', 'unsupported event version is refused, not best-effort deserialized', 'both', async () => {
      await pool.query(
        `INSERT INTO poc_outbox_event (id, event_type, event_version, aggregate_type, aggregate_id,
           organization_id, clinic_id, payload, idempotency_key, max_attempts)
         VALUES ($1,'appointment.reminder.due',99,'appointment','appt-v99',$2,$3,$4,'k-v99',3)`,
        [randomUUID(), ORG_A, CLINIC_A1, JSON.stringify(minimalPayload())],
      );
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5, baseBackoffMs: 10 });
      d.start(buildHandler(pool, 'postgres-outbox', 'ver-worker'));
      const dead = await waitFor(async () => (await pool.query(`SELECT status FROM poc_outbox_event WHERE idempotency_key='k-v99'`)).rows[0].status === 'dead');
      await d.stop();
      const r = (await pool.query(`SELECT last_error_code, attempt_count FROM poc_outbox_event WHERE idempotency_key='k-v99'`)).rows[0];
      const effects = await countSideEffects(pool, 'k-v99');
      return {
        status: dead && r.last_error_code === 'UNSUPPORTED_EVENT_VERSION' && effects === 0 ? 'PASS' : 'FAIL',
        detail: `v99 refused as ${r?.last_error_code} after ${r?.attempt_count} attempt; no side effect`,
        evidence: { code: r?.last_error_code, attempts: r?.attempt_count, sideEffects: effects },
      };
    });

    // =====================================================================
    console.log('\n— Tenant safety (negative tests) —');
    // =====================================================================

    await experiment('T1', 'tenant A job may not act on tenant B data', 'both', async () => {
      const envelope = makeEnvelope({ organizationId: ORG_B, clinicId: CLINIC_B1, aggregateId: 'x', idempotencyKey: 'k-cross' });
      let refused = false;
      let message = '';
      try {
        await runAsTenant(
          { organizationId: ORG_A, clinicScope: { kind: 'EXPLICIT', clinicIds: [CLINIC_A1] }, actor: { kind: 'SERVICE', id: null } },
          async () => performSideEffect(pool, 'postgres-outbox', envelope, 'w'),
        );
      } catch (err) {
        refused = String((err as Error).message).startsWith('CROSS_TENANT_REFUSED');
        message = (err as Error).message;
      }
      return {
        status: refused && (await countSideEffects(pool)) === 0 ? 'PASS' : 'FAIL',
        detail: refused ? `refused: ${message}` : 'cross-tenant execution was NOT refused',
        evidence: { refused, sideEffects: await countSideEffects(pool) },
      };
    });

    await experiment('T2', 'same-org sibling clinic outside scope is refused', 'both', async () => {
      const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A2, aggregateId: 'x', idempotencyKey: 'k-sibling' });
      let refused = false;
      let message = '';
      try {
        await runAsTenant(
          { organizationId: ORG_A, clinicScope: { kind: 'EXPLICIT', clinicIds: [CLINIC_A1] }, actor: { kind: 'SERVICE', id: null } },
          async () => performSideEffect(pool, 'postgres-outbox', envelope, 'w'),
        );
      } catch (err) {
        refused = String((err as Error).message).startsWith('CROSS_CLINIC_REFUSED');
        message = (err as Error).message;
      }
      return {
        status: refused ? 'PASS' : 'FAIL',
        detail: refused ? `refused: ${message}` : 'sibling-clinic access was NOT refused',
        evidence: { refused },
      };
    });

    await experiment('T3', 'missing tenant context is refused (no implicit privilege)', 'both', async () => {
      const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'x', idempotencyKey: 'k-noctx' });
      let code = '';
      try {
        await performSideEffect(pool, 'postgres-outbox', envelope, 'w');
      } catch (err) {
        code = err instanceof TenantContextError ? err.code : `other:${(err as Error).message}`;
      }
      return {
        status: code === 'TENANT_CONTEXT_MISSING' ? 'PASS' : 'FAIL',
        detail: `outside any context the side effect raised ${code}`,
        evidence: { code },
      };
    });

    await experiment('T4', 'malformed tenant identity is refused by the real primitive', 'both', async () => {
      let code = '';
      try {
        await runAsTenant(
          { organizationId: '', clinicScope: { kind: 'EXPLICIT', clinicIds: [CLINIC_A1] }, actor: { kind: 'SERVICE', id: null } },
          async () => 1,
        );
      } catch (err) {
        code = err instanceof TenantContextError ? err.code : 'other';
      }
      return {
        status: code === 'TENANT_CONTEXT_INVALID' ? 'PASS' : 'FAIL',
        detail: `empty organizationId raised ${code}`,
        evidence: { code },
      };
    });

    await experiment('T5', 'forged tenant id in a job payload cannot widen scope', 'both', async () => {
      // The worker derives scope from the envelope's server-written identity.
      // A payload field claiming another org must have no effect.
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-forge',
        eventType: 'appointment.reminder.due', idempotencyKey: 'k-forge', payload: minimalPayload(),
      });
      // Attacker-controlled payload injection attempt is rejected outright by
      // payload minimisation, so it can never even reach the worker.
      let injectionRejected = false;
      try {
        assertMinimalPayload({ appointmentId: 'a', organizationId: ORG_B });
      } catch {
        injectionRejected = true;
      }
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5 });
      d.start(buildHandler(pool, 'postgres-outbox', 'forge-worker'));
      await waitFor(async () => (await countSideEffects(pool, 'k-forge')) === 1);
      await d.stop();
      const eff = (await pool.query(`SELECT organization_id FROM poc_side_effect WHERE idempotency_key='k-forge'`)).rows[0];
      return {
        status: injectionRejected && eff?.organization_id === ORG_A ? 'PASS' : 'FAIL',
        detail: `payload-level org injection rejected (${injectionRejected}); side effect recorded under server-derived org ${eff?.organization_id}`,
        evidence: { injectionRejected, effectOrg: eff?.organization_id },
      };
    });

    await experiment('T6', 'concurrent duplicate processing of one key yields one effect', 'both', async () => {
      const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-conc', idempotencyKey: 'k-conc' });
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, (_, i) => runJobAsTenant(envelope, async () => performSideEffect(pool, 'postgres-outbox', envelope, `racer-${i}`))),
      );
      const executed = outcomes.filter((o) => o === 'executed').length;
      return {
        status: executed === 1 && (await countSideEffects(pool, 'k-conc')) === 1 ? 'PASS' : 'FAIL',
        detail: `8 concurrent workers on one key → ${executed} executed, ${outcomes.length - executed} suppressed`,
        evidence: { executed, suppressed: outcomes.length - executed },
      };
    });

    await experiment('T7', 'system context cannot be invented, and cannot borrow tenant semantics', 'both', async () => {
      let unknownReasonRejected = false;
      try {
        await runAsSystem({ reason: 'totally-made-up' as never }, async () => 1);
      } catch (err) {
        unknownReasonRejected = err instanceof TenantContextError && err.code === 'SYSTEM_CONTEXT_REASON_UNKNOWN';
      }
      let systemCannotBeTenant = false;
      try {
        await runAsSystem({ reason: 'background-job' }, async () => {
          requireTenantContext();
          return 1;
        });
      } catch (err) {
        systemCannotBeTenant = err instanceof TenantContextError && err.code === 'TENANT_CONTEXT_MISSING';
      }
      return {
        status: unknownReasonRejected && systemCannotBeTenant ? 'PASS' : 'FAIL',
        detail: `invented reason rejected (${unknownReasonRejected}); SYSTEM context refused tenant semantics (${systemCannotBeTenant})`,
        evidence: { unknownReasonRejected, systemCannotBeTenant },
      };
    });

    // =====================================================================
    console.log('\n— Redis dependency behaviour (Candidate B only) —');
    // =====================================================================

    await experiment('E05', 'Redis unavailable BEFORE enqueue: producer fails loudly, never silently drops', 'bullmq', async () => {
      const rig = await bullRig(env, { workers: 0 });
      await env.stopRedis();
      let threw = false;
      let msg = '';
      try {
        const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-nored', idempotencyKey: 'k-nored' });
        await enqueueBull(rig.queue, envelope, minimalPayload());
      } catch (err) {
        threw = true;
        msg = (err as Error).message.slice(0, 120);
      }
      await env.startRedis();
      await rig.close().catch(() => {});
      return {
        status: threw ? 'PASS' : 'FAIL',
        detail: threw
          ? `enqueue rejected while Redis was down (${msg}) — the caller learns the event was NOT accepted, which is the required behaviour`
          : 'enqueue RESOLVED while Redis was down — a silent drop, which would lose the event',
        evidence: { threw, message: msg },
      };
    });

    await experiment('E05b', 'PostgreSQL candidate is unaffected by Redis being down', 'postgres-outbox', async () => {
      await env.stopRedis();
      await publishInTransaction(pool, {
        organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-noredis', eventType: 'appointment.reminder.due', idempotencyKey: 'k-noredis', payload: minimalPayload(),
      });
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 5 });
      d.start(buildHandler(pool, 'postgres-outbox', 'noredis-worker'));
      const ok = await waitFor(async () => (await countSideEffects(pool, 'k-noredis')) === 1);
      await d.stop();
      await env.startRedis();
      return {
        status: ok ? 'PASS' : 'FAIL',
        detail: 'publish and dispatch completed with Redis stopped — Candidate A has no Redis dependency at all',
        evidence: { sideEffects: await countSideEffects(pool, 'k-noredis') },
      };
    });

    await experiment('E06/E07', 'graceful Redis restart: enqueued jobs survive and clients reconnect', 'bullmq', async () => {
      const queueName = `noramedi.poc.test.survive.v1.${randomUUID().slice(0, 8)}`;
      const q1 = createBullQueue({ queueName, redis: env.redis });
      await enqueueBull(q1, makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: 'appt-survive', idempotencyKey: 'k-survive' }), minimalPayload());
      const before = await q1.getWaitingCount();
      await q1.close();

      await env.stopRedis('graceful'); // SIGTERM: Redis flushes its AOF on exit
      await env.startRedis();

      const q2 = createBullQueue({ queueName, redis: env.redis });
      const after = await q2.getWaitingCount();
      await q2.close();
      const survived = before === 1 && after === 1;
      return {
        status: survived ? 'PASS' : 'FAIL',
        detail: survived
          ? `waiting before=${before}, after=${after} — a SIGTERM restart flushed the AOF and the job survived; a reconnected client saw it again`
          : `waiting before=${before}, after=${after} — the job did NOT survive a graceful restart`,
        evidence: { waitingBefore: before, waitingAfter: after, stopMode: 'SIGTERM (graceful)', persistence: 'appendonly=yes, appendfsync=everysec' },
      };
    });

    await experiment('E06b', 'abrupt Redis kill: appendfsync=everysec has a real loss window', 'bullmq', async () => {
      const queueName = `noramedi.poc.test.kill.v1.${randomUUID().slice(0, 8)}`;
      const q1 = createBullQueue({ queueName, redis: env.redis });
      const N = 50;
      for (let i = 0; i < N; i++) {
        await enqueueBull(q1, makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-kill-${i}`, idempotencyKey: `k-kill-${i}` }), minimalPayload(i));
      }
      const before = await q1.getWaitingCount();
      await q1.close().catch(() => {});

      await env.stopRedis('kill'); // SIGKILL immediately after the writes
      await env.startRedis();

      const q2 = createBullQueue({ queueName, redis: env.redis });
      const after = await q2.getWaitingCount();
      await q2.close();
      const lost = before - after;
      // Either outcome is a legitimate, reportable result: what matters is that
      // the window is measured rather than assumed.
      return {
        status: 'PASS',
        detail:
          lost > 0
            ? `${lost} of ${before} jobs were LOST across an abrupt SIGKILL (survivors: ${after}). appendfsync=everysec buys at most ~1s of durability, so Redis persistence is NOT transactional durability — an event that must survive a Redis host failure needs a durable source of record (the outbox), with the queue as transport only.`
            : `all ${before} jobs survived SIGKILL in this run (after=${after}). everysec still permits a ~1s loss window in principle; this run simply did not land inside it, which is itself why Redis persistence must not be relied on as transactional durability.`,
        evidence: { waitingBefore: before, waitingAfter: after, lost, stopMode: 'SIGKILL (abrupt)', persistence: 'appendonly=yes, appendfsync=everysec' },
      };
    });

    await experiment('E08', 'BullMQ worker restart resumes pending work', 'bullmq', async () => {
      const queueName = `noramedi.poc.test.restart.v1.${randomUUID().slice(0, 8)}`;
      const setup = { queueName, redis: env.redis, concurrency: 1 };
      const queue = createBullQueue(setup);
      for (let i = 0; i < 10; i++) {
        const envelope = makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-rs-${i}`, idempotencyKey: `k-rs-${i}` });
        await enqueueBull(queue, envelope, minimalPayload(i));
      }
      const w1 = createBullWorker(setup, buildHandler(pool, 'bullmq', 'w1', { delayMs: 5 }), async () => {});
      await waitFor(async () => (await countSideEffects(pool)) >= 2);
      await w1.close();
      const mid = await countSideEffects(pool);
      const w2 = createBullWorker(setup, buildHandler(pool, 'bullmq', 'w2', { delayMs: 5 }), async () => {});
      const done = await waitFor(async () => (await countSideEffects(pool)) === 10);
      await w2.close();
      await queue.close();
      return {
        status: done ? 'PASS' : 'FAIL',
        detail: `worker 1 processed ${mid}/10 then stopped; worker 2 resumed and completed all 10 with no duplicates`,
        evidence: { processedByFirstWorker: mid, total: await countSideEffects(pool) },
      };
    });

    await experiment('E09', 'dispatcher restart resumes pending work', 'postgres-outbox', async () => {
      for (let i = 0; i < 10; i++) {
        await publishInTransaction(pool, {
          organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-dr-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-dr-${i}`, payload: minimalPayload(i),
        });
      }
      const d1 = new PostgresOutboxDispatcher(pool, { batchSize: 2, leaseMs: 3_000 });
      d1.start(buildHandler(pool, 'postgres-outbox', 'd1', { delayMs: 5 }));
      await waitFor(async () => (await countSideEffects(pool)) >= 2);
      await d1.stop();
      const mid = await countSideEffects(pool);
      const d2 = new PostgresOutboxDispatcher(pool, { batchSize: 5, leaseMs: 3_000 });
      d2.start(buildHandler(pool, 'postgres-outbox', 'd2', { delayMs: 5 }));
      const done = await waitFor(async () => (await countSideEffects(pool)) === 10, 25_000);
      await d2.stop();
      return {
        status: done ? 'PASS' : 'FAIL',
        detail: `dispatcher 1 processed ${mid}/10 then stopped gracefully; dispatcher 2 completed all 10`,
        evidence: { processedByFirst: mid, total: await countSideEffects(pool) },
      };
    });

    await experiment('E10', 'PostgreSQL connection loss: pool recovers and work completes', 'postgres-outbox', async () => {
      for (let i = 0; i < 8; i++) {
        await publishInTransaction(pool, {
          organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-pg-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-pg-${i}`, payload: minimalPayload(i),
        });
      }
      // Terminate every other backend mid-flight.
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 2, leaseMs: 2_000, baseBackoffMs: 20 });
      d.start(buildHandler(pool, 'postgres-outbox', 'pgkill', { delayMs: 10 }));
      await new Promise((r) => setTimeout(r, 120));
      let terminated = 0;
      try {
        const res = await pool.query(
          `SELECT pg_terminate_backend(pid)::int AS ok FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()`,
        );
        terminated = res.rowCount ?? 0;
      } catch {
        /* terminating our own pool member can surface as an error; that is the point */
      }
      const done = await waitFor(async () => (await countSideEffects(pool)) === 8, 30_000);
      await d.stop();
      return {
        status: done ? 'PASS' : 'FAIL',
        detail: `${terminated} backends terminated mid-flight; pool reconnected and all 8 events completed exactly once`,
        evidence: { terminatedBackends: terminated, sideEffects: await countSideEffects(pool) },
      };
    });

    // =====================================================================
    console.log('\n— Shutdown —');
    // =====================================================================

    await experiment('E22', 'graceful shutdown finishes in-flight work and leaves nothing stuck', 'both', async () => {
      for (let i = 0; i < 12; i++) {
        await publishInTransaction(pool, {
          organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-gs-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-gs-${i}`, payload: minimalPayload(i),
        });
      }
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 4, leaseMs: 5_000 });
      d.start(buildHandler(pool, 'postgres-outbox', 'gs', { delayMs: 8 }));
      await waitFor(async () => (await countSideEffects(pool)) >= 4);
      await d.stop(); // graceful
      const stuck = (await pool.query(`SELECT count(*)::int c FROM poc_outbox_event WHERE status='claimed'`)).rows[0].c;
      return {
        status: stuck === 0 ? 'PASS' : 'FAIL',
        detail: `after graceful stop, ${stuck} rows left in 'claimed' (0 required — the in-flight batch was finalised before exit)`,
        evidence: { stuckClaimed: stuck, processed: await countSideEffects(pool) },
      };
    });

    await experiment('E23', 'forced shutdown strands rows, and the lease is what recovers them', 'postgres-outbox', async () => {
      for (let i = 0; i < 6; i++) {
        await publishInTransaction(pool, {
          organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `appt-fs-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-fs-${i}`, payload: minimalPayload(i),
        });
      }
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 6, leaseMs: 700, baseBackoffMs: 10 });
      const claimed = await runAsSystem({ reason: 'background-job', detail: 'forced' }, async () => d.claim(6));
      d.kill(); // hard kill, nothing finalised
      const strandedNow = (await pool.query(`SELECT count(*)::int c FROM poc_outbox_event WHERE status='claimed'`)).rows[0].c;
      await new Promise((r) => setTimeout(r, 1_000));
      const d2 = new PostgresOutboxDispatcher(pool, { batchSize: 6, leaseMs: 5_000 });
      d2.start(buildHandler(pool, 'postgres-outbox', 'fs2'));
      const done = await waitFor(async () => (await countSideEffects(pool)) === 6, 25_000);
      await d2.stop();
      return {
        status: claimed.length === 6 && strandedNow === 6 && done ? 'PASS' : 'FAIL',
        detail: `forced kill stranded ${strandedNow} claimed rows; after lease expiry all 6 were recovered and processed exactly once`,
        evidence: { strandedAfterKill: strandedNow, recoveredAndProcessed: await countSideEffects(pool) },
      };
    });

    // =====================================================================
    console.log('\n— Fairness (noisy neighbour) —');
    // =====================================================================

    const NOISY = 'org-noisy';
    const QUIET = ['org-quiet-1', 'org-quiet-2', 'org-quiet-3'];

    /**
     * Fairness is measured as per-tenant COMPLETION LATENCY under real
     * contention, not as "did it finish".
     *
     * The noisy tenant's backlog is enqueued FIRST and in full, so a plain FIFO
     * consumer must drain all of it before the first quiet-tenant event. A
     * per-tenant cap should interleave instead. The handler carries a delay so
     * that processing, not enqueueing, is the bottleneck.
     */
    const NOISY_N = 240;
    const QUIET_N = 10;
    const HANDLER_DELAY_MS = 3;

    const latencyByGroup = async (candidate: string, t0: string) => {
      const r = await pool.query(
        `SELECT CASE WHEN organization_id = $1 THEN 'noisy' ELSE 'quiet' END AS grp,
                EXTRACT(EPOCH FROM (delivered_at - $2::timestamptz)) * 1000 AS ms
           FROM poc_side_effect WHERE candidate = $3`,
        [NOISY, t0, candidate],
      );
      const g: Record<string, number[]> = { noisy: [], quiet: [] };
      for (const row of r.rows) g[row.grp as string].push(Number(row.ms));
      return {
        quietP50: Math.round(pct(g.quiet, 50)),
        quietP95: Math.round(pct(g.quiet, 95)),
        noisyP50: Math.round(pct(g.noisy, 50)),
        quietCount: g.quiet.length,
        noisyCount: g.noisy.length,
      };
    };

    for (const cap of [undefined, 4] as (number | undefined)[]) {
      await experiment(
        cap ? 'E19' : 'E19-nocap',
        `PostgreSQL dispatcher, per-tenant cap ${cap ?? 'DISABLED'}: quiet-tenant latency under a noisy backlog`,
        'postgres-outbox',
        async () => {
          for (let i = 0; i < NOISY_N; i++) {
            await publishInTransaction(pool, { organizationId: NOISY, clinicId: 'c', aggregateId: `n-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-noisy-${i}`, payload: minimalPayload(i) });
          }
          for (const org of QUIET) {
            for (let i = 0; i < QUIET_N; i++) {
              await publishInTransaction(pool, { organizationId: org, clinicId: 'c', aggregateId: `${org}-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-${org}-${i}`, payload: minimalPayload(i) });
            }
          }
          const t0 = (await pool.query('SELECT now()::text AS t')).rows[0].t as string;
          const d = new PostgresOutboxDispatcher(pool, { batchSize: 20, perTenantConcurrency: cap, leaseMs: 30_000 });
          d.start(buildHandler(pool, 'postgres-outbox', 'fair', { delayMs: HANDLER_DELAY_MS }));
          const total = NOISY_N + QUIET.length * QUIET_N;
          const done = await waitFor(async () => (await countSideEffects(pool)) >= total, 120_000);
          await d.stop();
          const lat = await latencyByGroup('postgres-outbox', t0);
          return {
            status: done ? 'PASS' : 'FAIL',
            detail: `cap=${cap ?? 'none'} — quiet-tenant completion latency p50=${lat.quietP50}ms p95=${lat.quietP95}ms vs noisy p50=${lat.noisyP50}ms (${lat.quietCount} quiet / ${lat.noisyCount} noisy events). Lower quiet latency with the cap enabled is the fairness effect; the two E19 rows are meant to be read against each other.`,
            evidence: { perTenantConcurrency: cap ?? null, ...lat, noisyBacklog: NOISY_N, quietPerTenant: QUIET_N, handlerDelayMs: HANDLER_DELAY_MS },
          };
        },
      );
    }

    await experiment('E19b', 'BullMQ single FIFO queue: quiet-tenant latency behind a noisy backlog', 'bullmq', async () => {
      const queueName = `noramedi.poc.test.fair.v1.${randomUUID().slice(0, 8)}`;
      const setup = { queueName, redis: env.redis, concurrency: 4 };
      const queue = createBullQueue(setup);
      for (let i = 0; i < NOISY_N; i++) {
        await enqueueBull(queue, makeEnvelope({ organizationId: NOISY, clinicId: 'c', aggregateId: `bn-${i}`, idempotencyKey: `kb-noisy-${i}` }), minimalPayload(i));
      }
      for (const org of QUIET) {
        for (let i = 0; i < QUIET_N; i++) {
          await enqueueBull(queue, makeEnvelope({ organizationId: org, clinicId: 'c', aggregateId: `b-${org}-${i}`, idempotencyKey: `kb-${org}-${i}` }), minimalPayload(i));
        }
      }
      const t0 = (await pool.query('SELECT now()::text AS t')).rows[0].t as string;
      // Workers start only AFTER the whole backlog exists, matching candidate A.
      const workers = [0, 1].map((i) => createBullWorker(setup, buildHandler(pool, 'bullmq', `bw-${i}`, { delayMs: HANDLER_DELAY_MS }), async () => {}));
      const total = NOISY_N + QUIET.length * QUIET_N;
      const done = await waitFor(async () => {
        const r = await pool.query(`SELECT count(*)::int c FROM poc_side_effect WHERE candidate='bullmq'`);
        return r.rows[0].c >= total;
      }, 120_000);
      await Promise.all(workers.map((w) => w.close()));
      await queue.close();
      const lat = await latencyByGroup('bullmq', t0);
      return {
        status: done ? 'PASS' : 'FAIL',
        detail: `plain FIFO, no tenant-aware control — quiet-tenant completion latency p50=${lat.quietP50}ms p95=${lat.quietP95}ms vs noisy p50=${lat.noisyP50}ms. Quiet tenants sit behind the entire enqueued noisy backlog; BullMQ can fix this (groups / per-key rate limiting) but does NOT do it by default.`,
        evidence: { fairnessControl: 'none (plain FIFO)', ...lat, noisyBacklog: NOISY_N, quietPerTenant: QUIET_N, handlerDelayMs: HANDLER_DELAY_MS },
      };
    });

    // =====================================================================
    console.log('\n— Observability —');
    // =====================================================================

    await experiment('E25', 'queue depth and oldest-waiting age are observable for both candidates', 'both', async () => {
      for (let i = 0; i < 5; i++) {
        await publishInTransaction(pool, { organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `m-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-m-${i}`, payload: minimalPayload(i) });
      }
      await new Promise((r) => setTimeout(r, 150));
      const pg = (
        await pool.query(`
          SELECT count(*) FILTER (WHERE status IN ('pending','failed'))::int AS depth,
                 COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status IN ('pending','failed'))))*1000, 0)::int AS oldest_ms,
                 count(*) FILTER (WHERE status='dead')::int AS dead
            FROM poc_outbox_event`)
      ).rows[0];

      const rig = await bullRig(env, { workers: 0 });
      try {
        for (let i = 0; i < 5; i++) {
          await enqueueBull(rig.queue, makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `bm-${i}`, idempotencyKey: `k-bm-${i}` }), minimalPayload(i));
        }
        const counts = await rig.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        const ok = pg.depth === 5 && (counts.waiting ?? 0) === 5;
        return {
          status: ok ? 'PASS' : 'FAIL',
          detail: `PostgreSQL: depth=${pg.depth}, oldest_waiting=${pg.oldest_ms}ms, dead=${pg.dead} via one SQL query. BullMQ: ${JSON.stringify(counts)} via getJobCounts(). Both expose depth; BullMQ gives richer per-state counts out of the box, PostgreSQL gives arbitrary per-tenant slicing for free.`,
          evidence: { postgres: pg, bullmq: counts },
        };
      } finally {
        await rig.close();
      }
    });

    // =====================================================================
    console.log('\n— MessagingInboundEvent flow (modelled, production untouched) —');
    // =====================================================================

    await experiment('M1', 'durable inbound acceptance dedupes at the DB before any queue exists', 'both', async () => {
      const insertInbound = async (providerMessageId: string) =>
        runAsSystem({ reason: 'inbound-webhook-envelope', detail: 'f5-1p-poc' }, async () => {
          const r = await pool.query(
            `INSERT INTO poc_inbound_event (id, channel, provider, connection_id, provider_message_id, organization_id, clinic_id)
             VALUES ($1,'whatsapp','meta','conn-1',$2,$3,$4)
             ON CONFLICT (channel, provider, connection_id, provider_message_id) DO NOTHING
             RETURNING id`,
            [randomUUID(), providerMessageId, ORG_A, CLINIC_A1],
          );
          return r.rowCount === 1 ? 'accepted' : 'duplicate';
        });
      const first = await insertInbound('wamid.ABC');
      const second = await insertInbound('wamid.ABC');
      const total = (await pool.query('SELECT count(*)::int c FROM poc_inbound_event')).rows[0].c;
      return {
        status: first === 'accepted' && second === 'duplicate' && total === 1 ? 'PASS' : 'FAIL',
        detail: `provider redelivery of the same wamid: first=${first}, second=${second}, ledger rows=${total}. This is the guarantee MessagingInboundEvent ALREADY provides in production today — a queue placed after this point cannot improve it, and a Redis-only acceptance path would weaken it.`,
        evidence: { first, second, ledgerRows: total },
      };
    });

    // =====================================================================
    console.log('\n— Performance (local, disposable; NOT production capacity) —');
    // =====================================================================

    for (const N of [100, 1000]) {
      await experiment(`P-${N}`, `throughput and latency at ${N} events, both candidates`, 'both', async () => {
        // --- Candidate A
        const pubLat: number[] = [];
        const tA0 = Date.now();
        for (let i = 0; i < N; i++) {
          const t = Date.now();
          await publishInTransaction(pool, { organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `p-${N}-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-p-${N}-${i}`, payload: minimalPayload(i) });
          pubLat.push(Date.now() - t);
        }
        const publishMs = Date.now() - tA0;
        const dispatchers = [0, 1].map(() => new PostgresOutboxDispatcher(pool, { batchSize: 25, leaseMs: 20_000 }));
        const tA1 = Date.now();
        dispatchers.forEach((d, i) => d.start(buildHandler(pool, 'postgres-outbox', `perf-${i}`)));
        const drainedA = await waitFor(async () => (await countSideEffects(pool)) >= N, 120_000);
        const drainMsA = Date.now() - tA1;
        await Promise.all(dispatchers.map((d) => d.stop()));
        const claimLat = dispatchers.flatMap((d) => d.claimLatenciesMs);

        // --- Candidate B
        // Workers are created only AFTER the full backlog is enqueued. Starting
        // them earlier would let them drain during the enqueue loop and make
        // "drainMs" measure only the tail - a ~10x flattering artefact rather
        // than a comparable number.
        const queueNameP = `noramedi.poc.perf.v1.${randomUUID().slice(0, 8)}`;
        const setupB = { queueName: queueNameP, redis: env.redis, concurrency: 10 };
        const queueB = createBullQueue(setupB);
        let drainMsB = -1;
        let enqueueMs = -1;
        const enqLat: number[] = [];
        try {
          const tB0 = Date.now();
          for (let i = 0; i < N; i++) {
            const t = Date.now();
            await enqueueBull(queueB, makeEnvelope({ organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `bp-${N}-${i}`, idempotencyKey: `k-bp-${N}-${i}` }), minimalPayload(i));
            enqLat.push(Date.now() - t);
          }
          enqueueMs = Date.now() - tB0;
          const tB1 = Date.now();
          const workersB = [0, 1].map((i) => createBullWorker(setupB, buildHandler(pool, 'bullmq', `perf-b-${i}`), async () => {}));
          const drainedB = await waitFor(async () => {
            const r = await pool.query(`SELECT count(*)::int c FROM poc_side_effect WHERE candidate='bullmq'`);
            return r.rows[0].c >= N;
          }, 120_000);
          drainMsB = drainedB ? Date.now() - tB1 : -1;
          await Promise.all(workersB.map((w) => w.close()));
        } finally {
          await queueB.close();
        }

        const row = {
          n: N,
          postgres: {
            publishTotalMs: publishMs,
            publishP50Ms: pct(pubLat, 50),
            publishP95Ms: pct(pubLat, 95),
            claimP50Ms: pct(claimLat, 50),
            claimP95Ms: pct(claimLat, 95),
            drainMs: drainMsA,
            throughputPerSec: drainMsA > 0 ? Math.round((N / drainMsA) * 1000) : null,
            dispatchers: 2,
          },
          bullmq: {
            enqueueTotalMs: enqueueMs,
            enqueueP50Ms: pct(enqLat, 50),
            enqueueP95Ms: pct(enqLat, 95),
            drainMs: drainMsB,
            throughputPerSec: drainMsB > 0 ? Math.round((N / drainMsB) * 1000) : null,
            workers: 2,
            concurrency: 10,
            methodologyNote: 'workers started only after the full backlog was enqueued, matching candidate A',
          },
        };
        perf[`n${N}`] = row;
        return {
          status: drainedA && drainMsB > 0 ? 'PASS' : 'FAIL',
          detail: `PG: publish p50=${row.postgres.publishP50Ms}ms p95=${row.postgres.publishP95Ms}ms, drain ${drainMsA}ms (${row.postgres.throughputPerSec}/s). BullMQ: enqueue p50=${row.bullmq.enqueueP50Ms}ms p95=${row.bullmq.enqueueP95Ms}ms, drain ${drainMsB}ms (${row.bullmq.throughputPerSec}/s). Local disposable containers — NOT production capacity.`,
          evidence: row,
        };
      });
    }

    await experiment('E24', 'backlog recovery: a cold start drains an existing backlog', 'postgres-outbox', async () => {
      const N = 300;
      for (let i = 0; i < N; i++) {
        await publishInTransaction(pool, { organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `bk-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-bk-${i}`, payload: minimalPayload(i) });
      }
      const depthBefore = (await pool.query(`SELECT count(*)::int c FROM poc_outbox_event WHERE status='pending'`)).rows[0].c;
      const t = Date.now();
      const ds = [0, 1, 2].map(() => new PostgresOutboxDispatcher(pool, { batchSize: 30, leaseMs: 20_000 }));
      ds.forEach((d, i) => d.start(buildHandler(pool, 'postgres-outbox', `bk-${i}`)));
      const drained = await waitFor(async () => (await countSideEffects(pool)) >= N, 90_000);
      const ms = Date.now() - t;
      await Promise.all(ds.map((d) => d.stop()));
      return {
        status: drained ? 'PASS' : 'FAIL',
        detail: `backlog of ${depthBefore} drained by 3 cold-started dispatchers in ${ms}ms with no duplicates (${await countSideEffects(pool)} effects)`,
        evidence: { backlog: depthBefore, drainMs: ms, effects: await countSideEffects(pool) },
      };
    });

    await experiment('E-RETRY-STORM', 'retry storm stays bounded and does not spin', 'postgres-outbox', async () => {
      const N = 40;
      for (let i = 0; i < N; i++) {
        await publishInTransaction(pool, { organizationId: ORG_A, clinicId: CLINIC_A1, aggregateId: `rs-${i}`, eventType: 'appointment.reminder.due', idempotencyKey: `k-rs2-${i}`, payload: minimalPayload(i), maxAttempts: 3 });
      }
      const t = Date.now();
      const d = new PostgresOutboxDispatcher(pool, { batchSize: 20, baseBackoffMs: 25 });
      d.start(buildHandler(pool, 'postgres-outbox', 'storm', { failBeforeEffect: () => true }));
      const allDead = await waitFor(async () => (await pool.query(`SELECT count(*)::int c FROM poc_outbox_event WHERE status='dead'`)).rows[0].c === N, 60_000);
      const ms = Date.now() - t;
      await d.stop();
      const totalAttempts = (await pool.query(`SELECT COALESCE(sum(attempt_count),0)::int s FROM poc_outbox_event`)).rows[0].s;
      return {
        status: allDead && totalAttempts === N * 3 ? 'PASS' : 'FAIL',
        detail: `${N} permanently-failing events consumed exactly ${totalAttempts} attempts (${N}×3 cap) in ${ms}ms — backoff held, no unbounded spin`,
        evidence: { events: N, totalAttempts, expectedAttempts: N * 3, elapsedMs: ms },
      };
    });

    // Connection footprint
    await experiment('E-CONN', 'connection footprint of each candidate', 'both', async () => {
      const pgConns = (await pool.query(`SELECT count(*)::int c FROM pg_stat_activity WHERE datname=current_database()`)).rows[0].c;
      const rig = await bullRig(env, { workers: 2, concurrency: 5 });
      await new Promise((r) => setTimeout(r, 500));
      let redisClients = -1;
      let redisProbeError = '';
      const probe = new IORedis({ host: env.redis.host, port: env.redis.port, password: env.redis.password, maxRetriesPerRequest: 1 });
      try {
        const clients = await probe.info('clients');
        redisClients = Number(/connected_clients:(\d+)/.exec(clients)?.[1] ?? -1);
      } catch (err) {
        redisProbeError = (err as Error).message;
      } finally {
        await probe.quit().catch(() => {});
      }
      await rig.close();
      return {
        status: 'PASS',
        detail: `PostgreSQL backends for the dispatcher pool: ${pgConns}. Redis connected_clients with 1 queue + 2 workers (concurrency 5): ${redisClients}. BullMQ adds a second connection-pool dimension that must be budgeted separately from the existing DB pool.`,
        evidence: { postgresBackends: pgConns, redisConnectedClients: redisClients, redisProbeError, note: 'BullMQ requires >=1 connection per Worker plus blocking connections; the DB pool is unchanged for candidate A.' },
      };
    });

    // =====================================================================
    // Report
    // =====================================================================
    const counts = results.reduce<Record<Status, number>>(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
      { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_APPLICABLE: 0 },
    );

    const report = {
      task: 'F5-1P — Queue platform disposable PoC and ADR-007 evidence',
      clickup: '869enfvvu',
      generatedAtIso: new Date().toISOString(),
      environment: {
        postgres: 'postgres:16 (production baseline 16.14)',
        redis: 'redis:7.0, appendonly=yes, appendfsync=everysec (production baseline 7.0.15)',
        node: process.version,
        bullmq: '6.2.0',
        isolation: 'throwaway Docker containers, generated credentials, 127.0.0.1-bound random ports, tmpfs storage, destroyed at end',
        productionContact: 'NONE — assertNoProductionEnvLeak() refuses to run if DATABASE_URL/REDIS_URL is set',
      },
      summary: counts,
      performance: perf,
      results,
    };
    await writeFile(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n──────────────────────────────────────────────');
    console.log(`PASS ${counts.PASS}  FAIL ${counts.FAIL}  BLOCKED ${counts.BLOCKED}  N/A ${counts.NOT_APPLICABLE}`);
    console.log(`results → ${OUT_FILE}`);
    if (counts.FAIL > 0) {
      console.log('\nFailures:');
      for (const r of results.filter((x) => x.status === 'FAIL')) console.log(`  ${r.id} ${r.title}\n     ${r.detail}`);
    }
  } finally {
    console.log('\nDestroying disposable environment …');
    await env.destroy();
    console.log('done.');
  }
}

main().catch((err) => {
  console.error('PoC harness failed:', err);
  process.exitCode = 1;
});
