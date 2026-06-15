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

export type AnonymizePatientResult = {
  alreadyAnonymized: boolean;
  patientId: string;
  privacyRequestId: string;
};

const ANON_FIRST = 'Anonim';
const ANON_LAST  = 'Hasta';
const ANON_TEXT  = '[ANONYMIZED]';

export async function anonymizePatientData(
  args: AnonymizePatientArgs,
): Promise<AnonymizePatientResult> {
  const { clinicId, patientId, actorUserId, actorRole, organizationId, reason } = args;

  // Fetch patient within clinic + org scope
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId, organizationId, deletedAt: null },
    select: { id: true, isAnonymized: true },
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
    return {
      alreadyAnonymized: true,
      patientId,
      privacyRequestId: existing?.id ?? '',
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

  // ── 8. Create PatientPrivacyRequest record ────────────────────────────────
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

  // ── 9. Write audit log (no full PII) ──────────────────────────────────────
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
    },
  });

  // ── 10. Write activity log ────────────────────────────────────────────────
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
  };
}
