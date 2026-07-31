/**
 * externalCalendarWebhook.ts — public, unauthenticated webhook receiver for
 * external calendar providers (DigiDentiS first).
 *
 * Mounted at /api/public (before the global `authenticate` middleware — see
 * index.ts), mirroring routes/metaWhatsAppWebhook.ts's conventions:
 *   - Raw body captured via express.raw() so HMAC verification runs over
 *     the exact bytes DigiDentiS signed.
 *   - Always responds 200 quickly to prevent provider retry storms; all
 *     further processing happens after the response is sent, and any error
 *     is logged, never re-thrown.
 *   - Signature is verified BEFORE the payload is parsed/trusted, using the
 *     clinic's own encrypted webhook secret (never a global/shared secret).
 *   - Every accepted event is durably, idempotently recorded via
 *     externalCalendarWebhookProcessor.ts before any processing is
 *     attempted — a crash after that point is recoverable, never a silent
 *     drop.
 *   - Cross-clinic leakage is impossible: :receiverKey is an opaque, random
 *     per-clinic token (ExternalCalendarIntegration.webhookReceiverKey) —
 *     deliberately NOT the row's own database id, so the URL exposes no
 *     predictable/enumerable identifier and can be rotated independently
 *     (see externalCalendarConnectionService.ts's
 *     rotateExternalCalendarWebhookReceiverKey). clinicId/organizationId are
 *     always read from the resolved row, never from the request body.
 */

import express, { Request, Response } from 'express';
import { getExternalCalendarConnectionRecordByReceiverKey } from '../services/externalCalendar/externalCalendarConnectionService.js';
import { getExternalCalendarProvider } from '../services/externalCalendar/externalCalendarProviderFactory.js';
import { processExternalCalendarWebhookEvent } from '../services/externalCalendar/externalCalendarWebhookProcessor.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { requireWebhookSecretInProduction } from '../utils/secrets.js';

const router = express.Router();

function getRawBody(req: Request): Buffer {
  const rawBody = (req as any).rawBody;
  if (rawBody instanceof Buffer) return rawBody;
  return Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
}

function logWebhookSecurityEvent(
  organizationId: string | null,
  clinicId: string | null,
  connectionId: string,
  event: string,
  description: string,
  metadata?: Record<string, unknown>,
) {
  if (!organizationId) return;
  writeAuditLog({
    organizationId,
    clinicId,
    action: event,
    entityType: 'external_calendar_integration',
    entityId: connectionId,
    description,
    metadata,
  }).catch(() => {
    // Operational log failure must never block webhook processing.
  });
}

router.post(
  '/external-calendar/digidentis/:receiverKey/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    // Always respond 200 quickly — prevents provider retry storms and never
    // reveals whether a receiver key or signature was valid.
    res.status(200).json({ status: 'ok' });

    const receiverKey = req.params['receiverKey'] as string;

    try {
      const rawBody = getRawBody(req);

      const connection = await getExternalCalendarConnectionRecordByReceiverKey(receiverKey);
      if (!connection) return;

      const provider = getExternalCalendarProvider(connection.provider);

      const hasSecret = Boolean(connection.webhookSecretEncrypted);
      if (!hasSecret && !requireWebhookSecretInProduction(null)) {
        logWebhookSecurityEvent(
          connection.organizationId,
          connection.clinicId,
          connection.id,
          'external_calendar_webhook_no_secret_rejected',
          'DigiDentiS webhook rejected: no webhook secret configured in production',
        );
        return;
      }

      if (hasSecret) {
        const valid = provider.verifyWebhookSignature(connection, rawBody, req.headers as Record<string, string>);
        if (!valid) {
          logWebhookSecurityEvent(
            connection.organizationId,
            connection.clinicId,
            connection.id,
            'external_calendar_webhook_invalid_signature',
            'DigiDentiS webhook rejected: signature mismatch',
          );
          return;
        }
      } else {
        logWebhookSecurityEvent(
          connection.organizationId,
          connection.clinicId,
          connection.id,
          'external_calendar_webhook_no_secret',
          'DigiDentiS webhook received without signature verification (no secret configured)',
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return; // Malformed payload — nothing to record.
      }

      const parsed = provider.parseWebhook(payload);

      await processExternalCalendarWebhookEvent({
        provider: connection.provider,
        connectionId: connection.id,
        clinicId: connection.clinicId,
        organizationId: connection.organizationId,
        parsed,
      });
    } catch (err) {
      console.error('[external-calendar-webhook] handler error:', err);
    }
  },
);

export default router;
