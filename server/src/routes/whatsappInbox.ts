/**
 * whatsappInbox.ts — Unassigned WhatsApp Inbox API
 *
 * Handles incoming messages that could not be automatically routed to a clinic
 * (Priority D from clinicResolver). Allows authorized staff to:
 *   - List unresolved conversations
 *   - Resolve a conversation to a clinic + optional patient
 *   - Link an existing patient to a conversation
 *
 * Security rules:
 *   - All queries are scoped to req.user.organizationId — no cross-org leakage.
 *   - CLINIC_MANAGER can only resolve to clinics they have access to.
 *   - Patient lookups are always scoped to the same organization.
 *   - Resolved messages are NOT exposed before linking to preserve privacy.
 */

import express from 'express';
import prisma from '../db.js';
import type { Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';
import { normalizeRole } from '../utils/roles.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';

const router = express.Router();

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Clinics accessible to the current user (for CLINIC_MANAGER scoping). */
async function getAllowedClinicIds(user: NonNullable<AuthRequest['user']>): Promise<string[] | null> {
  // OWNER / ORG_ADMIN — see everything in their org
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  if (role === 'OWNER' || role === 'ORG_ADMIN') return null; // null = all clinics

  // CLINIC_MANAGER / RECEPTIONIST — only assigned clinics
  if (user.canAccessAllClinics) return null;
  return user.allowedClinicIds ?? [];
}

// ─── GET /api/whatsapp/inbox/unassigned ──────────────────────────────────────

router.get(
  '/whatsapp/inbox/unassigned',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const role = normalizeRole(user.role, user.canAccessAllClinics);

    // MVP: Only OWNER / ORG_ADMIN can see the org-level unassigned inbox.
    // CLINIC_MANAGER / RECEPTIONIST can view assigned conversations but NOT
    // the unresolved org-level inbox (clinicId is null there).
    if (role !== 'OWNER' && role !== 'ORG_ADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Only OWNER or ORG_ADMIN can access the unassigned inbox.',
      });
    }

    try {
      const entries = await prisma.whatsAppInboxEntry.findMany({
        where: {
          organizationId: user.organizationId,
          needsClinicResolution: true,
          status: 'open',
        },
        include: {
          whatsappConnection: {
            select: { id: true, name: true, provider: true, phoneNumber: true },
          },
          patient: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
          clinic: {
            select: { id: true, name: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Suggest possible matching patients for each entry (by phone)
      const enriched = await Promise.all(
        entries.map(async (entry) => {
          const phoneDigits = entry.phone.replace(/\D/g, '');
          const variants: string[] = [phoneDigits];
          if (phoneDigits.startsWith('90') && phoneDigits.length === 12) {
            variants.push(phoneDigits.slice(2), `0${phoneDigits.slice(2)}`);
          } else if (phoneDigits.startsWith('0') && phoneDigits.length === 11) {
            variants.push(phoneDigits.slice(1), `90${phoneDigits.slice(1)}`);
          } else if (phoneDigits.length === 10) {
            variants.push(`0${phoneDigits}`, `90${phoneDigits}`);
          }

          const possiblePatients = entry.patientId
            ? [] // already linked
            : await prisma.patient.findMany({
                where: {
                  organizationId: user.organizationId,
                  phone: { in: variants },
                  deletedAt: null,
                },
                select: { id: true, firstName: true, lastName: true, phone: true, clinicId: true },
                take: 5,
              });

          return { ...entry, possiblePatients };
        }),
      );

      res.json({ unassigned: enriched, entries: enriched, total: enriched.length });
    } catch (error) {
      console.error('[whatsapp-inbox] list-unassigned error', error);
      res.status(500).json({ error: 'Failed to fetch unassigned inbox' });
    }
  },
);

// ─── GET /api/whatsapp/inbox/conversations ───────────────────────────────────

router.get(
  '/whatsapp/inbox/conversations',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const allowedClinicIds = await getAllowedClinicIds(user);

    const { status, clinicId } = req.query;

    try {
      // Build inbox-entry where clause.
      const inboxWhere: Prisma.WhatsAppInboxEntryWhereInput = {
        organizationId: user.organizationId,
      };

      if (status === 'unassigned') {
        inboxWhere.needsClinicResolution = true;
        inboxWhere.status = 'open';
      } else if (status === 'assigned') {
        inboxWhere.needsClinicResolution = false;
        inboxWhere.clinicId = { not: null };
      }

      // Clinic filter from query
      if (clinicId && typeof clinicId === 'string') {
        // Make sure user can access this clinic
        if (allowedClinicIds !== null && !allowedClinicIds.includes(clinicId)) {
          return res.status(403).json({ error: 'Forbidden: No access to this clinic' });
        }
        inboxWhere.clinicId = clinicId;
      } else if (allowedClinicIds !== null) {
        // Scope to allowed clinics for non-admin roles (unassigned entries have clinicId=null,
        // which non-admins should not see)
        inboxWhere.clinicId = { in: allowedClinicIds };
      }

      const inboxEntries = await prisma.whatsAppInboxEntry.findMany({
        where: inboxWhere,
        include: {
          whatsappConnection: {
            select: { id: true, name: true, provider: true, phoneNumber: true },
          },
          clinic: { select: { id: true, name: true } },
          patient: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });

      // Patient pages read WhatsAppConversationMessage directly. Include those
      // routed patient conversations here so "All conversations" matches the
      // patient WhatsApp tab instead of only showing manual-resolution entries.
      const messageWhere: Prisma.WhatsAppConversationMessageWhereInput = {
        clinic: { organizationId: user.organizationId },
      };

      if (clinicId && typeof clinicId === 'string') {
        messageWhere.clinicId = clinicId;
      } else if (allowedClinicIds !== null) {
        messageWhere.clinicId = { in: allowedClinicIds };
      }

      const messageGroups =
        status === 'unassigned'
          ? []
          : await prisma.whatsAppConversationMessage.groupBy({
              by: ['clinicId', 'patientId', 'phone'],
              where: messageWhere,
              _count: { _all: true },
              _min: { createdAt: true },
              _max: { createdAt: true },
              orderBy: { _max: { createdAt: 'desc' } },
              take: 100,
            });

      const lastMessageFilters = messageGroups
        .filter((group) => group._max.createdAt)
        .map((group) => ({
          clinicId: group.clinicId,
          patientId: group.patientId,
          phone: group.phone,
          createdAt: group._max.createdAt!,
        }));

      const lastMessages = lastMessageFilters.length
        ? await prisma.whatsAppConversationMessage.findMany({
            where: { OR: lastMessageFilters },
            include: {
              clinic: { select: { id: true, name: true } },
              patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
            },
          })
        : [];

      const lastMessageByGroup = new Map(
        lastMessages.map((message) => [
          `${message.clinicId}:${message.patientId}:${message.phone}:${message.createdAt.toISOString()}`,
          message,
        ]),
      );

      const messageConversations = messageGroups.map((group) => {
        const updatedAt = group._max.createdAt ?? new Date(0);
        const lastMessage = lastMessageByGroup.get(
          `${group.clinicId}:${group.patientId}:${group.phone}:${updatedAt.toISOString()}`,
        );
        const patient = lastMessage?.patient;

        return {
          id: `conversation:${group.clinicId}:${group.patientId}:${group.phone}`,
          phone: group.phone,
          displayName: patient ? `${patient.firstName} ${patient.lastName}` : undefined,
          lastMessageText: lastMessage?.text ?? null,
          messageCount: group._count._all,
          needsClinicResolution: false,
          status: 'open',
          createdAt: group._min.createdAt ?? updatedAt,
          updatedAt,
          clinicId: group.clinicId,
          patientId: group.patientId,
          clinic: lastMessage?.clinic ?? null,
          patient: patient
            ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName }
            : null,
        };
      });

      const messageConversationKeys = new Set(
        messageConversations.map((entry) => `${entry.clinicId}:${entry.patientId}:${entry.phone}`),
      );

      const dedupedInboxEntries = inboxEntries.filter((entry) => {
        if (!entry.clinicId || !entry.patientId) return true;
        return !messageConversationKeys.has(`${entry.clinicId}:${entry.patientId}:${entry.phone}`);
      });

      const conversations = [...messageConversations, ...dedupedInboxEntries]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 100);

      res.json({ conversations, entries: conversations, total: conversations.length });
    } catch (error) {
      console.error('[whatsapp-inbox] list-conversations error', error);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  },
);

// ─── POST /api/whatsapp/inbox/:id/resolve ─────────────────────────────────────

router.post(
  '/whatsapp/inbox/:id/resolve',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const entryId = getParam(req, 'id');
    const { clinicId, patientId } = req.body as {
      clinicId?: string;
      patientId?: string;
    };

    if (!clinicId) {
      return res.status(400).json({ error: 'clinicId is required to resolve an inbox entry' });
    }

    try {
      // Load the entry — must belong to this org
      const entry = await prisma.whatsAppInboxEntry.findFirst({
        where: { id: entryId, organizationId: user.organizationId },
      });
      if (!entry) {
        return res.status(404).json({ error: 'Inbox entry not found' });
      }
      if (entry.status === 'resolved') {
        return res.status(409).json({ error: 'Entry is already resolved' });
      }

      // Validate clinic belongs to this org
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true, name: true },
      });
      if (!clinic) {
        return res.status(404).json({ error: 'Clinic not found in this organization' });
      }

      // CLINIC_MANAGER: may only resolve to clinics they can access
      const role = normalizeRole(user.role, user.canAccessAllClinics);
      if (role === 'CLINIC_MANAGER' && !user.canAccessAllClinics) {
        if (!user.allowedClinicIds?.includes(clinicId)) {
          return res.status(403).json({ error: 'Forbidden: You can only resolve to clinics you manage' });
        }
      }

      // Validate patient if provided
      let resolvedPatientId: string | null = entry.patientId ?? null;
      if (patientId) {
        const patient = await prisma.patient.findFirst({
          where: { id: patientId, organizationId: user.organizationId, deletedAt: null },
          select: { id: true },
        });
        if (!patient) {
          return res.status(404).json({ error: 'Patient not found in this organization' });
        }
        resolvedPatientId = patient.id;
      }

      // Update inbox entry
      const updated = await prisma.whatsAppInboxEntry.update({
        where: { id: entryId },
        data: {
          clinicId,
          patientId: resolvedPatientId,
          resolvedByUserId: user.id,
          resolvedAt: new Date(),
          needsClinicResolution: false,
          status: 'resolved',
        },
        include: {
          clinic: { select: { id: true, name: true } },
          patient: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      res.json({ ok: true, entry: updated });

      // Audit log — non-blocking
      writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'whatsapp_inbox_resolved',
        entityType: 'whatsapp_inbox_entry',
        entityId: entryId,
        description: `WhatsApp inbox entry resolved to clinic: ${clinic.name}`,
        metadata: { phone: entry.phone, clinicId, patientId: resolvedPatientId },
        ...extractRequestMeta(req),
      });
    } catch (error) {
      console.error('[whatsapp-inbox] resolve error', error);
      res.status(500).json({ error: 'Failed to resolve inbox entry' });
    }
  },
);

