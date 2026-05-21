/**
 * operationalMonitoring.ts — Operational Monitoring API (Sprint 13)
 *
 * GET  /api/ops/audit-logs          — Paginated audit log (OWNER/ORG_ADMIN/CLINIC_MANAGER)
 * GET  /api/ops/events              — Operational events list
 * PATCH /api/ops/events/:id/resolve — Mark event as resolved
 * GET  /api/ops/health              — Safe health summary (no secrets)
 *
 * Security rules:
 *  1. All queries are scoped to req.user.organizationId — no cross-org leakage.
 *  2. CLINIC_MANAGER sees only their allowed clinicIds.
 *  3. DENTIST / RECEPTIONIST / BILLING get 403.
 *  4. Health endpoint never exposes API keys, tokens or webhook secrets.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { normalizeRole, canViewOperations, canResolveOperationalEvents } from '../utils/roles.js';
import { getParam } from '../utils/helpers.js';

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the list of clinicIds the user may see, or null = all org clinics.
 * OWNER/ORG_ADMIN → null (no restriction within org).
 * CLINIC_MANAGER  → allowedClinicIds only.
 */
function getAllowedClinicFilter(
  user: NonNullable<AuthRequest['user']>
): string[] | null {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  if (role === 'OWNER' || role === 'ORG_ADMIN') return null;
  return user.allowedClinicIds ?? [];
}

// ─── GET /api/ops/audit-logs ─────────────────────────────────────────────────

