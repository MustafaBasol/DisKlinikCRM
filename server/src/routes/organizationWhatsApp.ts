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
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { recordOperationalEvent } from '../services/operationalEventService.js';
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

  // Shared webhook secret (applies to any provider)
  webhookSecret: z.string().max(120).optional().nullable(),

  // Clinic assignment (optional) — UUIDs of clinics to link this connection to
  linkedClinicIds: z.array(z.string().uuid()).optional(),
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
      const sanitized = connections.map((c) => sanitizeConnection(c as unknown as Record<string, unknown>));

      // Surface legacy env-var config as a virtual read-only entry when DB has no records.
      // This ensures the page is never empty for deployments that have not yet run backfill.
      // The virtual entry is safe: it never includes the raw API key.
      if (sanitized.length === 0) {
        const legacyUrl = process.env.EVOLUTION_API_BASE_URL?.trim();
        const legacyInstance = process.env.EVOLUTION_INSTANCE_NAME?.trim();
        const legacyKeySet = Boolean(process.env.EVOLUTION_API_KEY?.trim());
        if (legacyUrl && legacyInstance && legacyKeySet) {
          sanitized.unshift({
            id: '__legacy__',
            isLegacy: true,
            organizationId,
            name: 'Mevcut Evolution API Bağlantısı (Ortam Değişkenlerinden)',
            provider: 'evolution_api',
            status: 'connected',
            phoneNumber: null,
            displayName: null,
            evolutionApiUrl: legacyUrl,
            evolutionInstanceName: legacyInstance,
            isActive: true,
            clinics: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastConnectedAt: null,
            lastError: null,
          } as unknown as ReturnType<typeof sanitizeConnection>);
        }
      }

      res.json(sanitized);
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
      // Encrypt secrets before persisting — strip linkedClinicIds from DB fields
      const { linkedClinicIds, ...connectionFields } = parsed.data;
      const createData: Record<string, unknown> = { organizationId, ...connectionFields };
      if (typeof createData.evolutionApiKeyEncrypted === 'string' && createData.evolutionApiKeyEncrypted) {
        createData.evolutionApiKeyEncrypted = encryptSecret(createData.evolutionApiKeyEncrypted as string);
      }
      if (typeof createData.metaAccessTokenEncrypted === 'string' && createData.metaAccessTokenEncrypted) {
        createData.metaAccessTokenEncrypted = encryptSecret(createData.metaAccessTokenEncrypted as string);
      }
      const connection = await prisma.whatsAppConnection.create({
        data: createData as Parameters<typeof prisma.whatsAppConnection.create>[0]['data'],
      });

      // Link to specified clinics (all must belong to same organization — cross-org guard)
      if (Array.isArray(linkedClinicIds) && linkedClinicIds.length > 0) {
        const validClinics = await prisma.clinic.findMany({
          where: { id: { in: linkedClinicIds }, organizationId },
          select: { id: true },
        });
        if (validClinics.length > 0) {
          await prisma.clinicWhatsAppConnection.createMany({
            data: validClinics.map((c) => ({
              organizationId,
              clinicId: c.id,
              whatsappConnectionId: connection.id,
              isDefault: true,
            })),
            skipDuplicates: true,
          });
        }
      }

      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: connection.id,
        action: 'created',
        description: `WhatsApp bağlantısı oluşturuldu: ${connection.name} (${connection.provider})`,
      });
      writeAuditLog({
        organizationId: req.user!.organizationId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'whatsapp_connection_created',
        entityType: 'whatsapp_connection',
        entityId: connection.id,
        description: `WhatsApp connection created: ${connection.name} (${connection.provider})`,
        metadata: { name: connection.name, provider: connection.provider },
        ...extractRequestMeta(req),
      });

      // Fetch with clinics for response
      const full = await prisma.whatsAppConnection.findUnique({
        where: { id: connection.id },
        include: { clinics: { include: { clinic: { select: { id: true, name: true } } } } },
      });
      res.status(201).json(sanitizeConnection(full as unknown as Record<string, unknown>));
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
      const { linkedClinicIds, ...updateFields } = parsed.data;
      const updateData: Record<string, unknown> = { ...updateFields };
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

      // Sync clinic assignments if linkedClinicIds is provided
      if (Array.isArray(linkedClinicIds)) {
        if (linkedClinicIds.length === 0) {
          // Empty array = remove all assignments from this connection
          await prisma.clinicWhatsAppConnection.deleteMany({
            where: { whatsappConnectionId: id, organizationId },
          });
        } else {
          // Validate clinic IDs belong to same org (cross-org guard)
          const validClinics = await prisma.clinic.findMany({
            where: { id: { in: linkedClinicIds }, organizationId },
            select: { id: true },
          });
          const validIds = validClinics.map((c) => c.id);
          // Remove assignments from this connection for clinics no longer in the list
          await prisma.clinicWhatsAppConnection.deleteMany({
            where: { whatsappConnectionId: id, organizationId, clinicId: { notIn: validIds } },
          });
          // For each clinic being assigned to this connection:
          // delete its existing default assignment to any OTHER connection first (reassignment)
          if (validIds.length > 0) {
            await prisma.clinicWhatsAppConnection.deleteMany({
              where: {
                organizationId,
                clinicId: { in: validIds },
                whatsappConnectionId: { not: id },
                isDefault: true,
              },
            });
            // Now add new assignments (skipDuplicates handles already-linked clinics)
            await prisma.clinicWhatsAppConnection.createMany({
              data: validIds.map((clinicId) => ({
                organizationId,
                clinicId,
                whatsappConnectionId: id,
                isDefault: true,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: updated.id,
        action: 'updated',
        description: `WhatsApp bağlantısı güncellendi: ${updated.name}`,
      });
      writeAuditLog({
        organizationId: req.user!.organizationId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'whatsapp_connection_updated',
        entityType: 'whatsapp_connection',
        entityId: updated.id,
        description: `WhatsApp connection updated: ${updated.name}`,
        metadata: { name: updated.name, provider: updated.provider },
        ...extractRequestMeta(req),
      });
      // Return with updated clinic assignments
      const full = await prisma.whatsAppConnection.findUnique({
        where: { id },
        include: { clinics: { include: { clinic: { select: { id: true, name: true } } } } },
      });
      res.json(sanitizeConnection(full as unknown as Record<string, unknown>));
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
      writeAuditLog({
        organizationId: req.user!.organizationId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'whatsapp_connection_tested',
        entityType: 'whatsapp_connection',
        entityId: id,
        description: `WhatsApp connection test: ${existing.name}`,
        metadata: { success: (result as any)?.success ?? null },
        ...extractRequestMeta(req),
      });
      if ((result as any)?.success === false) {
        recordOperationalEvent({
          organizationId: req.user!.organizationId,
          severity: 'warning',
          source: 'whatsapp',
          message: `WhatsApp connection test failed: ${existing.name}`,
          metadata: { connectionId: id, name: existing.name, provider: existing.provider },
        });
      }
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
      writeAuditLog({
        organizationId: req.user!.organizationId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'whatsapp_connection_disconnected',
        entityType: 'whatsapp_connection',
        entityId: id,
        description: `WhatsApp connection disconnected: ${existing.name}`,
        metadata: { name: existing.name, provider: existing.provider },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, message: 'Connection disconnected' });
    } catch {
      res.status(500).json({ error: 'Failed to disconnect connection' });
    }
  },
);

// POST /api/organization/whatsapp-connections/import-legacy
// Imports the legacy env-var Evolution API config into the DB.
// Idempotent: returns existing record if already imported.
router.post(
  '/organization/whatsapp-connections/import-legacy',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageWhatsAppConnections(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: 'No organization context' });

    const apiUrl = process.env.EVOLUTION_API_BASE_URL?.trim();
    const apiKey = process.env.EVOLUTION_API_KEY?.trim();
    const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();

    if (!apiUrl || !apiKey || !instanceName) {
      return res.status(400).json({
        error:
          'EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY ve EVOLUTION_INSTANCE_NAME ortam değişkenleri bulunamadı.',
      });
    }

    try {
      // Idempotency: return existing record if already imported
      const existing = await prisma.whatsAppConnection.findFirst({
        where: { organizationId, evolutionInstanceName: instanceName },
        include: { clinics: { include: { clinic: { select: { id: true, name: true } } } } },
      });
      if (existing) {
        return res.status(200).json({
          alreadyImported: true,
          connection: sanitizeConnection(existing as unknown as Record<string, unknown>),
        });
      }

      // Get organization name for the connection label
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });
      const connectionName = `${org?.name ?? 'Ana'} WhatsApp Hattı`;

      // Get all clinics in organization for auto-assignment
      const clinics = await prisma.clinic.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      });

      // Create WhatsAppConnection
      const connection = await prisma.whatsAppConnection.create({
        data: {
          organizationId,
          name: connectionName,
          provider: 'evolution_api',
          status: 'connected',
          evolutionApiUrl: apiUrl,
          evolutionInstanceName: instanceName,
          evolutionApiKeyEncrypted: encryptSecret(apiKey),
          isActive: true,
          lastConnectedAt: new Date(),
        },
      });

      // Link to all clinics in the organization
      if (clinics.length > 0) {
        await prisma.clinicWhatsAppConnection.createMany({
          data: clinics.map((c) => ({
            organizationId,
            clinicId: c.id,
            whatsappConnectionId: connection.id,
            isDefault: true,
          })),
          skipDuplicates: true,
        });
      }

      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'whatsapp_connection',
        entityId: connection.id,
        action: 'imported',
        description: `Evolution API ortam değişkenleri bağlantıya aktarıldı: ${connection.name}`,
      });
      writeAuditLog({
        organizationId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'whatsapp_connection_imported',
        entityType: 'whatsapp_connection',
        entityId: connection.id,
        description: `Legacy Evolution API config imported as WhatsApp connection: ${connection.name}`,
        metadata: { name: connection.name, instanceName, clinicCount: clinics.length },
        ...extractRequestMeta(req),
      });

      const full = await prisma.whatsAppConnection.findUnique({
        where: { id: connection.id },
        include: { clinics: { include: { clinic: { select: { id: true, name: true } } } } },
      });
      res.status(201).json({
        alreadyImported: false,
        connection: sanitizeConnection(full as unknown as Record<string, unknown>),
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Bu adla bir bağlantı zaten mevcut.' });
      }
      res.status(500).json({ error: 'Failed to import legacy configuration' });
    }
  },
);

