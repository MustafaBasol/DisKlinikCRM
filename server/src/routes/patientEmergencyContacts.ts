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
 *   - "At most one isPrimary=true contact per patient" is enforced at two
 *     layers: (1) a per-patient PostgreSQL advisory transaction lock
 *     (acquireEmergencyContactPrimaryLock — server/src/services/
 *     patientEmergencyContactsConcurrency.ts) that serializes every
 *     primary-promotion attempt for that patient plus an
 *     optimistic-concurrency re-check performed under that lock, and (2) a
 *     database-level partial unique index (PatientEmergencyContact_
 *     one_primary_per_patient — see migration 20260803120000_add_patient_
 *     emergency_contacts) as a last-resort backstop. The advisory lock is
 *     what actually makes "exactly one promotion wins, the other gets a
 *     deterministic 409" true in practice — a partial unique index alone
 *     only rejects writes that physically overlap at the index-insert step,
 *     and two requests dispatched together do not have to overlap that
 *     precisely (see patientEmergencyContactsConcurrency.ts's header
 *     comment for the exact failure mode this closes).
 *   - When two requests race to become primary for the same patient, the
 *     loser either fails the optimistic-concurrency re-check
 *     (PrimaryContactConflictError) or, in the rare case both reach the
 *     database index simultaneously, rejects with a P2002 unique-constraint
 *     error. POST/PUT below catch both via isPrimaryContactConflict() and
 *     turn them into a controlled `409 { error, code:
 *     'PRIMARY_CONTACT_CONFLICT' }` response — never an unhandled exception
 *     or a generic 500, and never internal DB details. No retry is
 *     attempted; the caller is expected to reload and retry.
 *   - The lock is keyed by patientId alone (already globally unique in this
 *     schema), so different patients — including different
 *     clinics/organizations — never contend with each other. It is only
 *     ever acquired when a request would set isPrimary=true; concurrent
 *     isPrimary=false writes and unrelated field updates never touch it.
 *   - The primary-reset queries inside the transaction are explicitly scoped
 *     to (patientId, clinicId, organizationId) — not patientId alone — so
 *     the tenant boundary stays explicit and defensible even though
 *     patientId is already globally unique.
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
  acquireEmergencyContactPrimaryLock,
  PrimaryContactConflictError,
} from '../services/patientEmergencyContactsConcurrency.js';

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

      // Captured BEFORE the transaction so the in-lock re-check below can
      // tell "nobody raced me since I looked" apart from "someone else just
      // won" — see patientEmergencyContactsConcurrency.ts's header comment.
      const priorPrimaryId = data.isPrimary
        ? (
            await prisma.patientEmergencyContact.findFirst({
              where: {
                patientId: patient.id,
                clinicId: patient.clinicId,
                organizationId: patient.organizationId,
                isPrimary: true,
              },
              select: { id: true },
            })
          )?.id ?? null
        : null;

      let contact;
      try {
        contact = await prisma.$transaction(async (tx) => {
          if (data.isPrimary) {
            await acquireEmergencyContactPrimaryLock(tx, patient.id);

            const currentPrimary = await tx.patientEmergencyContact.findFirst({
              where: {
                patientId: patient.id,
                clinicId: patient.clinicId,
                organizationId: patient.organizationId,
                isPrimary: true,
              },
              select: { id: true },
            });
            if (currentPrimary && currentPrimary.id !== priorPrimaryId) {
              throw new PrimaryContactConflictError();
            }
            if (currentPrimary) {
              await tx.patientEmergencyContact.updateMany({
                where: {
                  patientId: patient.id,
                  clinicId: patient.clinicId,
                  organizationId: patient.organizationId,
                  isPrimary: true,
                },
                data: { isPrimary: false },
              });
            }
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
        if (isPrimaryContactConflict(txErr)) {
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

      // Only an actual promotion (not-yet-primary -> primary) needs the lock
      // and the priorPrimaryId snapshot below — an idempotent update of an
      // already-primary row, or a demotion, never contends for the
      // single-primary invariant (see patientEmergencyContactsConcurrency.ts).
      const promoting = data.isPrimary && !existing.isPrimary;

      const priorPrimaryId = promoting
        ? (
            await prisma.patientEmergencyContact.findFirst({
              where: {
                patientId: patient.id,
                clinicId: patient.clinicId,
                organizationId: patient.organizationId,
                isPrimary: true,
              },
              select: { id: true },
            })
          )?.id ?? null
        : null;

      let contact;
      try {
        contact = await prisma.$transaction(async (tx) => {
          if (promoting) {
            await acquireEmergencyContactPrimaryLock(tx, patient.id);

            const currentPrimary = await tx.patientEmergencyContact.findFirst({
              where: {
                patientId: patient.id,
                clinicId: patient.clinicId,
                organizationId: patient.organizationId,
                isPrimary: true,
                id: { not: existing.id },
              },
              select: { id: true },
            });
            if (currentPrimary && currentPrimary.id !== priorPrimaryId) {
              throw new PrimaryContactConflictError();
            }
            if (currentPrimary) {
              await tx.patientEmergencyContact.updateMany({
                where: {
                  patientId: patient.id,
                  clinicId: patient.clinicId,
                  organizationId: patient.organizationId,
                  isPrimary: true,
                  id: { not: existing.id },
                },
                data: { isPrimary: false },
              });
            }
          }
          return tx.patientEmergencyContact.update({
            where: { id: existing.id },
            data: toContactData(data),
          });
        });
      } catch (txErr: any) {
        if (isPrimaryContactConflict(txErr)) {
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
