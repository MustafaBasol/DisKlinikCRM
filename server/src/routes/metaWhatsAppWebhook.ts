/**
 * metaWhatsAppWebhook.ts — Meta Cloud API Webhook Routes (public, no JWT auth)
 *
 * Two routing strategies are supported:
 *
 * A) Connection-specific routes (recommended for single-WABA setups):
 *    GET  /api/public/whatsapp/meta/:connectionId/webhook  — verification challenge
 *    POST /api/public/whatsapp/meta/:connectionId/webhook  — incoming events
 *
 * B) Global route (for setups where one Meta App serves multiple connections):
 *    GET  /api/public/whatsapp/meta/webhook  — verification (uses META_WEBHOOK_VERIFY_TOKEN env)
 *    POST /api/public/whatsapp/meta/webhook  — resolves connection by phone_number_id in payload
 *
 * Security rules:
 *   - Webhook verification uses hub.verify_token.
 *   - Payloads are validated using X-Hub-Signature-256 if webhookSecret is configured.
 *   - Incoming messages are processed via the existing inbox routing / clinic resolver.
 *   - Cross-organization leakage is impossible: each connectionId is org-scoped.
 *   - Never expose tokens, secrets, or access tokens in responses.
 */

import express, { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '../db.js';
import { MetaCloudWhatsAppProvider } from '../services/whatsapp/MetaCloudWhatsAppProvider.js';
import {
  resolveClinicForIncomingMessage,
  upsertInboxEntry,
} from '../services/whatsapp/clinicResolver.js';
import { writeAuditLog } from '../utils/auditLog.js';

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget operational event log for webhook security/health events.
 * Never logs tokens, secrets, or raw Authorization headers.
 */
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
    entityType: 'whatsapp_connection',
    entityId: connectionId,
    description,
    metadata,
  }).catch(() => {
    // Operational log failure must never block webhook processing
  });
}

/**
 * Validate the X-Hub-Signature-256 header sent by Meta.
 * Returns true if valid, false if invalid, null if no secret is configured.
 */
function validateHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean | null {
  if (!secret) return null;
  if (!signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  // Constant-time comparison to prevent timing attacks
  try {
    if (expected.length === signature.length) {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    }
    return false;
  } catch {
    return expected === signature;
  }
}

/**
 * Route an incoming parsed Meta webhook event to the correct clinic using the
 * existing clinic resolver + inbox logic. Mirrors the Evolution webhook flow.
 */
async function routeIncomingMetaMessage(
  connection: { id: string; organizationId: string },
  phone: string,
  text: string,
  messageId: string | undefined,
): Promise<void> {
  const resolution = await resolveClinicForIncomingMessage(
    connection.id,
    connection.organizationId,
    phone,
  );

  if (resolution.clinicId) {
    // Priority A/B/C resolved — clinic is known, existing booking-flow handles it
    // via the existing Evolution-style conversation state. Meta messages with a known
    // clinic are stored in the inbox for staff visibility.
    await upsertInboxEntry({
      organizationId: connection.organizationId,
      whatsappConnectionId: connection.id,
      phone,
      lastMessageText: text,
      externalMessageId: messageId,
    });
  } else {
    // Priority D — unresolved shared-line, create inbox entry for manual resolution
    await upsertInboxEntry({
      organizationId: connection.organizationId,
      whatsappConnectionId: connection.id,
      phone,
      lastMessageText: text,
      externalMessageId: messageId,
    });
  }
}

// ── Global verification (GET /api/public/whatsapp/meta/webhook) ──────────────

/**
 * Global Meta webhook verification.
 * Uses META_WEBHOOK_VERIFY_TOKEN env var.
 * Responds to Meta's hub.verify_token challenge.
 */
router.get('/whatsapp/meta/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!expectedToken) {
    return res.status(503).json({
      error: 'META_WEBHOOK_VERIFY_TOKEN is not configured on this server.',
    });
  }

  if (mode === 'subscribe' && token === expectedToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ error: 'Webhook verification failed' });
});

// ── Global incoming (POST /api/public/whatsapp/meta/webhook) ─────────────────

/**
 * Global Meta webhook receiver.
 * Resolves the connection by phone_number_id from the payload metadata.
 */
