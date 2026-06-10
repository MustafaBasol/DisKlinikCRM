/**
 * instagramClinicResolver.ts — Incoming Instagram DM → clinic resolution
 *
 * When an InstagramConnection is shared by multiple clinic branches, incoming DMs
 * must be routed to the correct clinic. Mirrors the WhatsApp clinicResolver logic.
 *
 * Priority order:
 *   A — Existing open inbox conversation with a clinic → keep same clinic.
 *   B — Single-clinic connection → auto-assign.
 *   C — Multi-clinic connection with one default → use default clinic.
 *   D — No connection links and one active organization clinic → auto-assign.
 *   E — Multi-clinic / no usable context → mark as needsClinicResolution=true.
 *
 * Rules:
 *   - Never randomly assign to the first linked clinic.
 *   - Never leak messages across organizations.
 */

import prisma from '../../db.js';

export interface InstagramClinicResolutionResult {
  clinicId: string | null;
  needsClinicResolution: boolean;
  resolutionSource:
    | 'inbox_entry'
    | 'connection_default'
    | 'connection_single'
    | 'organization_single'
    | 'no_clinic_links'
    | 'unresolved';
}

function logInstagramClinicResolution(metadata: Record<string, unknown>) {
  console.info('[instagram-clinic-resolution]', metadata);
}

function summarizeIdentifier(value: string | null | undefined) {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
}

export function resolveInstagramClinicFromKnownContext(params: {
  existingInboxClinicId?: string | null;
  clinicLinks: Array<{ clinicId: string; isDefault?: boolean | null }>;
  organizationClinicIds: string[];
}): InstagramClinicResolutionResult {
  if (params.existingInboxClinicId) {
    return {
      clinicId: params.existingInboxClinicId,
      needsClinicResolution: false,
      resolutionSource: 'inbox_entry',
    };
  }

  if (params.clinicLinks.length === 1) {
    return {
      clinicId: params.clinicLinks[0].clinicId,
      needsClinicResolution: false,
      resolutionSource: 'connection_single',
    };
  }

  if (params.clinicLinks.length > 1) {
    const defaultLinks = params.clinicLinks.filter(link => link.isDefault);
    if (defaultLinks.length === 1) {
      return {
        clinicId: defaultLinks[0].clinicId,
        needsClinicResolution: false,
        resolutionSource: 'connection_default',
      };
    }
    return { clinicId: null, needsClinicResolution: true, resolutionSource: 'unresolved' };
  }

  if (params.organizationClinicIds.length === 1) {
    return {
      clinicId: params.organizationClinicIds[0],
      needsClinicResolution: false,
      resolutionSource: 'organization_single',
    };
  }

  return { clinicId: null, needsClinicResolution: true, resolutionSource: 'no_clinic_links' };
}

/**
 * Resolve the target clinic for an incoming Instagram DM.
 *
 * @param instagramConnectionId - InstagramConnection.id
 * @returns resolved clinicId or null with a flag for staff manual resolution
 */
export async function resolveClinicForInstagramMessage(
  instagramConnectionId: string,
  externalSenderId?: string | null,
): Promise<InstagramClinicResolutionResult> {
  const connection = await prisma.instagramConnection.findUnique({
    where: { id: instagramConnectionId },
    select: {
      id: true,
      organizationId: true,
      clinics: {
        select: { clinicId: true, isDefault: true },
      },
    },
  });

  if (!connection) {
    logInstagramClinicResolution({
      connectionId: summarizeIdentifier(instagramConnectionId),
      organizationId: null,
      linkedClinicCount: 0,
      resolutionSource: 'unresolved',
    });
    return { clinicId: null, needsClinicResolution: true, resolutionSource: 'unresolved' };
  }

  let existingInboxClinicId: string | null = null;
  if (externalSenderId?.trim()) {
    const existingEntry = await prisma.instagramInboxEntry.findFirst({
      where: {
        organizationId: connection.organizationId,
        instagramConnectionId,
        externalSenderId: externalSenderId.trim(),
        clinicId: { not: null },
        status: 'open',
      },
      select: { clinicId: true },
      orderBy: { updatedAt: 'desc' },
    });

    existingInboxClinicId = existingEntry?.clinicId ?? null;
  }

  const clinicLinks = connection.clinics;
  const organizationClinics = clinicLinks.length === 0
    ? await prisma.clinic.findMany({
        where: { organizationId: connection.organizationId, status: 'active' },
        select: { id: true },
        take: 2,
      })
    : [];

  const resolution = resolveInstagramClinicFromKnownContext({
    existingInboxClinicId,
    clinicLinks,
    organizationClinicIds: organizationClinics.map(clinic => clinic.id),
  });

  logInstagramClinicResolution({
    organizationId: summarizeIdentifier(connection.organizationId),
    connectionId: summarizeIdentifier(instagramConnectionId),
    externalSenderId: summarizeIdentifier(externalSenderId),
    existingInboxClinicId: summarizeIdentifier(existingInboxClinicId),
    linkedClinicCount: clinicLinks.length,
    defaultClinicCount: clinicLinks.filter(link => link.isDefault).length,
    linkedClinicIds: clinicLinks.slice(0, 5).map(link => ({
      clinicId: summarizeIdentifier(link.clinicId),
      isDefault: Boolean(link.isDefault),
    })),
    organizationClinicCount: organizationClinics.length,
    resolvedClinicId: summarizeIdentifier(resolution.clinicId),
    resolutionSource: resolution.resolutionSource,
  });
  return resolution;
}

/**
 * Create or update an InstagramInboxEntry for an incoming DM.
 * If an open entry already exists for this sender + connection, increment messageCount.
 */
export async function upsertInstagramInboxEntry(params: {
  organizationId: string;
  instagramConnectionId: string;
  clinicId: string | null;
  needsClinicResolution: boolean;
  externalSenderId: string;
  externalConversationId?: string | null;
  senderUsername?: string | null;
  lastMessageText?: string | null;
  externalMessageId?: string | null;
  rawPayload?: Record<string, unknown> | null;
}): Promise<void> {
  const existing = await prisma.instagramInboxEntry.findFirst({
    where: {
      organizationId: params.organizationId,
      instagramConnectionId: params.instagramConnectionId,
      externalSenderId: params.externalSenderId,
      status: 'open',
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.instagramInboxEntry.update({
      where: { id: existing.id },
      data: {
        messageCount: { increment: 1 },
        lastMessageText: params.lastMessageText ?? undefined,
        senderUsername: params.senderUsername ?? undefined,
        updatedAt: new Date(),
        // If we now know the clinic (e.g. staff just assigned), keep it
        ...(params.clinicId !== null && { clinicId: params.clinicId, needsClinicResolution: false }),
        ...(params.clinicId === null && params.needsClinicResolution && { needsClinicResolution: true }),
      },
    });
  } else {
    await prisma.instagramInboxEntry.create({
      data: {
        organizationId: params.organizationId,
        instagramConnectionId: params.instagramConnectionId,
        clinicId: params.clinicId,
        needsClinicResolution: params.needsClinicResolution,
        externalSenderId: params.externalSenderId,
        externalConversationId: params.externalConversationId ?? null,
        senderUsername: params.senderUsername ?? null,
        lastMessageText: params.lastMessageText ?? null,
        externalMessageId: params.externalMessageId ?? null,
        rawPayload: params.rawPayload ? (params.rawPayload as import('@prisma/client').Prisma.InputJsonValue) : undefined,
        status: 'open',
      },
    });
  }
}
