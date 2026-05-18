import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { paymentSchema } from '../schemas/index.js';

const router = express.Router();

// GET /api/payments
router.get('/payments', authorize(['admin', 'billing', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { patientId, treatmentCaseId, paymentStatus, paymentMethod, dateFrom, dateTo } = req.query;

  try {
    const where: any = { clinicId };

    if (role === 'doctor') {
      where.OR = [
        { patient: { appointments: { some: { practitionerId: userId } } } },
        { treatmentCase: { practitionerId: userId } },
      ];
    }

    if (patientId) where.patientId = String(patientId);
    if (treatmentCaseId) where.treatmentCaseId = String(treatmentCaseId);
    if (paymentStatus) where.paymentStatus = String(paymentStatus);
    if (paymentMethod) where.paymentMethod = String(paymentMethod);

    if (dateFrom || dateTo) {
      where.paidAt = {};
      if (dateFrom) where.paidAt.gte = new Date(String(dateFrom));
      if (dateTo) where.paidAt.lte = new Date(String(dateTo));
    }

    const payments = await prisma.payment.findMany({
      where,
      include: { patient: true, treatmentCase: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(payments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// POST /api/payments
router.post('/payments', authorize(['admin', 'billing', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = paymentSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const patient = await prisma.patient.findFirst({ where: { id: validation.data.patientId, clinicId } });
    if (!patient) return res.status(400).json({ error: 'Invalid patient' });

    if (validation.data.treatmentCaseId) {
      const tc = await prisma.treatmentCase.findFirst({
        where: { id: validation.data.treatmentCaseId, clinicId, patientId: validation.data.patientId },
      });
      if (!tc) return res.status(400).json({ error: 'Invalid treatment case' });
    }

    const payment = await prisma.payment.create({
      data: { ...validation.data, clinicId, createdById: req.user!.id },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: payment.id,
      action: 'created',
      description: `Payment of ${payment.amount} ${payment.currency} recorded for ${patient.firstName} ${patient.lastName}`,
    });

    res.json(payment);
  } catch {
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// PUT /api/payments/:id
router.put('/payments/:id', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  const validation = paymentSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.payment.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });

    const updated = await prisma.payment.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: id,
      action: 'updated', description: `Payment ${id} updated`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

// PATCH /api/payments/:id/cancel
router.patch('/payments/:id/cancel', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const existing = await prisma.payment.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });

    const updated = await prisma.payment.update({
      where: { id },
      data: { paymentStatus: 'cancelled' },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: id,
      action: 'cancelled',
      description: `Payment of ${existing.amount} ${existing.currency} cancelled`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

export default router;
