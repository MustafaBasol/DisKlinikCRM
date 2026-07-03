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
 *   - Message history is only exposed once a conversation has a clinic assignment
 *     (and the user has access to that clinic); unassigned entries expose only
 *     the lastMessageText snapshot.
 */

import express from 'express';
import prisma from '../db.js';
import type { Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';
import { normalizeRole } from '../utils/roles.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { findPatientInClinic, findUserAssignedToClinic } from '../utils/relationGuards.js';
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';
import {
  backfillConversationMessagePatient,
  persistWhatsAppConversationMessage,
} from '../services/whatsapp/conversationMessageStore.js';

const router = express.Router();

const normalizePhone = (value: string) => value.replace(/@.+$/, '').replace(/\D/g, '');

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
      // patientId != null: unlinked conversations are already represented by their
      // WhatsAppInboxEntry — including them here would duplicate rows in the list.
      const messageWhere: Prisma.WhatsAppConversationMessageWhereInput = {
        clinic: { organizationId: user.organizationId },
        patientId: { not: null },
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
        const patient = await findPatientInClinic(patientId, clinicId);
        if (!patient) {
          return res.status(404).json({ error: 'Patient not found in this clinic' });
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

      // Backfill unlinked conversation messages for this phone now that staff
      // resolved the conversation to a clinic (+ optionally a patient).
      if (resolvedPatientId) {
        await backfillConversationMessagePatient({
          clinicId,
          phone: entry.phone,
          patientId: resolvedPatientId,
        }).catch(error => console.error('[whatsapp-inbox] resolve backfill failed', error));
      }

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

      if (!entry.clinicId) {
        return res.status(400).json({ error: 'Conversation must be assigned to a clinic before linking a patient' });
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
      const patient = await findPatientInClinic(patientId, entry.clinicId);
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found in this clinic' });
      }

      const updated = await prisma.whatsAppInboxEntry.update({
        where: { id: entryId },
        data: { patientId: patient.id },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      });

      // Backfill unlinked conversation messages for this clinic + phone so the
      // patient detail Messages tab shows the full history after linking.
      await backfillConversationMessagePatient({
        clinicId: entry.clinicId,
        phone: entry.phone,
        patientId: patient.id,
      }).catch(error => console.error('[whatsapp-inbox] link-patient backfill failed', error));

      res.json({ ok: true, entry: updated });
    } catch (error) {
      console.error('[whatsapp-inbox] link-patient error', error);
      res.status(500).json({ error: 'Failed to link patient' });
    }
  },
);

// ─── GET /api/whatsapp/inbox/:id/messages ─────────────────────────────────────

