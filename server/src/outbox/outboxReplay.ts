/**
 * outboxReplay.ts — F5-2 audited replay of a dead-lettered event.
 *
 * REPLAY IS NOT `status = 'pending'`
 * ---------------------------------
 * The tempting one-liner — flip a dead row back to pending — is wrong in four
 * separate ways, and each one is a real incident waiting to happen:
 *
 *   1. IT DESTROYS THE EVIDENCE. The dead row is the only record that the event
 *      failed, why, and how many times. An operator who replays it and watches
 *      it die again has lost the first failure entirely.
 *   2. IT IS UNAUDITED. Nobody can later answer "who re-sent this patient a
 *      message, and when".
 *   3. IT IGNORES WHY IT DIED. An event that is dead because its contract is no
 *      longer registered, or its payload is malformed, will die again on the
 *      first dispatcher tick, having burned a claim and a write.
 *   4. IT CAN DUPLICATE AN ALREADY-APPLIED SIDE EFFECT. A row can be dead with
 *      the side effect already performed — that is exactly what
 *      `AMBIGUOUS_SIDE_EFFECT` means.
 *
 * SO REPLAY CREATES A NEW EVENT.
 *
 * The dead row STAYS dead — permanent evidence — and gains `replayCount`,
 * `lastReplayedAt`, `lastReplayedBy`. A NEW pending row is created carrying the
 * SAME `idempotencyKey` (so the consumer's ledger still suppresses a duplicate)
 * and `causationId` pointing at the dead row, with `correlationId` preserved.
 * The chain is therefore readable in both directions: what caused this, and
 * what came of that.
 *
 * `dedupeKey` is deliberately NOT copied. It is producer-side duplicate
 * suppression — "do not publish this fact twice" — and the dead row already
 * holds it. Copying it would make the UNIQUE constraint refuse the replay,
 * which would be the constraint doing the opposite of its job: blocking a
 * deliberate, authorized operator action rather than an accidental double
 * publish.
 *
 * AUTHORIZATION. This function enforces TENANT scope and event state. It does
 * NOT decide whether the caller's ROLE may replay — that belongs to the route
 * layer and the existing authorization architecture, and F5-2 adds no route.
 * The caller must pass an already-authorized scope; passing a wider scope than
 * the request actually had would be a defect at the call site, which is why the
 * argument is a required, explicit shape rather than an optional filter.
 */

import prisma from '../db.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { resolveContract, validatePayload } from './outboxEventRegistry.js';
import { findConsumerExecution } from './outboxIdempotency.js';

/** How many times one dead event may be replayed. A replay loop is still a loop. */
export const MAX_REPLAYS_PER_EVENT = 3;

/**
 * The already-authorized scope of the caller. Built by the route layer from the
 * authenticated user, never from a request body.
 */
export interface OutboxReplayAuthorization {
  readonly organizationId: string;
  /**
   * `ORGANIZATION_WIDE` corresponds to OWNER/ORG_ADMIN (`canAccessAllClinics`);
   * `EXPLICIT` to the caller's authorized clinic list. Same vocabulary as
   * `TenantClinicScope`, on purpose.
   */
  readonly clinicScope: { kind: 'ORGANIZATION_WIDE' } | { kind: 'EXPLICIT'; clinicIds: readonly string[] };
  readonly actorUserId: string | null;
  readonly actorRole: string;
}

export type OutboxReplayRefusal =
  /** No such event, or it belongs to another organization. Deliberately indistinguishable. */
  | 'NOT_FOUND'
  /** The event's clinic is outside the caller's authorized clinic set. */
  | 'CROSS_CLINIC_REFUSED'
  /** Only a terminal (dead) event may be replayed. */
  | 'NOT_TERMINAL'
  /** The replay ceiling was reached. */
  | 'REPLAY_LIMIT_EXCEEDED'
  /** A previous replay of this event is still pending or claimed. */
  | 'REPLAY_IN_FLIGHT'
  /** The contract is no longer registered, or this version is not supported. */
  | 'UNSUPPORTED_CONTRACT'
  /** The payload does not satisfy its contract; replaying would die identically. */
  | 'MALFORMED_PAYLOAD'
  /** The side effect is already recorded applied. Replaying would duplicate it. */
  | 'ALREADY_APPLIED'
  /**
   * The idempotency ledger is `ambiguous`: the side effect may already have
   * happened. Requires an explicit operator acknowledgement.
   */
  | 'AMBIGUOUS_REQUIRES_ACKNOWLEDGEMENT';

export type OutboxReplayResult =
  | { readonly ok: true; readonly replayEventId: string; readonly sourceEventId: string }
  | { readonly ok: false; readonly refusal: OutboxReplayRefusal };

export interface ReplayDeadOutboxEventArgs {
  readonly eventId: string;
  readonly authorization: OutboxReplayAuthorization;
  /**
   * Operator's explicit acknowledgement that they have checked the provider and
   * accept the duplicate risk for an `AMBIGUOUS_SIDE_EFFECT` event. Never
   * defaulted to true anywhere.
   */
  readonly acknowledgeAmbiguousSideEffect?: boolean;
  readonly now?: Date;
}

/**
 * Replay one dead event.
 *
 * Every refusal below is checked BEFORE anything is written, so a refused
 * replay leaves the database byte-identical.
 */
