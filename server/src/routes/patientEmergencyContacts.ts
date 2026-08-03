/**
 * patientEmergencyContacts.ts — US-01.2: patient emergency contacts, relationship
 * (contactType), and legal decision-maker CRUD.
 *
 * Endpoints:
 *   GET    /api/patients/:patientId/emergency-contacts
 *   POST   /api/patients/:patientId/emergency-contacts
 *   PUT    /api/patients/:patientId/emergency-contacts/:contactId
 *   DELETE /api/patients/:patientId/emergency-contacts/:contactId
 *
 * Security:
 *   - Role matrix mirrors PUT /api/patients/:id (server/src/routes/patients.ts):
 *     OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST. BILLING is
 *     intentionally excluded — emergency contacts are PII, not a billing/payment
 *     concern (see docs BILLING data-minimization convention).
 *   - The patient is always re-resolved from the DB within org + clinic scope
 *     (never trusted from the URL/body alone) — same pattern as patients.ts.
 *     DENTIST is further restricted to patients they have an appointment or
 *     treatment case with, same as GET/PUT /api/patients/:id.
 *   - A contact row is always re-fetched scoped to (id, patientId, clinicId,
 *     organizationId) before update/delete — a contact cannot be mutated by
 *     guessing its ID under a different patient/clinic/organization.
 *
 * Single-primary-contact invariant (concurrency):
 *   - "At most one isPrimary=true contact per patient" has two layers:
 *     1. A database-level partial unique index (PatientEmergencyContact_
 *        one_primary_per_patient — see migration 20260803120000_add_patient_
 *        emergency_contacts) guarantees the DB can never physically hold two
 *        isPrimary=true rows for one patient. This is a backstop, not the
 *        primary race guard (see below for why it alone is insufficient).
 *     2. A per-patient PostgreSQL advisory transaction lock (claimPrimaryContactSlot,
 *        server/src/services/patientEmergencyContactPrimaryLock.ts) combined
 *        with an optimistic snapshot check of who is currently primary. This
 *        is what actually delivers the documented HTTP contract: when two
 *        requests race to become primary for the same patient, exactly one
 *        gets 200/201 and the other gets a controlled
 *        `409 { error, code: 'PRIMARY_CONTACT_CONFLICT' }` — never an
 *        unhandled exception, a generic 500, internal DB details, or a
 *        silent last-writer-wins 200/200 (F1-004-P1: the unique index alone
 *        does not prevent this — a second transaction's reset-then-set can
 *        legitimately clear the first transaction's already-committed
 *        primary and set its own without ever touching the unique index,
 *        producing two 200s. See the lock helper's file header for the full
 *        analysis). No retry is attempted; the caller is expected to reload
 *        and retry.
 *   - claimPrimaryContactSlot() re-checks are explicitly scoped to
 *     (patientId, clinicId, organizationId) — not patientId alone — so the
 *     tenant boundary stays explicit and defensible even though patientId is
 *     already globally unique (the advisory-lock key itself is patientId-only,
 *     since Patient.id is a single global primary key — see the lock
 *     helper's file header).
 *   - The lock is only ever acquired when a write is actually transitioning
 *     a row to isPrimary=true; non-primary creates/updates never contend on
 *     it, and different patients use different lock keys, so unrelated
 *     writes are never serialized against each other.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import {
  validateEmergencyContact,
  mergeEmergencyContactPatch,
  isPrimaryContactConflict,
  type NormalizedEmergencyContact,
} from '../services/patientEmergencyContacts.js';
import {
  claimPrimaryContactSlot,
  readCurrentPrimaryContactId,
  PrimaryContactRaceError,
} from '../services/patientEmergencyContactPrimaryLock.js';

const router = express.Router();

// Exported so tests can assert against the real role list instead of a
// hand-copied duplicate (see server/src/tests/patientEmergencyContacts.test.ts).
export const EMERGENCY_CONTACT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'];

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

function toContactData(data: NormalizedEmergencyContact) {
  return {
    contactType: data.contactType,
    fullName: data.fullName,
    phone: data.phone,
    phoneCountryCode: data.phoneCountryCode,
    email: data.email,
    occupation: data.occupation,
    isPrimary: data.isPrimary,
    isLegalDecisionMaker: data.isLegalDecisionMaker,
  };
}

// ── GET /api/patients/:patientId/emergency-contacts ────────────────────────

router.get(
  '/patients/:patientId/emergency-contacts',
  authorize(EMERGENCY_CONTACT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const contacts = await prisma.patientEmergencyContact.findMany({
        where: { patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      res.json(contacts);
    } catch (err: any) {
      console.error('[patientEmergencyContacts] list error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch emergency contacts' });
    }
  },
);

// ── POST /api/patients/:patientId/emergency-contacts ────────────────────────

router.post(
  '/patients/:patientId/emergency-contacts',
  authorize(EMERGENCY_CONTACT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const validation = validateEmergencyContact(req.body ?? {});
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const data = validation.data;

      const scope = { patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId };
      const expectedCurrentPrimaryId = data.isPrimary ? await readCurrentPrimaryContactId(prisma, scope) : null;

      let contact;
      try {
        contact = await prisma.$transaction(async (tx) => {
          if (data.isPrimary) {
            await claimPrimaryContactSlot(tx, scope, expectedCurrentPrimaryId);
          }
          return tx.patientEmergencyContact.create({
            data: {
              ...toContactData(data),
              patientId: patient.id,
              clinicId: patient.clinicId,
              organizationId: patient.organizationId,
            },
          });
        });
      } catch (txErr: any) {
        if (txErr instanceof PrimaryContactRaceError || isPrimaryContactConflict(txErr)) {
          return res.status(409).json({
            error: 'Another request just set a primary contact for this patient. Please retry.',
            code: 'PRIMARY_CONTACT_CONFLICT',
          });
        }
        throw txErr;
      }

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_emergency_contact',
        entityId: contact.id,
        patientId: patient.id,
        action: 'created',
        description: `Acil durum kişisi eklendi (${data.contactType})`,
      });

      res.status(201).json(contact);
    } catch (err: any) {
      console.error('[patientEmergencyContacts] create error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to create emergency contact' });
    }
  },
);

// ── PUT /api/patients/:patientId/emergency-contacts/:contactId ──────────────

router.put(
  '/patients/:patientId/emergency-contacts/:contactId',
  authorize(EMERGENCY_CONTACT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const contactId = getParam(req, 'contactId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const existing = await prisma.patientEmergencyContact.findFirst({
        where: { id: contactId, patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
      });
      if (!existing) return res.status(404).json({ error: 'Emergency contact not found' });

      const merged = mergeEmergencyContactPatch(existing as unknown as NormalizedEmergencyContact, req.body ?? {});
      const validation = validateEmergencyContact(merged);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const data = validation.data;

      const willPromoteToPrimary = data.isPrimary && !existing.isPrimary;
      const scope = { patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId };
      const expectedCurrentPrimaryId = willPromoteToPrimary ? await readCurrentPrimaryContactId(prisma, scope) : null;

      let contact;
      try {
        contact = await prisma.$transaction(async (tx) => {
          if (willPromoteToPrimary) {
            await claimPrimaryContactSlot(tx, scope, expectedCurrentPrimaryId, existing.id);
          }
          return tx.patientEmergencyContact.update({
            where: { id: existing.id },
            data: toContactData(data),
          });
        });
      } catch (txErr: any) {
        if (txErr instanceof PrimaryContactRaceError || isPrimaryContactConflict(txErr)) {
          return res.status(409).json({
            error: 'Another request just set a primary contact for this patient. Please retry.',
            code: 'PRIMARY_CONTACT_CONFLICT',
          });
        }
        throw txErr;
      }

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_emergency_contact',
        entityId: contact.id,
        patientId: patient.id,
        action: 'updated',
        description: `Acil durum kişisi güncellendi (${data.contactType})`,
      });

      res.json(contact);
    } catch (err: any) {
      console.error('[patientEmergencyContacts] update error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to update emergency contact' });
    }
  },
);

// ── DELETE /api/patients/:patientId/emergency-contacts/:contactId ───────────

router.delete(
  '/patients/:patientId/emergency-contacts/:contactId',
  authorize(EMERGENCY_CONTACT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const contactId = getParam(req, 'contactId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const existing = await prisma.patientEmergencyContact.findFirst({
        where: { id: contactId, patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
      });
      if (!existing) return res.status(404).json({ error: 'Emergency contact not found' });

      await prisma.patientEmergencyContact.delete({ where: { id: existing.id } });

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_emergency_contact',
        entityId: existing.id,
        patientId: patient.id,
        action: 'deleted',
        description: `Acil durum kişisi silindi (${existing.contactType})`,
      });

      res.json({ message: 'Emergency contact deleted successfully' });
    } catch (err: any) {
      console.error('[patientEmergencyContacts] delete error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to delete emergency contact' });
    }
  },
);

export default router;
