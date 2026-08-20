/**
 * patientAnonymization.ts — KVKK/GDPR Patient Anonymization Service
 *
 * Replaces patient PII with anonymized placeholders while preserving
 * all operational/legal records (appointments, payments, treatments, etc.).
 *
 * Design rules:
 * - Never hard-deletes patient row or medical/financial records.
 * - Three children are hard-deleted, and only three, each because the row
 *   carries NO clinical, financial or audit value once the patient is
 *   anonymized: PatientIdentityDocument (pure identifier), PatientContactPoint
 *   (the patient's own secondary phone numbers) and
 *   MigrationPreservedSourceValue (raw legacy PII kept only as import
 *   evidence). See deletePatientIdentityDocuments / deletePatientContactPoints
 *   / deletePatientPreservedSourceValues below.
 * - Linked communication records (ContactRequest, WhatsApp, Instagram) have
 *   their contact-identifying fields cleared.
 * - Audit log is written without full patient PII.
 * - Re-running on an already-anonymized patient is a no-op (safe idempotency).
 */

import prisma from '../../db.js';
import { writeAuditLog } from '../../utils/auditLog.js';
import { logActivity } from '../../utils/activity.js';
import { safeErrorFields } from '../../utils/safeError.js';
import {
  getImagesForLifecycleReview,
  redactForAnonymization,
  ImagingLegalHoldViolationError,
} from '../imaging/public.js';

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
   * F3-DATA-MIG-003 / G-E4. Number of PatientIdentityDocument rows HARD
   * DELETED for this patient. 0 on a patient that never had one, and 0 on an
   * idempotent re-run (the first run already destroyed them).
   */
  identityDocumentsDeleted: number;
  /**
   * F3-DATA-MIG-TODAY-001-R10. Number of PatientContactPoint rows HARD
   * DELETED for this patient. 0 on a patient that never had one, and 0 on an
   * idempotent re-run.
   */
  contactPointsDeleted: number;
  /**
   * F3-DATA-MIG-TODAY-001-R10. Number of MigrationPreservedSourceValue rows
   * HARD DELETED for this patient. 0 on a patient that was never migrated,
   * and 0 on an idempotent re-run.
   */
  preservedSourceValuesDeleted: number;
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
      console.error('[patientAnonymization] attachment redaction failed', attachment.id, safeErrorFields(err));
    }
  }
  return counters;
}

/**
 * Same redaction semantics as redactPatientAttachments, applied to
 * ImagingImage rows belonging to the patient's ImagingStudy records — via
 * ImagingLifecyclePort (F2-STAGE3-IMPL-001), not direct Prisma access.
 * ImagingImage has no legalHold field of its own — it inherits its parent
 * study's hold (docs/compliance/53), which the port's DTO already surfaces.
 *
 * Legal-hold caller-side adapter: ImagingLifecyclePort.redactForAnonymization
 * throws ImagingLegalHoldViolationError for a held image rather than silently
 * skipping it (the port never mutates a held image), so this caller checks
 * the DTO's `legalHold` flag itself and never calls the port for those rows —
 * preserving the pre-migration skip/count semantics instead of surfacing a
 * new failure. The same error is also caught around the port call itself, as
 * a defense against a legal hold acquired in the race window between the
 * lifecycle-review read and the redact call (the port's write-time recheck
 * catches that race; pre-migration direct-Prisma code had no such recheck).
 *
 * Counter fidelity (F2-STAGE3-IMPL-001-R1): redactForAnonymization returns a
 * `{ changed: boolean }` mutation outcome (not lifecycle read-state, no
 * PII/PHI) precisely so this caller can restore the pre-migration counter
 * semantics that the port's original void-returning contract could not
 * express — `redacted` is incremented only when THIS port call returns
 * `changed: true`, i.e. only when THIS call itself actually flipped an
 * unredacted row via its own atomic originalName CAS. If a concurrent writer
 * races this call and wins (its own CAS flips the row first), this call's
 * CAS matches zero rows and returns `changed: false`, so it does NOT
 * increment this caller's `redacted` counter — the winning writer's own call
 * is the one that observes `changed: true` and increments its own counters.
 * A row that was already redacted by an earlier run resolves without
 * throwing but with `changed: false`, and is correctly excluded from
 * `redacted` on an idempotent re-run, exactly as the old
 * `originalName === ANON_TEXT` pre-check excluded it. `total`/
 * `skippedLegalHold`/`failed` semantics are unaffected. See
 * F2-STAGE3-IMPL-001-R1 evidence doc.
 */
