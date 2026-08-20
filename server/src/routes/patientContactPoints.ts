/**
 * patientContactPoints.ts — F3-DATA-MIG-TODAY-001-R10: SECONDARY patient phone
 * numbers (PatientContactPoint).
 *
 * Endpoints:
 *   GET    /api/patients/:patientId/contact-points
 *   POST   /api/patients/:patientId/contact-points
 *   PUT    /api/patients/:patientId/contact-points/:contactPointId
 *   DELETE /api/patients/:patientId/contact-points/:contactPointId
 *
 * WHY THIS EXISTS
 *   `Patient.phone` is, and remains, the ONE primary number for a patient.
 *   Real clinic data routinely carries a second/third number (TEL2, "iş",
 *   "yazlık") that previously had nowhere to go: overwriting `Patient.phone`
 *   would destroy the primary, and appending to it would produce a value that
 *   is no longer a phone number. PatientContactPoint is the additive home for
 *   those extra numbers.
 *
 * TWO INVARIANTS THIS FILE MUST NEVER BREAK
 *   1. NOTHING here reads, writes, or otherwise touches `Patient.phone`. There
 *      is no `prisma.patient.update` anywhere in this file — a contact-point
 *      create/update/delete can never modify the patient row. (Asserted in
 *      server/src/tests/patientContactPoints.test.ts.)
 *   2. A contact point is NEVER a patient-matching key. Patient lookup /
 *      duplicate detection / WhatsApp-inbox binding all match on
 *      `Patient.phone` only (see routes/patients.ts check-phone-duplicate and
 *      routes/whatsappInbox.ts). `normalizedValue` below exists for DISPLAY
 *      and for hinting duplicates WITHIN one patient — never as a lookup key
 *      across patients. See the PatientContactPoint doc comment in
 *      prisma/schema.prisma.
 *
 * Security (mirrors routes/patientEmergencyContacts.ts, the nearest sibling):
 *   - Role matrix mirrors PUT /api/patients/:id (routes/patients.ts):
 *     OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST. BILLING is
 *     intentionally excluded — a patient's phone numbers are contact PII, not
 *     a billing concern.
 *   - The patient is ALWAYS re-resolved from the DB within org + clinic scope
 *     (resolvePatientScope below); `clinicId`/`organizationId` for every write
 *     are taken from the RESOLVED PATIENT ROW, never from the request body.
 *     DENTIST is further restricted to patients they have an appointment or
 *     treatment case with, same as GET/PUT /api/patients/:id.
 *   - A contact-point row is always re-fetched scoped to (id, patientId,
 *     clinicId, organizationId) before update/delete — it cannot be mutated by
 *     guessing its id under a different patient/clinic/organization.
 *   - `source` is ALWAYS forced to 'staff' for API-created rows and is never
 *     read from the client: 'import' / 'legacy_migration' are provenance
 *     claims only the migration pipeline is allowed to make.
 *
 * LOGGING / AUDIT PRIVACY
 *   The phone number itself (`value`) and its digits-only projection
 *   (`normalizedValue`) are NEVER logged and NEVER placed in audit metadata.
 *   Activity metadata carries ids and counts only. Error logs use
 *   safeErrorFields() — a raw Prisma error message pretty-prints the attempted
 *   call arguments, which would echo the number into the log (the exact defect
 *   class covered by routeErrorLogPrivacy.test.ts).
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { safeErrorFields } from '../utils/safeError.js';

const router = express.Router();

// Exported so tests assert against the real role list instead of a hand-copied
// duplicate (same convention as EMERGENCY_CONTACT_ROLES).
export const CONTACT_POINT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'];

/**
 * Closed vocabulary, matching the PatientContactPoint.contactType doc comment
 * in prisma/schema.prisma. An unrecognized token is REJECTED (400), never
 * coerced to 'other' — silently rewriting what staff selected would be the
 * system deciding a fact about the record by omission.
 */
