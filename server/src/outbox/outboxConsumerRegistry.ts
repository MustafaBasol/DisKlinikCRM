/**
 * outboxConsumerRegistry.ts — F5-2 the infrastructure/domain seam.
 *
 * ADR-001 (modular monolith) draws a line this file has to hold. On one side,
 * INFRASTRUCTURE owns storage, claiming, leases, retry, dead-lettering, replay
 * plumbing and metrics — none of which know what an appointment is. On the
 * other, a DOMAIN owns what its event means, what its payload contains, what
 * "already done" means for it, and what a duplicate must do.
 *
 * The failure mode this prevents is the one F0-004 already documented across 37
 * domains: infrastructure reaching directly into domain tables because it is
 * convenient. A dispatcher that imports `prisma.appointment` to "just check
 * something" has quietly become a thirty-eighth domain with a dependency on all
 * the others.
 *
 * So the dispatcher knows exactly one thing about a consumer: this interface.
 * It hands over a validated envelope and receives an outcome. It never sees the
 * message, the patient, or the provider.
 *
 * A consumer, symmetrically, never sees the outbox row, never touches
 * `status`/`attemptCount`/`leaseExpiresAt`, and cannot decide its own retry
 * policy beyond classifying its failure. Retry is an infrastructure decision
 * made from the registered contract.
 */

import type { OutboxEventContract } from './outboxEventRegistry.js';

/**
 * What the dispatcher hands a consumer. Deliberately minimal: identifiers, the
 * validated payload, and tenancy. No Prisma client, no transaction, no row.
 */
export interface OutboxConsumerContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly organizationId: string;
  readonly clinicId: string | null;
  readonly aggregateId: string;
  /** Already validated against the contract's field allowlist. */
  readonly payload: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
  /** 1-based; the attempt currently being made. */
  readonly attemptCount: number;
  readonly contract: OutboxEventContract;
}

/**
 * The outcome a consumer reports for an attempt it actually performed.
 *
 * `SKIPPED` is not a failure and not a success-with-side-effect: it is the
 * consumer stating that the obligation no longer applies (the appointment was
 * cancelled before the confirmation went out, the request was deleted). The
 * event is finalised as processed and never retried — retrying an obligation
 * that no longer exists is pure load.
 */
export type OutboxConsumerOutcome =
  | { readonly result: 'APPLIED'; readonly outcomeCode: string }
  | { readonly result: 'SKIPPED'; readonly outcomeCode: string };

/**
 * A registered consumer.
 *
 * `handle` MUST either return an outcome or throw. It must throw
 * `OutboxConsumerError` with a category whenever it can classify the failure;
 * anything else is treated as `UNKNOWN` (retryable, shortest budget), which is
 * the fail-safe direction.
 *
 * `handle` is responsible for its OWN business idempotency via
 * `outboxIdempotency.ts` — the dispatcher does not call the ledger on the
 * consumer's behalf, because only the consumer knows exactly where in its own
 * sequence the irreversible step is.
 */
export interface OutboxConsumer {
  readonly consumerKey: string;
  /** One line: which domain owns this and what it does. */
  readonly description: string;
  handle(ctx: OutboxConsumerContext): Promise<OutboxConsumerOutcome>;
}

/**
 * Consumers are REGISTERED, not discovered.
 *
 * A registry built by scanning a directory would make "which code runs for this
 * event" depend on the filesystem, and would make an accidental import a
 * production behaviour change. This list is the whole answer, and adding to it
 * is a reviewable diff.
 */
const CONSUMERS = new Map<string, OutboxConsumer>();

export function registerOutboxConsumer(consumer: OutboxConsumer): void {
  if (CONSUMERS.has(consumer.consumerKey)) {
    throw new Error(
      `Outbox consumer "${consumer.consumerKey}" is already registered. Two handlers for one ` +
        'contract means the effective behaviour depends on import order.',
    );
  }
  CONSUMERS.set(consumer.consumerKey, consumer);
}

export function getOutboxConsumer(consumerKey: string): OutboxConsumer | undefined {
  return CONSUMERS.get(consumerKey);
}

export function getRegisteredConsumerKeys(): readonly string[] {
  return Object.freeze([...CONSUMERS.keys()].sort());
}

/**
 * Test-only: clears the registry so a suite can register a fake consumer
 * against a real contract. Never called by production code — `startOutbox`
 * registers once at process start.
 */
export function resetOutboxConsumersForTest(): void {
  CONSUMERS.clear();
}
