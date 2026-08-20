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
  claimExportDownload,
  ExportGenerationInProgressError,
  ExportLeaseLostError,
} from '../services/privacy/patientPrivacyExportPackage.js';
import { buildDeletionReviewInventory } from '../services/privacy/deletionReviewInventory.js';
import {
  collectBridgeImagingActivityForPatient,
  mergePatientActivityHistory,
  MAX_PATIENT_ACTIVITY_HISTORY_ROWS,
} from '../services/privacy/patientActivityHistoryExport.js';
import { inspectOrphans } from '../services/privacy/orphanFileInspection.js';
import { openFileStream } from '../services/fileStorage.js';
import { safeErrorFields } from '../utils/safeError.js';
import { decryptIdentityValue } from '../utils/patientIdentityCrypto.js';

/** Header carrying the one-time export-download token (never a query param — see PR #160 review). */
const EXPORT_DOWNLOAD_TOKEN_HEADER = 'x-export-download-token';

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
        identityDocumentRows,
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
        bridgeImagingActivity,
        privacyRequests,
        emergencyContacts,
        medicalHistory,
        contactPoints,
        preservedSourceValues,
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
            // F3-DATA-MIG-TODAY-001-R10: district (ilçe) is address PII held
            // about the subject, exactly like `city` (province/il) above it.
            // Disclosed on the same basis and by the same rule.
            district: true,
            postalCode: true,
            country: true,
            patientStatus: true,
            source: true,
            notes: true,
            // F3-DATA-MIG-TODAY-001 (G-E5/G-E6): personal data held about the
            // subject, so KVKK Art. 11 / GDPR Art. 15 cover them.
            gender: true,
            chartNumber: true,
            // F3-DATA-MIG-TODAY-001-R8: KVKK Art. 6 special-category health
            // data held about the subject. Art. 11 / GDPR Art. 15 cover it
            // exactly as they cover every other field here — special-category
            // status raises the bar for PROCESSING it, and does not narrow the
            // subject's right to see what is held.
            bloodGroup: true,
            communicationConsent: true,
            marketingConsent: true,
            isAnonymized: true,
            anonymizedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        // F3-DATA-MIG-003 / G-E4: the data subject is entitled to the identity
        // number held about them, so the subject-access export carries the
        // PLAINTEXT value (this download is already step-up protected,
        // one-time-claim, 1 h TTL).
        //
        // Precisely what does and does not leave this route:
        //  - `lookupHash` is NEVER selected. It is a tenant correlation token
        //    derived for internal lookup, not data held "about" the subject,
        //    and exporting it would hand out a stable cross-record correlator.
        //  - `valueEncrypted` IS selected here because decryption needs it,
        //    but it is stripped in the mapping step below and NEVER appears in
        //    the response. The guarantee is "never present in the export", not
        //    "never read from the database" — those are different claims and
        //    only the first one is true.
        prisma.patientIdentityDocument.findMany({
          where: { patientId, clinicId, organizationId },
          select: {
            id: true,
            docType: true,
            isVerified: true,
            cryptoVersion: true,
            valueEncrypted: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
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
          // Per-source fetch cap; mergePatientActivityHistory applies the
          // authoritative final global cap (MAX_PATIENT_ACTIVITY_HISTORY_ROWS)
          // across both sources combined — see that function's doc comment.
          take: MAX_PATIENT_ACTIVITY_HISTORY_ROWS,
        }),
        // F2-IMG-AUDIT-003: bridge-linked imaging ingest events (AuditLog,
        // machine actor — see F2-IMG-AUDIT-002) surfaced into the same
        // export projection, tenant-scoped and allowlisted; see
        // patientActivityHistoryExport.ts for the full rationale.
        collectBridgeImagingActivityForPatient(patientId, clinicId, organizationId),
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
        prisma.patientEmergencyContact.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            contactType: true,
            fullName: true,
            phone: true,
            phoneCountryCode: true,
            email: true,
            occupation: true,
            isPrimary: true,
            isLegalDecisionMaker: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        }),
        // US-01.1-P1: medical history is sensitive health data and a KVKK/GDPR
        // access request must include it. Every version is exported (not just
        // the latest) — the subject access right covers the full record held,
        // and versions are immutable so none of this can go stale after export.
        prisma.patientMedicalHistory.findMany({
          where: { patientId, clinicId, organizationId },
          select: {
            id: true,
            version: true,
            recordedById: true,
            recordedAt: true,
            noKnownConditions: true,
            allergies: true,
            currentMedications: true,
            pregnancyStatus: true,
            pregnancyStartDate: true,
            createdAt: true,
            conditions: {
              select: {
                status: true,
                note: true,
                condition: { select: { code: true, category: true, nameEn: true, nameTr: true } },
              },
            },
          },
          orderBy: { version: 'desc' },
        }),
        // F3-DATA-MIG-TODAY-001-R10: secondary contact points are the
        // subject's OWN alternative phone numbers, so KVKK Art. 11 / GDPR
        // Art. 15 cover them exactly as they cover `Patient.phone`. Selected
        // explicitly (never a bare findMany) for the same reason as every
        // other read here.
        prisma.patientContactPoint.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            contactType: true,
            value: true,
            normalizedValue: true,
            label: true,
            source: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ contactType: 'asc' }, { createdAt: 'asc' }],
        }),
        // F3-DATA-MIG-TODAY-001-R10: preserved legacy source values are raw
        // personal data held ABOUT the subject (parents' names, phone
        // numbers, free text), carried over from the clinic's previous
        // system. The subject is entitled to receive them.
        //
        // `sensitivity` is DELIBERATELY NOT a filter here. It gates the
        // CLINIC BULK export (a copy handed to the clinic), not the subject's
        // own access right — withholding a RESTRICTED row from the person the
        // row is about would invert what the flag is for. Every preserved row
        // for this patient is disclosed, and `sensitivity` itself is included
        // so the subject can see how the value is classified.
        prisma.migrationPreservedSourceValue.findMany({
          where: { patientId, clinicId },
          select: {
            id: true,
            sourceSystem: true,
            sourceColumn: true,
            sourceRowNumber: true,
            value: true,
            valueType: true,
            semanticClass: true,
            sensitivity: true,
            importedAt: true,
          },
          orderBy: [{ importedAt: 'asc' }, { sourceColumn: 'asc' }],
        }),
      ]);

      // F3-DATA-MIG-003 / G-E4. Decryption is per-document and fail-SOFT: a
      // crypto failure (missing/rotated key material, corrupt ciphertext)
      // degrades that ONE document to `value: null, valueStatus:
      // 'unavailable'` instead of throwing and collapsing the whole subject
      // -access export into a 500. A KVKK Art. 11 request has a statutory
      // response deadline; denying the subject their appointments, payments
      // and medical history because one identity record cannot be decrypted
      // would be the worse failure, and the 'unavailable' marker makes the
      // gap explicit and auditable rather than silently absent. Nothing about
      // the value — not the error, not the docType, not a length — is logged:
      // the identity number is the most sensitive field in the product and no
      // log sink is an appropriate destination for anything derived from it.
      const identityDocuments = identityDocumentRows.map((doc) => {
        let value: string | null = null;
        let valueStatus: 'available' | 'unavailable' = 'available';
        try {
          value = decryptIdentityValue(doc.valueEncrypted, doc.cryptoVersion);
        } catch {
          value = null;
          valueStatus = 'unavailable';
        }
        return {
          id: doc.id,
          docType: doc.docType,
          isVerified: doc.isVerified,
          createdAt: doc.createdAt,
          value,
          valueStatus,
        };
      });

      return {
        exportedAt: new Date().toISOString(),
        exportedBy: exportedByUserId,
        dataSubject: patientFull,
        identityDocuments,
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
        activityHistory: mergePatientActivityHistory(activityLogs, bridgeImagingActivity),
        privacyRequests,
        emergencyContacts,
        medicalHistory,
        // F3-DATA-MIG-TODAY-001-R10 — see the two reads above for why each is
        // in scope for a subject-access request.
        contactPoints,
        preservedSourceValues,
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
      console.error('[patientPrivacy/export]', safeErrorFields(err));
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
      console.error('[patientPrivacy/anonymize]', safeErrorFields(err));
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
      if (err instanceof ExportGenerationInProgressError) {
        return res.status(409).json({ error: 'An export package is already being generated for this clinic. Please try again shortly.' });
      }
      if (err instanceof ExportLeaseLostError) {
        // The generated archive was already discarded by createExportPackage
        // — safe (and necessary) for the client to simply retry.
        return res.status(503).json({ error: 'Export package generation lost its lock and was discarded. Please try again.' });
      }
      console.error('[patientPrivacy/export-package]', {
        operation: 'export-package-create',
        patientId,
        ...safeErrorFields(err),
      });
      return res.status(500).json({ error: 'Export package generation failed. Please try again.' });
    }
  },
);

