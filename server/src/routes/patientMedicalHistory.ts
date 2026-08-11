/**
 * patientMedicalHistory.ts — US-01.1-P1: versioned medical-history backend
 * foundation.
 *
 * Endpoints:
 *   GET  /api/patients/:patientId/medical-history            — list version summaries
 *   GET  /api/patients/:patientId/medical-history/latest      — read the latest version (full)
 *   GET  /api/patients/:patientId/medical-history/:historyId  — read one version (full)
 *   POST /api/patients/:patientId/medical-history              — create a new version
 *
 * No PUT/PATCH/DELETE route exists for this resource — medical history is
 * append-only in P1. Editing means recording a new version.
 *
 * Security:
 *   - The patient is always re-resolved from the DB within org + clinic scope
 *     (never trusted from the URL/body alone) — same resolvePatientScope
 *     pattern as patientEmergencyContacts.ts. DENTIST is further restricted
 *     to patients they have an appointment or treatment case with. A patient
 *     outside the caller's org/clinic scope resolves to 404 (not 403) to
 *     avoid leaking existence across tenant/clinic boundaries.
 *   - READ roles (list/get): OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST |
 *     RECEPTIONIST — reception may need to see allergy/condition alerts for
 *     scheduling and triage.
 *   - WRITE role (create a version): OWNER | ORG_ADMIN | CLINIC_MANAGER |
 *     DENTIST only — recording clinical medical history is a clinical
 *     judgment call, narrower than the read set and narrower than
 *     PatientEmergencyContact's role set. This is a deliberate P1 design
 *     decision (see docs/architecture reviews for US-01.1), not a gap.
 *   - BILLING is excluded from both sets entirely (never included, unlike
 *     GET /api/patients which includes BILLING with a reduced field
 *     selection) — medical history has no billing-relevant subset at all.
 *   - A version row is always re-fetched scoped to (id, patientId, clinicId,
 *     organizationId) before being returned — a version cannot be read by
 *     guessing its ID under a different patient/clinic/organization.
 *
 * Versioning/concurrency:
 *   - Every create allocates version = previous max(version) + 1 for that
 *     patientId under a per-patient pg_advisory_xact_lock (see
 *     services/patientMedicalHistoryConcurrency.ts), inside the same
 *     transaction that inserts the new PatientMedicalHistory row and its
 *     PatientCondition children. A database-level @@unique([patientId,
 *     version]) constraint is the last-resort backstop (see migration
 *     <TBD>_add_patient_medical_history_foundation).
 *   - Existing versions are never updated or deleted by this route.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { getParam } from '../utils/helpers.js';
import { safeErrorFields } from '../utils/safeError.js';
import { validateMedicalHistory, type NormalizedMedicalHistory } from '../services/medicalHistory.js';
import {
  acquireMedicalHistoryVersionLock,
  isMedicalHistoryVersionConflict,
  MedicalHistoryVersionConflictError,
} from '../services/patientMedicalHistoryConcurrency.js';

const router = express.Router();

// Exported so tests can assert against the real role lists instead of a
// hand-copied duplicate (see server/src/tests/patientMedicalHistory.test.ts).
export const MEDICAL_HISTORY_READ_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'];
export const MEDICAL_HISTORY_WRITE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST'];

type ResolvedPatient = { id: string; clinicId: string; organizationId: string };

async function resolvePatientScope(req: AuthRequest, patientId: string): Promise<ResolvedPatient | null> {
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

const HISTORY_SUMMARY_SELECT = {
  id: true,
  version: true,
  recordedById: true,
  recordedAt: true,
  noKnownConditions: true,
  createdAt: true,
  _count: { select: { conditions: true } },
} as const;

const HISTORY_DETAIL_SELECT = {
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
      id: true,
      status: true,
      note: true,
      createdAt: true,
      condition: { select: { code: true, category: true, nameEn: true, nameTr: true } },
    },
  },
} as const;

// ── GET /api/patients/:patientId/medical-history ────────────────────────────

router.get(
  '/patients/:patientId/medical-history',
  authorize(MEDICAL_HISTORY_READ_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const versions = await prisma.patientMedicalHistory.findMany({
        where: { patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
        select: HISTORY_SUMMARY_SELECT,
        orderBy: { version: 'desc' },
      });

      res.json(
        versions.map((v) => ({
          id: v.id,
          version: v.version,
          recordedById: v.recordedById,
          recordedAt: v.recordedAt,
          noKnownConditions: v.noKnownConditions,
          createdAt: v.createdAt,
          conditionCount: v._count.conditions,
        })),
      );
    } catch (err: any) {
      console.error('[patientMedicalHistory] list error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch medical history' });
    }
  },
);

// ── GET /api/patients/:patientId/medical-history/latest ─────────────────────

router.get(
  '/patients/:patientId/medical-history/latest',
  authorize(MEDICAL_HISTORY_READ_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const latest = await prisma.patientMedicalHistory.findFirst({
        where: { patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
        select: HISTORY_DETAIL_SELECT,
        orderBy: { version: 'desc' },
      });
      if (!latest) return res.status(404).json({ error: 'No medical history recorded for this patient yet' });

      res.json(latest);
    } catch (err: any) {
      console.error('[patientMedicalHistory] latest error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch medical history' });
    }
  },
);

// ── GET /api/patients/:patientId/medical-history/:historyId ─────────────────

router.get(
  '/patients/:patientId/medical-history/:historyId',
  authorize(MEDICAL_HISTORY_READ_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const historyId = getParam(req, 'historyId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const version = await prisma.patientMedicalHistory.findFirst({
        where: { id: historyId, patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
        select: HISTORY_DETAIL_SELECT,
      });
      if (!version) return res.status(404).json({ error: 'Medical history version not found' });

      res.json(version);
    } catch (err: any) {
      console.error('[patientMedicalHistory] get error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch medical history' });
    }
  },
);

// ── POST /api/patients/:patientId/medical-history ───────────────────────────

router.post(
  '/patients/:patientId/medical-history',
  authorize(MEDICAL_HISTORY_WRITE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await resolvePatientScope(req, patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const validation = validateMedicalHistory(req.body ?? {});
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const data: NormalizedMedicalHistory = validation.data;

      // Resolve condition codes against the lookup table BEFORE opening the
      // transaction — an unknown code is a 400 (client error), not something
      // that should hold the per-patient advisory lock.
      let conditionIdByCode = new Map<string, string>();
      if (data.conditions.length > 0) {
        const codes = data.conditions.map((c) => c.code);
        const found = await prisma.medicalCondition.findMany({
          where: { code: { in: codes }, isActive: true },
          select: { id: true, code: true },
        });
        conditionIdByCode = new Map(found.map((f) => [f.code, f.id]));
        const missing = codes.filter((code) => !conditionIdByCode.has(code));
        if (missing.length > 0) {
          return res.status(400).json({ error: `Unknown or inactive condition code(s): ${missing.join(', ')}` });
        }
      }

      let created;
      try {
        created = await prisma.$transaction(async (tx) => {
          await acquireMedicalHistoryVersionLock(tx, patient.id);

          const latest = await tx.patientMedicalHistory.findFirst({
            where: { patientId: patient.id, clinicId: patient.clinicId, organizationId: patient.organizationId },
            select: { id: true, version: true },
            orderBy: { version: 'desc' },
          });
          const nextVersion = (latest?.version ?? 0) + 1;

          // Defense in depth: this can only fire if a row for this exact
          // (patientId, nextVersion) pair already exists despite holding the
          // lock — should be unreachable in normal operation.
          const collision = await tx.patientMedicalHistory.findFirst({
            where: { patientId: patient.id, version: nextVersion },
            select: { id: true },
          });
          if (collision) throw new MedicalHistoryVersionConflictError();

          return tx.patientMedicalHistory.create({
            data: {
              patientId: patient.id,
              clinicId: patient.clinicId,
              organizationId: patient.organizationId,
              version: nextVersion,
              recordedById: req.user!.id,
              noKnownConditions: data.noKnownConditions,
              allergies: data.allergies,
              currentMedications: data.currentMedications,
              pregnancyStatus: data.pregnancyStatus,
              pregnancyStartDate: data.pregnancyStartDate,
              conditions: {
                create: data.conditions.map((c) => ({
                  conditionId: conditionIdByCode.get(c.code)!,
                  status: c.status,
                  note: c.note,
                  patientId: patient.id,
                  clinicId: patient.clinicId,
                  organizationId: patient.organizationId,
                })),
              },
            },
            select: HISTORY_DETAIL_SELECT,
          });
        });
      } catch (txErr: any) {
        if (isMedicalHistoryVersionConflict(txErr)) {
          return res.status(409).json({
            error: 'Another request just recorded a medical history version for this patient. Please retry.',
            code: 'MEDICAL_HISTORY_VERSION_CONFLICT',
          });
        }
        throw txErr;
      }

      await logActivity({
        clinicId: patient.clinicId,
        userId: req.user!.id,
        entityType: 'patient_medical_history',
        entityId: created.id,
        patientId: patient.id,
        action: 'created',
        description: `Tıbbi geçmiş kaydı eklendi (v${created.version})`,
      });

      await writeAuditLog({
        organizationId: patient.organizationId,
        clinicId: patient.clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'patient_medical_history_recorded',
        entityType: 'patient_medical_history',
        entityId: created.id,
        description: `Medical history version ${created.version} recorded for patient.`,
        metadata: { patientId: patient.id, version: created.version, noKnownConditions: created.noKnownConditions },
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error('[patientMedicalHistory] create error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to record medical history' });
    }
  },
);

export default router;
