import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { insuranceProvisionSchema, insuranceProvisionUpdateSchema, insuranceStatusSchema } from '../schemas/index.js';

const router = express.Router();

const insuranceInclude = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  treatmentCase: { select: { id: true, title: true, estimatedAmount: true, currency: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

const getInsuranceDoctorScope = (userId: string) => ({
  OR: [
    { treatmentCase: { practitionerId: userId } },
    { patient: { appointments: { some: { practitionerId: userId } } } },
  ],
});

async function validateInsuranceRelations(data: any, clinicId: string) {
  const patient = data.patientId
    ? await prisma.patient.findFirst({ where: { id: data.patientId, clinicId, deletedAt: null } })
    : null;
  if (data.patientId && !patient) return { error: 'Invalid patient' };

  if (data.treatmentCaseId) {
    const treatmentCase = await prisma.treatmentCase.findFirst({
      where: {
        id: data.treatmentCaseId,
        clinicId,
        deletedAt: null,
        ...(data.patientId ? { patientId: data.patientId } : {}),
      },
    });
    if (!treatmentCase) return { error: 'Invalid treatment case' };
  }

  if (data.assignedToId) {
    const assignee = await prisma.user.findFirst({ where: { id: data.assignedToId, clinicId, isActive: true } });
    if (!assignee) return { error: 'Invalid assignee' };
  }

  return { patient };
}

// GET /api/insurance-provisions
router.get('/insurance-provisions', authorize(['admin', 'receptionist', 'billing', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { status, insurance_type, patient_id, treatment_case_id, provider_name } = req.query;

  try {
    const where: any = { clinicId };
    if (role === 'doctor') Object.assign(where, getInsuranceDoctorScope(userId));
    if (status) where.status = String(status);
    if (insurance_type) where.insuranceType = String(insurance_type);
    if (patient_id) where.patientId = String(patient_id);
    if (treatment_case_id) where.treatmentCaseId = String(treatment_case_id);
    if (provider_name) where.insuranceProviderName = { contains: String(provider_name) };

    const provisions = await prisma.insuranceProvision.findMany({
      where,
      include: insuranceInclude,
      orderBy: { updatedAt: 'desc' },
    });

    res.json(provisions);
  } catch {
    res.status(500).json({ error: 'Failed to fetch insurance provisions' });
  }
});

// GET /api/insurance-provisions/:id
router.get('/insurance-provisions/:id', authorize(['admin', 'receptionist', 'billing', 'doctor']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const where: any = { id, clinicId };
    if (role === 'doctor') Object.assign(where, getInsuranceDoctorScope(userId));

    const provision = await prisma.insuranceProvision.findFirst({
      where,
      include: {
        ...insuranceInclude,
        activityLogs: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!provision) return res.status(404).json({ error: 'Insurance provision not found' });
    res.json(provision);
  } catch {
    res.status(500).json({ error: 'Failed to fetch insurance provision' });
  }
});

// POST /api/insurance-provisions
router.post('/insurance-provisions', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = insuranceProvisionSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const relationValidation = await validateInsuranceRelations(validation.data, clinicId);
    if (relationValidation.error) return res.status(400).json({ error: relationValidation.error });

    const provision = await prisma.insuranceProvision.create({
      data: { ...validation.data, clinicId, createdById: req.user!.id },
      include: insuranceInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'insurance_provision', entityId: provision.id,
      patientId: provision.patientId, treatmentCaseId: provision.treatmentCaseId,
      action: 'created', description: `${provision.insuranceProviderName} için sigorta provizyon kaydı oluşturuldu`,
    });

    res.json(provision);
  } catch {
    res.status(500).json({ error: 'Failed to create insurance provision' });
  }
});

// PUT /api/insurance-provisions/:id
router.put('/insurance-provisions/:id', authorize(['admin', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  const validation = insuranceProvisionUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.insuranceProvision.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Insurance provision not found' });

    const updateData: any = { ...validation.data };
    if (role === 'billing') {
      const allowed = ['status', 'approvedAmount', 'patientResponsibilityAmount', 'currency', 'respondedAt', 'rejectionReason', 'notes', 'provisionNumber'];
      for (const key of Object.keys(updateData)) {
        if (!allowed.includes(key)) delete updateData[key];
      }
    }

    const relationValidation = await validateInsuranceRelations(
      { ...existing, ...updateData, patientId: updateData.patientId || existing.patientId },
      clinicId,
    );
    if (relationValidation.error) return res.status(400).json({ error: relationValidation.error });

    const updated = await prisma.insuranceProvision.update({
      where: { id },
      data: updateData,
      include: insuranceInclude,
    });

    await logActivity({
      clinicId, userId, entityType: 'insurance_provision', entityId: id,
      patientId: updated.patientId, treatmentCaseId: updated.treatmentCaseId,
      action: updated.status !== existing.status ? `status_${updated.status}` : 'updated',
      description: updated.status !== existing.status
        ? `${updated.insuranceProviderName} provizyon durumu güncellendi: ${existing.status} → ${updated.status}`
        : `${updated.insuranceProviderName} sigorta provizyon kaydı güncellendi`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update insurance provision' });
  }
});

// PATCH /api/insurance-provisions/:id/status
router.patch('/insurance-provisions/:id/status', authorize(['admin', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { id: userId } = req.user!;
  const validation = insuranceStatusSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.insuranceProvision.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Insurance provision not found' });

    const status = validation.data.status;
    const updated = await prisma.insuranceProvision.update({
      where: { id },
      data: {
        ...validation.data,
        respondedAt: validation.data.respondedAt || (['approved', 'partially_approved', 'rejected'].includes(status) ? new Date() : undefined),
      },
      include: insuranceInclude,
    });

    await logActivity({
      clinicId, userId, entityType: 'insurance_provision', entityId: id,
      patientId: updated.patientId, treatmentCaseId: updated.treatmentCaseId,
      action: `status_${status}`,
      description: `Insurance provision status changed from ${existing.status} to ${status}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update insurance provision status' });
  }
});

// PATCH /api/insurance-provisions/:id/cancel
router.patch('/insurance-provisions/:id/cancel', authorize(['admin', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { id: userId } = req.user!;

  try {
    const existing = await prisma.insuranceProvision.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Insurance provision not found' });

    const updated = await prisma.insuranceProvision.update({
      where: { id },
      data: { status: 'cancelled' },
      include: insuranceInclude,
    });

    await logActivity({
      clinicId, userId, entityType: 'insurance_provision', entityId: id,
      patientId: updated.patientId, treatmentCaseId: updated.treatmentCaseId,
      action: 'status_cancelled',
      description: `${updated.insuranceProviderName} sigorta provizyon kaydı iptal edildi`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to cancel insurance provision' });
  }
});

export default router;
