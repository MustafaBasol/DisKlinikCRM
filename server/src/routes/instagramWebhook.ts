/**
 * Public Meta Instagram webhook routes.
 *
 * GET /api/public/instagram/webhook verifies the global Meta callback.
 * POST /api/public/instagram/webhook resolves the clinic from provider IDs in
 * the payload, never from the URL alone.
 */

import express, { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '../db.js';
import {
  parseWebhook,
  type ParsedInstagramEvent,
} from '../services/instagram/InstagramMessagingProvider.js';
import {
  resolveClinicForInstagramMessage,
  upsertInstagramInboxEntry,
} from '../services/instagram/instagramClinicResolver.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { requireWebhookSecretInProduction } from '../utils/secrets.js';
import { verifyMetaWebhookChallenge } from '../utils/webhookVerification.js';
import { selectUniqueProviderConnection } from '../utils/webhookRouting.js';
import {
  createInboundEventOrDetectDuplicate,
  markInboundEventFailed,
  markInboundEventProcessed,
} from '../services/messagingInboundIdempotency.js';

const router = express.Router();

type InstagramWebhookConnection = {
  id: string;
  organizationId: string;
  instagramAccountId?: string | null;
  facebookPageId?: string | null;
  webhookSecret?: string | null;
};

function logWebhookEvent(
  organizationId: string,
  connectionId: string,
  event: string,
  description: string,
  metadata?: Record<string, unknown>,
) {
  writeAuditLog({
    organizationId,
    action: event,
    entityType: 'instagram_connection',
    entityId: connectionId,
    description,
    metadata,
  }).catch(() => {
    // Operational log failure must never block webhook processing.
  });
}

function validateHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean | null {
  if (!secret) return null;
  if (!signature) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    if (expected.length === signature.length) {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    }
    return false;
  } catch {
    return expected === signature;
  }
}

function getRawBody(req: Request): Buffer {
  const rawBody = (req as any).rawBody;
  if (rawBody instanceof Buffer) return rawBody;
  return req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function summarizeProviderId(value: string | null | undefined) {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
}

function logInstagramResolutionFailure(
  reason: 'no_match' | 'multiple_matches' | 'identifier_mismatch',
  metadata: Record<string, unknown>,
) {
  console.warn('[instagram-webhook] connection resolution failed', {
    reason,
    ...metadata,
  });
}

async function findUniqueConnectionByProviderIdentifiers(params: {
  recipientId?: string | null;
  pageId?: string | null;
}): Promise<InstagramWebhookConnection | null> {
  const identifiers = [params.recipientId, params.pageId]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim());

  if (identifiers.length === 0) {
    logInstagramResolutionFailure('no_match', {
      recipientId: null,
      pageId: null,
      matchCount: 0,
    });
    return null;
  }

  const matches = await prisma.instagramConnection.findMany({
    where: {
      isActive: true,
      OR: identifiers.flatMap(identifier => [
        { instagramAccountId: identifier },
        { facebookPageId: identifier },
      ]),
    },
    select: {
      id: true,
      organizationId: true,
      instagramAccountId: true,
      facebookPageId: true,
      webhookSecret: true,
    },
  });

  const connection = selectUniqueProviderConnection(matches);
  if (!connection) {
    logInstagramResolutionFailure(matches.length === 0 ? 'no_match' : 'multiple_matches', {
      recipientId: summarizeProviderId(params.recipientId),
      pageId: summarizeProviderId(params.pageId),
      matchCount: matches.length,
    });
  }

  return connection;
}

function eventMatchesConnectionIdentifiers(
  event: ParsedInstagramEvent,
  connection: InstagramWebhookConnection,
): boolean {
  const eventIds = new Set(
    [event.recipientId, event.pageId]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(value => value.trim()),
  );
  if (eventIds.size === 0) return false;

  const connectionIds = [connection.instagramAccountId, connection.facebookPageId]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim());

  return connectionIds.some(identifier => eventIds.has(identifier));
}

function acceptsInstagramWebhookSignature(
  connection: InstagramWebhookConnection,
  signature: string | undefined,
  rawBody: Buffer,
  route: 'global' | 'connection',
): boolean {
  if (!connection.webhookSecret && !requireWebhookSecretInProduction(connection.webhookSecret)) {
    logWebhookEvent(connection.organizationId, connection.id, 'instagram_webhook_no_secret_rejected',
      'Instagram webhook rejected: no webhook secret configured in production', { route });
    return false;
  }

  if (connection.webhookSecret) {
    const valid = validateHubSignature(rawBody, signature, connection.webhookSecret);
    if (valid === false) {
      logWebhookEvent(connection.organizationId, connection.id, 'instagram_webhook_signature_invalid',
        'X-Hub-Signature-256 validation failed', {
          route,
          hasSignatureHeader: Boolean(signature),
        });
      return false;
    }
  }

  return true;
}

router.get('/instagram/webhook', (req: Request, res: Response) => {
  const verification = verifyMetaWebhookChallenge({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
    expectedToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
  });

  if (!verification.ok) {
    console.warn('[instagram-webhook] verification failed', {
      route: 'global',
      reason: verification.reason,
      hasToken: Boolean(req.query['hub.verify_token']),
      expectedConfigured: Boolean(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim()),
      hasChallenge: Boolean(req.query['hub.challenge']),
    });
    return res.sendStatus(403);
  }

  return res.status(200).send(verification.challenge);
});

