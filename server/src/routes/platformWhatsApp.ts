/**
 * platformWhatsApp.ts — F3-WA-META-COEX-002B
 *
 * Platform Admin API for the platform's own (NoraMedi-owned) Meta Cloud API
 * WhatsApp connection — NOT a tenant/clinic connection. Mounted under the
 * existing platform namespace (/api/platform/...), kept in its own file
 * rather than growing platformAdmin.ts further — same separation already
 * used for platformSecurityIncidents.ts / platformExternalCalendar.ts /
 * platformMigration.ts. Every route requires authenticatePlatformAdmin, and
 * every state-changing route requires csrfProtection('platform') — no
 * clinic JWT fallback, no tenant OWNER/ORG_ADMIN access.
 *
 * Singleton by design: at most one PlatformWhatsAppConnection row can ever
 * exist (DB-level unique `singleton` column — see schema.prisma), so these
 * routes address it directly rather than by :id.
 *
 * Secrets: never returned to the client (sanitizePlatformConnection strips
 * them, mirroring organizationWhatsApp.ts's sanitizeConnection), never
 * logged, and an omitted secret field on update leaves the stored value
 * unchanged (the create/update service functions only touch a secret field
 * when the caller actually supplies a non-empty string).
 *
 * Tenant isolation: this file only ever touches
 * prisma.platformWhatsAppConnection, never prisma.whatsAppConnection — see
 * F3-WA-META-COEX-002B evidence doc for the explicit negative tests.
 */

import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticatePlatformAdmin, PlatformAdminRequest } from '../middleware/platformAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import {
  PlatformWhatsAppConnectionAlreadyExistsError,
  PlatformWhatsAppConnectionNotFoundError,
  PlatformWhatsAppMetaConfigIncompleteError,
  createPlatformWhatsAppConnection,
  deletePlatformWhatsAppConnection,
  disconnectPlatformWhatsAppConnection,
  getPlatformWhatsAppConnection,
  testPlatformWhatsAppConnection,
  updatePlatformWhatsAppConnection,
} from '../services/platformWhatsAppConnectionService.js';
import {
  writePlatformAdminAuditEvent,
  writePlatformAdminAuditEventInTx,
} from '../services/platformAdminAudit.js';
import { safeErrorFields } from '../utils/safeError.js';

const router = express.Router();

router.use(authenticatePlatformAdmin as express.RequestHandler, csrfProtection('platform'));

/** Strip encrypted fields before sending to the client — mirrors organizationWhatsApp.ts's sanitizeConnection(). */
function sanitizePlatformConnection(conn: Record<string, unknown>) {
  const {
    metaAccessTokenEncrypted: _mat,
    metaWebhookVerifyToken: _mwvt,
    metaWebhookSecret: _mws,
    webhookSecret: _ws,
    ...safe
  } = conn;
  return safe;
}

const connectionInputSchema = z.object({
  name: z.string().min(1).max(80),
  phoneNumber: z.string().max(30).optional().nullable(),
  displayName: z.string().max(80).optional().nullable(),
  metaBusinessId: z.string().max(80).optional().nullable(),
  metaWabaId: z.string().max(80).optional().nullable(),
  metaPhoneNumberId: z.string().max(80).optional().nullable(),
  metaAppId: z.string().max(80).optional().nullable(),
  metaAccessTokenEncrypted: z.string().max(1000).optional().nullable(),
  metaWebhookVerifyToken: z.string().max(120).optional().nullable(),
  metaWebhookSecret: z.string().max(120).optional().nullable(),
  webhookSecret: z.string().max(120).optional().nullable(),
});
const connectionCreateSchema = connectionInputSchema;
const connectionUpdateSchema = connectionInputSchema.partial();

/** Sanitized, non-secret metadata describing which fields a mutation touched. */
function changedFieldNames(body: Record<string, unknown>): string[] {
  return Object.keys(body).sort();
}

// GET /api/platform/whatsapp/meta-connection
router.get('/whatsapp/meta-connection', async (_req: PlatformAdminRequest, res: Response) => {
  const connection = await getPlatformWhatsAppConnection();
  res.json({ connection: connection ? sanitizePlatformConnection(connection) : null });
});