export const CONTACT_POINT_TYPES = ['mobile', 'home', 'work', 'other'] as const;
export type ContactPointType = (typeof CONTACT_POINT_TYPES)[number];

/** Generous but bounded — an international number with spaces/parens/extension
 * fits well inside this; anything longer is not a phone number. */
export const CONTACT_POINT_VALUE_MAX_LENGTH = 32;
export const CONTACT_POINT_LABEL_MAX_LENGTH = 64;

/** API-created rows are always staff-entered. 'import' / 'legacy_migration' /
 * 'api' / 'patient_portal' are set by their own pipelines, never by a client. */
export const CONTACT_POINT_API_SOURCE = 'staff';

/** Stable API error code for the @@unique([patientId, contactType, value])
 * violation, so the client can distinguish "already recorded" from a 500. */
export const CONTACT_POINT_DUPLICATE_CODE = 'CONTACT_POINT_DUPLICATE';

/**
 * normalizeContactPointDigits — digits-only projection of a phone number.
 *
 * DUPLICATION NOTE (deliberate, F3-DATA-MIG-TODAY-001-R10):
 * Three other `normalizePhone`-shaped helpers already exist in this repo —
 * routes/whatsapp.ts, routes/whatsappInbox.ts, and
 * services/instagram/instagramAiConversationProcessor.ts. They are NOT reused
 * here and are NOT refactored (explicitly out of scope), because they are not
 * actually the same function:
 *   - the two WhatsApp copies strip a `@…` JID suffix, a WhatsApp transport
 *     detail that has no meaning for a number typed by a receptionist;
 *   - the Instagram copy additionally GATES on length (6..15) and returns
 *     null outside it, because it feeds patient MATCHING — the one thing this
 *     value must never do (see invariant 2 in the file header).
 * Hoisting them into one shared util would mean changing at least one of
 * those three behaviours; adding a fourth copy under a "shared" name would be
 * worse still. So this is one local, single-purpose, documented function whose
 * contract is narrow: strip everything that is not a digit, for display and
 * for within-patient duplicate hinting only. If a future task unifies phone
 * normalization repo-wide, this is a call site to fold in.
 *
 * Returns null when nothing digit-like remains, so `normalizedValue` is NULL
 * rather than '' for a value that carries no digits at all.
 */
