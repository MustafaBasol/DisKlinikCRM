/**
 * organizationInstagram.ts — Instagram Connection Management API
 *
 * Organization-level Instagram DM connections (OWNER / ORG_ADMIN only):
 *   GET    /api/organization/instagram-connections
 *   POST   /api/organization/instagram-connections
 *   GET    /api/organization/instagram-connections/:id
 *   PUT    /api/organization/instagram-connections/:id
 *   POST   /api/organization/instagram-connections/:id/test
 *   POST   /api/organization/instagram-connections/:id/disconnect
 *   PATCH  /api/organization/instagram-connections/:id/status
 *   DELETE /api/organization/instagram-connections/:id
 *
 * Clinic ↔ Connection assignment:
 *   GET    /api/clinics/:clinicId/instagram
 *   PUT    /api/clinics/:clinicId/instagram
 *   DELETE /api/clinics/:clinicId/instagram/:connectionId
 *
 * Security rules:
 *   1. All queries scoped to req.user.organizationId.
 *   2. Encrypted fields (tokens) NEVER returned to clients.
 *   3. Token replaced only when a new non-empty value is submitted.
 *   4. Cross-org access blocked at every query.
 */

import express, { Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import prisma from '../db.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
  canManageInstagramConnections,
  canAssignInstagramToClinic,
  canViewInstagramStatus,
} from '../utils/roles.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { encryptSecret } from '../utils/encryption.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { testConnection } from '../services/instagram/InstagramMessagingProvider.js';

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip all encrypted and sensitive fields before sending to client. */
function sanitizeConnection(conn: Record<string, unknown>) {
  const {
    accessTokenEncrypted: _at,
    pageAccessTokenEncrypted: _pat,
    webhookVerifyToken: _wvt,
    webhookSecret: _ws,
    ...safe
  } = conn;
  return safe;
}