// ─── POST /api/whatsapp/inbox/:id/link-patient ────────────────────────────────

router.post(
  '/whatsapp/inbox/:id/link-patient',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const entryId = getParam(req, 'id');
    const { patientId } = req.body as { patientId?: string };

    if (!patientId) {
      return res.status(400).json({ error: 'patientId is required' });
    }

    try {
      // Load entry — must belong to this org
      const entry = await prisma.whatsAppInboxEntry.findFirst({
        where: { id: entryId, organizationId: user.organizationId },
      });
      if (!entry) {
        return res.status(404).json({ error: 'Inbox entry not found' });
      }

      // CLINIC_MANAGER / RECEPTIONIST: only link patients in clinics they can access
      const role = normalizeRole(user.role, user.canAccessAllClinics);
      if (
        (role === 'CLINIC_MANAGER' || role === 'RECEPTIONIST') &&
        !user.canAccessAllClinics &&
        entry.clinicId
      ) {
        if (!user.allowedClinicIds?.includes(entry.clinicId)) {
          return res.status(403).json({ error: 'Forbidden: No access to this conversation clinic' });
        }
      }

      // Validate patient — must be in same org, not deleted
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, organizationId: user.organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, phone: true },
      });
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found in this organization' });
      }

      const updated = await prisma.whatsAppInboxEntry.update({
        where: { id: entryId },
        data: { patientId: patient.id },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      });

      res.json({ ok: true, entry: updated });
    } catch (error) {
      console.error('[whatsapp-inbox] link-patient error', error);
      res.status(500).json({ error: 'Failed to link patient' });
    }
  },
);

export default router;
