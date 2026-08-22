import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { runAsSystem } from '../tenancy/tenantContext.js';
import {
  classifyMessagingError,
  type MessagingFailureCode,
} from '../messaging/messagingFailureClassification.js';

/**
 * F3-2 — `MessagingInboundEvent` is one of the five models F3-1 classified
 * `EXPLICIT_REVIEW_REQUIRED`, and the F3-2 decision is SYSTEM-OWNED, with a
 * narrower reason than the security models get: `inbound-webhook-envelope`.
 *
 * Why it is not tenant-owned: this row is the raw provider envelope, written
 * BEFORE routing has resolved which connection — and therefore which clinic —
 * the message belongs to. Both tenant columns are legitimately null on arrival
 * and are populated later by the routing step. A guard that demanded a tenant
 * on insert would make the idempotency record impossible to write, and losing
 * it means reprocessing a duplicate inbound message.
 *
 * Why the reason is NOT on the escalate-from-tenant allowlist: every writer is
 * an unauthenticated public webhook route, mounted above `authenticate` in
 * index.ts, so no tenant context can exist here. If one ever does, that is a
 * routing defect and `runAsSystem` throwing is the correct outcome.
 */
const asWebhookEnvelopeSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  runAsSystem({ reason: 'inbound-webhook-envelope', detail: 'messaging' }, fn);

type MessagingInboundChannel = 'whatsapp' | 'instagram' | 'facebook_messenger' | string;
type MessagingInboundProvider = 'evolution' | 'meta_cloud' | 'meta_graph' | string;

export type CreateInboundEventArgs = {
  channel: MessagingInboundChannel;
  provider: MessagingInboundProvider;
  connectionId?: string | null;
  clinicId?: string | null;
  organizationId?: string | null;
  providerMessageId?: string | null;
  providerConversationId?: string | null;
  fromExternalId?: string | null;
  toExternalId?: string | null;
  fromPhone?: string | null;
  toPhone?: string | null;
  eventType?: string;
  direction?: string;
  rawPayload?: Record<string, unknown> | null;
};

export type InboundEventCreateResult =
  | { status: 'created'; eventId: string }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: 'missing_provider_message_id' | 'missing_connection_id' };

const isPrismaUniqueConstraintError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const createInboundEventOrDetectDuplicate = async (
  args: CreateInboundEventArgs,
): Promise<InboundEventCreateResult> => {
  const providerMessageId = normalizeOptional(args.providerMessageId);
  const connectionId = normalizeOptional(args.connectionId);

  if (!providerMessageId) {
    return { status: 'skipped', reason: 'missing_provider_message_id' };
  }

  if (!connectionId) {
    // Postgres unique constraints allow multiple NULL values, so null connectionId
    // cannot provide reliable idempotency for shared provider message IDs.
    return { status: 'skipped', reason: 'missing_connection_id' };
  }

  try {
    const event = await asWebhookEnvelopeSystem(() => prisma.messagingInboundEvent.create({
      data: {
        channel: args.channel,
        provider: args.provider,
        connectionId,
        clinicId: normalizeOptional(args.clinicId),
        organizationId: normalizeOptional(args.organizationId),
        providerMessageId,
        providerConversationId: normalizeOptional(args.providerConversationId),
        fromExternalId: normalizeOptional(args.fromExternalId),
        toExternalId: normalizeOptional(args.toExternalId),
        fromPhone: normalizeOptional(args.fromPhone),
        toPhone: normalizeOptional(args.toPhone),
        eventType: normalizeOptional(args.eventType) ?? 'message',
        direction: normalizeOptional(args.direction) ?? 'inbound',
        status: 'processing',
        rawPayload: args.rawPayload ? args.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
      },
      select: { id: true },
    }));

    return { status: 'created', eventId: event.id };
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return { status: 'duplicate' };
    }
    throw error;
  }
};

export const markInboundEventProcessed = async (eventId: string | null | undefined) => {
  if (!eventId) return null;

  return asWebhookEnvelopeSystem(() => prisma.messagingInboundEvent.update({
    where: { id: eventId },
    data: {
      status: 'processed',
      processedAt: new Date(),
      errorMessage: null,
    },
  }));
};

/**
 * F5-3 — record a failed attempt.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 * --------------------------------
 * This function used to persist `error.message.slice(0, 1000)` into
 * `errorMessage`. For a provider failure that message is built by concatenating
 * the provider's RAW RESPONSE BODY (see the pre-F5-3
 * `Meta Graph API sendMessage failed with ${status}: ${errorText}` shape), and a
 * provider body can echo the recipient's phone number or the message content
 * back at us. So an operational column could end up holding communication
 * content that nobody decided to retain, on a table an operator reads.
 *
 * Now the diagnosis is a **stable `MessagingFailureCode`** in `lastErrorCode`,
 * and `errorMessage` is written with a fixed, code-derived string chosen by us —
 * never provider text, never an exception message.
 *
 * The `unknown` overload is kept so existing callers do not have to change: an
 * unclassified throw becomes `UNKNOWN`, which is retryable on the shortest
 * budget. That is the fail-safe direction — an unclassified failure never
 * becomes silently permanent.
 */
export type MarkInboundFailedInput =
  | { code: MessagingFailureCode; nextAttemptAt?: Date | null }
  | unknown;

export const markInboundEventFailed = async (
  eventId: string | null | undefined,
  failure: MarkInboundFailedInput,
) => {
  if (!eventId) return null;

  const resolved = resolveFailureInput(failure);

  return asWebhookEnvelopeSystem(() => prisma.messagingInboundEvent.update({
    where: { id: eventId },
    data: {
      status: 'failed',
      lastErrorCode: resolved.code,
      // Fixed, code-derived text. Deliberately carries no provider content.
      errorMessage: `Inbound processing failed (${resolved.code}).`,
      ...(resolved.nextAttemptAt !== undefined ? { nextAttemptAt: resolved.nextAttemptAt } : {}),
    },
  }));
};

function resolveFailureInput(
  failure: MarkInboundFailedInput,
): { code: MessagingFailureCode; nextAttemptAt?: Date | null } {
  if (
    failure !== null &&
    typeof failure === 'object' &&
    typeof (failure as { code?: unknown }).code === 'string' &&
    !(failure instanceof Error)
  ) {
    const typed = failure as { code: MessagingFailureCode; nextAttemptAt?: Date | null };
    return typed.nextAttemptAt !== undefined
      ? { code: typed.code, nextAttemptAt: typed.nextAttemptAt }
      : { code: typed.code };
  }
  return { code: classifyMessagingError(failure).code };
}

export const MessagingInboundIdempotencyService = {
  createInboundEventOrDetectDuplicate,
  markInboundEventProcessed,
  markInboundEventFailed,
};