async function redactPatientImagingImages(clinicId: string, patientId: string): Promise<RedactionCounters> {
  const counters = emptyCounters();
  const images = await getImagesForLifecycleReview(clinicId, patientId);
  counters.total = images.length;

  for (const image of images) {
    if (image.legalHold) {
      counters.skippedLegalHold++;
      continue;
    }
    try {
      const outcome = await redactForAnonymization(clinicId, image.id, 'anonymization');
      if (outcome.changed) counters.redacted++;
    } catch (err) {
      if (err instanceof ImagingLegalHoldViolationError) {
        counters.skippedLegalHold++;
        continue;
      }
      counters.failed++;
      console.error('[patientAnonymization] imaging image redaction failed', image.id, safeErrorFields(err));
    }
  }
  return counters;
}

/**
 * US-01.1-P1 (medical history): unlike attachments/imaging/emergency
 * contacts, medical history rows are IMMUTABLE VERSIONS that must never be
 * deleted or have their clinical/structural fields altered — deleting or
 * rewriting a past version would falsify the clinical record the versioning
 * system exists to protect. Anonymization here is narrower and specific:
 * only the two FREE-TEXT fields that can carry incidental PII (a staff
 * member writing a patient's name/phone into a free-text note, for example)
 * are cleared to null, on every existing version — never a new version, and
 * never the coded/structured fields (version number, recordedAt,
 * recordedById, noKnownConditions, pregnancyStatus, pregnancyStartDate, or
 * any PatientCondition.status/conditionId link). This preserves the
 * clinical/audit shape of the history (how many versions existed, when,
 * what conditions were coded) while removing the only fields capable of
 * holding free-form identifying text. Idempotent by construction
 * (updateMany onto already-null fields is a safe no-op) — no separate
 * "already redacted" check is needed, unlike redactPatientAttachments/
 * redactPatientImagingImages, which mutate a required (NOT NULL) column and
 * so need a sentinel to detect a prior run.
 */
async function redactPatientMedicalHistory(clinicId: string, patientId: string): Promise<void> {
  await prisma.patientMedicalHistory.updateMany({
    where: { clinicId, patientId },
    data: { allergies: null, currentMedications: null },
  });
  await prisma.patientCondition.updateMany({
    where: { clinicId, patientId },
    data: { note: null },
  });
}

/**
 * F3-DATA-MIG-003 / G-E4 (PatientIdentityDocument): HARD DELETE, not redaction.
 *
 * Every other pass in this service preserves the row and clears the
 * identifying fields, because the row itself carries clinical, financial or
 * audit value that KVKK/GDPR anonymization must not destroy (medical history
 * versions, attachments, imaging metadata). A national/travel identity number
 * has NO such value: it is a pure identifier, never a clinical fact, so there
 * is nothing left to preserve once the patient is anonymized. It is therefore
 * destroyed outright rather than nulled or redacted — and destroying the
 * ciphertext also removes the only artifact a future key compromise could
 * retroactively unlock.
 *
 * Under the child-model design this is ONE reviewable deleteMany. Had
 * valueEncrypted/lookupHash/cryptoVersion been Patient scalars, they would
 * have become three more keys in the hand-enumerated deny-list payload below —
 * a list this sprint demonstrably drifted (gender/chartNumber were silently
 * absent from it, from the KVKK export and from the bulk export allow-list
 * simultaneously).
 *
 * Scoped by patientId ALONE, deliberately: the patient row was already
 * resolved under clinicId + organizationId scope by the caller, and adding
 * clinicId here would fail OPEN — an identity document whose clinicId drifted
 * from the patient's (e.g. after a branch transfer) would silently survive
 * anonymization. Idempotent by construction: a second run deletes 0 rows.
 */
