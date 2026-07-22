import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';

const router = express.Router();

// FDI tooth numbers (valid range)
const VALID_FDI = new Set([
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]);

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
      console.error('[dental-chart] save error:', err?.message ?? err);
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
