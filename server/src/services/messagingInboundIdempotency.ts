import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { runAsSystem } from '../tenancy/tenantContext.js';

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

export const markInboundEventFailed = async (
  eventId: string | null | undefined,
  error: unknown,
) => {
  if (!eventId) return null;

  const message = error instanceof Error ? error.message : String(error);
  return asWebhookEnvelopeSystem(() => prisma.messagingInboundEvent.update({
    where: { id: eventId },
    data: {
      status: 'failed',
      errorMessage: message.slice(0, 1000),
    },
  }));
};

export const MessagingInboundIdempotencyService = {
  createInboundEventOrDetectDuplicate,
  markInboundEventProcessed,
  markInboundEventFailed,
};
