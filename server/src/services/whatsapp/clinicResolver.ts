/**
 * clinicResolver.ts — Incoming WhatsApp message → clinic resolution
 *
 * When a WhatsApp connection is shared by multiple clinic branches, incoming
 * messages must be routed to the correct clinic context. This service implements
 * the priority resolution chain described in Sprint 11.
 *
 * Priority order:
 *   A — Reply to outbound: the message is a reply to a recent outbound SentMessage
 *       from a specific clinic. Use that clinic's ID.
 *
 *   B — Recent conversation: the sender has an active conversation state on one of
 *       the clinics that uses this connection. Use that clinic's ID.
 *
 *   C — Single-clinic connection: the WhatsApp connection is linked to exactly one
 *       clinic. Use that clinic's ID.
 *
 *   D — Unresolved: connection is shared by multiple clinics and no prior context
 *       exists. Mark as needsClinicResolution=true so staff can resolve manually
 *       via the WhatsApp Inbox.
 *
 * Rules:
 *   - Never randomly assign a shared-line message to the first clinic.
 *   - Never leak messages across organizations.
 *   - Existing single-clinic flow continues working via Priority C.
 */

import prisma from '../../db.js';

export interface ClinicResolutionResult {
  clinicId: string | null;
  needsClinicResolution: boolean;
  resolutionSource:
    | 'reply_context'
    | 'recent_conversation'
    | 'single_clinic'
    | 'no_clinic_links'
    | 'unresolved';
}

/**
 * Build normalized phone number variants to match against DB records.
 * Handles Turkish numbers (90xxxxxxxxxx, 0xxxxxxxxxx, xxxxxxxxxx).
 */
function getPhoneVariants(digits: string): string[] {
  const variants = new Set<string>();
  if (!digits) return [];
  variants.add(digits);
  if (digits.startsWith('90') && digits.length === 12) {
    variants.add(digits.slice(2));        // 10-digit
    variants.add(`0${digits.slice(2)}`);  // 11-digit with leading 0
  } else if (digits.startsWith('0') && digits.length === 11) {
    variants.add(digits.slice(1));        // 10-digit
    variants.add(`90${digits.slice(1)}`); // E.164 Turkey
  } else if (digits.length === 10) {
    variants.add(`0${digits}`);           // 11-digit with leading 0
    variants.add(`90${digits}`);          // E.164 Turkey
  }
  return [...variants];
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Resolve the target clinic for an incoming WhatsApp message.
 *
 * @param connectionId    - WhatsAppConnection.id (from DB)
 * @param organizationId  - Organization.id (from WhatsAppConnection)
 * @param rawPhone        - Sender phone as received from the provider
 * @returns               - clinicId if resolved, null + needsClinicResolution if not
 */
export async function resolveClinicForIncomingMessage(
  connectionId: string,
  organizationId: string,
  rawPhone: string,
): Promise<ClinicResolutionResult> {
  const phone = normalizePhone(rawPhone);
  const phoneVariants = getPhoneVariants(phone);

  // --- Get all clinic links for this connection ---
  const clinicLinks = await prisma.clinicWhatsAppConnection.findMany({
    where: { whatsappConnectionId: connectionId },
    select: { clinicId: true },
  });

  if (clinicLinks.length === 0) {
    // Connection exists but has no clinic assignments — return no resolution
    // (legacy env-var fallback will handle single-clinic deployments)
    return {
      clinicId: null,
      needsClinicResolution: false,
      resolutionSource: 'no_clinic_links',
    };
  }

  // --- Priority C: Single-clinic connection (fast path) ---
  if (clinicLinks.length === 1) {
    return {
      clinicId: clinicLinks[0].clinicId,
      needsClinicResolution: false,
      resolutionSource: 'single_clinic',
    };
  }

  const clinicIds = clinicLinks.map(l => l.clinicId);

  // --- Priority A: Reply context ---
  // Check for a recent outbound SentMessage to this phone from this connection.
  // "Recent" = sent within the last 48 hours (covers appointment reminders sent day before).
  const recentOutbound = await prisma.sentMessage.findFirst({
    where: {
      organizationId,
      whatsappConnectionId: connectionId,
      direction: 'outgoing',
      recipient: { in: phoneVariants },
      clinicId: { in: clinicIds },
      sentAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    },
    orderBy: { sentAt: 'desc' },
    select: { clinicId: true },
  });

  if (recentOutbound?.clinicId) {
    return {
      clinicId: recentOutbound.clinicId,
      needsClinicResolution: false,
      resolutionSource: 'reply_context',
    };
  }

  // --- Priority B: Recent conversation state ---
  // Look for a WhatsAppConversationState on any linked clinic for this phone.
  const recentConversation = await prisma.whatsAppConversationState.findFirst({
    where: {
      clinicId: { in: clinicIds },
      phone: { in: phoneVariants },
    },
    orderBy: { updatedAt: 'desc' },
    select: { clinicId: true },
  });

  if (recentConversation?.clinicId) {
    return {
      clinicId: recentConversation.clinicId,
      needsClinicResolution: false,
      resolutionSource: 'recent_conversation',
    };
  }

  // --- Priority D: Cannot determine ---
  return {
    clinicId: null,
    needsClinicResolution: true,
    resolutionSource: 'unresolved',
  };
}

/**
 * Create or update a WhatsAppInboxEntry for an unresolved shared-line message.
 * If an open entry already exists for this phone + connection, increment messageCount
 * and update the last message text (deduplication/thread grouping).
 */
export async function upsertInboxEntry(params: {
  organizationId: string;
  whatsappConnectionId: string;
  phone: string;
  displayName?: string | null;
  lastMessageText?: string | null;
  externalMessageId?: string | null;
  rawPayload?: Record<string, unknown> | null;
}): Promise<void> {
  const phone = normalizePhone(params.phone);

  const existing = await prisma.whatsAppInboxEntry.findFirst({
    where: {
      organizationId: params.organizationId,
      whatsappConnectionId: params.whatsappConnectionId,
      phone,
      status: 'open',
    },
    select: { id: true, messageCount: true },
  });

  if (existing) {
    await prisma.whatsAppInboxEntry.update({
      where: { id: existing.id },
      data: {
        messageCount: { increment: 1 },
        lastMessageText: params.lastMessageText ?? undefined,
        displayName: params.displayName ?? undefined,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.whatsAppInboxEntry.create({
      data: {
        organizationId: params.organizationId,
        whatsappConnectionId: params.whatsappConnectionId,
        phone,
        displayName: params.displayName ?? null,
        lastMessageText: params.lastMessageText ?? null,
        externalMessageId: params.externalMessageId ?? null,
        rawPayload: params.rawPayload
          ? (params.rawPayload as Parameters<typeof prisma.whatsAppInboxEntry.create>[0]['data']['rawPayload'])
          : undefined,
        needsClinicResolution: true,
        status: 'open',
        messageCount: 1,
      },
    });
  }
}