router.get('/instagram/:connectionId/webhook', async (req: Request, res: Response) => {
  const connectionId = req.params['connectionId'] as string;

  try {
    const conn = await prisma.instagramConnection.findUnique({
      where: { id: connectionId },
      select: { webhookVerifyToken: true },
    });

    if (!conn) return res.sendStatus(404);

    const verification = verifyMetaWebhookChallenge({
      mode: req.query['hub.mode'],
      token: req.query['hub.verify_token'],
      challenge: req.query['hub.challenge'],
      expectedToken: conn.webhookVerifyToken,
    });

    if (!verification.ok) {
      console.warn('[instagram-webhook] verification failed', {
        route: 'connection',
        connectionId,
        reason: verification.reason,
        hasToken: Boolean(req.query['hub.verify_token']),
        expectedConfigured: Boolean(conn.webhookVerifyToken?.trim()),
        hasChallenge: Boolean(req.query['hub.challenge']),
      });
      return res.sendStatus(403);
    }

    return res.status(200).send(verification.challenge);
  } catch {
    return res.sendStatus(500);
  }
});

router.post(
  '/instagram/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    res.sendStatus(200);

    try {
      const rawBody = getRawBody(req);
      const body = JSON.parse(rawBody.toString());
      await handleInstagramWebhookPayload(
        body,
        req.headers['x-hub-signature-256'] as string | undefined,
        rawBody,
      );
    } catch {
      // Errors must not block the 200 response already sent.
    }
  },
);

router.post(
  '/instagram/:connectionId/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    res.sendStatus(200);

    const connectionId = req.params['connectionId'] as string;

    try {
      const rawBody = getRawBody(req);
      const body = JSON.parse(rawBody.toString());

      const conn = await prisma.instagramConnection.findUnique({
        where: { id: connectionId },
        select: {
          id: true,
          organizationId: true,
          instagramAccountId: true,
          facebookPageId: true,
          webhookSecret: true,
          isActive: true,
        },
      });

      if (!conn || !conn.isActive) return;

      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      if (!acceptsInstagramWebhookSignature(conn, sig, rawBody, 'connection')) return;

      await processInstagramPayloadForConnection(conn, body);
    } catch {
      // Errors must not block the 200 response already sent.
    }
  },
);

async function handleInstagramWebhookPayload(
  body: unknown,
  signature: string | undefined,
  rawBody: Buffer,
): Promise<void> {
  const events = parseWebhook(body);
  if (events.length === 0) return;

  for (const event of events) {
    if (event.eventType !== 'message') continue;
    if (!event.senderId) continue;

    const conn = await findUniqueConnectionByProviderIdentifiers({
      recipientId: event.recipientId,
      pageId: event.pageId,
    });
    if (!conn) continue;
    if (!acceptsInstagramWebhookSignature(conn, signature, rawBody, 'global')) continue;

    await processInstagramEventForConnection(conn, event);
  }
}

async function processInstagramPayloadForConnection(
  connection: InstagramWebhookConnection,
  body: unknown,
): Promise<void> {
  const events = parseWebhook(body);

  for (const event of events) {
    if (event.eventType !== 'message') continue;
    if (!event.senderId) continue;

    await processInstagramEventForConnection(connection, event);
  }
}

async function processInstagramEventForConnection(
  connection: InstagramWebhookConnection,
  event: ParsedInstagramEvent,
): Promise<void> {
  if (!eventMatchesConnectionIdentifiers(event, connection)) {
    logInstagramResolutionFailure('identifier_mismatch', {
      connectionId: connection.id,
      recipientId: summarizeProviderId(event.recipientId),
      pageId: summarizeProviderId(event.pageId),
    });
    return;
  }

  const resolution = await resolveClinicForInstagramMessage(connection.id);
  if (resolution.resolutionSource === 'no_clinic_links') {
    logWebhookEvent(connection.organizationId, connection.id, 'instagram_webhook_no_clinic_links',
      'Instagram webhook received for a connection with no clinic assignments');
  }

  const inboundEvent = await createInboundEventOrDetectDuplicate({
    channel: 'instagram',
    provider: 'meta_graph',
    connectionId: connection.id,
    clinicId: resolution.clinicId,
    organizationId: connection.organizationId,
    providerMessageId: event.externalMessageId,
    providerConversationId: event.externalConversationId ?? event.senderId ?? null,
    fromExternalId: event.senderId ?? null,
    toExternalId: event.recipientId ?? event.pageId ?? null,
    rawPayload: asJsonRecord(event.rawPayload),
  });

  if (inboundEvent.status === 'duplicate') {
    console.info('[instagram-webhook] duplicate inbound message skipped', {
      connectionId: connection.id,
      messageId: event.externalMessageId,
    });
    return;
  }

  if (inboundEvent.status === 'skipped') {
    console.warn('[instagram-webhook] inbound idempotency skipped', {
      connectionId: connection.id,
      reason: inboundEvent.reason,
    });
  }

  try {
    await upsertInstagramInboxEntry({
      organizationId: connection.organizationId,
      instagramConnectionId: connection.id,
      clinicId: resolution.clinicId,
      needsClinicResolution: resolution.needsClinicResolution,
      externalSenderId: event.senderId!,
      externalConversationId: event.externalConversationId ?? null,
      senderUsername: null,
      lastMessageText: event.text ?? null,
      externalMessageId: event.externalMessageId ?? null,
      rawPayload: asJsonRecord(event.rawPayload),
    });

    if (inboundEvent.status === 'created') {
      await markInboundEventProcessed(inboundEvent.eventId);
    }
  } catch (error) {
    if (inboundEvent.status === 'created') {
      await markInboundEventFailed(inboundEvent.eventId, error).catch(() => {});
    }
    throw error;
  }
}

export default router;