// ─── Meta Cloud API Embedded Signup callback ──────────────────────────────────

/**
 * POST /api/organization/whatsapp-connections/meta/callback
 *
 * Called by the frontend after a successful Meta Embedded Signup flow.
 * Accepts the OAuth code (or direct field values) returned by the Meta SDK,
 * exchanges the code for a token if provided, creates or updates the
 * WhatsAppConnection record, and links chosen clinics.
 *
 * Access: OWNER | ORG_ADMIN only (same as create/update connection)
 */

const metaCallbackSchema = z.object({
  // OAuth code returned by Embedded Signup (optional if direct fields provided)
  code: z.string().max(512).optional().nullable(),

  // Direct field values (can come from Embedded Signup response or manual entry)
  businessId: z.string().max(80).optional().nullable(),
  wabaId: z.string().max(80).optional().nullable(),
  phoneNumberId: z.string().max(80).optional().nullable(),
  phoneNumber: z.string().max(30).optional().nullable(),
  displayName: z.string().max(80).optional().nullable(),

  // Connection metadata
  connectionName: z.string().min(1).max(80).optional(),
  linkedClinicIds: z.array(z.string().uuid()).optional(),
});

router.post(
  '/organization/whatsapp-connections/meta/callback',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageWhatsAppConnections(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(400).json({ error: 'No organization context' });

    const parsed = metaCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { code, businessId, wabaId, phoneNumberId, phoneNumber, displayName,
            connectionName, linkedClinicIds } = parsed.data;

    // ── Token exchange ────────────────────────────────────────────────────────
    let accessToken: string | null = null;

    if (code) {
      const appId = process.env.META_APP_ID?.trim();
      const appSecret = process.env.META_APP_SECRET?.trim();
      const redirectUri = process.env.META_REDIRECT_URI?.trim();
      const graphVersion = process.env.META_GRAPH_API_VERSION || 'v23.0';

      if (!appId || !appSecret || !redirectUri) {
        return res.status(500).json({
          error:
            'Meta Embedded Signup is not fully configured on this server. ' +
            'META_APP_ID, META_APP_SECRET and META_REDIRECT_URI must be set.',
        });
      }

      const tokenUrl =
        `https://graph.facebook.com/${graphVersion}/oauth/access_token`;

      // POST with URL-encoded body keeps client_secret out of URLs/logs
      const tokenBody = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      });

      try {
        const tokenRes = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenBody.toString(),
        });
        if (!tokenRes.ok) {
          const errText = await tokenRes.text().catch(() => '');
          return res.status(502).json({
            error: `Meta token exchange failed (${tokenRes.status}): ${errText}`,
          });
        }
        const tokenData = (await tokenRes.json()) as Record<string, unknown>;
        const rawToken = tokenData.access_token as string | undefined;
        if (!rawToken) {
          return res.status(502).json({ error: 'Meta token exchange returned no access_token' });
        }
        accessToken = rawToken;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: `Meta token exchange error: ${msg}` });
      }
    }

    if (!phoneNumberId) {
      return res.status(400).json({
        error: 'phoneNumberId is required. Provide it directly or ensure Embedded Signup returns it.',
      });
    }

    // ── Duplicate guard ───────────────────────────────────────────────────────
    const existing = await prisma.whatsAppConnection.findFirst({
      where: { organizationId, metaPhoneNumberId: phoneNumberId },
      include: { clinics: { include: { clinic: { select: { id: true, name: true } } } } },
    });

    const name = connectionName?.trim() ||
      (displayName ? `Meta — ${displayName}` : `Meta Cloud API — ${phoneNumberId}`);

    let connection;
    if (existing) {
      // Update in place — never overwrite token with null if not provided
      const updateData: Record<string, unknown> = {
        metaBusinessId: businessId ?? existing.metaBusinessId,
        metaWabaId: wabaId ?? existing.metaWabaId,
        metaPhoneNumberId: phoneNumberId,
        metaAppId: process.env.META_APP_ID || existing.metaAppId,
        phoneNumber: phoneNumber ?? existing.phoneNumber,
        displayName: displayName ?? existing.displayName,
        status: 'connected',
        isActive: true,
        lastConnectedAt: new Date(),
        lastError: null,
      };
      if (accessToken) {
        updateData.metaAccessTokenEncrypted = encryptSecret(accessToken);
        // Reset token status — will be confirmed valid on next testConnection call
        updateData.metaTokenStatus = 'unknown';
        updateData.metaTokenExpiresAt = null;
        updateData.metaTokenLastCheckedAt = null;
      }
      connection = await prisma.whatsAppConnection.update({
        where: { id: existing.id },
        data: updateData as Parameters<typeof prisma.whatsAppConnection.update>[0]['data'],
      });
    } else {
      const createData: Record<string, unknown> = {
        organizationId,
        name,
        provider: 'meta_cloud_api',
        metaBusinessId: businessId ?? null,
        metaWabaId: wabaId ?? null,
        metaPhoneNumberId: phoneNumberId,
        metaAppId: process.env.META_APP_ID || null,
        phoneNumber: phoneNumber ?? null,
        displayName: displayName ?? null,
        status: 'connected',
        isActive: true,
        lastConnectedAt: new Date(),
      };
      if (accessToken) {
        createData.metaAccessTokenEncrypted = encryptSecret(accessToken);
        createData.metaTokenStatus = 'unknown';
      }
      connection = await prisma.whatsAppConnection.create({
        data: createData as Parameters<typeof prisma.whatsAppConnection.create>[0]['data'],
      });
    }

    // ── Clinic assignment ─────────────────────────────────────────────────────
    if (Array.isArray(linkedClinicIds) && linkedClinicIds.length > 0) {
      const validClinics = await prisma.clinic.findMany({
        where: { id: { in: linkedClinicIds }, organizationId },
        select: { id: true },
      });
      if (validClinics.length > 0) {
        await prisma.clinicWhatsAppConnection.createMany({
          data: validClinics.map((c) => ({
            organizationId,
            clinicId: c.id,
            whatsappConnectionId: connection.id,
            isDefault: true,
          })),
          skipDuplicates: true,
        });
      }
    }

    await logActivity({
      clinicId: req.user!.clinicId,
      userId: req.user!.id,
      entityType: 'whatsapp_connection',
      entityId: connection.id,
      action: existing ? 'updated' : 'created',
      description: `Meta Cloud API bağlantısı ${existing ? 'güncellendi' : 'oluşturuldu'}: ${connection.name}`,
    });
    writeAuditLog({
      organizationId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: existing ? 'whatsapp_meta_connection_updated' : 'whatsapp_meta_connection_created',
      entityType: 'whatsapp_connection',
      entityId: connection.id,
      description: `Meta Cloud API connection ${existing ? 'updated' : 'created'}: ${connection.name}`,
      metadata: {
        name: connection.name,
        provider: 'meta_cloud_api',
        phoneNumberId,
        viaCodExchange: Boolean(code),
      },
      ...extractRequestMeta(req),
    });

    const full = await prisma.whatsAppConnection.findUnique({
      where: { id: connection.id },
      include: { clinics: { include: { clinic: { select: { id: true, name: true } } } } },
    });
    return res.status(existing ? 200 : 201).json(
      sanitizeConnection(full as unknown as Record<string, unknown>),
    );
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