export function normalizeContactPointDigits(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export type ContactPointInput = {
  contactType?: unknown;
  value?: unknown;
  label?: unknown;
};

export type NormalizedContactPoint = {
  contactType: ContactPointType;
  value: string;
  normalizedValue: string | null;
  label: string | null;
};

export type ContactPointValidationResult =
  | { ok: true; data: NormalizedContactPoint }
  | { ok: false; error: string };

/**
 * Pure validation/normalization — no DB access, so the create/update contract
 * is unit-testable without a database (same split as
 * services/patientEmergencyContacts.ts).
 *
 * NOTE `source` is not accepted here at all: it is not part of the input type
 * and is not read from `input`, so a client-supplied `source` is structurally
 * unable to reach the database.
 */
export function validateContactPoint(input: ContactPointInput): ContactPointValidationResult {
  const rawType = input.contactType;
  if (typeof rawType !== 'string' || !CONTACT_POINT_TYPES.includes(rawType.trim() as ContactPointType)) {
    return { ok: false, error: `contactType must be one of: ${CONTACT_POINT_TYPES.join(', ')}` };
  }
  const contactType = rawType.trim() as ContactPointType;

  if (typeof input.value !== 'string') {
    return { ok: false, error: 'value is required' };
  }
  const value = input.value.trim();
  if (value.length === 0) {
    return { ok: false, error: 'value is required' };
  }
  if (value.length > CONTACT_POINT_VALUE_MAX_LENGTH) {
    return { ok: false, error: `value must be at most ${CONTACT_POINT_VALUE_MAX_LENGTH} characters` };
  }

  let label: string | null = null;
  if (input.label !== undefined && input.label !== null) {
    if (typeof input.label !== 'string') {
      return { ok: false, error: 'label must be a string' };
    }
    const trimmed = input.label.trim();
    if (trimmed.length > CONTACT_POINT_LABEL_MAX_LENGTH) {
      return { ok: false, error: `label must be at most ${CONTACT_POINT_LABEL_MAX_LENGTH} characters` };
    }
    label = trimmed.length > 0 ? trimmed : null;
  }

  return {
    ok: true,
    data: { contactType, value, normalizedValue: normalizeContactPointDigits(value), label },
  };
}

/**
 * mergeContactPointPatch — PUT semantics: only the keys actually PRESENT in
 * the body are applied on top of the stored row. An omitted key keeps its
 * current value; `label: null` explicitly clears the label.
 */
export function mergeContactPointPatch(
  existing: { contactType: string; value: string; label: string | null },
  patch: Record<string, unknown>,
): ContactPointInput {
  return {
    contactType: 'contactType' in patch ? patch.contactType : existing.contactType,
    value: 'value' in patch ? patch.value : existing.value,
    label: 'label' in patch ? patch.label : existing.label,
  };
}

/** True for the @@unique([patientId, contactType, value]) violation. It is the
 * ONLY unique constraint on PatientContactPoint besides the primary key, so a
 * P2002 raised by a create/update here can only be that duplicate. */
export function isContactPointDuplicate(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

/**
 * resolvePatientScope — the single tenant gate for every endpoint below.
 * Structural mirror of resolvePatientScope() in patientEmergencyContacts.ts.
 * Returns null (-> 404, never a leak of existence) when the patient is in
 * another organization, in a clinic the caller is not assigned to, soft
 * deleted, or — for DENTIST — not one of their own patients.
 */
async function resolvePatientScope(
  req: AuthRequest,
  patientId: string,
): Promise<{ id: string; clinicId: string; organizationId: string } | null> {
  const { organizationId: orgId, normalizedRole, id: userId, canAccessAllClinics, allowedClinicIds } = req.user!;

  const patientWhere: any = { id: patientId, organizationId: orgId, deletedAt: null };
  if (normalizedRole === 'DENTIST') {
    patientWhere.OR = [
      { appointments: { some: { practitionerId: userId, deletedAt: null } } },
      { treatmentCases: { some: { practitionerId: userId, deletedAt: null } } },
    ];
  }

  const patient = await prisma.patient.findFirst({
    where: patientWhere,
    select: { id: true, clinicId: true, organizationId: true },
  });
  if (!patient) return null;

  if (!canAccessAllClinics && !allowedClinicIds.includes(patient.clinicId)) return null;

  return patient;
}

// ── GET /api/patients/:patientId/contact-points ─────────────────────────────

router.get(
  '/patients/:patientId/contact-points',
  authorize(CONTACT_POINT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const contactPoints = await prisma.patientContactPoint.findMany({
        where: {
          patientId: patient.id,
          clinicId: patient.clinicId,
          organizationId: patient.organizationId,
        },
        orderBy: [{ contactType: 'asc' }, { createdAt: 'asc' }],
      });

      res.json({ contactPoints });
    } catch (err: unknown) {
      console.error('[patientContactPoints] list error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to fetch contact points' });
    }
  },
);

// ── POST /api/patients/:patientId/contact-points ────────────────────────────

