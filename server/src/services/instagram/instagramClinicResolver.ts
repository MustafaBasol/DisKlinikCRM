/**
 * instagramClinicResolver.ts — Incoming Instagram DM → clinic resolution
 *
 * When an InstagramConnection is shared by multiple clinic branches, incoming DMs
 * must be routed to the correct clinic. Mirrors the WhatsApp clinicResolver logic.
 *
 * Priority order:
 *   C — Single-clinic connection: linked to exactly one clinic → auto-assign.
 *   D — Multi-clinic / no prior context: mark as needsClinicResolution=true.
 *
 * Priorities A (reply context) and B (recent conversation) are not yet implemented
 * for Instagram in this MVP sprint, since we do not persist sent Instagram DMs
 * in a SentMessage-equivalent table yet.
 *
 * Rules:
 *   - Never randomly assign to the first linked clinic.
 *   - Never leak messages across organizations.
 */

import prisma from '../../db.js';

export interface InstagramClinicResolutionResult {
  clinicId: string | null;
  needsClinicResolution: boolean;
  resolutionSource: 'single_clinic' | 'no_clinic_links' | 'unresolved';
}

/**
 * Resolve the target clinic for an incoming Instagram DM.
 *
 * @param instagramConnectionId - InstagramConnection.id
 * @returns resolved clinicId or null with a flag for staff manual resolution
 */
export async function resolveClinicForInstagramMessage(
  instagramConnectionId: string,
): Promise<InstagramClinicResolutionResult> {
  const clinicLinks = await prisma.clinicInstagramConnection.findMany({
    where: { instagramConnectionId },
    select: { clinicId: true },
  });

  if (clinicLinks.length === 0) {
    return { clinicId: null, needsClinicResolution: false, resolutionSource: 'no_clinic_links' };
  }

  if (clinicLinks.length === 1) {
    return {
      clinicId: clinicLinks[0].clinicId,
      needsClinicResolution: false,
      resolutionSource: 'single_clinic',
    };
  }

  // Multi-clinic: cannot auto-resolve without additional context in MVP
  return { clinicId: null, needsClinicResolution: true, resolutionSource: 'unresolved' };
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
