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
import { resolveClinicForIncomingMessage } from '../services/whatsapp/clinicResolver.js';
import { deliverIncomingMetaMessage } from '../services/whatsapp/metaInboundDelivery.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { requireWebhookSecretInProduction } from '../utils/secrets.js';
import { decryptSecretTagged } from '../utils/encryption.js';
import { verifyMetaWebhookChallenge } from '../utils/webhookVerification.js';
import { selectUniqueProviderConnection } from '../utils/webhookRouting.js';
import {
  createInboundEventOrDetectDuplicate,
  markInboundEventFailed,
  markInboundEventProcessed,
} from '../services/messagingInboundIdempotency.js';
import { safeErrorFields } from '../utils/safeError.js';

const router = express.Router();

function summarizeProviderId(value: string | null | undefined) {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
}

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

function getRawBody(req: Request): Buffer {
  const rawBody = (req as any).rawBody;
  if (rawBody instanceof Buffer) return rawBody;
  return Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
}

import { createWebhookAckGate, type WebhookAckGate } from '../messaging/webhookAckGate.js';
import { isDurableAckBeforeResponseEnabled } from '../messaging/messagingReliabilityConfig.js';

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Route an incoming parsed Meta webhook event to the correct clinic using the
 * existing clinic resolver + inbox logic. Mirrors the Evolution webhook flow.
 */
/**
 * F5-3 — `onDurablyAccepted` is invoked the instant the inbound ledger row is
 * committed (or the message is recognised as a duplicate), i.e. the first
 * moment at which losing this process would no longer lose the message.
 *
 * That is where the provider ACK belongs. Before F5-3 the 200 was sent at the
 * top of the route, so the window between "provider believes we have it" and
 * "we actually have it" contained a clinic-resolution query and an INSERT — and
 * Meta never redelivers a message it has already had a 200 for.
 *
 * The callback is optional and, in legacy mode, already spent: the route sends
 * its 200 up front exactly as before and this call is a no-op. That is what
 * makes deploying this change behaviourally identical until the flag is on.
 */
