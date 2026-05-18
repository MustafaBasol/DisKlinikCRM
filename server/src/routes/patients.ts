import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { patientSchema, patientUpdateSchema } from '../schemas/index.js';

const router = express.Router();

// GET /api/patients
router.get('/patients', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { search, status, source, includeArchived } = req.query;

  try {
    const where: any = { clinicId, deletedAt: null };

    if (search) {
      where.OR = [
        { firstName: { contains: String(search) } },
        { lastName: { contains: String(search) } },
        { email: { contains: String(search) } },
        { phone: { contains: String(search) } },
      ];
    }

    if (status) {
      where.patientStatus = String(status);
    } else if (includeArchived !== 'true') {
      where.patientStatus = { not: 'archived' };
    }

    if (source) where.source = String(source);

    const patients = await prisma.patient.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(patients);
  } catch {
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// GET /api/patients/:id
router.get('/patients/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const patient = await prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: {
        appointments: {
          include: { practitioner: true, appointmentType: true },
          orderBy: { startTime: 'desc' },
        },
        activityLogs: {
          include: { user: true },
          orderBy: { createdAt: 'desc' },
        },
        whatsappConversationMessages: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        insuranceProvisions: {
          include: { treatmentCase: true, assignedTo: true },
          orderBy: { updatedAt: 'desc' },
        },
        treatmentCases: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        },
        tasks: { orderBy: { dueDate: 'asc' } },
        payments: {
          where: { paymentStatus: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch {
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// POST /api/patients
router.post('/patients', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = patientSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const patient = await prisma.patient.create({ data: { ...validation.data, clinicId } });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'patient', entityId: patient.id,
      action: 'created',
      description: `Patient ${patient.firstName} ${patient.lastName} created`,
    });

    res.json(patient);
  } catch {
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// PUT /api/patients/:id
router.put('/patients/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  const validation = patientUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existingPatient = await prisma.patient.findFirst({ where: { id, clinicId, deletedAt: null } });
    if (!existingPatient) return res.status(404).json({ error: 'Patient not found' });

    if (role === 'doctor') {
      const hasAppointment = await prisma.appointment.findFirst({
        where: { patientId: id, practitionerId: userId, clinicId },
      });
      if (!hasAppointment) return res.status(403).json({ error: 'Forbidden: You can only update your own patients' });
    }

    const patient = await prisma.patient.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId, userId, entityType: 'patient', entityId: patient.id,
      action: 'updated',
      description: `Patient ${patient.firstName} ${patient.lastName} updated`,
    });

    res.json(patient);
  } catch {
    res.status(500).json({ error: 'Failed to update patient' });
  }
});

// DELETE /api/patients/:id (soft delete)
router.delete('/patients/:id', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const patient = await prisma.patient.findFirst({ where: { id, clinicId, deletedAt: null } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    await prisma.patient.update({
      where: { id },
      data: { patientStatus: 'archived', deletedAt: new Date() },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'patient', entityId: id,
      action: 'archived',
      description: `Patient ${patient.firstName} ${patient.lastName} archived`,
    });

    res.json({ message: 'Patient archived successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to archive patient' });
  }
});

export default router;
