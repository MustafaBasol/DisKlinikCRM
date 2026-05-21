/**
 * organizationWhatsApp.ts — Provider-Agnostic WhatsApp Connection Management
 *
 * Organization-level WhatsApp connections (OWNER / ORG_ADMIN only):
 *   GET    /api/organization/whatsapp-connections
 *   POST   /api/organization/whatsapp-connections
 *   GET    /api/organization/whatsapp-connections/:id
 *   PUT    /api/organization/whatsapp-connections/:id
 *   POST   /api/organization/whatsapp-connections/:id/test
 *   GET    /api/organization/whatsapp-connections/:id/qr
 *   POST   /api/organization/whatsapp-connections/:id/disconnect
 *
 * Clinic ↔ Connection assignment (OWNER / ORG_ADMIN / CLINIC_MANAGER):
 *   GET    /api/clinics/:clinicId/whatsapp
 *   PUT    /api/clinics/:clinicId/whatsapp            — set default connection for clinic
 *   DELETE /api/clinics/:clinicId/whatsapp/:connectionId
 *
 * Security rules:
 *   1. All queries are scoped to req.user.organizationId.
 *   2. Encrypted fields (apiKeys / tokens) are NEVER returned to clients.
 *   3. Cross-org access is blocked at every query.
 */

import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import {
  canManageWhatsAppConnections,
  canAssignWhatsAppToClinic,
  canViewWhatsAppStatus,
} from '../utils/roles.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { encryptSecret } from '../utils/encryption.js';
import {
  testWhatsAppConnection,
  getWhatsAppQrCode,
  disconnectWhatsAppConnection,
} from '../services/whatsapp/whatsappService.js';

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip all encrypted fields before sending a connection record to the client.
 * Never include API keys, access tokens, or webhook secrets in responses.
 */
function sanitizeConnection(conn: Record<string, unknown>) {
  const {
    evolutionApiKeyEncrypted: _eak,
    metaAccessTokenEncrypted: _mat,
    metaWebhookVerifyToken: _mwvt,
    metaWebhookSecret: _mws,
    webhookSecret: _ws,
    ...safe
  } = conn;
  return safe;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const connectionCreateSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(['evolution_api', 'meta_cloud_api']).default('evolution_api'),
  phoneNumber: z.string().max(30).optional().nullable(),
  displayName: z.string().max(80).optional().nullable(),

  // Evolution API fields
  evolutionApiUrl: z.string().url('Must be a valid URL').optional().nullable(),
  evolutionInstanceName: z.string().max(120).optional().nullable(),
  evolutionApiKeyEncrypted: z.string().max(500).optional().nullable(),

  // Meta Cloud API fields
  metaBusinessId: z.string().max(80).optional().nullable(),
  metaWabaId: z.string().max(80).optional().nullable(),
  metaPhoneNumberId: z.string().max(80).optional().nullable(),
  metaAppId: z.string().max(80).optional().nullable(),
  metaAccessTokenEncrypted: z.string().max(1000).optional().nullable(),
  metaWebhookVerifyToken: z.string().max(120).optional().nullable(),
  metaWebhookSecret: z.string().max(120).optional().nullable(),
});

const connectionUpdateSchema = connectionCreateSchema.partial();

// ─── Organization-level routes ────────────────────────────────────────────────

// GET /api/organization/whatsapp-connections
router.get(
  '/organization/whatsapp-connections',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewWhatsAppStatus(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: 'No organization context' });

    try {
      const connections = await prisma.whatsAppConnection.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        include: {
          clinics: {
            include: {
              clinic: { select: { id: true, name: true } },
            },
          },
        },
      });
      res.json(connections.map((c) => sanitizeConnection(c as unknown as Record<string, unknown>)));
    } catch {
      res.status(500).json({ error: 'Failed to fetch WhatsApp connections' });
    }
  },
);

