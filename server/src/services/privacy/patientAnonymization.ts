/**
 * patientAnonymization.ts — KVKK/GDPR Patient Anonymization Service
 *
 * Replaces patient PII with anonymized placeholders while preserving
 * all operational/legal records (appointments, payments, treatments, etc.).
 *
 * Design rules:
 * - Never hard-deletes patient row or medical/financial records.
 * - Linked communication records (ContactRequest, WhatsApp, Instagram) have
 *   their contact-identifying fields cleared.
 * - Audit log is written without full patient PII.
 * - Re-running on an already-anonymized patient is a no-op (safe idempotency).
 */

import prisma from '../../db.js';
import { writeAuditLog } from '../../utils/auditLog.js';
import { logActivity } from '../../utils/activity.js';

export type AnonymizePatientArgs = {
  clinicId: string;
  patientId: string;
  actorUserId: string;
  actorRole: string;
  organizationId: string;
  reason: string;
};

export type RedactionCounters = {
  total: number;
  redacted: number;
  skippedLegalHold: number;
  failed: number;
};

export type AnonymizePatientResult = {
  alreadyAnonymized: boolean;
  patientId: string;
  privacyRequestId: string;
  /** Per-object redaction counts for PatientAttachment rows (docs/compliance/53). */
  attachmentResults: RedactionCounters;
  /** Per-object redaction counts for ImagingImage rows (via the patient's ImagingStudy records). */
  imagingResults: RedactionCounters;
  /**
   * True if any attachment or imaging redaction failed. Callers (the privacy
   * route) MUST surface this — never report unconditional success when this
   * is true.
   */
  partialFailure: boolean;
};

const emptyCounters = (): RedactionCounters => ({
  total: 0,
  redacted: 0,
  skippedLegalHold: 0,
  failed: 0,
});

/**
 * Redacts originalName to '[ANONYMIZED]' for every PatientAttachment of the
 * patient, unless legalHold is true (legal-hold items are skipped entirely —
 * preserved as-is for legal review, not just protected from deletion) or the
 * row is already redacted (idempotent re-run). Physical file bytes are never
 * touched — fileName/filePath are already non-identifying storage keys. Each
 * row is wrapped in its own try/catch so one failure never aborts the loop.
 */
async function redactPatientAttachments(clinicId: string, patientId: string): Promise<RedactionCounters> {
  const counters = emptyCounters();
  const attachments = await prisma.patientAttachment.findMany({
    where: { clinicId, patientId },
    select: { id: true, originalName: true, legalHold: true },
  });
  counters.total = attachments.length;

  for (const attachment of attachments) {
    if (attachment.legalHold) {
      counters.skippedLegalHold++;
      continue;
    }
    if (attachment.originalName === ANON_TEXT) {
      // Already redacted — idempotent no-op, not a failure.
      continue;
    }
    try {
      await prisma.patientAttachment.update({
        where: { id: attachment.id },
        data: { originalName: ANON_TEXT },
      });
      counters.redacted++;
    } catch (err) {
      counters.failed++;
      console.error('[patientAnonymization] attachment redaction failed', attachment.id, err);
    }
  }
  return counters;
}

/**
 * Same redaction semantics as redactPatientAttachments, applied to
 * ImagingImage rows belonging to the patient's ImagingStudy records.
 * ImagingImage has no legalHold field of its own — it inherits its parent
 * study's hold (docs/compliance/53).
 */
async function redactPatientImagingImages(clinicId: string, patientId: string): Promise<RedactionCounters> {
  const counters = emptyCounters();
  const images = await prisma.imagingImage.findMany({
    where: { clinicId, study: { patientId } },
    select: { id: true, originalName: true, study: { select: { legalHold: true } } },
  });
  counters.total = images.length;

  for (const image of images) {
    if (image.study?.legalHold) {
      counters.skippedLegalHold++;
      continue;
    }
    if (image.originalName === ANON_TEXT) {
      continue;
    }
    try {
      await prisma.imagingImage.update({
        where: { id: image.id },
        data: { originalName: ANON_TEXT },
      });
      counters.redacted++;
    } catch (err) {
      counters.failed++;
      console.error('[patientAnonymization] imaging image redaction failed', image.id, err);
    }
  }
  return counters;
}

const ANON_FIRST = 'Anonim';
const ANON_LAST  = 'Hasta';
const ANON_TEXT  = '[ANONYMIZED]';