export async function replayDeadOutboxEvent(
  args: ReplayDeadOutboxEventArgs,
): Promise<OutboxReplayResult> {
  const now = args.now ?? new Date();
  const auth = args.authorization;

  // Scoped read. An event belonging to another organization is NOT_FOUND rather
  // than "forbidden": distinguishing them tells an attacker that an id exists.
  const event = await prisma.outboxEvent.findFirst({
    where: { id: args.eventId, organizationId: auth.organizationId },
    select: {
      id: true,
      organizationId: true,
      clinicId: true,
      eventType: true,
      eventVersion: true,
      aggregateType: true,
      aggregateId: true,
      payload: true,
      idempotencyKey: true,
      correlationId: true,
      status: true,
      replayCount: true,
      deadLetterCode: true,
    },
  });
  if (!event) return refuse('NOT_FOUND');

  if (!isClinicWithinScope(event.clinicId, auth.clinicScope)) {
    return refuse('CROSS_CLINIC_REFUSED');
  }
  if (event.status !== 'dead') return refuse('NOT_TERMINAL');
  if (event.replayCount >= MAX_REPLAYS_PER_EVENT) return refuse('REPLAY_LIMIT_EXCEEDED');

  // A prior replay that has not yet settled. Replaying again would put two live
  // events for one business key in flight, which the consumer ledger would
  // resolve to one side effect — but only after both had been claimed, run and
  // deferred. Refusing is cheaper and clearer.
  const inFlightReplay = await prisma.outboxEvent.findFirst({
    where: { causationId: event.id, status: { in: ['pending', 'claimed'] } },
    select: { id: true },
  });
  if (inFlightReplay) return refuse('REPLAY_IN_FLIGHT');

  const resolved = resolveContract(event.eventType, event.eventVersion);
  if (!resolved.ok) return refuse('UNSUPPORTED_CONTRACT');
  const contract = resolved.contract;

  const payloadCheck = validatePayload(contract, event.payload);
  if (!payloadCheck.ok) return refuse('MALFORMED_PAYLOAD');

  // Already-successful side-effect protection. The ledger, not the event row, is
  // the authority on whether the effect happened: an event can be dead with the
  // effect applied (a crash between the side effect and finalisation).
  const execution = await findConsumerExecution({
    consumerKey: contract.consumerKey,
    idempotencyKey: event.idempotencyKey,
  });
  if (execution?.status === 'completed') return refuse('ALREADY_APPLIED');
  if (execution?.status === 'ambiguous' && !args.acknowledgeAmbiguousSideEffect) {
    return refuse('AMBIGUOUS_REQUIRES_ACKNOWLEDGEMENT');
  }

  // One transaction: clear an acknowledged ambiguity, create the replay event,
  // and record the replay on the source row. A partial replay — a new event
  // with no audit trail, or a bumped counter with no event — is exactly the
  // inconsistency this whole phase exists to prevent.
  const replayEventId = await prisma.$transaction(async (tx) => {
    if (execution?.status === 'ambiguous') {
      // The operator has stated the side effect did not happen. Clearing the
      // marker is what lets the consumer proceed; leaving it would make the
      // replay dead-letter as AMBIGUOUS_SIDE_EFFECT immediately. Guarded on the
      // status observed above.
      await tx.outboxConsumerExecution.deleteMany({
        where: { id: execution.id, status: 'ambiguous' },
      });
    }

    const created = await tx.outboxEvent.create({
      data: {
        organizationId: event.organizationId,
        clinicId: event.clinicId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as object,
        // SAME key: this is what makes a replay idempotent rather than a second
        // delivery of the same obligation.
        idempotencyKey: event.idempotencyKey,
        dedupeKey: null,
        correlationId: event.correlationId,
        causationId: event.id,
        status: 'pending',
        occurredAt: now,
        availableAt: now,
      },
      select: { id: true },
    });

    await tx.outboxEvent.update({
      where: { id: event.id },
      data: {
        replayCount: { increment: 1 },
        lastReplayedAt: now,
        lastReplayedBy: auth.actorUserId,
      },
    });

    return created.id;
  });

  // Audit is written after the transaction commits, matching the repository's
  // existing convention for non-fail-closed audit actions (writeAuditLog
  // swallows its own errors by design). Identifiers and stable codes only — no
  // payload, no message content.
  await writeAuditLog({
    organizationId: event.organizationId,
    clinicId: event.clinicId,
    actorUserId: auth.actorUserId,
    actorRole: auth.actorRole,
    action: 'outbox_event_replayed',
    entityType: 'outbox_event',
    entityId: event.id,
    description: 'Dead-lettered outbox event replayed',
    metadata: {
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      deadLetterCode: event.deadLetterCode,
      replayEventId,
      acknowledgedAmbiguousSideEffect: args.acknowledgeAmbiguousSideEffect === true,
    },
  });

  return { ok: true, replayEventId, sourceEventId: event.id };
}

function refuse(refusal: OutboxReplayRefusal): OutboxReplayResult {
  return { ok: false, refusal };
}

/**
 * An ORGANIZATION_WIDE caller reaches every clinic in their own organization —
 * the organization predicate has already been applied by the read above. An
 * EXPLICIT caller reaches only their listed clinics; an organization-level event
 * (clinicId null) is NOT reachable from an explicit clinic scope, because such
 * an event belongs to the organization rather than to any clinic the caller
 * holds.
 */
function isClinicWithinScope(
  clinicId: string | null,
  scope: OutboxReplayAuthorization['clinicScope'],
): boolean {
  if (scope.kind === 'ORGANIZATION_WIDE') return true;
  if (clinicId === null) return false;
  return scope.clinicIds.includes(clinicId);
}
