import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import {
  deductPackageExtraMaterialsIfReady,
  deductServiceMaterialsForCompletedProcedure,
  isTreatmentStockDeductionError,
  markPackageExtraStockDeductionFailed,
  markProcedureStockDeductionFailed,
} from '../services/treatmentStockDeduction.js';
import { triggerOnProcedureCompleted } from '../services/postTreatmentMessaging.js';

const router = express.Router();

const treatmentPackageSelect = {
  id: true,
  name: true,
  color: true,
  price: true,
  currency: true,
  pricingMode: true,
} as const;

const packageApplicationSelect = {
  id: true,
  totalPrice: true,
  totalDurationMinutes: true,
  currency: true,
  extraMaterialsDeductionStatus: true,
  treatmentPackage: { select: treatmentPackageSelect },
} as const;

const procedureResponseInclude = {
  service: { select: { id: true, name: true, basePrice: true, currency: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  packageApplication: { select: packageApplicationSelect },
  treatmentPackage: { select: treatmentPackageSelect },
  packageItem: { select: { id: true, quantity: true, sortOrder: true } },
} as const;

// GET /api/treatment-cases/:caseId/procedures — list procedures
router.get(
  '/treatment-cases/:caseId/procedures',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const caseId = getParam(req, 'caseId');

    try {
      const tc = await prisma.treatmentCase.findFirst({ where: { id: caseId, clinicId, deletedAt: null } });
      if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
      if (req.user!.normalizedRole === 'DENTIST' && tc.practitionerId !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const procedures = await prisma.treatmentPlanProcedure.findMany({
        where: { treatmentCaseId: caseId, clinicId },
        include: procedureResponseInclude,
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
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId as string;
    const patientId = getParam(req, 'patientId');

    try {
      const patientWhere: any = { id: patientId, clinicId, deletedAt: null };
      if (req.user!.normalizedRole === 'DENTIST') {
        patientWhere.OR = [
          { appointments: { some: { practitionerId: req.user!.id, deletedAt: null } } },
          { treatmentCases: { some: { practitionerId: req.user!.id, deletedAt: null } } },
        ];
      }
      const patient = await prisma.patient.findFirst({ where: patientWhere });
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const procedures = await prisma.treatmentPlanProcedure.findMany({
        where: { patientId, clinicId },
        include: {
          ...procedureResponseInclude,
          service: { select: { id: true, name: true, basePrice: true, currency: true } },
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
        select: { id: true, patientId: true, practitionerId: true },
      });
      if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
      if (req.user!.normalizedRole === 'DENTIST' && tc.practitionerId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (serviceId) {
        const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
        if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
      }

      const initialStatus = status ?? 'planned';
      const completingOnCreate = initialStatus === 'completed';
      const now = new Date();

      const procedure = await prisma.$transaction(async (tx) => {
        const created = await tx.treatmentPlanProcedure.create({
          data: {
            clinicId,
            treatmentCaseId: caseId,
            patientId: tc.patientId,
            toothFdi: toothFdi ? Number(toothFdi) : null,
            procedureName: procedureName.trim().substring(0, 200),
            serviceId: serviceId ?? null,
            status: initialStatus,
            notes: notes ? String(notes).substring(0, 500) : null,
            estimatedCost: estimatedCost ? Number(estimatedCost) : null,
            scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
            completedAt: completingOnCreate ? now : null,
            createdById: userId,
          },
          include: procedureResponseInclude,
        });

        if (!completingOnCreate) return created;

        const stockStatus = await deductServiceMaterialsForCompletedProcedure(tx, {
          id: created.id,
          clinicId: created.clinicId,
          treatmentCaseId: created.treatmentCaseId,
          serviceId: created.serviceId,
          procedureName: created.procedureName,
          packageApplicationId: created.packageApplicationId,
          treatmentPackageId: created.treatmentPackageId,
          stockDeductedAt: created.stockDeductedAt,
        }, userId);

        return tx.treatmentPlanProcedure.update({
          where: { id: created.id },
          data: {
            stockDeductedAt: now,
            stockDeductionStatus: stockStatus,
            stockDeductionError: null,
          },
          include: procedureResponseInclude,
        });
      });

      await logActivity({
        clinicId,
        userId,
        action: 'create',
        entityType: 'TreatmentPlanProcedure',
        entityId: procedure.id,
        description: `Prosedür eklendi: ${procedure.procedureName}${toothFdi ? ` (Diş ${toothFdi})` : ''}`,
      });

      if (completingOnCreate) {
        triggerOnProcedureCompleted({
          procedureId: procedure.id,
          clinicId,
          organizationId: req.user!.organizationId as string,
          patientId: procedure.patientId,
          treatmentCaseId: procedure.treatmentCaseId,
          serviceId: procedure.serviceId ?? undefined,
          packageApplicationId: (procedure as any).packageApplicationId ?? undefined,
        }).catch(() => {});
      }

      return res.status(201).json(procedure);
    } catch (err) {
      if (isTreatmentStockDeductionError(err)) {
        return res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          shortages: err.shortages,
        });
      }
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
      const tc = await prisma.treatmentCase.findFirst({
        where: { id: caseId, clinicId, deletedAt: null },
        select: { id: true, practitionerId: true },
      });
      if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
      if (req.user!.normalizedRole === 'DENTIST' && tc.practitionerId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const existing = await prisma.treatmentPlanProcedure.findFirst({
        where: { id, treatmentCaseId: caseId, clinicId },
      });
      if (!existing) return res.status(404).json({ error: 'Procedure not found' });

      if (serviceId) {
        const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
        if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
      }

      const targetServiceId = serviceId !== undefined ? (serviceId || null) : existing.serviceId;
      const targetStatus = status ?? existing.status;
      const completingNow = targetStatus === 'completed' && existing.status !== 'completed';
      const now = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        let stockDeductionStatus = existing.stockDeductionStatus;
        let stockDeductedAt = existing.stockDeductedAt;

        if (completingNow && !existing.stockDeductedAt) {
          stockDeductionStatus = await deductServiceMaterialsForCompletedProcedure(tx, {
            id: existing.id,
            clinicId: existing.clinicId,
            treatmentCaseId: existing.treatmentCaseId,
            serviceId: targetServiceId,
            procedureName: procedureName ? procedureName.trim().substring(0, 200) : existing.procedureName,
            packageApplicationId: existing.packageApplicationId,
            treatmentPackageId: existing.treatmentPackageId,
            stockDeductedAt: existing.stockDeductedAt,
          }, userId);
          stockDeductedAt = now;
        } else if (completingNow) {
          stockDeductionStatus = existing.stockDeductionStatus ?? 'deducted';
        }

        const procedure = await tx.treatmentPlanProcedure.update({
          where: { id },
          data: {
            toothFdi: toothFdi !== undefined ? (toothFdi ? Number(toothFdi) : null) : existing.toothFdi,
            procedureName: procedureName ? procedureName.trim().substring(0, 200) : existing.procedureName,
            serviceId: targetServiceId,
            status: targetStatus,
            notes: notes !== undefined ? (notes ? String(notes).substring(0, 500) : null) : existing.notes,
            estimatedCost: estimatedCost !== undefined ? (estimatedCost ? Number(estimatedCost) : null) : existing.estimatedCost,
            scheduledDate: scheduledDate !== undefined ? (scheduledDate ? new Date(scheduledDate) : null) : (existing as any).scheduledDate,
            completedAt: completingNow ? now : existing.completedAt,
            stockDeductedAt: completingNow ? stockDeductedAt : existing.stockDeductedAt,
            stockDeductionStatus: completingNow ? stockDeductionStatus : existing.stockDeductionStatus,
            stockDeductionError: completingNow ? null : existing.stockDeductionError,
          },
          include: procedureResponseInclude,
        });

        if (completingNow && procedure.packageApplicationId) {
          await deductPackageExtraMaterialsIfReady(tx, {
            id: procedure.id,
            clinicId: procedure.clinicId,
            treatmentCaseId: procedure.treatmentCaseId,
            serviceId: procedure.serviceId,
            procedureName: procedure.procedureName,
            packageApplicationId: procedure.packageApplicationId,
            treatmentPackageId: procedure.treatmentPackageId,
            stockDeductedAt: procedure.stockDeductedAt,
          }, userId, now);
        }

        return procedure;
      });

      await logActivity({
        clinicId,
        userId,
        action: 'update',
        entityType: 'TreatmentPlanProcedure',
        entityId: id,
        description: `Prosedür güncellendi: ${updated.procedureName} → ${updated.status}`,
      });

      if (completingNow) {
        triggerOnProcedureCompleted({
          procedureId: updated.id,
          clinicId,
          organizationId: req.user!.organizationId as string,
          patientId: updated.patientId,
          treatmentCaseId: updated.treatmentCaseId,
          serviceId: updated.serviceId ?? undefined,
          packageApplicationId: (updated as any).packageApplicationId ?? undefined,
        }).catch(() => {});
      }

      return res.json(updated);
    } catch (err) {
      if (isTreatmentStockDeductionError(err)) {
        try {
          await markProcedureStockDeductionFailed(id, clinicId, err.message);
          await markPackageExtraStockDeductionFailed(err.packageApplicationId, clinicId, err.message);
        } catch {
          // Failure markers are informational; the completion block itself already failed.
        }

        return res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          shortages: err.shortages,
        });
      }
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
      const tc = await prisma.treatmentCase.findFirst({
        where: { id: caseId, clinicId, deletedAt: null },
        select: { id: true, practitionerId: true },
      });
      if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
      if (req.user!.normalizedRole === 'DENTIST' && tc.practitionerId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

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