// Phone pattern: digits/spaces/dashes/parens only (no dot — avoids matching dates like 22.05.2026).
// Requires 10+ digit-bearing chars total, covering Turkish formats (+90xx, 05xx, etc.).
const ACTIVITY_PHONE_RE = /(\+?\d[\d\s\-()]{8,}\d)/g;
const ACTIVITY_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces all occurrences of the patient's identifiers in a single
 * ActivityLog description string with [ANONYMIZED].
 * Full name is replaced first to avoid double-substitution of parts.
 */
function redactActivityDescription(
  desc: string,
  firstName: string,
  lastName: string,
  phone: string | null,
  email: string | null,
): string {
  let out = desc;
  const fullName = `${firstName} ${lastName}`;
  out = out.replace(new RegExp(escapeRegExp(fullName), 'gi'), ANON_TEXT);
  if (firstName) out = out.replace(new RegExp(escapeRegExp(firstName), 'gi'), ANON_TEXT);
  if (lastName)  out = out.replace(new RegExp(escapeRegExp(lastName),  'gi'), ANON_TEXT);
  if (phone) {
    out = out.replace(new RegExp(escapeRegExp(phone), 'g'), ANON_TEXT);
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 7) out = out.replace(new RegExp(escapeRegExp(digits), 'g'), ANON_TEXT);
  }
  if (email) out = out.replace(new RegExp(escapeRegExp(email), 'gi'), ANON_TEXT);
  // Pattern-based catch-all for any remaining phone/email patterns
  out = out.replace(ACTIVITY_PHONE_RE, ANON_TEXT).replace(ACTIVITY_EMAIL_RE, ANON_TEXT);
  return out;
}

