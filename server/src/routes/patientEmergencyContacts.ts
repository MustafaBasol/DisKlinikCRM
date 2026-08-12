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
 * Single-primary-contact invariant (concurrency) — F1-004-P1-R2 / F1-004-P1-R2-R3:
 *   - "At most one isPrimary=true contact per patient" is enforced at two
 *     layers: (1) a per-patient PostgreSQL advisory transaction lock
 *     (acquireEmergencyContactPrimaryLock — server/src/services/
 *     patientEmergencyContactsConcurrency.ts) guarding an
 *     optimistic-concurrency check performed under that lock
 *     (resolvePrimaryPromotion, same file), and (2) a database-level partial
 *     unique index (PatientEmergencyContact_one_primary_per_patient — see
 *     migration 20260803120000_add_patient_emergency_contacts) as a
 *     last-resort backstop.
 *   - Both POST and PUT accept an OPTIONAL `expectedCurrentPrimaryContactId`
 *     field (null, or an existing contact's id) whenever the request would
 *     set isPrimary=true. TWO DISTINCT CONTRACTS apply depending on whether
 *     it is supplied (F2-CT-32-R3-R1 reconciliation):
 *       - PRESENT — TOKEN-PROTECTED, the GUARANTEED contract: enforced as a
 *         TRUE optimistic-concurrency precondition. The canonical
 *         current-primary read taken under the lock must match it exactly,
 *         or the request gets 409 PRIMARY_CONTACT_CONFLICT before any
 *         demotion/insert. This is airtight against connection-pool/
 *         event-loop scheduling, unlike any purely server-side timing
 *         comparison — see resolvePrimaryPromotion's header comment in
 *         patientEmergencyContactsConcurrency.ts for the full proof
 *         (F1-004-P1-R2-R3, CI run 31020654709 attempt 1) that no
 *         server-only signal can distinguish two requests that genuinely
 *         overlapped at the HTTP layer from two that were genuinely
 *         sequential, once the losing request's entire transaction happens
 *         to execute after the winner's commit. Proven zero-dual-success
 *         across 1000/1000 contested rounds — see
 *         patientEmergencyContactsPrimaryConcurrency.test.ts. Every current
 *         production caller (src/components/PatientEmergencyContactForm.tsx)
 *         always supplies this field.
 *       - OMITTED (an older/non-updated client) — LEGACY, a BEST-EFFORT-ONLY
 *         compatibility contract, unreachable from any current production
 *         caller: falls back to F2-CT-32-R3's non-blocking
 *         advisory-lock-attempt comparison (see resolvePrimaryPromotion's
 *         header comment) — closes the much larger natural-race gap PR
 *         #310/R2 had, but is knowingly not PROVABLY race-free. That
 *         residual can and does occur under natural (unforced) scheduling,
 *         not only an artificially forced full-serialization interleaving —
 *         reconfirmed on this exact PR head, CI run 31335917295: 2 of 251
 *         unprotected contested rounds dual-succeeded. The database itself
 *         never durably holds two primaries either way (the partial unique
 *         index is the hard backstop); only the HTTP-layer "exactly one
 *         success" guarantee is not provable in this mode. See
 *         patientEmergencyContactsCreateRaceForcedInterleaving.test.ts's
 *         scenario 2 for the deterministic characterization of the same
 *         mechanism; never claim this path is race-free.
 *   - When two requests race to become primary for the same patient, the
 *     loser either fails the precondition/optimistic-concurrency check
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
  parseExpectedPrimaryPrecondition,
  type NormalizedEmergencyContact,
} from '../services/patientEmergencyContacts.js';
import {
  resolvePrimaryPromotion,
  invokeEmergencyContactRaceHook,
} from '../services/patientEmergencyContactsConcurrency.js';
import { safeErrorFields } from '../utils/safeError.js';

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

      const preconditionResult = parseExpectedPrimaryPrecondition(req.body ?? {});
      if (!preconditionResult.ok) return res.status(400).json({ error: preconditionResult.error });
      const precondition = preconditionResult.precondition;

      let contact;
      try {
        contact = await prisma.$transaction(async (tx) => {
          if (data.isPrimary) {
            await resolvePrimaryPromotion(tx, {
              patientId: patient.id,
              clinicId: patient.clinicId,
              organizationId: patient.organizationId,
              precondition,
              op: 'create',
            });
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
      if (data.isPrimary) {
        await invokeEmergencyContactRaceHook('afterCommit', { patientId: patient.id, op: 'create' });
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
      console.error('[patientEmergencyContacts] create error:', safeErrorFields(err));
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

      const preconditionResult = parseExpectedPrimaryPrecondition(req.body ?? {});
      if (!preconditionResult.ok) return res.status(400).json({ error: preconditionResult.error });
      const precondition = preconditionResult.precondition;

      // Only an actual promotion (not-yet-primary -> primary) needs the lock
      // below — an idempotent update of an already-primary row, or a
      // demotion, never contends for the single-primary invariant (see
      // patientEmergencyContactsConcurrency.ts).
      const promoting = data.isPrimary && !existing.isPrimary;

      let contact;
      try {
        contact = await prisma.$transaction(async (tx) => {
          if (promoting) {
            await resolvePrimaryPromotion(tx, {
              patientId: patient.id,
              clinicId: patient.clinicId,
              organizationId: patient.organizationId,
              excludeContactId: existing.id,
              precondition,
              op: 'update',
            });
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
      if (promoting) {
        await invokeEmergencyContactRaceHook('afterCommit', { patientId: patient.id, op: 'update' });
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
      console.error('[patientEmergencyContacts] update error:', safeErrorFields(err));
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
