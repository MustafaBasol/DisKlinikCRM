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
import {
  createExportPackage,
  validateExportDownloadToken,
  markExportDownloaded,
} from '../services/privacy/patientPrivacyExportPackage.js';
import { buildDeletionReviewInventory } from '../services/privacy/deletionReviewInventory.js';
import { inspectOrphans } from '../services/privacy/orphanFileInspection.js';
import { openFileStream, deleteFile } from '../services/fileStorage.js';

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

// ── Shared structured-export data collection (used by /export and /export-package) ──

async function collectStructuredExportData(
  patientId: string,
  clinicId: string,
  organizationId: string,
  exportedByUserId: string,
) {
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
          where: { id: patientId, clinicId, organizationId },
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

      return {
        exportedAt: new Date().toISOString(),
        exportedBy: exportedByUserId,
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
      const exportData = await collectStructuredExportData(patientId, clinicId, user.organizationId, user.id);

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
          attachmentResults: result.attachmentResults,
          imagingResults: result.imagingResults,
          partialFailure: result.partialFailure,
        });
      }

      // Never claim unconditional success when a per-object attachment or
      // imaging redaction failed — the caller (UI) must surface this.
      return res.json({
        success: !result.partialFailure,
        partialFailure: result.partialFailure,
        patientId: result.patientId,
        privacyRequestId: result.privacyRequestId,
        attachmentResults: result.attachmentResults,
        imagingResults: result.imagingResults,
        message: result.partialFailure
          ? 'Patient identity and communication PII anonymized, but some attachment/imaging metadata redactions failed — see attachmentResults/imagingResults.'
          : 'Patient identity and communication PII anonymized successfully.',
      });
    } catch (err: any) {
      if (err?.status === 404) return res.status(404).json({ error: err.message });
      console.error('[patientPrivacy/anonymize]', err?.message ?? err);
      return res.status(500).json({ error: 'Anonymization failed. Please try again.' });
    }
  },
);

// ── POST /api/patients/:id/privacy/export-package ─────────────────────────────
// KVKK lifecycle (docs/compliance/53): builds a downloadable ZIP (structured
// JSON + attachment files + manifest w/ sha256 hashes) and returns a one-time
// download token — never the storage key/path itself.

router.post(
  '/patients/:id/privacy/export-package',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const clinicId = patient.clinicId;

    try {
      const structuredData = await collectStructuredExportData(patientId, clinicId, user.organizationId, user.id);

      const result = await createExportPackage({
        clinicId,
        organizationId: user.organizationId,
        patientId,
        requestedByUserId: user.id,
        structuredData,
      });

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_data_export_package_created',
        entityType: 'patient',
        entityId: patientId,
        description: 'Patient data export package (ZIP) generated (KVKK/GDPR access request)',
        metadata: {
          exportId: result.exportId,
          includedFileCount: result.manifest.includedFiles.length,
          missingFileCount: result.manifest.missingFiles.length,
        },
        ...extractRequestMeta(req),
      });

      // Only the one-time token + expiry are returned — never the storage key.
      return res.status(201).json({
        exportId: result.exportId,
        downloadToken: result.downloadToken,
        expiresAt: result.expiresAt,
        manifest: result.manifest,
      });
    } catch (err: any) {
      console.error('[patientPrivacy/export-package]', err?.message ?? err);
      return res.status(500).json({ error: 'Export package generation failed. Please try again.' });
    }
  },
);

// ── GET /api/patients/:id/privacy/export-package/:exportId/download ──────────
// Token-gated download — validates clinic/org/patient scope + token hash +
// expiry before streaming. Sets downloadedAt and audit-logs the download (no
// patient name/phone/email/file content in the log).