router.get(
  '/whatsapp/inbox/:id/messages',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const entryId = getParam(req, 'id');

    try {
      const entry = await prisma.whatsAppInboxEntry.findFirst({
        where: { id: entryId, organizationId: user.organizationId },
      });
      if (!entry) {
        return res.status(404).json({ error: 'Inbox entry not found' });
      }

      if (entry.clinicId) {
        const allowedClinicIds = await getAllowedClinicIds(user);
        if (allowedClinicIds !== null && !allowedClinicIds.includes(entry.clinicId)) {
          return res.status(403).json({ error: 'Forbidden: No access to this conversation' });
        }
      }

      // Conversations without a clinic assignment only expose the single
      // lastMessageText snapshot (privacy: no clinic scope to authorize against).
      if (!entry.clinicId) {
        const messages = entry.lastMessageText
          ? [
              {
                id: entry.id,
                direction: 'incoming',
                text: entry.lastMessageText,
                createdAt: entry.updatedAt,
              },
            ]
          : [];
        return res.json({ messages, partial: true });
      }

      // The inbox thread is per phone: query by phone so unlinked messages
      // (patientId null, persisted before staff linked a patient) are included.
      const messages = await prisma.whatsAppConversationMessage.findMany({
        where: entry.patientId
          ? {
              clinicId: entry.clinicId,
              OR: [{ patientId: entry.patientId }, { phone: normalizePhone(entry.phone), patientId: null }],
            }
          : { clinicId: entry.clinicId, phone: normalizePhone(entry.phone) },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });

      res.json({ messages, partial: false });
    } catch (error) {
      console.error('[whatsapp-inbox] get-messages error', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  },
);

// ─── POST /api/whatsapp/inbox/:id/reply ───────────────────────────────────────

router.post(
  '/whatsapp/inbox/:id/reply',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const entryId = getParam(req, 'id');
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
    }

    try {
      const entry = await prisma.whatsAppInboxEntry.findFirst({
        where: { id: entryId, organizationId: user.organizationId },
      });
      if (!entry) {
        return res.status(404).json({ error: 'Inbox entry not found' });
      }
      if (!entry.clinicId) {
        return res.status(400).json({ error: 'Please assign a clinic before replying.' });
      }

      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds !== null && !allowedClinicIds.includes(entry.clinicId)) {
        return res.status(403).json({ error: 'Forbidden: No access to this conversation' });
      }

      const result = await sendWhatsAppMessage(
        entry.clinicId,
        { phone: entry.phone, text: message.trim() },
        entry.whatsappConnectionId ?? undefined,
      );

      if (!result.success) {
        return res.status(502).json({ error: result.error ?? 'Failed to send WhatsApp message' });
      }

      await persistWhatsAppConversationMessage({
        clinicId: entry.clinicId,
        patientId: entry.patientId ?? null,
        phone: entry.phone,
        providerMessageId: result.externalMessageId ?? null,
        direction: 'outgoing',
        text: message.trim(),
      }).catch(error => console.error('[whatsapp-inbox] reply persistence failed', error));

      await prisma.whatsAppInboxEntry.update({
        where: { id: entryId },
        data: { updatedAt: new Date() },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId: entry.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'whatsapp_reply_sent',
        entityType: 'whatsapp_inbox_entry',
        entityId: entryId,
        description: 'Staff replied to WhatsApp conversation',
        ...extractRequestMeta(req),
      });

      res.json({ success: true, externalMessageId: result.externalMessageId });
    } catch (error) {
      console.error('[whatsapp-inbox] reply error', error);
      res.status(500).json({ error: 'Failed to send reply' });
    }
  },
);

// ─── POST /api/whatsapp/inbox/:id/create-appointment-request ─────────────────

router.post(
  '/whatsapp/inbox/:id/create-appointment-request',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const entryId = getParam(req, 'id');

    try {
      const entry = await prisma.whatsAppInboxEntry.findFirst({
        where: { id: entryId, organizationId: user.organizationId },
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      });
      if (!entry) {
        return res.status(404).json({ error: 'Inbox entry not found' });
      }
      if (!entry.clinicId) {
        return res.status(400).json({ error: 'Please assign a clinic before creating an appointment request.' });
      }

      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds !== null && !allowedClinicIds.includes(entry.clinicId)) {
        return res.status(403).json({ error: 'Forbidden: No access to this conversation' });
      }

      const patientName = entry.patient
        ? `${entry.patient.firstName} ${entry.patient.lastName}`.trim()
        : entry.displayName?.trim() || entry.phone;

      const appointmentRequest = await prisma.appointmentRequest.create({
        data: {
          clinicId: entry.clinicId,
          patientId: entry.patientId ?? undefined,
          patientName,
          phone: entry.phone,
          source: 'whatsapp',
          sourceConnectionId: entry.whatsappConnectionId,
          sourceInboxEntryId: entry.id,
          status: 'pending',
          requestType: 'appointment',
          rawMessage: entry.lastMessageText ?? undefined,
          notes: `WhatsApp'tan oluşturuldu. Gönderen: ${patientName}`,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      });

      await prisma.whatsAppInboxEntry.update({
        where: { id: entryId },
        data: { status: 'resolved' },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId: entry.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'whatsapp_inbox_converted_to_request',
        entityType: 'whatsapp_inbox_entry',
        entityId: entryId,
        description: `WhatsApp conversation converted to appointment request ${appointmentRequest.id}`,
        metadata: { appointmentRequestId: appointmentRequest.id },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ appointmentRequest });
    } catch (error) {
      console.error('[whatsapp-inbox] create-appointment-request error', error);
      res.status(500).json({ error: 'Failed to create appointment request' });
    }
  },
);

