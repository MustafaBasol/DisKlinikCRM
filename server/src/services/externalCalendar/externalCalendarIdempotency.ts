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
    const event = await prisma.externalCalendarInboundEvent.create({
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
    });
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
  return prisma.externalCalendarInboundEvent.update({
    where: { id: eventId },
    data: { status: 'processed', processedAt: new Date(), errorMessage: null },
  });
};

export const markExternalCalendarEventIgnored = async (eventId: string | null | undefined, reason: string) => {
  if (!eventId) return null;
  return prisma.externalCalendarInboundEvent.update({
    where: { id: eventId },
    data: { status: 'ignored', processedAt: new Date(), errorMessage: reason.slice(0, 1000) },
  });
};

export const markExternalCalendarEventFailed = async (eventId: string | null | undefined, error: unknown) => {
  if (!eventId) return null;
  const message = error instanceof Error ? error.message : String(error);
  return prisma.externalCalendarInboundEvent.update({
    where: { id: eventId },
    data: { status: 'failed', errorMessage: message.slice(0, 1000), attempts: { increment: 1 } },
  });
};