router.post(
  '/patients/:patientId/contact-points',
  authorize(CONTACT_POINT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const validation = validateContactPoint((req.body ?? {}) as ContactPointInput);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const data = validation.data;

      let contactPoint;
      try {
        contactPoint = await prisma.patientContactPoint.create({
          data: {
            contactType: data.contactType,
            value: data.value,
            normalizedValue: data.normalizedValue,
            label: data.label,
            // Never from the client — see the file header.
            source: CONTACT_POINT_API_SOURCE,
            patientId: patient.id,
            clinicId: patient.clinicId,
            organizationId: patient.organizationId,
          },
        });
      } catch (createErr: unknown) {
        if (isContactPointDuplicate(createErr)) {
          return res.status(409).json({
            error: 'This contact point is already recorded for this patient.',
            code: CONTACT_POINT_DUPLICATE_CODE,
          });
        }
        throw createErr;
      }

      // Metadata: ids + type only. NEVER the number or its digits.
      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_contact_point',
        entityId: contactPoint.id,
        patientId: patient.id,
        action: 'created',
        description: `İkincil iletişim numarası eklendi (${data.contactType})`,
        metadata: { contactPointId: contactPoint.id, contactType: data.contactType, source: CONTACT_POINT_API_SOURCE },
      });

      res.status(201).json({ contactPoint });
    } catch (err: unknown) {
      console.error('[patientContactPoints] create error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to create contact point' });
    }
  },
);

// ── PUT /api/patients/:patientId/contact-points/:contactPointId ─────────────

router.put(
  '/patients/:patientId/contact-points/:contactPointId',
  authorize(CONTACT_POINT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const contactPointId = getParam(req, 'contactPointId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const existing = await prisma.patientContactPoint.findFirst({
        where: {
          id: contactPointId,
          patientId: patient.id,
          clinicId: patient.clinicId,
          organizationId: patient.organizationId,
        },
      });
      if (!existing) return res.status(404).json({ error: 'Contact point not found' });

      const merged = mergeContactPointPatch(existing, (req.body ?? {}) as Record<string, unknown>);
      const validation = validateContactPoint(merged);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const data = validation.data;

      let contactPoint;
      try {
        contactPoint = await prisma.patientContactPoint.update({
          where: { id: existing.id },
          data: {
            contactType: data.contactType,
            value: data.value,
            normalizedValue: data.normalizedValue,
            label: data.label,
            // `source` is intentionally NOT updated: it records where the row
            // originally came from, and a later staff edit does not rewrite
            // an 'import' / 'legacy_migration' provenance claim.
          },
        });
      } catch (updateErr: unknown) {
        if (isContactPointDuplicate(updateErr)) {
          return res.status(409).json({
            error: 'This contact point is already recorded for this patient.',
            code: CONTACT_POINT_DUPLICATE_CODE,
          });
        }
        throw updateErr;
      }

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_contact_point',
        entityId: contactPoint.id,
        patientId: patient.id,
        action: 'updated',
        description: `İkincil iletişim numarası güncellendi (${data.contactType})`,
        metadata: { contactPointId: contactPoint.id, contactType: data.contactType },
      });

      res.json({ contactPoint });
    } catch (err: unknown) {
      console.error('[patientContactPoints] update error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to update contact point' });
    }
  },
);

// ── DELETE /api/patients/:patientId/contact-points/:contactPointId ──────────

router.delete(
  '/patients/:patientId/contact-points/:contactPointId',
  authorize(CONTACT_POINT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const contactPointId = getParam(req, 'contactPointId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const existing = await prisma.patientContactPoint.findFirst({
        where: {
          id: contactPointId,
          patientId: patient.id,
          clinicId: patient.clinicId,
          organizationId: patient.organizationId,
        },
        select: { id: true, contactType: true },
      });
      if (!existing) return res.status(404).json({ error: 'Contact point not found' });

      await prisma.patientContactPoint.delete({ where: { id: existing.id } });

      const remainingCount = await prisma.patientContactPoint.count({
        where: {
          patientId: patient.id,
          clinicId: patient.clinicId,
          organizationId: patient.organizationId,
        },
      });

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_contact_point',
        entityId: existing.id,
        patientId: patient.id,
        action: 'deleted',
        description: `İkincil iletişim numarası silindi (${existing.contactType})`,
        metadata: { contactPointId: existing.id, contactType: existing.contactType, remainingCount },
      });

      res.status(204).send();
    } catch (err: unknown) {
      console.error('[patientContactPoints] delete error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to delete contact point' });
    }
  },
);

export default router;
