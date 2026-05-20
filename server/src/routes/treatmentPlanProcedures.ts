import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';

const router = express.Router();

// GET /api/treatment-cases/:caseId/procedures — list procedures
router.get(
  '/treatment-cases/:caseId/procedures',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const caseId = getParam(req, 'caseId');

    try {
      const tc = await prisma.treatmentCase.findFirst({ where: { id: caseId, clinicId, deletedAt: null } });
      if (!tc) return res.status(404).json({ error: 'Treatment case not found' });

      const procedures = await prisma.treatmentPlanProcedure.findMany({
        where: { treatmentCaseId: caseId, clinicId },
        include: {
          service: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });

      return res.json(procedures);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch procedures' });
    }
  },
);

// GET /api/patients/:patientId/treatment-procedures — all procedures for dental chart overlay
router.get(
  '/patients/:patientId/treatment-procedures',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const patientId = getParam(req, 'patientId');

    try {
      const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } });
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const procedures = await prisma.treatmentPlanProcedure.findMany({
        where: { patientId, clinicId },
        include: {
          service: { select: { id: true, name: true } },
          treatmentCase: { select: { id: true, title: true, stage: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json(procedures);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch treatment procedures' });
    }
  },
);

// POST /api/treatment-cases/:caseId/procedures — create procedure
router.post(
  '/treatment-cases/:caseId/procedures',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const userId = req.user!.id as string;
    const caseId = getParam(req, 'caseId');

    const { toothFdi, procedureName, serviceId, status, notes, estimatedCost, scheduledDate } = req.body;

    if (!procedureName || typeof procedureName !== 'string' || !procedureName.trim()) {
      return res.status(400).json({ error: 'procedureName is required' });
    }

    try {
      const tc = await prisma.treatmentCase.findFirst({
        where: { id: caseId, clinicId, deletedAt: null },
        select: { id: true, patientId: true },
      });
      if (!tc) return res.status(404).json({ error: 'Treatment case not found' });

      if (serviceId) {
        const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
        if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
      }

      const procedure = await prisma.treatmentPlanProcedure.create({
        data: {
          clinicId,
          treatmentCaseId: caseId,
          patientId: tc.patientId,
          toothFdi: toothFdi ? Number(toothFdi) : null,
          procedureName: procedureName.trim().substring(0, 200),
          serviceId: serviceId ?? null,
          status: status ?? 'planned',
          notes: notes ? String(notes).substring(0, 500) : null,
          estimatedCost: estimatedCost ? Number(estimatedCost) : null,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          createdById: userId,
        },
        include: {
          service: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await logActivity({
        clinicId,
        userId,
        action: 'create',
        entityType: 'TreatmentPlanProcedure',
        entityId: procedure.id,
        description: `Prosedür eklendi: ${procedure.procedureName}${toothFdi ? ` (Diş ${toothFdi})` : ''}`,
      });

      return res.status(201).json(procedure);
    } catch {
      return res.status(500).json({ error: 'Failed to create procedure' });
    }
  },
);

// PUT /api/treatment-cases/:caseId/procedures/:id — update procedure
router.put(
  '/treatment-cases/:caseId/procedures/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const userId = req.user!.id as string;
    const caseId = getParam(req, 'caseId');
    const id = getParam(req, 'id');

    const { toothFdi, procedureName, serviceId, status, notes, estimatedCost, scheduledDate } = req.body;

    try {
      const existing = await prisma.treatmentPlanProcedure.findFirst({
        where: { id, treatmentCaseId: caseId, clinicId },
      });
      if (!existing) return res.status(404).json({ error: 'Procedure not found' });

      if (serviceId) {
        const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
        if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
      }

      const updated = await prisma.treatmentPlanProcedure.update({
        where: { id },
        data: {
          toothFdi: toothFdi !== undefined ? (toothFdi ? Number(toothFdi) : null) : existing.toothFdi,
          procedureName: procedureName ? procedureName.trim().substring(0, 200) : existing.procedureName,
          serviceId: serviceId !== undefined ? (serviceId || null) : existing.serviceId,
          status: status ?? existing.status,
          notes: notes !== undefined ? (notes ? String(notes).substring(0, 500) : null) : existing.notes,
          estimatedCost: estimatedCost !== undefined ? (estimatedCost ? Number(estimatedCost) : null) : existing.estimatedCost,
          scheduledDate: scheduledDate !== undefined ? (scheduledDate ? new Date(scheduledDate) : null) : (existing as any).scheduledDate,
          completedAt: status === 'completed' && existing.status !== 'completed' ? new Date() : existing.completedAt,
        },
        include: {
          service: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await logActivity({
        clinicId,
        userId,
        action: 'update',
        entityType: 'TreatmentPlanProcedure',
        entityId: id,
        description: `Prosedür güncellendi: ${updated.procedureName} → ${updated.status}`,
      });

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to update procedure' });
    }
  },
);

// DELETE /api/treatment-cases/:caseId/procedures/:id — delete procedure
router.delete(
  '/treatment-cases/:caseId/procedures/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const userId = req.user!.id as string;
    const caseId = getParam(req, 'caseId');
    const id = getParam(req, 'id');

    try {
      const existing = await prisma.treatmentPlanProcedure.findFirst({
        where: { id, treatmentCaseId: caseId, clinicId },
      });
      if (!existing) return res.status(404).json({ error: 'Procedure not found' });

      await prisma.treatmentPlanProcedure.delete({ where: { id } });

      await logActivity({
        clinicId,
        userId,
        action: 'delete',
        entityType: 'TreatmentPlanProcedure',
        entityId: id,
        description: `Prosedür silindi: ${existing.procedureName}`,
      });

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to delete procedure' });
    }
  },
);

export default router;