async function routeIncomingMetaMessage(
  connection: { id: string; organizationId: string },
  phone: string,
  text: string,
  messageId: string | undefined,
  rawPayload: unknown,
  onDurablyAccepted?: () => void,
): Promise<void> {
  const resolution = await resolveClinicForIncomingMessage(
    connection.id,
    connection.organizationId,
    phone,
  );

  const inboundEvent = await createInboundEventOrDetectDuplicate({
    channel: 'whatsapp',
    provider: 'meta_cloud_api',
    connectionId: connection.id,
    clinicId: resolution.clinicId,
    organizationId: connection.organizationId,
    providerMessageId: messageId,
    providerConversationId: phone,
    fromExternalId: phone,
    fromPhone: phone,
    rawPayload: asJsonRecord(rawPayload),
  });

  // Durably accepted (or provably a duplicate of something already accepted).
  // Everything past this line is processing, and a crash here is recoverable by
  // inboundEventRetryJob because the row exists.
  onDurablyAccepted?.();

  if (inboundEvent.status === 'duplicate') {
    console.info('[meta-webhook] duplicate inbound message skipped', {
      connectionId: connection.id,
      messageId,
    });
    return;
  }

  if (inboundEvent.status === 'skipped') {
    console.warn('[meta-webhook] inbound idempotency skipped', {
      connectionId: connection.id,
      reason: inboundEvent.reason,
    });
  }

  try {
    // Klinik çözümü + inbox + AI işleme çekirdeği retry job ile paylaşılır.
    await deliverIncomingMetaMessage(connection, phone, text, messageId, rawPayload, resolution);

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

// ── Global verification (GET /api/public/whatsapp/meta/webhook) ──────────────

/**
 * Global Meta webhook verification.
 * Uses META_WEBHOOK_VERIFY_TOKEN env var.
 * Responds to Meta's hub.verify_token challenge.
 */
router.get('/whatsapp/meta/webhook', (req: Request, res: Response) => {
  const verification = verifyMetaWebhookChallenge({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
    expectedToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
  });

  if (verification.ok) {
    return res.status(200).send(verification.challenge);
  }

  if (verification.reason === 'missing_expected_token') {
    return res.status(503).json({
      error: 'META_WEBHOOK_VERIFY_TOKEN is not configured on this server.',
    });
  }

  return res.status(403).json({ error: 'Webhook verification failed' });
});

// ── Global incoming (POST /api/public/whatsapp/meta/webhook) ─────────────────

/**
 * Global Meta webhook receiver.
 * Resolves the connection by phone_number_id from the payload metadata.
 */
router.post('/whatsapp/meta/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  // F5-3 — the response is answered through a gate so it goes out exactly once,
  // whichever branch reaches it first.
  //
  // Legacy (flag off, the default): answer 200 immediately, exactly as before.
  // Durable-ack (flag on): hold the answer until the inbound ledger row is
  // committed, so a crash before that point returns 503 and Meta retries
  // instead of the message being lost behind a 200 nobody can take back.
  const gate = createWebhookAckGate(res);
  if (!isDurableAckBeforeResponseEnabled()) gate.ack();

  try {
    const rawBody = getRawBody(req);
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return; // Ignore malformed payloads
    }

    // Extract phone_number_id to resolve the connection
    const phoneNumberId = MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload(payload);
    if (!phoneNumberId) return;

    const connectionMatches = await prisma.whatsAppConnection.findMany({
      where: { metaPhoneNumberId: phoneNumberId, provider: 'meta_cloud_api', isActive: true },
      select: { id: true, organizationId: true, metaWebhookSecret: true, webhookSecret: true },
    });
    const connection = selectUniqueProviderConnection(connectionMatches);
    if (!connection) {
      console.warn('[meta-webhook] connection resolution failed', {
        reason: connectionMatches.length === 0 ? 'no_match' : 'multiple_matches',
        phoneNumberId: summarizeProviderId(phoneNumberId),
        matchCount: connectionMatches.length,
      });
      return;
    }

    // Validate signature if secret configured
    const secret = decryptSecretTagged(connection.metaWebhookSecret) || decryptSecretTagged(connection.webhookSecret);
    if (!secret && !requireWebhookSecretInProduction(secret)) {
      logWebhookEvent(
        connection.organizationId,
        connection.id,
        'meta_webhook_no_secret_rejected',
        'Meta webhook rejected: no webhook secret configured in production',
        {},
      );
      return;
    }
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
        event.raw,
        () => gate.ack(),
      );
    }
  } catch (err) {
    console.error('[meta-webhook] global handler error:', safeErrorFields(err));
    // Only reachable in durable-ack mode, and only when nothing has answered
    // yet — i.e. the failure happened at or before durable acceptance. A 503
    // makes Meta's own redelivery the backstop. In legacy mode the 200 is
    // already out and this is a no-op, preserving today's behaviour exactly.
    gate.fail('PROCESSING_FAILED_BEFORE_ACCEPTANCE');
  } finally {
    // Every early return above (malformed payload, unresolved connection,
    // rejected signature, nothing to route) still owes the provider an answer.
    gate.ack();
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

    const verification = verifyMetaWebhookChallenge({
      mode: req.query['hub.mode'],
      token: req.query['hub.verify_token'],
      challenge: req.query['hub.challenge'],
      expectedToken,
    });

    if (!verification.ok && verification.reason === 'missing_expected_token') {
      return res.status(503).json({
        error: 'No verify token configured for this connection. Set metaWebhookVerifyToken or META_WEBHOOK_VERIFY_TOKEN.',
      });
    }

    if (verification.ok) {
      return res.status(200).send(verification.challenge);
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
    // See the global route above for why the answer goes through a gate.
    const gate = createWebhookAckGate(res);
    if (!isDurableAckBeforeResponseEnabled()) gate.ack();

    const connectionId = req.params['connectionId'] as string;

    try {
      const rawBody = getRawBody(req);
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
      const secret = decryptSecretTagged(connection.metaWebhookSecret) || decryptSecretTagged(connection.webhookSecret);
      if (!secret && !requireWebhookSecretInProduction(secret)) {
        logWebhookEvent(
          connection.organizationId,
          connection.id,
          'meta_webhook_no_secret_rejected',
          'Meta webhook rejected: no webhook secret configured in production',
          { connectionId },
        );
        return;
      }
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
          event.raw,
          () => gate.ack(),
        );
      }
      // status_update events are logged but not yet persisted (future sprint)
    } catch (err) {
      console.error('[meta-webhook] connectionId handler error:', safeErrorFields(err));
      gate.fail('PROCESSING_FAILED_BEFORE_ACCEPTANCE');
    } finally {
      gate.ack();
    }
  },
);

export default router;