router.get(
  '/ops/audit-logs',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewOperations(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { clinicId, action, entityType, actorUserId, from, to } = req.query;
    const rawPage  = parseInt(String(req.query.page  ?? '1'), 10);
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const page   = Math.max(1, isNaN(rawPage)  ? 1  : rawPage);
    const limit  = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
    const skip   = (page - 1) * limit;

    const allowedClinics = getAllowedClinicFilter(req.user!);

    try {
      const where: Record<string, unknown> = {
        organizationId: req.user!.organizationId,
      };

      // Clinic scope
      if (clinicId && clinicId !== 'all') {
        const cid = String(clinicId);
        // CLINIC_MANAGER: validate they have access to this clinic
        if (allowedClinics !== null && !allowedClinics.includes(cid)) {
          return res.status(403).json({ error: 'Access denied to requested clinic' });
        }
        where['clinicId'] = cid;
      } else if (allowedClinics !== null) {
        // Restrict to allowed clinics when no specific clinic is requested
        where['clinicId'] = { in: allowedClinics };
      }

      if (action)       where['action']       = String(action);
      if (entityType)   where['entityType']   = String(entityType);
      if (actorUserId)  where['actorUserId']  = String(actorUserId);

      if (from || to) {
        const dateFilter: Record<string, Date> = {};
        if (from) dateFilter['gte'] = new Date(String(from));
        if (to)   dateFilter['lte'] = new Date(String(to));
        where['createdAt'] = dateFilter;
      }

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      res.json({ total, page, limit, data: logs });
    } catch (err) {
      console.error('[ops/audit-logs]', err);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

// ─── GET /api/ops/events ─────────────────────────────────────────────────────

router.get(
  '/ops/events',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewOperations(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { clinicId, severity, source, status, from, to } = req.query;
    const rawPage2  = parseInt(String(req.query.page  ?? '1'), 10);
    const rawLimit2 = parseInt(String(req.query.limit ?? '50'), 10);
    const page  = Math.max(1, isNaN(rawPage2)  ? 1  : rawPage2);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit2) ? 50 : rawLimit2));
    const skip  = (page - 1) * limit;

    const allowedClinics = getAllowedClinicFilter(req.user!);

    try {
      const where: Record<string, unknown> = {
        organizationId: req.user!.organizationId,
      };

      if (clinicId && clinicId !== 'all') {
        const cid = String(clinicId);
        if (allowedClinics !== null && !allowedClinics.includes(cid)) {
          return res.status(403).json({ error: 'Access denied to requested clinic' });
        }
        where['clinicId'] = cid;
      } else if (allowedClinics !== null) {
        where['clinicId'] = { in: allowedClinics };
      }

      if (severity) where['severity'] = String(severity);
      if (source)   where['source']   = String(source);

      // status=unresolved → resolvedAt=null ; status=resolved → resolvedAt != null
      if (status === 'unresolved') where['resolvedAt'] = null;
      if (status === 'resolved')   where['resolvedAt'] = { not: null };

      if (from || to) {
        const dateFilter: Record<string, Date> = {};
        if (from) dateFilter['gte'] = new Date(String(from));
        if (to)   dateFilter['lte'] = new Date(String(to));
        where['createdAt'] = dateFilter;
      }

      const [total, events] = await Promise.all([
        prisma.operationalEvent.count({ where }),
        prisma.operationalEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);

      res.json({ total, page, limit, data: events });
    } catch (err) {
      console.error('[ops/events]', err);
      res.status(500).json({ error: 'Failed to fetch operational events' });
    }
  }
);

// ─── PATCH /api/ops/events/:id/resolve ───────────────────────────────────────

router.patch(
  '/ops/events/:id/resolve',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canResolveOperationalEvents(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const id = getParam(req, 'id');
    const allowedClinics = getAllowedClinicFilter(req.user!);

    try {
      const event = await prisma.operationalEvent.findFirst({
        where: { id, organizationId: req.user!.organizationId },
      });

      if (!event) return res.status(404).json({ error: 'Event not found' });

      // CLINIC_MANAGER: scope check
      if (
        allowedClinics !== null &&
        event.clinicId &&
        !allowedClinics.includes(event.clinicId)
      ) {
        return res.status(403).json({ error: 'Access denied to this event' });
      }

      if (event.resolvedAt) {
        return res.status(400).json({ error: 'Event is already resolved' });
      }

      const updated = await prisma.operationalEvent.update({
        where: { id },
        data: { resolvedAt: new Date(), resolvedById: req.user!.id },
      });

      res.json(updated);
    } catch (err) {
      console.error('[ops/events/resolve]', err);
      res.status(500).json({ error: 'Failed to resolve event' });
    }
  }
);

// ─── GET /api/ops/health ─────────────────────────────────────────────────────

router.get(
  '/ops/health',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canViewOperations(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const orgId = req.user!.organizationId;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      // Database check
      let dbStatus = 'ok';
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        dbStatus = 'error';
      }

      // WhatsApp connections — no secrets exposed (select safe fields only)
      const waConnections = await prisma.whatsAppConnection.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, status: true },
      });
      const waTotal     = waConnections.length;
      const waConnected = waConnections.filter(c => c.status === 'connected').length;
      const waError     = waConnections.filter(c => c.status === 'error').length;

      // Recent unresolved errors (last 24h)
      const recentErrors = await prisma.operationalEvent.count({
        where: {
          organizationId: orgId,
          severity: { in: ['error', 'critical'] },
          createdAt: { gte: since24h },
          resolvedAt: null,
        },
      });

      // Last webhook received (approximated from latest WhatsApp conversation message)
      const lastWebhookEntry = await prisma.whatsAppConversationMessage.findFirst({
        where: {
          clinic: { organizationId: orgId },
          direction: 'incoming',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      // Last message sent
      const lastSentEntry = await prisma.sentMessage.findFirst({
        where: { organizationId: orgId, status: 'sent' },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      });

      // Unresolved events count
      const unresolvedEvents = await prisma.operationalEvent.count({
        where: { organizationId: orgId, resolvedAt: null },
      });

      // Failed sends in last 24h
      const failedSends24h = await prisma.sentMessage.count({
        where: {
          organizationId: orgId,
          status: 'failed',
          createdAt: { gte: since24h },
        },
      });

      const overallStatus =
        dbStatus === 'error'
          ? 'error'
          : waError > 0 || recentErrors > 0
          ? 'warning'
          : 'ok';

      res.json({
        status: overallStatus,
        database: dbStatus,
        whatsapp: {
          connections: waTotal,
          connected:   waConnected,
          error:       waError,
        },
        recentErrors,
        unresolvedEvents,
        failedSends24h,
        lastWebhookAt:    lastWebhookEntry?.createdAt ?? null,
        lastMessageSentAt: lastSentEntry?.sentAt ?? null,
      });
    } catch (err) {
      console.error('[ops/health]', err);
      res.status(500).json({ error: 'Failed to fetch health summary' });
    }
  }
);

export default router;