// ─── POST /api/whatsapp/inbox/:id/create-appointment ──────────────────────────

router.post(
  '/whatsapp/inbox/:id/create-appointment',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const entryId = getParam(req, 'id');
    const { patientId, clinicId, practitionerId, appointmentTypeId, date, time, endTime, notes } = req.body as {
      patientId?: string;
      clinicId?: string;
      practitionerId?: string;
      appointmentTypeId?: string;
      date?: string;
      time?: string;
      endTime?: string;
      notes?: string;
    };

    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!clinicId) return res.status(400).json({ error: 'clinicId is required' });
    if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });
    if (!appointmentTypeId) return res.status(400).json({ error: 'appointmentTypeId is required' });
    if (!date || !time) return res.status(400).json({ error: 'date and time are required' });

    try {
      const entry = await prisma.whatsAppInboxEntry.findFirst({
        where: { id: entryId, organizationId: user.organizationId },
      });
      if (!entry) return res.status(404).json({ error: 'Inbox entry not found' });

      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds !== null && !allowedClinicIds.includes(clinicId)) {
        return res.status(403).json({ error: 'Forbidden: No access to this clinic' });
      }

      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const patient = await findPatientInClinic(patientId, clinicId);
      if (!patient) return res.status(404).json({ error: 'Patient not found in this clinic' });

      const practitioner = await findUserAssignedToClinic(practitionerId, clinicId, { roles: ['DENTIST'] });
      if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

      const apptType = await prisma.appointmentType.findFirst({
        where: { id: appointmentTypeId, clinicId, isActive: true },
        select: { id: true, durationMinutes: true },
      });
      if (!apptType) return res.status(400).json({ error: 'Invalid appointment type' });

      const startTime = new Date(`${date}T${time}`);
      const endDateTime = endTime
        ? new Date(`${date}T${endTime}`)
        : new Date(startTime.getTime() + apptType.durationMinutes * 60_000);

      if (isNaN(startTime.getTime()) || isNaN(endDateTime.getTime())) {
        return res.status(400).json({ error: 'Invalid date or time format' });
      }

      const overlap = await prisma.appointment.findFirst({
        where: {
          clinicId,
          practitionerId,
          deletedAt: null,
          status: { notIn: ['cancelled'] },
          OR: [{ startTime: { lt: endDateTime }, endTime: { gt: startTime } }],
        },
        select: { id: true },
      });
      if (overlap) {
        return res.status(409).json({
          error: 'Practitioner already has an appointment during this time',
          code: 'APPOINTMENT_OVERLAP',
        });
      }

      const appointment = await prisma.appointment.create({
        data: {
          clinicId,
          patientId,
          practitionerId,
          appointmentTypeId,
          startTime,
          endTime: endDateTime,
          status: 'confirmed',
          notes: notes ?? `WhatsApp'tan oluşturuldu. Telefon: ${entry.phone}`,
          createdById: user.id,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          practitioner: { select: { id: true, firstName: true, lastName: true } },
          appointmentType: true,
        },
      });

      await prisma.whatsAppInboxEntry.update({
        where: { id: entryId },
        data: {
          status: 'resolved',
          patientId,
          clinicId,
          needsClinicResolution: false,
        },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'whatsapp_inbox_converted_to_appointment',
        entityType: 'whatsapp_inbox_entry',
        entityId: entryId,
        description: `WhatsApp conversation converted to appointment ${appointment.id}`,
        metadata: { appointmentId: appointment.id },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ appointment });
    } catch (error) {
      console.error('[whatsapp-inbox] create-appointment error', error);
      res.status(500).json({ error: 'Failed to create appointment' });
    }
  },
);

export default router;
