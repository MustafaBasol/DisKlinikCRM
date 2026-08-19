/**
 * patientIdentity.ts — F3-DATA-MIG-TODAY-001-UI-001-R1: secure clinic-facing
 * TCKN support.
 *
 * Endpoints:
 *   GET /api/patients/:patientId/identity — masked metadata only
 *   PUT /api/patients/:patientId/identity — create/replace the TCKN
 *
 * There is deliberately NO DELETE endpoint (F3-DATA-MIG-TODAY-001-UI-001-R2):
 * no accepted product/legal contract in this repository authorizes clinic
 * staff to physically remove a government identity document. Correcting a
 * mis-entered value is supported through PUT replacement. If clinic-facing
 * deletion is ever required, that needs its own explicit product decision —
 * do not add it back here without one.
 *
 * All persistence, validation, tenant-bound lookup and duplicate-rejection
 * logic lives in services/patientIdentityService.ts — this file is
 * transport only (auth, scope resolution, request/response shaping, audit).
 *
 * Security:
 *   - PatientIdentityDocument is a SEPARATE model from Patient specifically
 *     so it is never accidentally included in GET /api/patients/:id's
 *     whole-record response (see the model's doc comment in
 *     prisma/schema.prisma and routes/patients.ts:205-206). This router is
 *     the ONLY place a client can read even the masked form.
 *   - The patient is always re-resolved from the DB within org + clinic
 *     scope before any read or write — same resolvePatientScope pattern as
 *     patientMedicalHistory.ts / patientEmergencyContacts.ts. A patient
 *     outside the caller's org/clinic scope resolves to 404, never 403, to
 *     avoid leaking existence across a tenant/clinic boundary.
 *   - READ and WRITE share one role gate (PATIENT_IDENTITY_ROLES = OWNER |
 *     ORG_ADMIN | CLINIC_MANAGER | RECEPTIONIST): DENTIST and BILLING get
 *     neither, per the F3-DATA-MIG-TODAY-001-UI-001-R1 authorization
 *     contract — only staff who manage patient identity documents at all
 *     should see even the masked present/absent state.
 *   - The response body is NEVER anything but { present, type, maskedValue }
 *     — no ciphertext, no lookup hash/token, no cryptoVersion, no plaintext.
 *
 * Audit:
 *   Every successful write (add / replace) gets a fail-closed,
 *   transaction-scoped audit row (writeAuditLogInTx — same primitive used by
 *   clinicBulkExportPackage.ts for other KVKK-critical events) so the
 *   operation is never reported successful without a durable audit trail.
 *   Metadata is limited to { patientId, docType } — never the raw value, the
 *   masked value, the ciphertext or the lookup hash (see
 *   patientIdentityService.ts's "NO LOGGING" contract).
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { writeAuditLogInTx } from '../utils/auditLog.js';
import { getParam } from '../utils/helpers.js';
import { safeErrorFields } from '../utils/safeError.js';
import { patientIdentityWriteSchema } from '../schemas/index.js';
import {
  PATIENT_IDENTITY_DOC_TYPE,
  PATIENT_IDENTITY_ROLES,
  PatientIdentityError,
  getMaskedIdentityForPatient,
  safeIdentityErrorMessage,
  writeIdentityInTx,
} from '../services/patientIdentityService.js';

const router = express.Router();

type ResolvedPatient = { id: string; clinicId: string; organizationId: string };

/**
 * Same tenant/clinic-scope resolution as the other nested patient
 * sub-resource routes (patientMedicalHistory.ts, patientEmergencyContacts.ts)
 * — NOT routes/patients.ts's own 404-vs-403 split. A patient outside the
 * caller's org OR outside the caller's clinic both resolve to a uniform 404,
 * deliberately: this is a highly sensitive identity sub-resource, and
 * distinguishing "doesn't exist" from "exists but you lack clinic access"
 * would leak cross-clinic existence to a caller who has no relationship with
 * the record at all.
 */
async function resolvePatientScope(req: AuthRequest, patientId: string): Promise<ResolvedPatient | null> {
  const { organizationId: orgId, canAccessAllClinics, allowedClinicIds } = req.user!;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, organizationId: orgId, deletedAt: null },
    select: { id: true, clinicId: true, organizationId: true },
  });
  if (!patient) return null;

  if (!canAccessAllClinics && !allowedClinicIds.includes(patient.clinicId)) return null;

  return patient;
}

// ── GET /api/patients/:patientId/identity ────────────────────────────────

router.get(
  '/patients/:patientId/identity',
  authorize(PATIENT_IDENTITY_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const identity = await getMaskedIdentityForPatient(prisma, patient.id);
      res.json(identity);
    } catch (err: any) {
      console.error('[patientIdentity] get error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to fetch identity document' });
    }
  },
);

// ── PUT /api/patients/:patientId/identity ────────────────────────────────

router.put(
  '/patients/:patientId/identity',
  authorize(PATIENT_IDENTITY_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    const validation = patientIdentityWriteSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: validation.error.format() });

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      let outcome: { maskedValue: string; created: boolean };
      try {
        outcome = await prisma.$transaction(async (tx) => {
          const result = await writeIdentityInTx(tx, {
            patientId: patient.id,
            clinicId: patient.clinicId,
            organizationId: patient.organizationId,
            rawValue: validation.data.value,
          });

          await writeAuditLogInTx(tx, {
            organizationId: patient.organizationId,
            clinicId: patient.clinicId,
            actorUserId: req.user!.id,
            actorRole: req.user!.role,
            action: result.created ? 'patient_identity_added' : 'patient_identity_replaced',
            entityType: 'patient_identity',
            entityId: patient.id,
            metadata: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE },
          });

          return result;
        });
      } catch (txErr: unknown) {
        if (txErr instanceof PatientIdentityError) {
          return res.status(txErr.httpStatus).json({ error: safeIdentityErrorMessage(txErr.code), code: txErr.code });
        }
        throw txErr;
      }

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_identity',
        entityId: patient.id,
        patientId: patient.id,
        action: outcome.created ? 'identity_added' : 'identity_replaced',
        description: outcome.created ? 'Kimlik belgesi eklendi' : 'Kimlik belgesi güncellendi',
      });

      res.json({ present: true, type: PATIENT_IDENTITY_DOC_TYPE, maskedValue: outcome.maskedValue });
    } catch (err: any) {
      console.error('[patientIdentity] put error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to save identity document' });
    }
  },
);

export default router;
