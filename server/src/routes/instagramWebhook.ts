/**
 * instagramWebhook.ts — Meta Instagram Webhook Routes (public, no JWT auth)
 *
 * Routes:
 *   GET  /api/public/instagram/webhook  — Meta webhook verification challenge
 *   POST /api/public/instagram/webhook  — Incoming Instagram DM events
 *
 * Optional connection-specific routes:
 *   GET  /api/public/instagram/:connectionId/webhook
 *   POST /api/public/instagram/:connectionId/webhook
 *
 * Security rules:
 *   - Webhook challenge uses hub.verify_token from connection or env fallback.
 *   - Payload signature validated using X-Hub-Signature-256 when webhookSecret configured.
 *   - Incoming messages are stored in InstagramInboxEntry.
 *   - Cross-organization leakage is impossible: each connection is org-scoped.
 *   - Never expose tokens, secrets, or raw encrypted fields in responses.
 *   - Always return 200 to Meta quickly (errors are logged, not propagated).
 */

import express, { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '../db.js';
import {
  parseWebhook,
} from '../services/instagram/InstagramMessagingProvider.js';
import {
  resolveClinicForInstagramMessage,
  upsertInstagramInboxEntry,
} from '../services/instagram/instagramClinicResolver.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { requireWebhookSecretInProduction } from '../utils/secrets.js';

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    // Operational log failure must never block webhook processing
  });
}

/**
 * Validate X-Hub-Signature-256 from Meta.
 * Returns true if valid, false if invalid, null if no secret configured.
 */
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

/** Find Instagram connection by instagramAccountId matching the recipient in the payload. */
async function findConnectionByRecipientId(
  recipientId: string,
): Promise<{ id: string; organizationId: string; webhookSecret?: string | null } | null> {
  return prisma.instagramConnection.findFirst({
    where: { instagramAccountId: recipientId, isActive: true },
    select: { id: true, organizationId: true, webhookSecret: true },
  });
}

// ── Global webhook verify (GET) ───────────────────────────────────────────────

router.get('/instagram/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  if (mode !== 'subscribe') {
    return res.sendStatus(400);
  }

  const globalToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '';
  if (!token || token !== globalToken) {
    return res.sendStatus(403);
  }

  return res.status(200).send(challenge as string);
});

// ── Connection-specific webhook verify (GET) ──────────────────────────────────

router.get('/instagram/:connectionId/webhook', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  if (mode !== 'subscribe') {
    return res.sendStatus(400);
  }

  const connectionId = req.params["connectionId"] as string;

  try {
    const conn = await prisma.instagramConnection.findUnique({
      where: { id: connectionId },
      select: { webhookVerifyToken: true },
    });

    if (!conn) return res.sendStatus(404);

    if (!token || token !== conn.webhookVerifyToken) {
      return res.sendStatus(403);
    }

    return res.status(200).send(challenge as string);
  } catch {
    return res.sendStatus(500);
  }
});

// ── Global webhook receive (POST) ─────────────────────────────────────────────

router.post(
  '/instagram/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    // Always respond 200 immediately — Meta will retry on non-2xx
    res.sendStatus(200);

    let rawBody: Buffer;
    try {
      rawBody = getRawBody(req);
      const body = JSON.parse(rawBody.toString());
      await handleInstagramWebhookPayload(body, req.headers['x-hub-signature-256'] as string | undefined, rawBody);
    } catch {
      // Ignore parse errors silently — don't block the 200
    }
  },
);

// ── Connection-specific webhook receive (POST) ────────────────────────────────

router.post(
  '/instagram/:connectionId/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    res.sendStatus(200);

    const connectionId = req.params["connectionId"] as string;

    try {
      const rawBody = getRawBody(req);
      const body = JSON.parse(rawBody.toString());

      const conn = await prisma.instagramConnection.findUnique({
        where: { id: connectionId },
        select: {
          id: true,
          organizationId: true,
          webhookSecret: true,
          instagramAccountId: true,
          isActive: true,
        },
      });

      if (!conn || !conn.isActive) return;

      // Validate signature if secret is configured
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      if (!conn.webhookSecret && !requireWebhookSecretInProduction(conn.webhookSecret)) {
        logWebhookEvent(conn.organizationId, conn.id, 'instagram_webhook_no_secret_rejected',
          'Instagram webhook rejected: no webhook secret configured in production');
        return;
      }
      if (conn.webhookSecret) {
        const valid = validateHubSignature(rawBody, sig, conn.webhookSecret);
        if (valid === false) {
          logWebhookEvent(conn.organizationId, conn.id, 'instagram_webhook_signature_invalid',
            'X-Hub-Signature-256 validation failed');
          return;
        }
      }

      await processInstagramPayload(conn.id, conn.organizationId, body);
    } catch {
      // Errors must not block the 200 response already sent
    }
  },
);

// ── Shared processing logic ───────────────────────────────────────────────────

async function handleInstagramWebhookPayload(
  body: unknown,
  signature: string | undefined,
  rawBody: Buffer,
): Promise<void> {
  const events = parseWebhook(body);
  if (events.length === 0) return;

  // Determine connection by recipientId in the first relevant message event
  const firstMessage = events.find(e => e.eventType === 'message');
  if (!firstMessage?.recipientId) return;

  const conn = await findConnectionByRecipientId(firstMessage.recipientId);
  if (!conn) {
    // Unknown Instagram account — log and discard safely
    return;
  }

  // Validate signature if secret is configured
  if (!conn.webhookSecret && !requireWebhookSecretInProduction(conn.webhookSecret)) {
    logWebhookEvent(conn.organizationId, conn.id, 'instagram_webhook_no_secret_rejected',
      'Instagram webhook rejected: no webhook secret configured in production');
    return;
  }
  if (conn.webhookSecret) {
    const valid = validateHubSignature(rawBody, signature, conn.webhookSecret);
    if (valid === false) {
      logWebhookEvent(conn.organizationId, conn.id, 'instagram_webhook_signature_invalid',
        'X-Hub-Signature-256 validation failed on global route');
      return;
    }
  }

  await processInstagramPayload(conn.id, conn.organizationId, body);
}

async function processInstagramPayload(
  connectionId: string,
  organizationId: string,
  body: unknown,
): Promise<void> {
  const events = parseWebhook(body);

  for (const event of events) {
    // Only store inbound text messages (not echo, not unsupported)
    if (event.eventType !== 'message') continue;
    if (!event.senderId) continue;

    const resolution = await resolveClinicForInstagramMessage(connectionId);

    await upsertInstagramInboxEntry({
      organizationId,
      instagramConnectionId: connectionId,
      clinicId: resolution.clinicId,
      needsClinicResolution: resolution.needsClinicResolution,
      externalSenderId: event.senderId,
      externalConversationId: event.externalConversationId ?? null,
      senderUsername: null,  // Not available in basic webhook payload; resolved later if needed
      lastMessageText: event.text ?? null,
      externalMessageId: event.externalMessageId ?? null,
      rawPayload: event.rawPayload as Record<string, unknown>,
    });
  }
}

export default router;
