/**
 * instagramInbox.ts — Instagram DM Inbox API
 *
 * Allows staff to manage incoming Instagram DMs:
 *   GET  /api/instagram/inbox/unassigned        — org-level unresolved entries
 *   GET  /api/instagram/inbox/conversations      — all entries with filters
 *   POST /api/instagram/inbox/:id/resolve        — assign to clinic + optional patient
 *   POST /api/instagram/inbox/:id/link-patient   — link existing patient
 *   POST /api/instagram/inbox/:id/assign-clinic  — manually assign clinic
 *   POST /api/instagram/conversations/:id/reply  — send reply via Instagram DM
 *
 * Security rules:
 *   - All queries scoped to req.user.organizationId.
 *   - CLINIC_MANAGER / RECEPTIONIST can only see entries for their allowed clinics.
 *   - Patient lookups are always org-scoped.
 *   - Never expose encrypted tokens or raw secrets in responses.
 */

import express from 'express';
import prisma from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';
import { normalizeRole } from '../utils/roles.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import {
  canViewInstagramInbox,
  canResolveInstagramConversation,
  canReplyInstagramMessages,
} from '../utils/roles.js';
import { sendMessage } from '../services/instagram/InstagramMessagingProvider.js';
import { findPatientInClinic, findUserAssignedToClinic } from '../utils/relationGuards.js';
import { patientContactSelect } from '../utils/prismaSelects.js';
import { normalizeInstagramPatientPhone } from '../services/instagram/instagramAiConversationProcessor.js';

const router = express.Router();

function instagramDisplayName(entry: { patient?: { firstName: string; lastName: string } | null; senderUsername?: string | null }): string {
  if (entry.patient) {
    const patientName = `${entry.patient.firstName} ${entry.patient.lastName}`.trim();
    if (patientName) return patientName;
  }
  const username = entry.senderUsername?.trim();
  if (username && !/^\d{8,}$/.test(username)) return `@${username}`;
  return 'Instagram Kullanıcısı';
}