router.get(
  '/patients/:id/privacy/export-package/:exportId/download',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const exportId = getParam(req, 'exportId');
    const token = String(req.query.token ?? '');
    const user = req.user!;

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const clinicId = patient.clinicId;

    try {
      const validation = await validateExportDownloadToken({
        clinicId,
        organizationId: user.organizationId,
        patientId,
        exportId,
        token,
      });

      if (!validation.ok || !validation.archive) {
        return res.status(404).json({ error: 'Export package not found or expired' });
      }

      const stream = await openFileStream(validation.archive.storageKey);
      if (!stream) return res.status(404).json({ error: 'Export package file missing in storage' });

      await markExportDownloaded(validation.archive.id);
      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_data_export_package_downloaded',
        entityType: 'patient',
        entityId: patientId,
        description: 'Patient data export package (ZIP) downloaded (KVKK/GDPR access request)',
        metadata: { exportId },
        ...extractRequestMeta(req),
      });

      res.setHeader('Content-Disposition', `attachment; filename="patient-export-${patientId}.zip"`);
      res.setHeader('Content-Type', 'application/zip');
      stream.on('error', (streamErr) => {
        console.error('[patientPrivacy/export-package/download] stream error:', streamErr?.message ?? streamErr);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download export package' });
        else res.destroy();
      });
      stream.pipe(res as any);
    } catch (err: any) {
      console.error('[patientPrivacy/export-package/download]', err?.message ?? err);
      return res.status(500).json({ error: 'Download failed. Please try again.' });
    }
  },
);

// ── GET /api/patients/:id/privacy/deletion-review ─────────────────────────────
// Dry-run only — never writes to the database (docs/compliance/53).

router.get(
  '/patients/:id/privacy/deletion-review',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    try {
      const inventory = await buildDeletionReviewInventory({
        clinicId: patient.clinicId,
        patientId,
        organizationId: user.organizationId,
      });
      return res.json(inventory);
    } catch (err: any) {
      console.error('[patientPrivacy/deletion-review]', err?.message ?? err);
      return res.status(500).json({ error: 'Failed to build deletion-review inventory.' });
    }
  },
);

// ── POST /api/patients/:id/privacy/deletion-review/execute ───────────────────
// Narrow-scope live delete: ONLY non-legal-hold PatientAttachment rows.
// Never touches imaging/clinical records. Idempotent — safe to call twice.

router.post(
  '/patients/:id/privacy/deletion-review/execute',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;
    const { confirm, reason } = req.body as { confirm?: boolean; reason?: string };

    if (!confirm) {
      return res.status(400).json({ error: 'confirm field must be true to proceed with deletion.' });
    }
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A reason is required (min 3 characters).' });
    }

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const clinicId = patient.clinicId;

    try {
      const deletable = await prisma.patientAttachment.findMany({
        where: { clinicId, patientId, legalHold: false },
        select: { id: true, filePath: true, originalName: true },
      });

      const results: { id: string; status: 'deleted' | 'failed'; error?: string }[] = [];
      for (const attachment of deletable) {
        try {
          await prisma.patientAttachment.delete({ where: { id: attachment.id } });
          await deleteFile(attachment.filePath).catch((delErr) => {
            console.error('[patientPrivacy/deletion-review/execute] storage delete error:', delErr?.message ?? delErr);
          });
          results.push({ id: attachment.id, status: 'deleted' });
        } catch (err: any) {
          results.push({ id: attachment.id, status: 'failed', error: err?.message ?? 'unknown error' });
        }
      }

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_deletion_review_executed',
        entityType: 'patient',
        entityId: patientId,
        description: 'Deletion-review executed: non-legal-hold PatientAttachment rows deleted per KVKK request.',
        metadata: {
          reasonProvided: !!reason,
          deletedCount: results.filter((r) => r.status === 'deleted').length,
          failedCount: results.filter((r) => r.status === 'failed').length,
        },
        ...extractRequestMeta(req),
      });

      return res.json({
        success: true,
        deletedCount: results.filter((r) => r.status === 'deleted').length,
        failedCount: results.filter((r) => r.status === 'failed').length,
        results,
      });
    } catch (err: any) {
      console.error('[patientPrivacy/deletion-review/execute]', err?.message ?? err);
      return res.status(500).json({ error: 'Deletion-review execution failed. Please try again.' });
    }
  },
);

// ── GET /api/patients/:id/privacy/orphan-check ────────────────────────────────
// Patient-scoped, bounded, dry-run only (docs/compliance/53).

router.get(
  '/patients/:id/privacy/orphan-check',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const user = req.user!;

    const patient = await resolvePatient(patientId, user);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    try {
      const result = await inspectOrphans({ clinicId: patient.clinicId, patientId });
      return res.json(result);
    } catch (err: any) {
      console.error('[patientPrivacy/orphan-check]', err?.message ?? err);
      return res.status(500).json({ error: 'Orphan check failed. Please try again.' });
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