export async function anonymizePatientData(
  args: AnonymizePatientArgs,
): Promise<AnonymizePatientResult> {
  const { clinicId, patientId, actorUserId, actorRole, organizationId, reason } = args;

  // Fetch patient within clinic + org scope
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId, organizationId, deletedAt: null },
    select: { id: true, isAnonymized: true, firstName: true, lastName: true, phone: true, email: true },
  });

  if (!patient) {
    throw Object.assign(new Error('Patient not found or access denied'), { status: 404 });
  }

  if (patient.isAnonymized) {
    // Idempotent: find existing completed privacy request
    const existing = await prisma.patientPrivacyRequest.findFirst({
      where: { clinicId, patientId, requestType: 'anonymization', status: 'completed' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    // Still run the attachment/imaging redaction pass — re-running must be a
    // safe no-op (already-redacted rows are skipped, see redactPatientAttachments),
    // but a first anonymization performed before this feature shipped may not
    // have touched attachments/imaging yet.
    const attachmentResults = await redactPatientAttachments(clinicId, patientId);
    const imagingResults = await redactPatientImagingImages(clinicId, patientId);
    return {
      alreadyAnonymized: true,
      patientId,
      privacyRequestId: existing?.id ?? '',
      attachmentResults,
      imagingResults,
      partialFailure: attachmentResults.failed > 0 || imagingResults.failed > 0,
    };
  }

  // Sanitize reason
  const safeReason = reason.slice(0, 500);

  // ── 1. Anonymize patient identity fields ──────────────────────────────────
  await prisma.patient.update({
    where: { id: patientId },
    data: {
      firstName: ANON_FIRST,
      lastName: ANON_LAST,
      email: null,
      phone: null,
      dateOfBirth: null,
      address: null,
      city: null,
      postalCode: null,
      country: null,
      notes: null,
      communicationConsent: false,
      marketingConsent: false,
      isAnonymized: true,
      anonymizedAt: new Date(),
      anonymizedById: actorUserId,
      anonymizationReason: safeReason,
    },
  });

  // ── 2. ContactRequests: clear contact PII ─────────────────────────────────
  await prisma.contactRequest.updateMany({
    where: { clinicId, patientId },
    data: {
      phone: null,
      name: null,
      externalSenderId: null,
      note: null,
      lastMessage: null,
    },
  });

  // ── 3. AppointmentRequests: redact contact fields ─────────────────────────
  await prisma.appointmentRequest.updateMany({
    where: { clinicId, patientId },
    data: {
      patientName: `${ANON_FIRST} ${ANON_LAST}`,
      phone: '[ANONYMIZED]',
      email: null,
      externalSenderId: null,
      rawMessage: null,
      notes: null,
    },
  });

  // ── 4. WhatsAppConversationMessages: redact phone + rawPayload + text ─────
  await prisma.whatsAppConversationMessage.updateMany({
    where: { clinicId, patientId },
    data: {
      phone: '[ANONYMIZED]',
      text: ANON_TEXT,
      rawPayload: undefined, // Prisma will set to DbNull via updateMany
    },
  });

  // Clear rawPayload with raw query since Prisma updateMany doesn't accept DbNull
  await prisma.$executeRaw`
    UPDATE "WhatsAppConversationMessage"
    SET "rawPayload" = NULL
    WHERE "clinicId" = ${clinicId} AND "patientId" = ${patientId}
  `;

  // ── 5. WhatsAppInboxEntries: clear PII for matched patient ────────────────
  await prisma.whatsAppInboxEntry.updateMany({
    where: { clinicId, patientId },
    data: {
      displayName: null,
      lastMessageText: null,
    },
  });

  await prisma.$executeRaw`
    UPDATE "WhatsAppInboxEntry"
    SET "rawPayload" = NULL
    WHERE "clinicId" = ${clinicId} AND "patientId" = ${patientId}
  `;

  // ── 6. InstagramInboxEntries: clear PII ──────────────────────────────────
  await prisma.instagramInboxEntry.updateMany({
    where: { clinicId, patientId },
    data: {
      senderUsername: null,
      lastMessageText: null,
    },
  });

  await prisma.$executeRaw`
    UPDATE "InstagramInboxEntry"
    SET "rawPayload" = NULL
    WHERE "clinicId" = ${clinicId} AND "patientId" = ${patientId}
  `;

  // ── 7. InstagramConversationMessages: redact ──────────────────────────────
  await prisma.instagramConversationMessage.updateMany({
    where: { clinicId, patientId },
    data: {
      senderUsername: null,
      text: ANON_TEXT,
    },
  });

  await prisma.$executeRaw`
    UPDATE "InstagramConversationMessage"
    SET "rawPayload" = NULL
    WHERE "clinicId" = ${clinicId} AND "patientId" = ${patientId}
  `;

  // ── 8. Redact ActivityLog descriptions for this patient ──────────────────────
  const activityRows = await prisma.activityLog.findMany({
    where: { clinicId, patientId, description: { not: null } },
    select: { id: true, description: true },
  });

  await Promise.all(
    activityRows
      .filter((r): r is { id: string; description: string } => r.description !== null)
      .map(({ id, description }) => {
        const redacted = redactActivityDescription(
          description,
          patient.firstName,
          patient.lastName,
          patient.phone,
          patient.email,
        );
        if (redacted === description) return Promise.resolve();
        return prisma.activityLog.update({ where: { id }, data: { description: redacted } });
      }),
  );

  // ── 9. PatientAttachment metadata redaction (legal-hold skipped) ──────────
  const attachmentResults = await redactPatientAttachments(clinicId, patientId);

  // ── 10. ImagingImage metadata redaction, via patient's ImagingStudy rows ──
  const imagingResults = await redactPatientImagingImages(clinicId, patientId);

  // ── 11. Create PatientPrivacyRequest record ───────────────────────────────
  const privacyRequest = await prisma.patientPrivacyRequest.create({
    data: {
      clinicId,
      patientId,
      requestType: 'anonymization',
      status: 'completed',
      requestedByUserId: actorUserId,
      handledByUserId: actorUserId,
      requestNote: safeReason,
      decisionNote: 'Patient data anonymized by authorized staff.',
      completedAt: new Date(),
    },
    select: { id: true },
  });

  const partialFailure = attachmentResults.failed > 0 || imagingResults.failed > 0;

  // ── 12. Write audit log (no full PII) ─────────────────────────────────────
  await writeAuditLog({
    organizationId,
    clinicId,
    actorUserId,
    actorRole,
    action: 'patient_anonymized',
    entityType: 'patient',
    entityId: patientId,
    description: 'Patient identity and communication PII anonymized per KVKK/GDPR request.',
    metadata: {
      privacyRequestId: privacyRequest.id,
      reasonProvided: !!safeReason,
      attachmentResults,
      imagingResults,
      partialFailure,
    },
  });

  // ── 13. Write activity log ────────────────────────────────────────────────
  await logActivity({
    clinicId,
    userId: actorUserId,
    entityType: 'patient',
    entityId: patientId,
    patientId,
    action: 'anonymized',
    description: 'Hasta kimlik ve iletişim bilgileri anonimleştirildi.',
  });

  return {
    alreadyAnonymized: false,
    patientId,
    privacyRequestId: privacyRequest.id,
    attachmentResults,
    imagingResults,
    partialFailure,
  };
}
