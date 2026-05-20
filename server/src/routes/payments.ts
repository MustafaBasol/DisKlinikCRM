import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { paymentSchema } from '../schemas/index.js';
import { generateEarningFromPayment } from '../services/earningService.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';

const router = express.Router();

// GET /api/payments
router.get('/payments', authorize(['admin', 'billing', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const { role, id: userId } = req.user!;
  const { patientId, treatmentCaseId, paymentStatus, paymentMethod, dateFrom, dateTo, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };

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
      include: {
        patient: true,
        treatmentCase: {
          include: {
            practitioner: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(payments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// POST /api/payments
router.post('/payments', authorize(['admin', 'billing', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const validation = paymentSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const patient = await prisma.patient.findFirst({ where: { id: validation.data.patientId, organizationId: req.user!.organizationId } });
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

    // Auto-generate practitioner earning for paid payments
    if (payment.paymentStatus === 'paid') {
      generateEarningFromPayment(payment.id, clinicId, req.user!.id).catch(console.error);
    }

    res.json(payment);
  } catch {
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// PUT /api/payments/:id
router.put('/payments/:id', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  const validation = paymentSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.payment.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });
    const clinicId = existing.clinicId;

    const updated = await prisma.payment.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: id,
      action: 'updated', description: `Ödeme güncellendi`,
    });

    // Auto-generate practitioner earning if payment was just moved to 'paid'
    if (validation.data.paymentStatus === 'paid' && existing.paymentStatus !== 'paid') {
      generateEarningFromPayment(updated.id, clinicId, req.user!.id).catch(console.error);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

// PATCH /api/payments/:id/cancel
router.patch('/payments/:id/cancel', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.payment.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });
    const clinicId = existing.clinicId;

    const updated = await prisma.payment.update({
      where: { id },
      data: { paymentStatus: 'cancelled' },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: id,
      action: 'cancelled',
      description: `${existing.amount} ${existing.currency} tutarındaki ödeme iptal edildi`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

// GET /api/payments/:id/receipt
router.get('/payments/:id/receipt', authorize(['admin', 'billing', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const payment = await prisma.payment.findFirst({
      where: { id, clinicId: { in: accessibleIds } },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true, email: true } },
        treatmentCase: { select: { title: true, estimatedAmount: true, acceptedAmount: true, currency: true } },
        clinic: { select: { name: true, legalName: true, address: true, phone: true, email: true, currency: true } },
      },
    });

    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch {
    res.status(500).json({ error: 'Failed to fetch receipt data' });
  }
});

export default router;
