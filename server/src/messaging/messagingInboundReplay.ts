/**
 * messagingInboundReplay.ts — F5-3 authorized, audited replay of a terminal
 * inbound messaging event.
 *
 * WHY THIS IS THE HIGHEST-RISK THING IN F5-3
 * ------------------------------------------
 * Replaying an inbound message re-runs a conversational AI turn against a
 * patient. Get it wrong and the system sends a real person a real message —
 * possibly a duplicate of one they already received, possibly an answer to a
 * question from three hours ago, possibly on behalf of the wrong clinic.
 *
 * So replay here is narrower than an operator might expect, and every
 * narrowing is deliberate:
 *
 *   - **Terminal only.** A `failed` row the retry job is still going to pick up
 *     must not be replayed underneath it. Only `dead` is replayable.
 *   - **Channel must have a handler.** Replaying an Evolution or Instagram
 *     event would do nothing at all today (see `messagingRedeliveryRegistry`),
 *     so it is refused loudly rather than reported as a success that silently
 *     did nothing.
 *   - **Tenant-scoped, and the organization predicate is applied to the READ.**
 *     A cross-organization id is `NOT_FOUND`, never "forbidden" — the
 *     difference is an id oracle.
 *   - **`providerMessageId` is preserved.** Replay re-uses the existing row
 *     rather than creating a new envelope, so the unique constraint
 *     `(channel, provider, connectionId, providerMessageId)` keeps doing its
 *     job: a provider redelivery arriving during a replay is still a duplicate.
 *   - **Bounded.** A replay loop is still a loop.
 *   - **Audited.** Identifiers and stable codes only.
 *   - **Payload is never mutated.** There is no argument that lets a caller
 *     change what gets re-delivered. Replay re-drives what actually arrived, or
 *     it does nothing.
 *
 * WHY REPLAY REUSES THE ROW, WHERE THE OUTBOX CREATES A NEW ONE
 * ------------------------------------------------------------
 * F5-2's outbox replay creates a NEW event and leaves the dead one as evidence,
 * because an outbox event is an obligation the system owes and the failure
 * record must survive. An inbound event is the opposite: it is a record of
 * something that HAPPENED, and its identity is the provider's own message id.
 * Creating a second row for one real message would violate the dedupe
 * constraint that is the entire point of the ledger. So the row is reset to
 * `failed` with the attempt budget refreshed, and `replayCount` /
 * `lastReplayedAt` / `lastReplayedBy` carry the audit on the row itself.
 *
 * AUTHORIZATION. This function enforces TENANT scope, event state and channel
 * capability. It does NOT decide whether the caller's ROLE may replay — that
 * belongs to the route layer and the existing authorization architecture.
 * **F5-3 adds no route**, exactly as F5-2 added none.
 */

import prisma from '../db.js';
import { runAsSystem } from '../tenancy/tenantContext.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { MESSAGING_INBOUND_TERMINAL_STATUS } from './messagingInboundDlq.js';
import { getRedeliverySupport } from './messagingRedeliveryRegistry.js';

/** How many times one inbound event may be replayed. */
export const MAX_INBOUND_REPLAYS_PER_EVENT = 2;

const asInboundLedgerSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  runAsSystem({ reason: 'inbound-webhook-envelope', detail: 'messaging-replay' }, fn);

/** Already-authorized caller scope, built by the route layer from the session. */
export interface MessagingReplayAuthorization {
  readonly organizationId: string;
  /** Same vocabulary as `TenantClinicScope`, on purpose. */
  readonly clinicScope: { kind: 'ORGANIZATION_WIDE' } | { kind: 'EXPLICIT'; clinicIds: readonly string[] };
  readonly actorUserId: string | null;
  readonly actorRole: string;
}

export type MessagingReplayRefusal =
  /** No such event, or it belongs to another organization. Deliberately indistinguishable. */
  | 'NOT_FOUND'
  /** The event's clinic is outside the caller's authorized clinic set. */
  | 'CROSS_CLINIC_REFUSED'
  /** Only a terminal (dead) event may be replayed. */
  | 'NOT_TERMINAL'
  /** Already successfully processed — replaying would duplicate the effect. */
  | 'ALREADY_PROCESSED'
  /** The replay ceiling was reached. */
  | 'REPLAY_LIMIT_EXCEEDED'
  /** This channel/provider has no re-delivery handler, so a replay would do nothing. */
  | 'NO_REDELIVERY_HANDLER'
  /** The event has no connection, so it cannot be routed to a tenant at all. */
  | 'UNROUTABLE'
  /** There is no stored envelope to re-drive. */
  | 'NO_STORED_PAYLOAD';

