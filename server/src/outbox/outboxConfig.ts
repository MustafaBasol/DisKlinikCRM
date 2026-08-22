/**
 * outboxConfig.ts — F5-2 rollout and cutover controls.
 *
 * TWO FLAGS, NOT ONE, AND THE ORDER MATTERS
 * -----------------------------------------
 * `OUTBOX_DISPATCH_ENABLED` starts the dispatcher. `OUTBOX_PRODUCER_ENABLED`
 * switches a producer from its current inline post-commit behaviour to writing
 * an outbox row inside the business transaction.
 *
 * They are separate because a single flag has an unsafe intermediate state in
 * BOTH directions:
 *
 *   - one flag turned ON: rows start being produced at the same instant the
 *     dispatcher starts; if the dispatcher fails to start (bad config, crash
 *     loop) the confirmations silently stop going out, with nothing draining
 *     the table.
 *   - one flag turned OFF: production stops and draining stops together, so
 *     already-published rows are stranded.
 *
 * THE ONLY SAFE ORDERS ARE THEREFORE:
 *   rollout:  dispatcher ON (drains an empty table, proves it runs) -> producer ON
 *   rollback: producer OFF (inline path resumes immediately) -> let the
 *             dispatcher drain -> dispatcher OFF
 *
 * Both default to OFF. A deployment of this branch changes no runtime behaviour
 * until someone sets a flag, which is what makes the migration safe to ship
 * ahead of the application.
 *
 * FLAG SEMANTICS follow the repository convention used by
 * CLINIC_BULK_EXPORT_ENABLED: the value must be exactly `'true'` to enable.
 * Anything else — unset, empty, `'1'`, `'yes'`, a typo — is OFF. A feature that
 * can be switched on by a typo is not a kill switch.
 */

function isEnabled(raw: string | undefined): boolean {
  return raw === 'true';
}

/** Whether this process should schedule and run the outbox dispatcher. */
export function isOutboxDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.OUTBOX_DISPATCH_ENABLED);
}

/**
 * Whether producers should publish outbox events instead of performing their
 * current inline post-commit side effect.
 *
 * Read at the CALL SITE on every publish, never snapshotted at module load —
 * the clinic-bulk-export worker's own remediation history (a stale in-memory
 * flag snapshot surviving a PM2 rolling reload) is the reason.
 */
export function isOutboxProducerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.OUTBOX_PRODUCER_ENABLED);
}

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Rows claimed per dispatcher tick. Bounded so one tick cannot monopolise the pool. */
export function getOutboxClaimBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntFromEnv(env.OUTBOX_CLAIM_BATCH_SIZE, 20);
}

/**
 * How long a claim is valid without being finalised. A dispatcher that dies
 * mid-flight lets this pass and the row becomes reclaimable — this IS the crash
 * recovery mechanism (F5-1P E03/E17/E23), so it must comfortably exceed the
 * slowest legitimate consumer call plus its provider timeout.
 */
export function getOutboxLeaseMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntFromEnv(env.OUTBOX_LEASE_MS, 5 * 60 * 1000);
}

/**
 * Consumer-side idempotency lease. Shorter than the event lease is WRONG: it
 * would let a second dispatcher declare the first one's still-running side
 * effect "ambiguous". Kept equal to the event lease by default for that reason.
 */
export function getOutboxConsumerLeaseMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntFromEnv(env.OUTBOX_CONSUMER_LEASE_MS, getOutboxLeaseMs(env));
}

/** Dispatcher cron expression. Minute granularity matches the other workers. */
export function getOutboxDispatchCron(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OUTBOX_DISPATCH_CRON;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '*/1 * * * *';
}

/**
 * Identifies THIS dispatcher instance in `claimedBy` / `executedBy`.
 *
 * Deliberately not the hostname alone: PM2 runs several processes per host and
 * two of them claiming under the same identity would make a lease impossible to
 * attribute. Never PII, never a secret — it is persisted and logged.
 */
export function buildOutboxDispatcherId(env: NodeJS.ProcessEnv = process.env): string {
  const instance = env.NODE_APP_INSTANCE ?? env.pm_id ?? '0';
  return `outbox-dispatcher:${process.pid}:${instance}`;
}