// POST /api/organization/whatsapp-connections
router.post(
  '/organization/whatsapp-connections',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageWhatsAppConnections(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: 'No organization context' });

    const parsed = connectionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    try {
      // Encrypt secrets before persisting
      const createData: Record<string, unknown> = { organizationId, ...parsed.data };
      if (typeof createData.evolutionApiKeyEncrypted === 'string' && createData.evolutionApiKeyEncrypted) {
        createData.evolutionApiKeyEncrypted = encryptSecret(createData.evolutionApiKeyEncrypted as string);
      }
      if (typeof createData.metaAccessTokenEncrypted === 'string' && createData.metaAccessTokenEncrypted) {
        createData.metaAccessTokenEncrypted = encryptSecret(createData.metaAccessTokenEncrypted as string);
      }
      const connection = await prisma.whatsAppConnection.create({
        data: createData as Parameters<typeof prisma.whatsAppConnection.create>[0]['data'],
      });
      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: connection.id,
        action: 'created',
        description: `WhatsApp bağlantısı oluşturuldu: ${connection.name} (${connection.provider})`,
      });
      res.status(201).json(sanitizeConnection(connection as unknown as Record<string, unknown>));
    } catch (err: any) {
      if (err.code === 'P2002') {
        return res
          .status(409)
          .json({ error: 'A connection with this name already exists for this organization' });
      }
      res.status(500).json({ error: 'Failed to create WhatsApp connection' });
    }
  },
);

// GET /api/organization/whatsapp-connections/:id
router.get(
  '/organization/whatsapp-connections/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewWhatsAppStatus(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const id = getParam(req, 'id');

    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id, organizationId },
        include: {
          clinics: {
            include: { clinic: { select: { id: true, name: true } } },
          },
        },
      });
      if (!connection) return res.status(404).json({ error: 'Connection not found' });
      res.json(sanitizeConnection(connection as unknown as Record<string, unknown>));
    } catch {
      res.status(500).json({ error: 'Failed to fetch connection' });
    }
  },
);

// PUT /api/organization/whatsapp-connections/:id
router.put(
  '/organization/whatsapp-connections/:id',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageWhatsAppConnections(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const id = getParam(req, 'id');

    const parsed = connectionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.whatsAppConnection.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return res.status(404).json({ error: 'Connection not found' });

      // Encrypt secrets before persisting — only if provided (partial update)
      const updateData: Record<string, unknown> = { ...parsed.data };
      if (typeof updateData.evolutionApiKeyEncrypted === 'string' && updateData.evolutionApiKeyEncrypted) {
        updateData.evolutionApiKeyEncrypted = encryptSecret(updateData.evolutionApiKeyEncrypted as string);
      }
      if (typeof updateData.metaAccessTokenEncrypted === 'string' && updateData.metaAccessTokenEncrypted) {
        updateData.metaAccessTokenEncrypted = encryptSecret(updateData.metaAccessTokenEncrypted as string);
      }
      const updated = await prisma.whatsAppConnection.update({
        where: { id },
        data: updateData as Parameters<typeof prisma.whatsAppConnection.update>[0]['data'],
      });
      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: updated.id,
        action: 'updated',
        description: `WhatsApp bağlantısı güncellendi: ${updated.name}`,
      });
      res.json(sanitizeConnection(updated as unknown as Record<string, unknown>));
    } catch (err: any) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Connection name already in use' });
      }
      res.status(500).json({ error: 'Failed to update connection' });
    }
  },
);

// POST /api/organization/whatsapp-connections/:id/test
router.post(
  '/organization/whatsapp-connections/:id/test',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewWhatsAppStatus(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const id = getParam(req, 'id');

    try {
      const existing = await prisma.whatsAppConnection.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return res.status(404).json({ error: 'Connection not found' });

      const result = await testWhatsAppConnection(id);
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Failed to test connection' });
    }
  },
);