/** Generate a random 32-char hex verify token. */
function generateVerifyToken(): string {
  return randomBytes(16).toString('hex');
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const connectionCreateSchema = z.object({
  name: z.string().min(1).max(80),
  instagramAccountId: z.string().max(100).optional().nullable(),
  instagramUsername: z.string().max(100).optional().nullable(),
  facebookPageId: z.string().max(100).optional().nullable(),
  accessTokenEncrypted: z.string().max(1000).optional().nullable(),
  pageAccessTokenEncrypted: z.string().max(1000).optional().nullable(),
  webhookVerifyToken: z.string().max(120).optional().nullable(),
  webhookSecret: z.string().max(120).optional().nullable(),
  metaAppId: z.string().max(80).optional().nullable(),
  metaBusinessId: z.string().max(80).optional().nullable(),
  linkedClinicIds: z.array(z.string().uuid()).optional(),
});

const connectionUpdateSchema = connectionCreateSchema.partial();

// ── Organization-level routes ─────────────────────────────────────────────────

// GET /api/organization/instagram-connections
router.get(
  '/organization/instagram-connections',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    if (!canViewInstagramStatus(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const connections = await prisma.instagramConnection.findMany({
        where: { organizationId: user.organizationId },
        include: {
          clinics: {
            include: { clinic: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ connections: connections.map(c => sanitizeConnection(c as unknown as Record<string, unknown>)) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch connections' });
    }
  },
);

// POST /api/organization/instagram-connections
router.post(
  '/organization/instagram-connections',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    if (!canManageInstagramConnections(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = connectionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    try {
      // Auto-generate verify token if not provided
      const verifyToken = data.webhookVerifyToken || generateVerifyToken();

      // Encrypt tokens
      const accessTokenEncrypted = data.accessTokenEncrypted
        ? encryptSecret(data.accessTokenEncrypted)
        : null;
      const pageAccessTokenEncrypted = data.pageAccessTokenEncrypted
        ? encryptSecret(data.pageAccessTokenEncrypted)
        : null;

      const conn = await prisma.instagramConnection.create({
        data: {
          organizationId: user.organizationId,
          name: data.name,
          instagramAccountId: data.instagramAccountId ?? null,
          instagramUsername: data.instagramUsername ?? null,
          facebookPageId: data.facebookPageId ?? null,
          accessTokenEncrypted,
          pageAccessTokenEncrypted,
          webhookVerifyToken: verifyToken,
          webhookSecret: data.webhookSecret ?? null,
          metaAppId: data.metaAppId ?? null,
          metaBusinessId: data.metaBusinessId ?? null,
          status: 'disconnected',
        },
      });

      // Sync clinic assignments
      if (data.linkedClinicIds && data.linkedClinicIds.length > 0) {
        const validClinics = await prisma.clinic.findMany({
          where: { id: { in: data.linkedClinicIds }, organizationId: user.organizationId },
          select: { id: true },
        });
        await prisma.clinicInstagramConnection.createMany({
          data: validClinics.map(c => ({
            organizationId: user.organizationId,
            clinicId: c.id,
            instagramConnectionId: conn.id,
          })),
          skipDuplicates: true,
        });
      }

      await writeAuditLog({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_connection_created',
        entityType: 'instagram_connection',
        entityId: conn.id,
        description: `Instagram connection "${conn.name}" created`,
        ...extractRequestMeta(req),
      });

      return res.status(201).json({ connection: sanitizeConnection(conn as unknown as Record<string, unknown>) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Unique constraint')) {
        return res.status(409).json({ error: 'A connection with this name already exists.' });
      }
      return res.status(500).json({ error: 'Failed to create connection' });
    }
  },
);

// GET /api/organization/instagram-connections/:id
router.get(
  '/organization/instagram-connections/:id',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const id = getParam(req, 'id');

    if (!canViewInstagramStatus(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const conn = await prisma.instagramConnection.findFirst({
        where: { id, organizationId: user.organizationId },
        include: {
          clinics: {
            include: { clinic: { select: { id: true, name: true } } },
          },
        },
      });

      if (!conn) return res.status(404).json({ error: 'Not found' });

      return res.json({ connection: sanitizeConnection(conn as unknown as Record<string, unknown>) });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch connection' });
    }
  },
);

// PUT /api/organization/instagram-connections/:id
router.put(
  '/organization/instagram-connections/:id',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const id = getParam(req, 'id');

    if (!canManageInstagramConnections(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = connectionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    try {
      const existing = await prisma.instagramConnection.findFirst({
        where: { id, organizationId: user.organizationId },
        select: {
          id: true,
          accessTokenEncrypted: true,
          pageAccessTokenEncrypted: true,
          webhookVerifyToken: true,
        },
      });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      // Preserve existing encrypted token if no new value provided
      const accessTokenEncrypted =
        data.accessTokenEncrypted
          ? encryptSecret(data.accessTokenEncrypted)
          : existing.accessTokenEncrypted;

      const pageAccessTokenEncrypted =
        data.pageAccessTokenEncrypted
          ? encryptSecret(data.pageAccessTokenEncrypted)
          : existing.pageAccessTokenEncrypted;

      const updateData: Record<string, unknown> = {
        accessTokenEncrypted,
        pageAccessTokenEncrypted,
      };
      if (data.name !== undefined) updateData.name = data.name;
      if (data.instagramAccountId !== undefined) updateData.instagramAccountId = data.instagramAccountId;
      if (data.instagramUsername !== undefined) updateData.instagramUsername = data.instagramUsername;
      if (data.facebookPageId !== undefined) updateData.facebookPageId = data.facebookPageId;
      if (data.webhookVerifyToken !== undefined) updateData.webhookVerifyToken = data.webhookVerifyToken || existing.webhookVerifyToken;
      if (data.webhookSecret !== undefined) updateData.webhookSecret = data.webhookSecret;
      if (data.metaAppId !== undefined) updateData.metaAppId = data.metaAppId;
      if (data.metaBusinessId !== undefined) updateData.metaBusinessId = data.metaBusinessId;

      const conn = await prisma.instagramConnection.update({
        where: { id },
        data: updateData,
      });

      // Sync clinic assignments if provided
      if (data.linkedClinicIds !== undefined) {
        // Validate all clinic IDs belong to the organization
        const validClinics = await prisma.clinic.findMany({
          where: { id: { in: data.linkedClinicIds }, organizationId: user.organizationId },
          select: { id: true },
        });
        const validIds = validClinics.map(c => c.id);

        // Remove old links
        await prisma.clinicInstagramConnection.deleteMany({
          where: { instagramConnectionId: id, clinicId: { notIn: validIds } },
        });

        // Add new links
        await prisma.clinicInstagramConnection.createMany({
          data: validIds.map(cid => ({
            organizationId: user.organizationId,
            clinicId: cid,
            instagramConnectionId: id,
          })),
          skipDuplicates: true,
        });
      }

      await writeAuditLog({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_connection_updated',
        entityType: 'instagram_connection',
        entityId: conn.id,
        description: `Instagram connection "${conn.name}" updated`,
        ...extractRequestMeta(req),
      });

      return res.json({ connection: sanitizeConnection(conn as unknown as Record<string, unknown>) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Unique constraint')) {
        return res.status(409).json({ error: 'A connection with this name already exists.' });
      }
      return res.status(500).json({ error: 'Failed to update connection' });
    }
  },
);

// POST /api/organization/instagram-connections/:id/test
router.post(
  '/organization/instagram-connections/:id/test',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const id = getParam(req, 'id');

    if (!canViewInstagramStatus(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const conn = await prisma.instagramConnection.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!conn) return res.status(404).json({ error: 'Not found' });

      const result = await testConnection(conn);

      // Update status and username based on test result
      await prisma.instagramConnection.update({
        where: { id },
        data: {
          status: result.success ? 'connected' : 'error',
          lastError: result.success ? null : result.message,
          lastConnectedAt: result.success ? new Date() : undefined,
          instagramUsername: result.username ?? conn.instagramUsername,
        },
      });

      return res.json(result);
    } catch {
      return res.status(500).json({ error: 'Test failed' });
    }
  },
);

// POST /api/organization/instagram-connections/:id/disconnect
router.post(
  '/organization/instagram-connections/:id/disconnect',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const id = getParam(req, 'id');

    if (!canManageInstagramConnections(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const conn = await prisma.instagramConnection.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true, name: true },
      });
      if (!conn) return res.status(404).json({ error: 'Not found' });

      await prisma.instagramConnection.update({
        where: { id },
        data: { status: 'disconnected', isActive: false },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_connection_disconnected',
        entityType: 'instagram_connection',
        entityId: id,
        description: `Instagram connection "${conn.name}" disconnected`,
        ...extractRequestMeta(req),
      });

      return res.json({
        success: true,
        message: 'Connection marked as disconnected. Revoke token via Meta Developer Dashboard to fully disconnect.',
      });
    } catch {
      return res.status(500).json({ error: 'Failed to disconnect' });
    }
  },
);

// PATCH /api/organization/instagram-connections/:id/status
router.patch(
  '/organization/instagram-connections/:id/status',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const id = getParam(req, 'id');

    if (!canManageInstagramConnections(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    try {
      const conn = await prisma.instagramConnection.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!conn) return res.status(404).json({ error: 'Not found' });

      await prisma.instagramConnection.update({
        where: { id },
        data: { isActive },
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to update status' });
    }
  },
);

// DELETE /api/organization/instagram-connections/:id
router.delete(
  '/organization/instagram-connections/:id',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const id = getParam(req, 'id');

    if (!canManageInstagramConnections(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const conn = await prisma.instagramConnection.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true, name: true },
      });
      if (!conn) return res.status(404).json({ error: 'Not found' });

      // Remove clinic assignments first
      await prisma.clinicInstagramConnection.deleteMany({
        where: { instagramConnectionId: id },
      });

      await prisma.instagramConnection.delete({ where: { id } });

      await writeAuditLog({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_connection_deleted',
        entityType: 'instagram_connection',
        entityId: id,
        description: `Instagram connection "${conn.name}" deleted`,
        ...extractRequestMeta(req),
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to delete connection' });
    }
  },
);

// ── Clinic assignment routes ──────────────────────────────────────────────────

// GET /api/clinics/:clinicId/instagram
router.get(
  '/clinics/:clinicId/instagram',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const clinicId = getParam(req, 'clinicId');

    if (!canViewInstagramStatus(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      // Cross-org guard
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const assignments = await prisma.clinicInstagramConnection.findMany({
        where: { clinicId },
        include: {
          instagramConnection: {
            select: { id: true, name: true, status: true, instagramUsername: true, isActive: true },
          },
        },
      });

      return res.json({ assignments });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch assignments' });
    }
  },
);

// PUT /api/clinics/:clinicId/instagram
router.put(
  '/clinics/:clinicId/instagram',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const clinicId = getParam(req, 'clinicId');

    if (!canAssignInstagramToClinic(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { instagramConnectionId } = req.body;
    if (!instagramConnectionId || typeof instagramConnectionId !== 'string') {
      return res.status(400).json({ error: 'instagramConnectionId is required' });
    }

    try {
      // Cross-org guard for clinic
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      // Cross-org guard for connection
      const conn = await prisma.instagramConnection.findFirst({
        where: { id: instagramConnectionId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!conn) return res.status(404).json({ error: 'Instagram connection not found' });

      await prisma.clinicInstagramConnection.upsert({
        where: { clinicId_instagramConnectionId: { clinicId, instagramConnectionId } },
        create: {
          organizationId: user.organizationId,
          clinicId,
          instagramConnectionId,
        },
        update: {},
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to assign connection' });
    }
  },
);

// DELETE /api/clinics/:clinicId/instagram/:connectionId
router.delete(
  '/clinics/:clinicId/instagram/:connectionId',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const clinicId = getParam(req, 'clinicId');
    const connectionId = getParam(req, 'connectionId');

    if (!canAssignInstagramToClinic(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      // Cross-org guard
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      await prisma.clinicInstagramConnection.deleteMany({
        where: { clinicId, instagramConnectionId: connectionId },
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to remove assignment' });
    }
  },
);

export default router;