function summarizeIdentifier(value: string | null | undefined) {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function getAllowedClinicIds(user: NonNullable<AuthRequest['user']>): Promise<string[] | null> {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  if (role === 'OWNER' || role === 'ORG_ADMIN') return null;
  if (user.canAccessAllClinics) return null;
  return user.allowedClinicIds ?? [];
}

router.get(
  '/instagram/inbox/clinics',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canViewInstagramInbox(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const allowedClinicIds = await getAllowedClinicIds(user);
      const clinics = await prisma.clinic.findMany({
        where: {
          organizationId: user.organizationId,
          status: 'active',
          ...(allowedClinicIds ? { id: { in: allowedClinicIds } } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      return res.json({ clinics });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch clinics' });
    }
  },
);

// ── GET /api/instagram/inbox/unassigned ───────────────────────────────────────

router.get(
  '/instagram/inbox/unassigned',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canViewInstagramInbox(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const role = normalizeRole(user.role, user.canAccessAllClinics);
    if (role !== 'OWNER' && role !== 'ORG_ADMIN') {
      return res.status(403).json({
        error: 'Only OWNER or ORG_ADMIN can access the unassigned Instagram inbox.',
      });
    }

    try {
      const entries = await prisma.instagramInboxEntry.findMany({
        where: {
          organizationId: user.organizationId,
          needsClinicResolution: true,
          status: 'open',
        },
        include: {
          instagramConnection: {
            select: { id: true, name: true, instagramUsername: true, instagramAccountId: true },
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

      return res.json({ entries });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch inbox entries' });
    }
  },
);

// ── GET /api/instagram/inbox/conversations ─────────────────────────────────────

router.get(
  '/instagram/inbox/conversations',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canViewInstagramInbox(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowedClinicIds = await getAllowedClinicIds(user);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const clinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : undefined;

    const clinicFilter =
      clinicId && (!allowedClinicIds || allowedClinicIds.includes(clinicId))
        ? clinicId
        : allowedClinicIds
        ? { in: allowedClinicIds }
        : undefined;

    try {
      const entries = await prisma.instagramInboxEntry.findMany({
        where: {
          organizationId: user.organizationId,
          ...(status && { status }),
          ...(clinicFilter !== undefined && { clinicId: clinicFilter as string }),
        },
        include: {
          instagramConnection: {
            select: { id: true, name: true, instagramUsername: true },
          },
          patient: {
            select: { id: true, firstName: true, lastName: true },
          },
          clinic: {
            select: { id: true, name: true },
          },
          resolvedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });

      return res.json({ entries });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  },
);

// ── POST /api/instagram/inbox/:id/resolve ─────────────────────────────────────

router.post(
  '/instagram/inbox/:id/resolve',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canResolveInstagramConversation(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = getParam(req, 'id');
    const { clinicId, patientId } = req.body;

    if (!clinicId || typeof clinicId !== 'string') {
      return res.status(400).json({ error: 'clinicId is required' });
    }

    try {
      // Cross-org guard: verify clinic belongs to org
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      // CLINIC_MANAGER scope check
      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds && !allowedClinicIds.includes(clinicId)) {
        return res.status(403).json({ error: 'You do not have access to this clinic.' });
      }

      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!entry) return res.status(404).json({ error: 'Inbox entry not found' });

      // If patientId provided, verify it belongs to the org
      if (patientId) {
        const patient = await findPatientInClinic(patientId, clinicId);
        if (!patient) return res.status(404).json({ error: 'Patient not found in this clinic' });
      }

      await prisma.instagramInboxEntry.update({
        where: { id },
        data: {
          clinicId,
          patientId: patientId ?? undefined,
          needsClinicResolution: false,
          status: 'resolved',
          resolvedByUserId: user.id,
          resolvedAt: new Date(),
        },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_inbox_resolved',
        entityType: 'instagram_inbox_entry',
        entityId: id,
        description: 'Instagram inbox entry resolved',
        ...extractRequestMeta(req),
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to resolve entry' });
    }
  },
);

// ── POST /api/instagram/inbox/:id/link-patient ────────────────────────────────

router.post(
  '/instagram/inbox/:id/link-patient',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const id = getParam(req, 'id');
    const { patientId } = req.body;

    if (!patientId || typeof patientId !== 'string') {
      return res.status(400).json({ error: 'patientId is required' });
    }

    try {
      // Cross-org guard
      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true, clinicId: true },
      });

      if (!entry) return res.status(404).json({ error: 'Inbox entry not found' });
      if (!entry.clinicId) return res.status(400).json({ error: 'Conversation must be assigned to a clinic before linking a patient' });
      const patient = await findPatientInClinic(patientId, entry.clinicId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      await prisma.instagramInboxEntry.update({
        where: { id },
        data: { patientId },
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to link patient' });
    }
  },
);

// ── POST /api/instagram/inbox/:id/assign-clinic ───────────────────────────────

router.post(
  '/instagram/inbox/:id/assign-clinic',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canResolveInstagramConversation(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = getParam(req, 'id');
    const { clinicId } = req.body;

    if (!clinicId || typeof clinicId !== 'string') {
      return res.status(400).json({ error: 'clinicId is required' });
    }

    try {
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds && !allowedClinicIds.includes(clinicId)) {
        return res.status(403).json({ error: 'You do not have access to this clinic.' });
      }

      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!entry) return res.status(404).json({ error: 'Inbox entry not found' });

      await prisma.instagramInboxEntry.update({
        where: { id },
        data: {
          clinicId,
          needsClinicResolution: false,
          resolvedByUserId: user.id,
        },
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to assign clinic' });
    }
  },
);

// ── POST /api/instagram/conversations/:id/reply ───────────────────────────────

router.post(
  '/instagram/conversations/:id/reply',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canReplyInstagramMessages(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = getParam(req, 'id');
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
    }

    try {
      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: user.organizationId },
        include: {
          instagramConnection: true,
        },
      });

      if (!entry) return res.status(404).json({ error: 'Conversation not found' });

      // Check clinic access for CLINIC_MANAGER / RECEPTIONIST
      if (entry.clinicId) {
        const allowedClinicIds = await getAllowedClinicIds(user);
        if (allowedClinicIds && !allowedClinicIds.includes(entry.clinicId)) {
          return res.status(403).json({ error: 'You do not have access to this conversation.' });
        }
      }

      if (!entry.instagramConnection || !entry.instagramConnection.isActive) {
        return res.status(400).json({ error: 'Instagram connection is not active.' });
      }

      const result = await sendMessage(entry.instagramConnection, {
        recipientIgsid: entry.externalSenderId,
        text: message.trim(),
      });

      if (!result.success) {
        return res.status(502).json({ error: result.error ?? 'Failed to send message via Meta API' });
      }

      // Update conversation last message time
      await prisma.instagramInboxEntry.update({
        where: { id },
        data: { updatedAt: new Date() },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId: entry.clinicId ?? undefined,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_reply_sent',
        entityType: 'instagram_inbox_entry',
        entityId: id,
        description: 'Staff replied to Instagram DM',
        ...extractRequestMeta(req),
      });

      return res.json({ success: true, externalMessageId: result.externalMessageId });
    } catch {
      return res.status(500).json({ error: 'Failed to send reply' });
    }
  },
);

// ── POST /api/instagram/inbox/:id/create-appointment-request ─────────────────
//
// Creates an AppointmentRequest from an Instagram inbox entry.
// Source = 'instagram'. Links to patient if already linked.
// Marks entry status = 'converted'.

router.post(
  '/instagram/inbox/:id/create-appointment-request',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canViewInstagramInbox(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = getParam(req, 'id');

    try {
      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: user.organizationId },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          clinic: { select: { id: true, name: true } },
        },
      });

      if (!entry) return res.status(404).json({ error: 'Inbox entry not found' });

      if (!entry.clinicId) {
        return res.status(400).json({
          error: 'Please assign a clinic before creating an appointment request.',
        });
      }

      // Scope check: CLINIC_MANAGER / RECEPTIONIST only for their clinics
      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds && !allowedClinicIds.includes(entry.clinicId)) {
        return res.status(403).json({ error: 'You do not have access to this clinic.' });
      }

      if (entry.status === 'converted') {
        return res.status(400).json({ error: 'This entry has already been converted.' });
      }

      // Build patient name + phone from what we have
      const patientName = instagramDisplayName(entry);

      const phone = normalizeInstagramPatientPhone(entry.patient?.phone);
      if (!phone) {
        return res.status(400).json({
          error: 'Linked patient must have a valid phone number before creating an Instagram appointment request.',
          code: 'MISSING_PATIENT_PHONE',
        });
      }

      const appointmentRequest = await prisma.appointmentRequest.create({
        data: {
          clinicId: entry.clinicId,
          patientId: entry.patientId ?? undefined,
          patientName,
          phone,
          source: 'instagram',
          externalSenderId: entry.externalSenderId,
          sourceConnectionId: entry.instagramConnectionId,
          sourceInboxEntryId: entry.id,
          sourceConversationId: entry.externalConversationId ?? null,
          status: 'pending',
          requestType: 'appointment',
          rawMessage: entry.lastMessageText ?? undefined,
          notes: `Instagram DM'den oluşturuldu. Gönderen: ${instagramDisplayName(entry)}`,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          appointmentType: true,
          practitioner: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      console.info('[appointment-request] created', {
        channel: 'instagram',
        clinicId: summarizeIdentifier(entry.clinicId),
        inboxEntryId: summarizeIdentifier(entry.id),
        conversationId: summarizeIdentifier(entry.externalConversationId),
        patientId: summarizeIdentifier(entry.patientId),
        serviceId: null,
        serviceName: null,
        practitionerId: null,
        practitionerName: null,
        requestedDateTime: null,
        requestId: summarizeIdentifier(appointmentRequest.id),
      });

      // Mark inbox entry as converted
      await prisma.instagramInboxEntry.update({
        where: { id },
        data: { status: 'converted' },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId: entry.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_inbox_converted_to_request',
        entityType: 'instagram_inbox_entry',
        entityId: id,
        description: `Instagram DM converted to appointment request ${appointmentRequest.id}`,
        metadata: { appointmentRequestId: appointmentRequest.id } as Record<string, unknown>,
        ...extractRequestMeta(req),
      });

      return res.status(201).json({ appointmentRequest });
    } catch {
      return res.status(500).json({ error: 'Failed to create appointment request' });
    }
  },
);

// ── POST /api/instagram/inbox/:id/create-appointment ─────────────────────────
//
// Directly creates an Appointment from an Instagram inbox entry.
// Marks entry status = 'converted'.

router.post(
  '/instagram/inbox/:id/create-appointment',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!canViewInstagramInbox(user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = getParam(req, 'id');
    const { patientId, clinicId, practitionerId, appointmentTypeId, date, time, endTime, notes } = req.body;

    if (!patientId || typeof patientId !== 'string') {
      return res.status(400).json({ error: 'patientId is required' });
    }
    if (!clinicId || typeof clinicId !== 'string') {
      return res.status(400).json({ error: 'clinicId is required' });
    }
    if (!practitionerId || typeof practitionerId !== 'string') {
      return res.status(400).json({ error: 'practitionerId is required' });
    }
    if (!appointmentTypeId || typeof appointmentTypeId !== 'string') {
      return res.status(400).json({ error: 'appointmentTypeId is required' });
    }
    if (!date || !time) {
      return res.status(400).json({ error: 'date and time are required' });
    }

    try {
      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true, clinicId: true, status: true, senderUsername: true, externalSenderId: true },
      });

      if (!entry) return res.status(404).json({ error: 'Inbox entry not found' });

      // Scope check
      const allowedClinicIds = await getAllowedClinicIds(user);
      if (allowedClinicIds && !allowedClinicIds.includes(clinicId)) {
        return res.status(403).json({ error: 'You do not have access to this clinic.' });
      }

      if (entry.status === 'converted') {
        return res.status(400).json({ error: 'This entry has already been converted.' });
      }

      // Validate clinic belongs to org
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      // Validate patient
      const patient = await findPatientInClinic(patientId, clinicId);
      if (!patient) return res.status(404).json({ error: 'Patient not found in this clinic' });

      const practitioner = await findUserAssignedToClinic(practitionerId, clinicId, { roles: ['DENTIST'] });
      if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

      // Validate appointment type
      const apptType = await prisma.appointmentType.findFirst({
        where: { id: appointmentTypeId, clinicId, isActive: true },
        select: { id: true, durationMinutes: true },
      });
      if (!apptType) return res.status(400).json({ error: 'Invalid appointment type' });

      // Build start/end times
      const startTime = new Date(`${date}T${time}`);
      const endDateTime = endTime
        ? new Date(`${date}T${endTime}`)
        : new Date(startTime.getTime() + apptType.durationMinutes * 60_000);

      if (isNaN(startTime.getTime()) || isNaN(endDateTime.getTime())) {
        return res.status(400).json({ error: 'Invalid date or time format' });
      }

      // Check overlap
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
          notes: notes ?? `Instagram DM'den oluşturuldu. Gönderen: ${instagramDisplayName(entry)}`,
          createdById: user.id,
        },
        include: {
          patient: { select: patientContactSelect },
          practitioner: { select: { id: true, firstName: true, lastName: true } },
          appointmentType: true,
        },
      });

      // Mark inbox entry as converted, link patient and clinic if needed
      await prisma.instagramInboxEntry.update({
        where: { id },
        data: {
          status: 'converted',
          patientId: patientId,
          clinicId: clinicId,
          needsClinicResolution: false,
        },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'instagram_inbox_converted_to_appointment',
        entityType: 'instagram_inbox_entry',
        entityId: id,
        description: `Instagram DM converted to appointment ${appointment.id}`,
        metadata: { appointmentId: appointment.id } as Record<string, unknown>,
        ...extractRequestMeta(req),
      });

      return res.status(201).json({ appointment });
    } catch {
      return res.status(500).json({ error: 'Failed to create appointment' });
    }
  },
);

// ── PATCH /instagram/inbox/:id/status — update entry status (e.g. 'converted') ──
router.patch(
  '/instagram/inbox/:id/status',
  authenticate,
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DOCTOR']),
  async (req: AuthRequest, res) => {
    const id = getParam(req, 'id');
    const { status } = req.body as { status?: string };
    const validStatuses = ['open', 'resolved', 'ignored', 'converted'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    try {
      const entry = await prisma.instagramInboxEntry.findFirst({
        where: { id, organizationId: req.user!.organizationId },
      });
      if (!entry) return res.status(404).json({ error: 'Entry not found' });
      const updated = await prisma.instagramInboxEntry.update({
        where: { id },
        data: { status },
      });
      return res.json({ entry: updated });
    } catch {
      return res.status(500).json({ error: 'Failed to update status' });
    }
  },
);

export default router;
