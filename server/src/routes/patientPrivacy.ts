/**
 * patientPrivacy.ts — KVKK/GDPR Patient Privacy Rights API
 *
 * Endpoints:
 *   POST  /api/patients/:id/privacy/export      — Export patient data as JSON
 *   POST  /api/patients/:id/privacy/anonymize   — Anonymize patient PII
 *   GET   /api/patients/:id/privacy/requests    — List privacy requests for patient
 *   POST  /api/patients/:id/privacy/requests    — Create a privacy request record
 *   PATCH /api/privacy-requests/:reqId/status   — Update request status/decision
 *
 * Security:
 *   - All routes require authenticated clinic session (global auth middleware).
 *   - Sensitive actions (export, anonymize) require OWNER | ORG_ADMIN | CLINIC_MANAGER.
 *   - All operations are organization + clinic scoped.
 *   - No cross-clinic data is returned.
 *   - No provider tokens/secrets are included in exports.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { anonymizePatientData } from '../services/privacy/patientAnonymization.js';
import { getParam } from '../utils/helpers.js';

const router = express.Router();

const PRIVACY_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

const VALID_REQUEST_TYPES = new Set([
  'access_export',
  'rectification',
  'anonymization',
  'deletion_review',
  'restriction',
  'objection',
  'other',
]);

const VALID_STATUSES = new Set([
  'pending',
  'in_review',
  'completed',
  'rejected',
  'cancelled',
]);

// ── Helper: resolve patient within org scope ───────────────────────────────────

async function resolvePatient(
  patientId: string,
  user: NonNullable<AuthRequest['user']>,
): Promise<{ id: string; clinicId: string; isAnonymized: boolean } | null> {
  const where: any = {
    id: patientId,
    organizationId: user.organizationId,
    deletedAt: null,
  };
  // If user can't access all clinics, restrict to assigned clinics
  if (!user.canAccessAllClinics) {
    where.clinicId = { in: user.allowedClinicIds };
  }
  return prisma.patient.findFirst({
    where,
    select: { id: true, clinicId: true, isAnonymized: true },
  });
}

// ── POST /api/patients/:id/privacy/export ─────────────────────────────────────

router.post(
  '/patients/:id/privacy/export',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const clinicId = patient.clinicId;

    try {
      const [
        patientFull,
        appointments,
        appointmentRequests,
        contactRequests,
        treatmentCases,
        payments,
        paymentPlans,
        toothRecords,
        attachments,
        whatsappMessages,
        instagramMessages,
        whatsappInboxEntries,
        instagramInboxEntries,
        activityLogs,
        privacyRequests,
      ] = await Promise.all([
        prisma.patient.findFirst({
          where: { id: patientId, clinicId, organizationId: user.organizationId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            dateOfBirth: true,
            address: true,
            city: true,
            postalCode: true,
            country: true,
            patientStatus: true,
            source: true,
            notes: true,
            communicationConsent: true,
            marketingConsent: true,
            isAnonymized: true,
            anonymizedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.appointment.findMany({
          where: { patientId, clinicId, deletedAt: null },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            notes: true,
            createdAt: true,
            appointmentType: { select: { name: true } },
            practitioner: { select: { firstName: true, lastName: true } },
          },
          orderBy: { startTime: 'desc' },
        }),
        prisma.appointmentRequest.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            patientName: true,
            phone: true,
            email: true,
            source: true,
            status: true,
            requestType: true,
            notes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.contactRequest.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            channel: true,
            type: true,
            status: true,
            priority: true,
            name: true,
            phone: true,
            note: true,
            lastMessage: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.treatmentCase.findMany({
          where: { patientId, clinicId, deletedAt: null },
          select: {
            id: true,
            title: true,
            stage: true,
            description: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.payment.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            amount: true,
            currency: true,
            paymentStatus: true,
            paymentMethod: true,
            paidAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.paymentPlan.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            totalAmount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.toothRecord.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            toothFdi: true,
            status: true,
            note: true,
            createdAt: true,
          },
        }),
        prisma.patientAttachment.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.whatsAppConversationMessage.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            direction: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        prisma.instagramConversationMessage.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            direction: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        prisma.whatsAppInboxEntry.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            status: true,
            messageCount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.instagramInboxEntry.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            status: true,
            messageCount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.activityLog.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            action: true,
            entityType: true,
            description: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
        prisma.patientPrivacyRequest.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            requestType: true,
            status: true,
            requestNote: true,
            decisionNote: true,
            completedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: user.id,
        dataSubject: patientFull,
        appointments,
        appointmentRequests,
        contactRequests,
        treatmentCases,
        payments,
        paymentPlans,
        toothRecords,
        attachmentMetadata: attachments,
        messagingActivity: {
          whatsappMessageCount: whatsappMessages.length,
          instagramMessageCount: instagramMessages.length,
          whatsappInboxEntries,
          instagramInboxEntries,
          note: 'Raw message text and payloads are excluded from the data export for privacy compliance.',
        },
        activityHistory: activityLogs,
        privacyRequests,
      };

      // Create/log a privacy request record for the export action
      await prisma.patientPrivacyRequest.create({
        data: {
          clinicId,
          patientId,
          requestType: 'access_export',
          status: 'completed',
          requestedByUserId: user.id,
          handledByUserId: user.id,
          requestNote: 'Data export requested via API.',
          decisionNote: 'Export delivered.',
          completedAt: new Date(),
        },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_data_export',
        entityType: 'patient',
        entityId: patientId,
        description: 'Patient data export (KVKK/GDPR access request)',
        ...extractRequestMeta(req),
      });

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="patient-export-${patientId}-${Date.now()}.json"`,
      );
      res.setHeader('Content-Type', 'application/json');
      return res.json(exportData);
    } catch (err: any) {
      console.error('[patientPrivacy/export]', err?.message ?? err);
      return res.status(500).json({ error: 'Export failed. Please try again.' });
    }
  },
);

// ── POST /api/patients/:id/privacy/anonymize ──────────────────────────────────

router.post(
  '/patients/:id/privacy/anonymize',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;
    const { confirm, reason } = req.body as { confirm?: boolean; reason?: string };

    if (!confirm) {
      return res.status(400).json({
        error: 'confirm field must be true to proceed with anonymization.',
      });
    }

    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A reason is required (min 3 characters).' });
    }

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    try {
      const result = await anonymizePatientData({
        clinicId: patient.clinicId,
        patientId,
        actorUserId: user.id,
        actorRole: user.role,
        organizationId: user.organizationId,
        reason: String(reason).trim(),
      });

      if (result.alreadyAnonymized) {
        return res.status(409).json({
          error: 'Patient is already anonymized.',
          privacyRequestId: result.privacyRequestId,
        });
      }

      return res.json({
        success: true,
        patientId: result.patientId,
        privacyRequestId: result.privacyRequestId,
        message: 'Patient identity and communication PII anonymized successfully.',
      });
    } catch (err: any) {
      if (err?.status === 404) return res.status(404).json({ error: err.message });
      console.error('[patientPrivacy/anonymize]', err?.message ?? err);
      return res.status(500).json({ error: 'Anonymization failed. Please try again.' });
    }
  },
);

// ── GET /api/patients/:id/privacy/requests ────────────────────────────────────

router.get(
  '/patients/:id/privacy/requests',
  authorize([...PRIVACY_MANAGE_ROLES, 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    try {
      const requests = await prisma.patientPrivacyRequest.findMany({
        where: { patientId, clinicId: patient.clinicId },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ requests });
    } catch (err: any) {
      console.error('[patientPrivacy/requests/list]', err?.message ?? err);
      return res.status(500).json({ error: 'Failed to load privacy requests.' });
    }
  },
);

// ── POST /api/patients/:id/privacy/requests ───────────────────────────────────

router.post(
  '/patients/:id/privacy/requests',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;
    const { requestType, requestNote } = req.body as {
      requestType?: string;
      requestNote?: string;
    };

    if (!requestType || !VALID_REQUEST_TYPES.has(requestType)) {
      return res.status(400).json({
        error: `requestType must be one of: ${[...VALID_REQUEST_TYPES].join(', ')}`,
      });
    }

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // deletion_review: do not auto-delete, create a review request
    const safeDeletionNote =
      requestType === 'deletion_review'
        ? 'Silme talebi alındı. Bu işlem yasal ve idari inceleme gerektirir. Onaylanana kadar hasta kaydı silinmeyecektir. Güvenli alternatif olarak anonimleştirme önerilir.'
        : undefined;

    try {
      const created = await prisma.patientPrivacyRequest.create({
        data: {
          clinicId: patient.clinicId,
          patientId,
          requestType,
          status: 'pending',
          requestedByUserId: user.id,
          requestNote: requestNote ? String(requestNote).slice(0, 1000) : null,
          decisionNote: safeDeletionNote ?? null,
        },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId: patient.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_privacy_request_created',
        entityType: 'patient',
        entityId: patientId,
        description: `Privacy request created: ${requestType}`,
        ...extractRequestMeta(req),
      });

      return res.status(201).json({ request: created });
    } catch (err: any) {
      console.error('[patientPrivacy/requests/create]', err?.message ?? err);
      return res.status(500).json({ error: 'Failed to create privacy request.' });
    }
  },
);

// ── PATCH /api/privacy-requests/:reqId/status ────────────────────────────────

router.patch(
  '/privacy-requests/:reqId/status',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const reqId = getParam(req, 'reqId');
    const user = req.user!;
    const { status, decisionNote } = req.body as {
      status?: string;
      decisionNote?: string;
    };

    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({
        error: `status must be one of: ${[...VALID_STATUSES].join(', ')}`,
      });
    }

    try {
      // Resolve: must belong to a clinic the user can access
      const existing = await prisma.patientPrivacyRequest.findFirst({
        where: {
          id: reqId,
          clinicId: user.canAccessAllClinics
            ? undefined
            : { in: user.allowedClinicIds },
          clinic: { organizationId: user.organizationId },
        },
        select: { id: true, clinicId: true },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Privacy request not found.' });
      }

      const completedAt = status === 'completed' ? new Date() : undefined;

      const updated = await prisma.patientPrivacyRequest.update({
        where: { id: reqId },
        data: {
          status,
          handledByUserId: user.id,
          decisionNote: decisionNote ? String(decisionNote).slice(0, 2000) : undefined,
          ...(completedAt ? { completedAt } : {}),
        },
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId: existing.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_privacy_request_status_updated',
        entityType: 'patient_privacy_request',
        entityId: reqId,
        description: `Privacy request status updated to: ${status}`,
        ...extractRequestMeta(req),
      });

      return res.json({ request: updated });
    } catch (err: any) {
      console.error('[patientPrivacy/requests/status]', err?.message ?? err);
      return res.status(500).json({ error: 'Failed to update privacy request.' });
    }
  },
);

export default router;