// GET /api/organization/whatsapp-connections/:id/qr
router.get(
  '/organization/whatsapp-connections/:id/qr',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewWhatsAppStatus(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const id = getParam(req, 'id');

    try {
      const existing = await prisma.whatsAppConnection.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return res.status(404).json({ error: 'Connection not found' });

      const result = await getWhatsAppQrCode(id);
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Failed to fetch QR code' });
    }
  },
);

// POST /api/organization/whatsapp-connections/:id/disconnect
router.post(
  '/organization/whatsapp-connections/:id/disconnect',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageWhatsAppConnections(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const id = getParam(req, 'id');

    try {
      const existing = await prisma.whatsAppConnection.findFirst({
        where: { id, organizationId },
      });
      if (!existing) return res.status(404).json({ error: 'Connection not found' });

      await disconnectWhatsAppConnection(id);
      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: id,
        action: 'disconnected',
        description: `WhatsApp bağlantısı kesildi: ${existing.name}`,
      });
      res.json({ success: true, message: 'Connection disconnected' });
    } catch {
      res.status(500).json({ error: 'Failed to disconnect connection' });
    }
  },
);

// ─── Clinic ↔ Connection assignment routes ────────────────────────────────────

// GET /api/clinics/:clinicId/whatsapp
router.get(
  '/clinics/:clinicId/whatsapp',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewWhatsAppStatus(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const clinicId = getParam(req, 'clinicId');

    try {
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const assignments = await prisma.clinicWhatsAppConnection.findMany({
        where: { clinicId, organizationId },
        include: { whatsappConnection: true },
      }) as Array<Record<string, unknown>>;

      res.json(
        assignments.map((a) => ({
          ...a,
          whatsappConnection: sanitizeConnection(
            (a.whatsappConnection ?? {}) as Record<string, unknown>,
          ),
        })),
      );
    } catch {
      res.status(500).json({ error: 'Failed to fetch clinic WhatsApp assignment' });
    }
  },
);

// PUT /api/clinics/:clinicId/whatsapp — Set or replace the default connection for a clinic
router.put(
  '/clinics/:clinicId/whatsapp',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canAssignWhatsAppToClinic(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const clinicId = getParam(req, 'clinicId');

    const parsed = z
      .object({ whatsappConnectionId: z.string().uuid() })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'whatsappConnectionId (UUID) is required' });
    }
    const { whatsappConnectionId } = parsed.data;

    try {
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id: whatsappConnectionId, organizationId, isActive: true },
      });
      if (!connection) {
        return res.status(404).json({ error: 'WhatsApp connection not found or inactive' });
      }

      const assignment = await prisma.clinicWhatsAppConnection.upsert({
        where: {
          clinicId_whatsappConnectionId: { clinicId, whatsappConnectionId },
        },
        create: { organizationId, clinicId, whatsappConnectionId, isDefault: true },
        update: { isDefault: true },
      });

      await logActivity({
        clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: whatsappConnectionId,
        action: 'assigned',
        description: `WhatsApp bağlantısı şubeye atandı: ${clinic.name} → ${connection.name}`,
      });

      res.json(assignment);
    } catch {
      res.status(500).json({ error: 'Failed to assign WhatsApp connection' });
    }
  },
);

// DELETE /api/clinics/:clinicId/whatsapp/:connectionId
router.delete(
  '/clinics/:clinicId/whatsapp/:connectionId',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageWhatsAppConnections(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    const clinicId = getParam(req, 'clinicId');
    const connectionId = getParam(req, 'connectionId');

    try {
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const deleted = await prisma.clinicWhatsAppConnection.deleteMany({
        where: { clinicId, whatsappConnectionId: connectionId, organizationId },
      });

      if (deleted.count === 0) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      await logActivity({
        clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: connectionId,
        action: 'unassigned',
        description: `WhatsApp bağlantısı şubeden kaldırıldı: ${clinic.name}`,
      });

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to remove WhatsApp assignment' });
    }
  },
);

export default router;
