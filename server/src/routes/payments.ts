import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { paymentSchema } from '../schemas/index.js';
import { generateEarningFromPayment } from '../services/earningService.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { findPatientInClinic, findTreatmentCaseInClinic } from '../utils/relationGuards.js';
import { patientContactSelect } from '../utils/prismaSelects.js';

const router = express.Router();

// GET /api/payments
router.get('/payments', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const { patientId, treatmentCaseId, paymentStatus, paymentMethod, dateFrom, dateTo, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };

    if (normalizedRole === 'DENTIST') {
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
        patient: { select: patientContactSelect },
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
router.post('/payments', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const operatingPreferences = await getClinicOperatingPreferences(clinicId);
    const validation = paymentSchema.safeParse({
      ...req.body,
      currency: req.body.currency || operatingPreferences.currency,
    });
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        issues: validation.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const patient = await findPatientInClinic(validation.data.patientId, clinicId);
    if (!patient) return res.status(400).json({ error: 'Invalid patient' });

    if (validation.data.treatmentCaseId) {
      const tc = await findTreatmentCaseInClinic(validation.data.treatmentCaseId, clinicId, validation.data.patientId);
      if (!tc) return res.status(400).json({ error: 'Invalid treatment case' });
    }

    const payment = await prisma.payment.create({
      data: {
        ...validation.data,
        currency: validation.data.currency || operatingPreferences.currency,
        clinicId,
        createdById: req.user!.id,
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: payment.id,
      action: 'created',
      description: `Payment of ${payment.amount} ${payment.currency} recorded for ${patient.firstName} ${patient.lastName}`,
    });

    writeAuditLog({
      organizationId: req.user!.organizationId,
      clinicId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'payment_created',
      entityType: 'payment',
      entityId: payment.id,
      description: `Payment created: ${payment.amount} ${payment.currency} (${payment.paymentStatus})`,
      metadata: { amount: payment.amount, currency: payment.currency, paymentMethod: payment.paymentMethod, paymentStatus: payment.paymentStatus },
      ...extractRequestMeta(req),
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
router.put('/payments/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  const validation = paymentSchema.partial().safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation failed',
      issues: validation.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.payment.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });
    const clinicId = existing.clinicId;

    if (req.user!.normalizedRole === 'BILLING') {
      const bodyPatientId = validation.data.patientId;
      const bodyTCId = validation.data.treatmentCaseId;
      if (
        (bodyPatientId !== undefined && bodyPatientId !== existing.patientId) ||
        (bodyTCId !== undefined && bodyTCId !== existing.treatmentCaseId)
      ) {
        return res.status(403).json({ error: 'Billing users cannot change the patient or treatment case of an existing payment.' });
      }
    }

    const nextPatientId = validation.data.patientId ?? existing.patientId;
    const nextTreatmentCaseId = validation.data.treatmentCaseId === undefined
      ? existing.treatmentCaseId
      : validation.data.treatmentCaseId;

    const patient = await findPatientInClinic(nextPatientId, clinicId);
    if (!patient) return res.status(400).json({ error: 'Invalid patient' });

    if (nextTreatmentCaseId) {
      const treatmentCase = await findTreatmentCaseInClinic(nextTreatmentCaseId, clinicId, nextPatientId);
      if (!treatmentCase) return res.status(400).json({ error: 'Invalid treatment case' });
    }

    const updated = await prisma.payment.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment', entityId: id,
      action: 'updated', description: `Ödeme güncellendi`,
    });

    writeAuditLog({
      organizationId: req.user!.organizationId,
      clinicId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'payment_updated',
      entityType: 'payment',
      entityId: id,
      description: `Payment updated`,
      metadata: { paymentStatus: validation.data.paymentStatus },
      ...extractRequestMeta(req),
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
router.patch('/payments/:id/cancel', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
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

    writeAuditLog({
      organizationId: req.user!.organizationId,
      clinicId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'payment_cancelled',
      entityType: 'payment',
      entityId: id,
      description: `Payment cancelled: ${existing.amount} ${existing.currency}`,
      metadata: { amount: existing.amount, currency: existing.currency },
      ...extractRequestMeta(req),
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

// GET /api/payments/:id/receipt
router.get('/payments/:id/receipt', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
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