async function deletePatientIdentityDocuments(patientId: string): Promise<number> {
  const { count } = await prisma.patientIdentityDocument.deleteMany({ where: { patientId } });
  return count;
}

/**
 * F3-DATA-MIG-TODAY-001-R10 (PatientContactPoint): HARD DELETE, not redaction.
 *
 * These rows ARE the patient's own alternative phone numbers (home/work/other)
 * and nothing else. Unlike PatientEmergencyContact — whose row is preserved
 * because `isPrimary`/`isLegalDecisionMaker` encode a clinically meaningful
 * fact about who may decide for the patient — a contact point carries no
 * clinical, financial or audit fact at all: strip `value`/`normalizedValue`/
 * `label` and what remains is an empty shell asserting only "this patient once
 * had a second number", which is itself a (weak) quasi-identifier and of no
 * use to anyone. Preserving it would keep the row count and destroy the
 * content — the worst of both. So the row goes.
 *
 * Ordering follows the identity-document precedent exactly: this runs BEFORE
 * the patient row is flipped to `isAnonymized = true`, so a failure at any
 * later step leaves `isAnonymized = false` and the whole sequence is retried,
 * rather than leaving a row that CLAIMS to be anonymized while still holding
 * live phone numbers.
 *
 * Scoped by patientId ALONE, deliberately, for the same reason as
 * deletePatientIdentityDocuments: the patient was already resolved under
 * clinicId + organizationId scope by the caller, and adding clinicId here
 * would fail OPEN — a contact point whose clinicId drifted from the patient's
 * (e.g. after a branch transfer) would silently survive anonymization.
 * Idempotent by construction: a second run deletes 0 rows.
 */
async function deletePatientContactPoints(patientId: string): Promise<number> {
  const { count } = await prisma.patientContactPoint.deleteMany({ where: { patientId } });
  return count;
}

/**
 * F3-DATA-MIG-TODAY-001-R10 (MigrationPreservedSourceValue): HARD DELETE.
 *
 * Preserved source values are the raw cells of the clinic's PREVIOUS system,
 * kept verbatim with provenance because they had no canonical destination —
 * parents' names, extra phone numbers, free text. They are import EVIDENCE,
 * explicitly never current clinical truth (nothing in the product may branch
 * on them), so anonymization's "preserve the operational record" rule does not
 * apply: there is no operational record here to preserve, only unstructured
 * legacy PII. Leaving these rows behind would void the anonymization guarantee
 * outright — the patient's name, parents and phone numbers would still be
 * readable from a table nobody thinks to look at.
 *
 * Redaction is not an option either: the value column is the whole row, and a
 * preserved value with its value cleared is provenance pointing at nothing.
 *
 * Same ordering discipline and same `patientId`-only scoping as
 * deletePatientIdentityDocuments/deletePatientContactPoints above — see those
 * for the full rationale. Idempotent: a second run deletes 0 rows.
 */
