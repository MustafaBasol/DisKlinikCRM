import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';

const router = express.Router();

// GET /api/clinic/export-data — GDPR: Klinik verisinin tamamını JSON olarak indir
router.get(
  '/clinic/export-data',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId;

    try {
      const [
        clinic,
        users,
        patients,
        appointments,
        treatmentCases,
        payments,
        tasks,
        sentMessages,
        activityLogs,
        insuranceProvisions,
        inventoryItems,
      ] = await Promise.all([
        prisma.clinic.findUnique({ where: { id: clinicId } }),
        prisma.user.findMany({ where: { clinicId }, select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true } }),
        prisma.patient.findMany({ where: { clinicId, deletedAt: null } }),
        prisma.appointment.findMany({ where: { clinicId, deletedAt: null } }),
        prisma.treatmentCase.findMany({ where: { clinicId, deletedAt: null } }),
        prisma.payment.findMany({ where: { clinicId } }),
        prisma.task.findMany({ where: { clinicId } }),
        prisma.sentMessage.findMany({ where: { clinicId } }),
        prisma.activityLog.findMany({ where: { clinicId }, orderBy: { createdAt: 'desc' }, take: 10000 }),
        prisma.insuranceProvision.findMany({ where: { clinicId } }),
        prisma.inventoryItem.findMany({ where: { clinicId } }),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: req.user!.id,
        clinic,
        users,
        patients,
        appointments,
        treatmentCases,
        payments,
        tasks,
        sentMessages,
        activityLogs,
        insuranceProvisions,
        inventoryItems,
      };

      res.setHeader('Content-Disposition', `attachment; filename="clinic-export-${clinicId}-${Date.now()}.json"`);
      res.setHeader('Content-Type', 'application/json');

      writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'gdpr_export',
        entityType: 'clinic',
        entityId: clinicId,
        description: `GDPR data export triggered for clinic`,
        ...extractRequestMeta(req),
      });

      res.json(exportData);
    } catch {
      res.status(500).json({ error: 'Export failed. Please try again.' });
    }
  },
);

export default router;