export type MessagingReplayResult =
  | { readonly ok: true; readonly eventId: string; readonly replayCount: number }
  | { readonly ok: false; readonly refusal: MessagingReplayRefusal };

export interface ReplayInboundEventArgs {
  readonly eventId: string;
  readonly authorization: MessagingReplayAuthorization;
  readonly now?: Date;
}

/**
 * Requeue one terminal inbound event for re-delivery.
 *
 * Every refusal is checked BEFORE anything is written, so a refused replay
 * leaves the database byte-identical.
 */
export async function replayDeadInboundEvent(
  args: ReplayInboundEventArgs,
): Promise<MessagingReplayResult> {
  const now = args.now ?? new Date();
  const auth = args.authorization;

  const event = await asInboundLedgerSystem(() =>
    prisma.messagingInboundEvent.findFirst({
      where: { id: args.eventId, organizationId: auth.organizationId },
      select: {
        id: true,
        channel: true,
        provider: true,
        connectionId: true,
        clinicId: true,
        organizationId: true,
        providerMessageId: true,
        status: true,
        attempts: true,
        replayCount: true,
        lastErrorCode: true,
        // `rawPayload` is selected ONLY to answer "is there anything to
        // re-drive". Its contents are never read, returned or logged.
        rawPayload: true,
      },
    }),
  );
  if (!event) return refuse('NOT_FOUND');

  if (!isClinicWithinScope(event.clinicId, auth.clinicScope)) return refuse('CROSS_CLINIC_REFUSED');
  if (event.status === 'processed') return refuse('ALREADY_PROCESSED');
  if (event.status !== MESSAGING_INBOUND_TERMINAL_STATUS) return refuse('NOT_TERMINAL');
  if (event.replayCount >= MAX_INBOUND_REPLAYS_PER_EVENT) return refuse('REPLAY_LIMIT_EXCEEDED');
  if (!event.connectionId) return refuse('UNROUTABLE');
  if (event.rawPayload === null || event.rawPayload === undefined) return refuse('NO_STORED_PAYLOAD');

  const support = getRedeliverySupport({ channel: event.channel, provider: event.provider });
  if (support?.supported !== true) return refuse('NO_REDELIVERY_HANDLER');

  // Guarded on the terminal status observed above, so two concurrent replays
  // resolve to exactly one requeue and the loser sees count 0.
  const updated = await asInboundLedgerSystem(() =>
    prisma.messagingInboundEvent.updateMany({
      where: { id: event.id, status: MESSAGING_INBOUND_TERMINAL_STATUS },
      data: {
        status: 'failed',
        // The attempt budget is refreshed — that is what a replay IS. The
        // `replayCount` ceiling, not `attempts`, is what bounds the operator.
        attempts: 0,
        // Available to the retry job on its next tick rather than after a
        // backoff: an operator asking for this now has already decided.
        nextAttemptAt: now,
        deadLetteredAt: null,
        lastErrorCode: null,
        replayCount: { increment: 1 },
        lastReplayedAt: now,
        lastReplayedBy: auth.actorUserId,
      },
    }),
  );
  if (updated.count === 0) return refuse('NOT_TERMINAL');

  await writeAuditLog({
    organizationId: event.organizationId ?? auth.organizationId,
    clinicId: event.clinicId,
    actorUserId: auth.actorUserId,
    actorRole: auth.actorRole,
    action: 'messaging_inbound_event_replayed',
    entityType: 'messaging_inbound_event',
    entityId: event.id,
    description: 'Terminal inbound messaging event requeued for re-delivery',
    metadata: {
      channel: event.channel,
      provider: event.provider,
      // The provider's own id, which an operator needs to correlate with the
      // provider console. Not patient content.
      providerMessageId: event.providerMessageId,
      previousErrorCode: event.lastErrorCode,
      previousAttempts: event.attempts,
    },
  });

  return { ok: true, eventId: event.id, replayCount: event.replayCount + 1 };
}

function refuse(refusal: MessagingReplayRefusal): MessagingReplayResult {
  return { ok: false, refusal };
}

/**
 * An ORGANIZATION_WIDE caller reaches every clinic in their own organization —
 * the organization predicate has already been applied by the read. An EXPLICIT
 * caller reaches only their listed clinics.
 *
 * An event whose `clinicId` is still NULL is reachable ONLY organization-wide.
 * That is the case where routing never resolved a clinic, so no clinic-scoped
 * operator can legitimately claim it, and guessing would be exactly the
 * cross-clinic mistake this check exists to prevent.
 */
function isClinicWithinScope(
  clinicId: string | null,
  scope: MessagingReplayAuthorization['clinicScope'],
): boolean {
  if (scope.kind === 'ORGANIZATION_WIDE') return true;
  if (clinicId === null) return false;
  return scope.clinicIds.includes(clinicId);
}