// POST /api/platform/whatsapp/meta-connection
router.post('/whatsapp/meta-connection', async (req: PlatformAdminRequest, res: Response) => {
  const parsed = connectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    const connection = await prisma.$transaction(async (tx) => {
      const created = await createPlatformWhatsAppConnection(parsed.data, tx);
      await writePlatformAdminAuditEventInTx(tx, {
        actorPlatformAdminId: req.platformAdmin?.id ?? null,
        action: 'platform_whatsapp_connection.created',
        resourceType: 'platform_whatsapp_connection',
        resourceKey: created.id,
        outcome: 'success',
        safeMetadata: { fields: changedFieldNames(parsed.data) },
      });
      return created;
    });
    res.status(201).json({ connection: sanitizePlatformConnection(connection) });
  } catch (err) {
    if (err instanceof PlatformWhatsAppMetaConfigIncompleteError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof PlatformWhatsAppConnectionAlreadyExistsError) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[platform-whatsapp] create failed:', safeErrorFields(err));
    res.status(500).json({ error: 'Failed to create the platform WhatsApp connection' });
  }
});

// PUT /api/platform/whatsapp/meta-connection
router.put('/whatsapp/meta-connection', async (req: PlatformAdminRequest, res: Response) => {
  const parsed = connectionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    const connection = await prisma.$transaction(async (tx) => {
      const existing = await getPlatformWhatsAppConnection(tx);
      if (!existing) throw new PlatformWhatsAppConnectionNotFoundError();
      const updated = await updatePlatformWhatsAppConnection(existing.id, parsed.data, tx);
      await writePlatformAdminAuditEventInTx(tx, {
        actorPlatformAdminId: req.platformAdmin?.id ?? null,
        action: 'platform_whatsapp_connection.updated',
        resourceType: 'platform_whatsapp_connection',
        resourceKey: updated.id,
        outcome: 'success',
        safeMetadata: { fields: changedFieldNames(parsed.data) },
      });
      return updated;
    });
    res.json({ connection: sanitizePlatformConnection(connection) });
  } catch (err) {
    if (err instanceof PlatformWhatsAppConnectionNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof PlatformWhatsAppMetaConfigIncompleteError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[platform-whatsapp] update failed:', safeErrorFields(err));
    res.status(500).json({ error: 'Failed to update the platform WhatsApp connection' });
  }
});

// POST /api/platform/whatsapp/meta-connection/test
router.post('/whatsapp/meta-connection/test', async (req: PlatformAdminRequest, res: Response) => {
  const existing = await getPlatformWhatsAppConnection();
  if (!existing) return res.status(404).json({ error: 'No platform WhatsApp connection configured' });

  const result = await testPlatformWhatsAppConnection(existing.id);
  await writePlatformAdminAuditEvent({
    actorPlatformAdminId: req.platformAdmin?.id ?? null,
    action: 'platform_whatsapp_connection.tested',
    resourceType: 'platform_whatsapp_connection',
    resourceKey: existing.id,
    outcome: result.success ? 'success' : 'failure',
    safeMetadata: { success: result.success },
  });
  res.json({ result });
});

// POST /api/platform/whatsapp/meta-connection/disconnect
router.post(
  '/whatsapp/meta-connection/disconnect',
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await getPlatformWhatsAppConnection(tx);
        if (!existing) throw new PlatformWhatsAppConnectionNotFoundError();
        await disconnectPlatformWhatsAppConnection(existing.id, tx);
        await writePlatformAdminAuditEventInTx(tx, {
          actorPlatformAdminId: req.platformAdmin?.id ?? null,
          action: 'platform_whatsapp_connection.disconnected',
          resourceType: 'platform_whatsapp_connection',
          resourceKey: existing.id,
          outcome: 'success',
        });
      });
      res.status(204).end();
    } catch (err) {
      if (err instanceof PlatformWhatsAppConnectionNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[platform-whatsapp] disconnect failed:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to disconnect the platform WhatsApp connection' });
    }
  },
);

// DELETE /api/platform/whatsapp/meta-connection
router.delete('/whatsapp/meta-connection', async (req: PlatformAdminRequest, res: Response) => {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await getPlatformWhatsAppConnection(tx);
      if (!existing) throw new PlatformWhatsAppConnectionNotFoundError();
      await deletePlatformWhatsAppConnection(existing.id, tx);
      await writePlatformAdminAuditEventInTx(tx, {
        actorPlatformAdminId: req.platformAdmin?.id ?? null,
        action: 'platform_whatsapp_connection.deleted',
        resourceType: 'platform_whatsapp_connection',
        resourceKey: existing.id,
        outcome: 'success',
      });
    });
    res.status(204).end();
  } catch (err) {
    if (err instanceof PlatformWhatsAppConnectionNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    console.error('[platform-whatsapp] delete failed:', safeErrorFields(err));
    res.status(500).json({ error: 'Failed to delete the platform WhatsApp connection' });
  }
});

export default router;