// ── GET /api/patients/:id/privacy/export-package/:exportId/download ──────────
// Token-gated download. The one-time token MUST be sent via the
// X-Export-Download-Token header — never a query parameter (query strings
// land in access/proxy logs and browser history). Validates clinic/org/
// patient scope + token hash + expiry, opens the file stream, THEN
// atomically claims the download (closing the concurrent-replay window)
// before piping to the response. Writes three distinct audit events:
//   - patient_data_export_package_download_started   (token claimed)
//   - patient_data_export_package_downloaded          (stream completed)
//   - patient_data_export_package_download_failed     (stream error/abort)
// The raw token itself is never logged/audited anywhere in this route.

router.get(
  '/patients/:id/privacy/export-package/:exportId/download',
  authorize(PRIVACY_MANAGE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'id');
    const exportId = getParam(req, 'exportId');
    const token = String(req.headers[EXPORT_DOWNLOAD_TOKEN_HEADER] ?? '');
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
        const reason = validation.failure ?? 'not_found';
        const status = reason === 'already_downloaded' ? 409 : 404;
        return res.status(status).json({ error: 'Export package not available for download', reason });
      }

      // Confirm the file can actually be opened BEFORE claiming the
      // download, so a storage-layer failure doesn't burn the one-time
      // token for a download that never happened.
      const stream = await openFileStream(validation.archive.storageKey);
      if (!stream) return res.status(404).json({ error: 'Export package file missing in storage', reason: 'not_found' });

      const claim = await claimExportDownload(validation.archive.id);
      if (!claim.claimed) {
        // Lost the race to a concurrent request — distinct code, no file served.
        return res.status(409).json({ error: 'Export package already downloaded', reason: 'already_downloaded' });
      }

      await writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'patient_data_export_package_download_started',
        entityType: 'patient',
        entityId: patientId,
        description: 'Patient data export package (ZIP) download claimed (KVKK/GDPR access request)',
        metadata: { exportId },
        ...extractRequestMeta(req),
      });

      res.setHeader('Content-Disposition', `attachment; filename="patient-export-${patientId}.zip"`);
      res.setHeader('Content-Type', 'application/zip');

      let outcomeLogged = false;
      const logOutcome = async (action: string, description: string, extra?: Record<string, unknown>) => {
        if (outcomeLogged) return;
        outcomeLogged = true;
        try {
          await writeAuditLog({
            organizationId: user.organizationId,
            clinicId,
            actorUserId: user.id,
            actorRole: user.role,
            action,
            entityType: 'patient',
            entityId: patientId,
            description,
            metadata: { exportId, ...extra },
            ...extractRequestMeta(req),
          });
        } catch (auditErr) {
          console.error('[patientPrivacy/export-package/download] audit log failed', {
            operation: 'download-audit-log',
            exportId,
            ...safeErrorFields(auditErr),
          });
        }
      };

      stream.on('error', (streamErr) => {
        console.error('[patientPrivacy/export-package/download] stream error', {
          operation: 'download-stream',
          exportId,
          ...safeErrorFields(streamErr),
        });
        void logOutcome(
          'patient_data_export_package_download_failed',
          'Patient data export package (ZIP) download failed mid-stream (KVKK/GDPR access request)',
          { reason: 'stream_error' },
        );
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download export package' });
        else res.destroy();
      });
      res.on('close', () => {
        // Client disconnected before the response finished — 'end' will not
        // fire in that case, so record it as interrupted rather than silently
        // treating an aborted download as a successful one.
        if (!outcomeLogged) {
          void logOutcome(
            'patient_data_export_package_download_failed',
            'Patient data export package (ZIP) download interrupted (client disconnected)',
            { reason: 'interrupted' },
          );
        }
      });
      stream.on('end', () => {
        void logOutcome(
          'patient_data_export_package_downloaded',
          'Patient data export package (ZIP) downloaded (KVKK/GDPR access request)',
        );
      });
      stream.pipe(res as any);
    } catch (err: any) {
      console.error('[patientPrivacy/export-package/download]', {
        operation: 'download',
        exportId,
        ...safeErrorFields(err),
      });
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

// NOTE: POST /patients/:id/privacy/deletion-review/execute (live delete of
// non-legal-hold PatientAttachment rows) has been REMOVED per PR #160 review
// (unsafe blanket classification, no privacy-request-workflow binding, no
// dry-run-snapshot requirement). This PR ships dry-run inventory only — see
// GET /patients/:id/privacy/deletion-review below and
// docs/compliance/53-kvkk-attachment-imaging-lifecycle.md for the deferred
// follow-up (lifecycle-category enum + workflow-bound execute endpoint).

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
      console.error('[patientPrivacy/requests/create]', safeErrorFields(err));
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
      console.error('[patientPrivacy/requests/status]', safeErrorFields(err));
      return res.status(500).json({ error: 'Failed to update privacy request.' });
    }
  },
);

export default router;
