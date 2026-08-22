import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { safeErrorFields } from '../utils/safeError.js';

const router = express.Router();

// FDI tooth numbers (valid range).
//
// DENTAL-CHART-UX-001: quadrants 5-8 (the deciduous / primary dentition) are
// accepted alongside the permanent quadrants 1-4. This allowlist is the ONLY
// place primary teeth were ever rejected — ToothRecord.toothFdi is a plain
// `Int` column with no database-level range constraint, so no schema change
// or migration is involved (see prisma/schema.prisma model ToothRecord and
// migrations/20260518120000_add_tooth_records/migration.sql).
//
// The two ranges are disjoint by construction (11-48 vs 51-85), so a stored
// integer always identifies exactly one tooth in exactly one dentition. That
// is what makes this purely ADDITIVE: every previously-valid number is still
// valid and still means the same tooth, and a mixed-dentition child can hold
// permanent and primary records side by side under the existing
// (patientId, toothFdi) unique key without collision.
const PERMANENT_FDI = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
];

// Five teeth per quadrant: central incisor, lateral incisor, canine, first
// molar, second molar. There are no primary premolars, hence no 56/66/76/86.
const PRIMARY_FDI = [
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
];

const VALID_FDI = new Set([...PERMANENT_FDI, ...PRIMARY_FDI]);

const VALID_STATUS = new Set(['planned', 'in_progress', 'treated', 'issue', 'missing', 'crown', 'implant']);

// GET /api/patients/:patientId/dental-chart
router.get(
  '/patients/:patientId/dental-chart',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;
    try {
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, ...scope, deletedAt: null },
        select: { id: true, clinicId: true },
      });
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const records = await prisma.toothRecord.findMany({
        where: { patientId, clinicId: patient.clinicId },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { toothFdi: 'asc' },
      });
      res.json(records);
    } catch (err: any) {
      console.error('[dental-chart] list error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch dental chart' });
    }
  },
);

// PUT /api/patients/:patientId/dental-chart/:toothFdi  — upsert
router.put(
  '/patients/:patientId/dental-chart/:toothFdi',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const toothFdi = parseInt(req.params.toothFdi as string, 10);
    const { status, note } = req.body as { status: string; note?: string };

    if (!VALID_FDI.has(toothFdi)) {
      return res.status(400).json({ error: 'Invalid tooth FDI number' });
    }
    if (!VALID_STATUS.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    try {
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, ...scope, deletedAt: null },
        select: { id: true, clinicId: true },
      });
      if (!patient) return res.status(404).json({ error: 'Patient not found' });
      const clinicId = patient.clinicId;

      const record = await prisma.toothRecord.upsert({
        where: { patientId_toothFdi: { patientId, toothFdi } },
        update: {
          status,
          note: note?.trim() || null,
          createdById: req.user!.id,
        },
        create: {
          clinicId,
          patientId,
          toothFdi,
          status,
          note: note?.trim() || null,
          createdById: req.user!.id,
        },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      });

      await prisma.activityLog.create({
        data: {
          clinicId,
          userId: req.user!.id,
          action: 'update',
          entityType: 'patient',
          entityId: patientId,
          description: `Diş ${toothFdi} güncellendi: ${status}`,
        },
      });

      res.json(record);
    } catch (err: any) {
      console.error('[dental-chart] save error:', safeErrorFields(err));
      res.status(500).json({ error: 'Failed to save tooth record' });
    }
  },
);

// DELETE /api/patients/:patientId/dental-chart/:toothFdi
router.delete(
  '/patients/:patientId/dental-chart/:toothFdi',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const toothFdi = parseInt(req.params.toothFdi as string, 10);

    if (!VALID_FDI.has(toothFdi)) {
      return res.status(400).json({ error: 'Invalid tooth FDI number' });
    }

    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    try {
      const record = await prisma.toothRecord.findFirst({
        where: { patientId, toothFdi, ...scope },
      });
      if (!record) return res.status(404).json({ error: 'Not found' });
      const clinicId = record.clinicId;

      await prisma.toothRecord.delete({ where: { patientId_toothFdi: { patientId, toothFdi } } });

      await prisma.activityLog.create({
        data: {
          clinicId,
          userId: req.user!.id,
          action: 'delete',
          entityType: 'patient',
          entityId: patientId,
          description: `Diş ${toothFdi} kaydı silindi`,
        },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error('[dental-chart] delete error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to delete tooth record' });
    }
  },
);

export default router;