router.post('/whatsapp/meta/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  // Always respond 200 quickly to Meta to prevent retries
  res.status(200).json({ status: 'ok' });

  try {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return; // Ignore malformed payloads
    }

    // Extract phone_number_id to resolve the connection
    const phoneNumberId = MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload(payload);
    if (!phoneNumberId) return;

    const connection = await prisma.whatsAppConnection.findFirst({
      where: { metaPhoneNumberId: phoneNumberId, provider: 'meta_cloud_api', isActive: true },
      select: { id: true, organizationId: true, metaWebhookSecret: true, webhookSecret: true },
    });
    if (!connection) return;

    // Validate signature if secret configured
    const secret = connection.metaWebhookSecret || connection.webhookSecret;
    if (secret) {
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      const valid = validateHubSignature(rawBody, sig, secret);
      if (valid === false) {
        logWebhookEvent(
          connection.organizationId,
          connection.id,
          'meta_webhook_invalid_signature',
          'Meta webhook rejected: X-Hub-Signature-256 mismatch on global route',
          { hasSignatureHeader: Boolean(sig) },
        );
        return; // Reject silently — already sent 200
      }
    } else {
      // No secret configured — log once so operators know signature is not verified
      logWebhookEvent(
        connection.organizationId,
        connection.id,
        'meta_webhook_no_secret',
        'Meta webhook received without signature verification (no secret configured)',
        {},
      );
    }

    const provider = new MetaCloudWhatsAppProvider();
    const event = provider.parseWebhook(payload, {
      id: connection.id,
      organizationId: connection.organizationId,
      provider: 'meta_cloud_api',
      status: 'connected',
    });

    if (event.eventType === 'message' && event.phone && event.text) {
      await routeIncomingMetaMessage(
        { id: connection.id, organizationId: connection.organizationId },
        event.phone,
        event.text,
        event.messageId,
      );
    }
  } catch (err) {
    // Log but do not re-throw — we already sent 200 to Meta
    console.error('[meta-webhook] global handler error:', err);
  }
});

// ── Connection-specific verification (GET /api/public/whatsapp/meta/:connectionId/webhook) ──

/**
 * Per-connection Meta webhook verification.
 * Compares hub.verify_token with the connection's metaWebhookVerifyToken
 * or falls back to the global META_WEBHOOK_VERIFY_TOKEN env var.
 */
router.get('/whatsapp/meta/:connectionId/webhook', async (req: Request, res: Response) => {
  const connectionId = req.params['connectionId'] as string;
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  try {
    const connection = await prisma.whatsAppConnection.findFirst({
      where: { id: connectionId, provider: 'meta_cloud_api', isActive: true },
      select: { id: true, metaWebhookVerifyToken: true },
    });

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const expectedToken =
      connection.metaWebhookVerifyToken?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();

    if (!expectedToken) {
      return res.status(503).json({
        error: 'No verify token configured for this connection. Set metaWebhookVerifyToken or META_WEBHOOK_VERIFY_TOKEN.',
      });
    }

    if (mode === 'subscribe' && token === expectedToken) {
      return res.status(200).send(challenge);
    }

    return res.status(403).json({ error: 'Webhook verification failed' });
  } catch (err) {
    console.error('[meta-webhook] verification error:', err);
    return res.status(500).json({ error: 'Verification error' });
  }
});

// ── Connection-specific incoming (POST /api/public/whatsapp/meta/:connectionId/webhook) ──

/**
 * Per-connection Meta webhook receiver.
 * Validates provider, validates signature, parses payload, routes message.
 */
router.post(
  '/whatsapp/meta/:connectionId/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    // Always respond 200 quickly
    res.status(200).json({ status: 'ok' });

    const connectionId = req.params['connectionId'] as string;

    try {
      const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return;
      }

      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id: connectionId, provider: 'meta_cloud_api', isActive: true },
        select: {
          id: true,
          organizationId: true,
          metaWebhookSecret: true,
          webhookSecret: true,
        },
      });

      if (!connection) return;

      // Validate signature if secret configured
      const secret = connection.metaWebhookSecret || connection.webhookSecret;
      if (secret) {
        const sig = req.headers['x-hub-signature-256'] as string | undefined;
        const valid = validateHubSignature(rawBody, sig, secret);
        if (valid === false) {
          logWebhookEvent(
            connection.organizationId,
            connection.id,
            'meta_webhook_invalid_signature',
            'Meta webhook rejected: X-Hub-Signature-256 mismatch on connection-specific route',
            { hasSignatureHeader: Boolean(sig), connectionId },
          );
          return;
        }
      } else {
        logWebhookEvent(
          connection.organizationId,
          connection.id,
          'meta_webhook_no_secret',
          'Meta webhook received without signature verification (no secret configured)',
          { connectionId },
        );
      }

      const provider = new MetaCloudWhatsAppProvider();
      const event = provider.parseWebhook(payload, {
        id: connection.id,
        organizationId: connection.organizationId,
        provider: 'meta_cloud_api',
        status: 'connected',
      });

      if (event.eventType === 'message' && event.phone && event.text) {
        await routeIncomingMetaMessage(
          { id: connection.id, organizationId: connection.organizationId },
          event.phone,
          event.text,
          event.messageId,
        );
      }
      // status_update events are logged but not yet persisted (future sprint)
    } catch (err) {
      console.error('[meta-webhook] connectionId handler error:', err);
    }
  },
);

export default router;
