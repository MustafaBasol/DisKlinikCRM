/**
 * outboxProducer.ts — F5-2 the ONLY way to publish a durable event.
 *
 * THE ONE INVARIANT
 * -----------------
 * A business state change and the obligation it creates are written in the SAME
 * database transaction. Not "shortly after". Not "in a finally". In the same
 * transaction, so that:
 *
 *     rollback -> neither the business row nor the event exists
 *     commit   -> both exist, and the obligation survives the process dying in
 *                 the very next instruction
 *
 * F5-1P measured this as experiments E11 (rollback: 0 appointments, 0 events),
 * E11b (commit: 1, 1) and E11c (a Redis-backed queue keeps the job after the
 * business transaction rolls back — an orphan event pointing at a row that does
 * not exist). It is the single property the outbox has that a queue
 * structurally cannot have on its own, and it is the entire reason this module
 * exists.
 *
 * MAKING THE SAFE PATH THE ONLY PATH
 * ----------------------------------
 * The failure this design is defending against is not malice, it is
 * convenience: someone writes
 *
 *     await prisma.$transaction(...)      // business change commits
 *     await publishOutboxEvent(...)       // ...and this one throws
 *
 * and has reintroduced exactly the gap the outbox was built to close, in code
 * that looks completely reasonable in review.
 *
 * So there is no `publishOutboxEvent(...)`. The only exported publisher takes a
 * `Prisma.TransactionClient` as its FIRST argument. You cannot obtain one
 * outside `prisma.$transaction`, which means the unsafe call is not something
 * to catch in review — it does not typecheck.
 *
 * `tests/outboxProducerContract.test.ts` additionally scans this module's
 * source to prove no non-transactional publisher has been added later.
 */

import type { Prisma } from '@prisma/client';
import {
  resolveContract,
  validatePayload,
  type OutboxContractViolation,
  type OutboxEventContract,
} from './outboxEventRegistry.js';

/**
 * Refusal to publish. Thrown INSIDE the caller's transaction, so a contract
 * violation rolls the business change back rather than committing a business
 * change whose obligation was silently dropped.
 *
 * That direction is deliberate and is the safer of the two: refusing to convert
 * an appointment request because the event contract is broken is a loud,
 * immediate, fixable failure. Converting it and losing the patient's
 * confirmation is a silent one that surfaces days later as a complaint.
 */
export class OutboxPublishError extends Error {
  readonly violation: OutboxContractViolation;

  constructor(violation: OutboxContractViolation) {
    super(describeViolation(violation));
    this.name = 'OutboxPublishError';
    this.violation = violation;
  }
}

/** Never includes a payload VALUE — this message reaches logs. */
function describeViolation(violation: OutboxContractViolation): string {
  switch (violation.kind) {
    case 'UNREGISTERED_EVENT':
      return `No outbox contract is registered for event type "${violation.eventType}". Register it in outboxEventRegistry.ts.`;
    case 'UNSUPPORTED_VERSION':
      return (
        `Outbox event "${violation.eventType}" has no registered version ${violation.eventVersion} ` +
        `(registered: ${violation.registeredVersions.join(', ') || 'none'}).`
      );
    case 'MALFORMED_PAYLOAD':
      return (
        `Outbox payload for "${violation.eventType}" v${violation.eventVersion} violates its ` +
        `contract: ${violation.reason}.`
      );
  }
}

export interface PublishOutboxEventInput {
  readonly eventType: string;
  readonly eventVersion: number;
  /** Server-derived. NEVER read from a request body — see the tenant note below. */
  readonly organizationId: string;
  /** Required for CLINIC_OWNED contracts, forbidden for ORGANIZATION_OWNED ones. */
  readonly clinicId?: string | null;
  readonly aggregateId: string;
  /** Identifiers only; validated against the contract's field allowlist. */
  readonly payload: Record<string, string>;
  /** Business idempotency key. See the contract's `idempotency` field. */
  readonly idempotencyKey: string;
  /**
   * Optional producer-side duplicate suppression. When set, the database UNIQUE
   * constraint makes a second publish of the same logical fact fail rather than
   * create a second obligation.
   */
  readonly dedupeKey?: string | null;
  /** Existing request/correlation id when the caller has one. Never invented here. */
  readonly correlationId?: string | null;
  /** The event that caused this one, when there is one (a replay records its parent). */
  readonly causationId?: string | null;
  /** Defaults to now. Set explicitly only when the fact happened at a different instant. */
  readonly occurredAt?: Date;
  /** Not dispatchable before this. Defaults to `occurredAt` (dispatch as soon as possible). */
  readonly availableAt?: Date;
}

/**
 * Publish a durable event inside the caller's transaction.
 *
 * TENANT IDENTITY IS SERVER-DERIVED, ALWAYS. `organizationId`/`clinicId` must
 * come from the same authenticated scope the business write used, never from a
 * request body. F5-1P T5 measured the alternative: a forged tenant id in a job
 * payload. The defence there was payload minimisation plus a server-derived
 * owner, and it is the same defence here — the registry's field allowlist means
 * a tenant id cannot even BE a payload field, so a consumer physically cannot
 * read one from attacker-influenced data.
 *
 * Does NOT establish or require an execution context. The producer runs on the
 * caller's context (a tenant request), which is correct: the row it writes
 * belongs to that tenant. Only the dispatcher, which polls across tenants,
 * needs system execution.
 */
export async function publishOutboxEventInTx(
  tx: Prisma.TransactionClient,
  input: PublishOutboxEventInput,
): Promise<{ id: string; contract: OutboxEventContract }> {
  const resolved = resolveContract(input.eventType, input.eventVersion);
  if (!resolved.ok) throw new OutboxPublishError(resolved.violation);
  const contract = resolved.contract;

  const payloadCheck = validatePayload(contract, input.payload);
  if (!payloadCheck.ok) throw new OutboxPublishError(payloadCheck.violation);

  assertTenancyMatchesContract(contract, input);
  assertNonEmpty('organizationId', input.organizationId);
  assertNonEmpty('aggregateId', input.aggregateId);
  assertNonEmpty('idempotencyKey', input.idempotencyKey);

  const occurredAt = input.occurredAt ?? new Date();
  const availableAt = input.availableAt ?? occurredAt;

  const created = await tx.outboxEvent.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId ?? null,
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      aggregateType: contract.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      dedupeKey: input.dedupeKey ?? null,
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
      status: 'pending',
      occurredAt,
      availableAt,
    },
    select: { id: true },
  });

  return { id: created.id, contract };
}

function assertTenancyMatchesContract(
  contract: OutboxEventContract,
  input: PublishOutboxEventInput,
): void {
  const clinicId = input.clinicId ?? null;
  if (contract.tenancy === 'CLINIC_OWNED' && !clinicId) {
    throw new OutboxPublishError({
      kind: 'MALFORMED_PAYLOAD',
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      reason: 'contract is CLINIC_OWNED but no clinicId was supplied',
    });
  }
  if (contract.tenancy === 'ORGANIZATION_OWNED' && clinicId) {
    throw new OutboxPublishError({
      kind: 'MALFORMED_PAYLOAD',
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      reason: 'contract is ORGANIZATION_OWNED but a clinicId was supplied',
    });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`publishOutboxEventInTx requires a non-empty ${field}.`);
  }
}
