/**
 * externalCalendarIdempotency.ts — inbound webhook idempotency ledger for
 * external calendar providers. Mirrors
 * services/messagingInboundIdempotency.ts's dedupe-by-unique-constraint
 * pattern: uniqueness is enforced by the database
 * (@@unique([provider, connectionId, providerEventId])), and a duplicate
 * insert (Prisma P2002) is caught and reported as a duplicate — never a
 * check-then-insert race.
 */

import { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import { runAsSystem } from '../../tenancy/tenantContext.js';

/**
 * F3-2 — `ExternalCalendarInboundEvent` is one of the five models F3-1
 * classified `EXPLICIT_REVIEW_REQUIRED`, with the same pre-tenant-resolution
 * shape as `MessagingInboundEvent`: the row is the provider's raw envelope,
 * written before the connection (and therefore the clinic) is resolved. The
 * F3-2 decision is identical — system-owned, reason
 * `inbound-webhook-envelope`, deliberately NOT allowed to escalate from inside
 * a tenant request, because every writer is a public webhook route.
 *
 * See services/messagingInboundIdempotency.ts for the full reasoning; the two
 * models are kept on the same decision on purpose, since they are the same
 * pattern and splitting them would invite drift.
 */
const asWebhookEnvelopeSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  runAsSystem({ reason: 'inbound-webhook-envelope', detail: 'external-calendar' }, fn);

export type CreateInboundEventArgs = {
  provider: string;
  connectionId?: string | null;
  clinicId?: string | null;
  organizationId?: string | null;
  eventType: string;
  providerEventId: string;
  externalAppointmentId?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

export type InboundEventCreateResult =
  | { status: 'created'; eventId: string }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: 'missing_provider_event_id' | 'missing_connection_id' };

const isPrismaUniqueConstraintError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const createExternalCalendarInboundEventOrDetectDuplicate = async (
  args: CreateInboundEventArgs,
): Promise<InboundEventCreateResult> => {
  const providerEventId = normalizeOptional(args.providerEventId);
  const connectionId = normalizeOptional(args.connectionId);

  if (!providerEventId) {
    return { status: 'skipped', reason: 'missing_provider_event_id' };
  }
  if (!connectionId) {
    // Postgres unique constraints allow multiple NULL values, so a null
    // connectionId cannot provide reliable idempotency (see the identical
    // rationale in messagingInboundIdempotency.ts).
    return { status: 'skipped', reason: 'missing_connection_id' };
  }

  try {
    const event = await asWebhookEnvelopeSystem(() => prisma.externalCalendarInboundEvent.create({
      data: {
        provider: args.provider,
        connectionId,
        clinicId: normalizeOptional(args.clinicId),
        organizationId: normalizeOptional(args.organizationId),
        eventType: args.eventType,
        providerEventId,
        externalAppointmentId: normalizeOptional(args.externalAppointmentId),
        status: 'processing',
        rawPayload: args.rawPayload ? (args.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull,
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

export const markExternalCalendarEventProcessed = async (eventId: string | null | undefined) => {
  if (!eventId) return null;
  return asWebhookEnvelopeSystem(() => prisma.externalCalendarInboundEvent.update({
    where: { id: eventId },
    data: { status: 'processed', processedAt: new Date(), errorMessage: null },
  }));
};

export const markExternalCalendarEventIgnored = async (eventId: string | null | undefined, reason: string) => {
  if (!eventId) return null;
  return asWebhookEnvelopeSystem(() => prisma.externalCalendarInboundEvent.update({
    where: { id: eventId },
    data: { status: 'ignored', processedAt: new Date(), errorMessage: reason.slice(0, 1000) },
  }));
};

export const markExternalCalendarEventFailed = async (eventId: string | null | undefined, error: unknown) => {
  if (!eventId) return null;
  const message = error instanceof Error ? error.message : String(error);
  return asWebhookEnvelopeSystem(() => prisma.externalCalendarInboundEvent.update({
    where: { id: eventId },
    data: { status: 'failed', errorMessage: message.slice(0, 1000), attempts: { increment: 1 } },
  }));
};