async function deletePatientPreservedSourceValues(patientId: string): Promise<number> {
  const { count } = await prisma.migrationPreservedSourceValue.deleteMany({ where: { patientId } });
  return count;
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
    // Same reason the passes below are re-run: an anonymization performed
    // before gender/chartNumber (F3-DATA-MIG-TODAY-001, G-E5/G-E6) or
    // bloodGroup (R8) or district (R10) were added to this payload never nulled them, and the isAnonymized guard above means the
    // main patient.update() block never runs again to backfill them. Blind and
    // idempotent — nulling an already-null column is a no-op.
    await prisma.patient.updateMany({
      where: { id: patientId, clinicId },
      data: { gender: null, chartNumber: null, bloodGroup: null, district: null },
    });
    // Still run the attachment/imaging/emergency-contact redaction passes —
    // re-running must be a safe no-op (already-redacted rows are skipped, see
    // redactPatientAttachments; the emergency-contact updateMany is
    // idempotent by construction), but a first anonymization performed before
    // these features shipped may not have touched them yet.
    const attachmentResults = await redactPatientAttachments(clinicId, patientId);
    const imagingResults = await redactPatientImagingImages(clinicId, patientId);
    await prisma.patientEmergencyContact.updateMany({
      where: { clinicId, patientId },
      data: { fullName: ANON_TEXT, phone: null, phoneCountryCode: null, email: null, occupation: null },
    });
    await redactPatientMedicalHistory(clinicId, patientId);
    // Same reason the passes above are re-run: an anonymization performed
    // before identity documents shipped never destroyed them. Deletes 0 rows
    // on a patient the current code path already handled.
    const identityDocumentsDeleted = await deletePatientIdentityDocuments(patientId);
    // F3-DATA-MIG-TODAY-001-R10, same reason again: a patient anonymized
    // before secondary contact points and preserved legacy source values
    // existed still holds both, and the isAnonymized guard means the main
    // block never runs to destroy them. Both deletes are idempotent and
    // delete 0 rows on a patient the current code path already handled.
    const contactPointsDeleted = await deletePatientContactPoints(patientId);
    const preservedSourceValuesDeleted = await deletePatientPreservedSourceValues(patientId);
    return {
      alreadyAnonymized: true,
      patientId,
      privacyRequestId: existing?.id ?? '',
      attachmentResults,
      imagingResults,
      identityDocumentsDeleted,
      contactPointsDeleted,
      preservedSourceValuesDeleted,
      partialFailure: attachmentResults.failed > 0 || imagingResults.failed > 0,
    };
  }

  // Sanitize reason
  const safeReason = reason.slice(0, 500);

  // ── 0. PatientIdentityDocument: HARD DELETE, BEFORE the patient is marked ─
  // F3-DATA-MIG-TODAY-001. Ordering here is deliberate and load-bearing.
  //
  // This function is a sequence of independent Prisma calls, not one
  // transaction (wrapping ~15 operations across many models, including raw
  // SQL, in a single transaction is a separate change with its own risk).
  // Given that, the ORDER decides what a mid-way failure leaves behind.
  //
  // Deleting the encrypted national identity FIRST means a failure at any
  // later step leaves `isAnonymized = false`: the request is reported as
  // failed and a retry re-runs the whole sequence. Doing it after the patient
  // update would mean a failure between the two leaves a row that CLAIMS to
  // be anonymized while still holding a decryptable T.C. Kimlik No — the one
  // outcome this whole boundary exists to prevent.
  //
  // `deleteMany` is idempotent, so re-running costs nothing. The
  // already-anonymized branch above performs the same delete, which is what
  // repairs rows anonymized before this field existed.
  const identityDocumentsDeleted = await deletePatientIdentityDocuments(patientId);

  // ── 0b. PatientContactPoint: HARD DELETE, BEFORE the patient is marked ────
  // F3-DATA-MIG-TODAY-001-R10. Same ordering rationale as step 0 above, and
  // for the same reason: these rows hold live phone numbers, so a failure
  // between this delete and the patient update must leave `isAnonymized =
  // false` and force a full retry — never a row that claims to be anonymized
  // while its secondary numbers are still readable. See
  // deletePatientContactPoints for why the row is destroyed rather than
  // redacted, and why it is scoped by patientId alone.
  const contactPointsDeleted = await deletePatientContactPoints(patientId);

  // ── 0c. MigrationPreservedSourceValue: HARD DELETE, BEFORE the mark ───────
  // F3-DATA-MIG-TODAY-001-R10. Raw legacy PII kept only as import evidence.
  // Identical ordering discipline to steps 0 and 0b — see
  // deletePatientPreservedSourceValues for why leaving these rows behind
  // would void the anonymization guarantee outright.
  const preservedSourceValuesDeleted = await deletePatientPreservedSourceValues(patientId);

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
      // F3-DATA-MIG-TODAY-001-R10: district (ilçe) is address PII and a
      // sharper quasi-identifier than `city` above it — a province holds
      // millions of people, a district thousands, so retaining it while
      // nulling everything else would materially narrow a re-identification
      // search against the surviving operational record. Nulled on exactly
      // the same basis as city/postalCode/address.
      district: null,
      postalCode: null,
      country: null,
      notes: null,
      // F3-DATA-MIG-TODAY-001 (G-E5): demographic PII, and a quasi-identifier
      // that narrows a re-identification search alongside the surviving
      // operational record. NULL is already its "not recorded" state, so
      // nulling loses no distinguishable information.
      gender: null,
      // F3-DATA-MIG-TODAY-001 (G-E6): the number written on the clinic's
      // PAPER chart, which still bears the patient's name. Leaving it here
      // would make the anonymized row directly re-identifiable by anyone with
      // access to the physical archive — the strongest re-identification
      // vector among these fields, despite looking like an innocuous internal
      // reference.
      chartNumber: null,
      // F3-DATA-MIG-TODAY-001-R8: KVKK Art. 6 special-category HEALTH data,
      // and a quasi-identifier — ABO/Rh partitions a population into eight
      // buckets, so retaining it materially narrows a re-identification search
      // against the surviving operational record. Anonymization preserves
      // OPERATIONAL history, not the patient's clinical attributes, and no
      // operational query in this product reads bloodGroup. NULL is already
      // its "not recorded" state, so nulling destroys no distinguishable
      // information beyond the datum itself.
      bloodGroup: null,
      // primaryPractitionerId is DELIBERATELY NOT nulled: it identifies a
      // STAFF member, not the patient, so clearing it reduces patient
      // re-identification risk by nothing while destroying clinically and
      // operationally relevant history (who treated this case, practitioner
      // workload/earnings attribution). Anonymization preserves operational
      // records by design — see this file's header.
      communicationConsent: false,
      marketingConsent: false,
      isAnonymized: true,
      anonymizedAt: new Date(),
      anonymizedById: actorUserId,
      anonymizationReason: safeReason,
    },
  });

  // (Identity documents, secondary contact points and preserved legacy source
  // values were hard-deleted in steps 0/0b/0c, before the patient was marked
  // anonymized — see the ordering rationale there.)

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

  // ── 8. PatientEmergencyContact (US-01.2): clear PII fields ────────────────
  // fullName cannot be null (NOT NULL, and the create/update API requires a
  // non-empty value) so it is redacted to the shared ANON_TEXT placeholder,
  // matching the convention used for other NOT-NULL text fields above
  // (AppointmentRequest.phone, WhatsAppConversationMessage.text). isPrimary/
  // isLegalDecisionMaker flags and the row itself are preserved — only the
  // identifying fields are cleared.
  await prisma.patientEmergencyContact.updateMany({
    where: { clinicId, patientId },
    data: {
      fullName: ANON_TEXT,
      phone: null,
      phoneCountryCode: null,
      email: null,
      occupation: null,
    },
  });

  // ── 8b. PatientMedicalHistory (US-01.1-P1): redact free text only ────────
  await redactPatientMedicalHistory(clinicId, patientId);

  // ── 9. Redact ActivityLog descriptions for this patient ──────────────────────
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

  // ── 10. PatientAttachment metadata redaction (legal-hold skipped) ─────────
  const attachmentResults = await redactPatientAttachments(clinicId, patientId);

  // ── 11. ImagingImage metadata redaction, via patient's ImagingStudy rows ──
  const imagingResults = await redactPatientImagingImages(clinicId, patientId);

  // ── 12. Create PatientPrivacyRequest record ───────────────────────────────
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

  // ── 13. Write audit log (no full PII) ─────────────────────────────────────
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
      // Count only — never the identifier, never its docType/value.
      identityDocumentsDeleted,
      // Counts only — never the phone number, never the preserved value, and
      // never the vendor column name it came from.
      contactPointsDeleted,
      preservedSourceValuesDeleted,
      partialFailure,
    },
  });

  // ── 14. Write activity log ────────────────────────────────────────────────
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
    identityDocumentsDeleted,
    contactPointsDeleted,
    preservedSourceValuesDeleted,
    partialFailure,
  };
}
