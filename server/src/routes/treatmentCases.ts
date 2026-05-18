import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { treatmentCaseSchema } from '../schemas/index.js';
import { generateEarningFromTreatmentCase } from '../services/earningService.js';

const router = express.Router();

const treatmentCaseInclude = {
  patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  practitioner: { select: { id: true, firstName: true, lastName: true } },
  appointments: {
    where: { deletedAt: null },
    include: { appointmentType: { select: { id: true, name: true } }, practitioner: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { startTime: 'asc' as const },
  },
  payments: { orderBy: { createdAt: 'desc' as const } },
};

// GET /api/treatment-cases
router.get('/treatment-cases', authorize(['admin', 'doctor', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { status, patientId, practitionerId } = req.query;

  try {
    const where: any = { clinicId };

    if (role === 'doctor') where.practitionerId = userId;
    else if (practitionerId) where.practitionerId = String(practitionerId);

    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);

    const cases = await prisma.treatmentCase.findMany({
      where,
      include: treatmentCaseInclude,
      orderBy: { createdAt: 'desc' },
    });

    res.json(cases);
  } catch {
    res.status(500).json({ error: 'Failed to fetch treatment cases' });
  }
});

// GET /api/treatment-cases/:id
router.get('/treatment-cases/:id', authorize(['admin', 'doctor', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const tc = await prisma.treatmentCase.findFirst({
      where: { id, clinicId },
      include: {
        ...treatmentCaseInclude,
        activityLogs: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!tc) return res.status(404).json({ error: 'Treatment case not found' });

    if (role === 'doctor' && tc.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(tc);
  } catch {
    res.status(500).json({ error: 'Failed to fetch treatment case' });
  }
});

// POST /api/treatment-cases
router.post('/treatment-cases', authorize(['admin', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = treatmentCaseSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const practitionerId = validation.data.practitionerId ?? undefined;
    const [patient, practitioner] = await Promise.all([
      prisma.patient.findFirst({ where: { id: validation.data.patientId, clinicId, deletedAt: null } }),
      practitionerId ? prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor' } }) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (practitionerId && !practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    const tc = await prisma.treatmentCase.create({
      data: { ...validation.data, clinicId },
      include: treatmentCaseInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'treatment_case', entityId: tc.id,
      action: 'created', description: `${patient.firstName} ${patient.lastName} için "${tc.title}" tedavi vakası oluşturuldu`,
    });

    // Auto-generate practitioner earning when TC is created with a known cost (billed base)
    if (tc.practitionerId && (tc.estimatedAmount || tc.acceptedAmount)) {
      generateEarningFromTreatmentCase(tc.id, clinicId, req.user!.id).catch(console.error);
    }

    res.json(tc);
  } catch {
    res.status(500).json({ error: 'Failed to create treatment case' });
  }
});

// PUT /api/treatment-cases/:id
router.put('/treatment-cases/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  const validation = treatmentCaseSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.treatmentCase.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Treatment case not found' });

    if (role === 'doctor' && existing.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await prisma.treatmentCase.update({
      where: { id },
      data: validation.data,
      include: treatmentCaseInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'treatment_case', entityId: id,
      action: 'updated', description: `"${updated.title}" tedavi vakası güncellendi`,
    });

    // Auto-generate practitioner earning when treatment case has a known cost (billed base)
    // Covers: initial cost set, cost updated, and stage=completed
    if (updated.practitionerId && (updated.estimatedAmount || updated.acceptedAmount)) {
      generateEarningFromTreatmentCase(id, clinicId, req.user!.id).catch(console.error);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update treatment case' });
  }
});

export default router;
