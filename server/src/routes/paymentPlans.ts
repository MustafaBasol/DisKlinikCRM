import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';

const router = express.Router();

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function generateInstallments(totalAmount: number, count: number, firstDueDate: Date) {
  const baseAmount = Math.round(totalAmount / count * 100) / 100;
  const remainder = Math.round((totalAmount - baseAmount * count) * 100) / 100;

  return Array.from({ length: count }, (_, i) => ({
    installmentNo: i + 1,
    dueDate: addMonths(firstDueDate, i),
    amount: i === count - 1 ? Math.round((baseAmount + remainder) * 100) / 100 : baseAmount,
    status: 'pending',
  }));
}

// GET /api/payment-plans
router.get('/payment-plans', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const selectedClinicId = req.query.clinicId as string | undefined;
  const { patientId, status } = req.query;

  try {
    const clinicScope = await validateAndGetClinicIdScope(req.user!, selectedClinicId, res);
    if (clinicScope === false) return;

    const where: any = { ...clinicScope };
    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);

    const plans = await prisma.paymentPlan.findMany({
      where,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        treatmentCase: { select: { id: true, title: true } },
        installments: { orderBy: { installmentNo: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(plans);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payment plans' });
  }
});

// GET /api/payment-plans/:id
router.get('/payment-plans/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const plan = await prisma.paymentPlan.findFirst({
      where: { id, clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        treatmentCase: { select: { id: true, title: true, estimatedAmount: true, acceptedAmount: true } },
        installments: {
          orderBy: { installmentNo: 'asc' },
          include: { payment: { select: { id: true, paymentMethod: true, paidAt: true } } },
        },
      },
    });
    if (!plan) return res.status(404).json({ error: 'Payment plan not found' });
    res.json(plan);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payment plan' });
  }
});

// POST /api/payment-plans
router.post('/payment-plans', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { patientId, treatmentCaseId, totalAmount, currency, installmentCount, firstDueDate, description } = req.body;

  if (!patientId || !totalAmount || !installmentCount || !firstDueDate) {
    return res.status(400).json({ error: 'patientId, totalAmount, installmentCount, firstDueDate are required' });
  }
  if (installmentCount < 1 || installmentCount > 60) {
    return res.status(400).json({ error: 'installmentCount must be between 1 and 60' });
  }
  if (totalAmount <= 0) {
    return res.status(400).json({ error: 'totalAmount must be positive' });
  }

  try {
    const operatingPreferences = await getClinicOperatingPreferences(clinicId);
    const planCurrency = currency || operatingPreferences.currency;
    const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId } });
    if (!patient) return res.status(400).json({ error: 'Invalid patient' });

    if (treatmentCaseId) {
      const tc = await prisma.treatmentCase.findFirst({ where: { id: treatmentCaseId, clinicId, patientId } });
      if (!tc) return res.status(400).json({ error: 'Invalid treatment case' });
    }

    const firstDate = new Date(firstDueDate);
    if (isNaN(firstDate.getTime())) return res.status(400).json({ error: 'Invalid firstDueDate' });

    const installmentsData = generateInstallments(Number(totalAmount), Number(installmentCount), firstDate);

    const plan = await prisma.paymentPlan.create({
      data: {
        clinicId,
        patientId,
        treatmentCaseId: treatmentCaseId || null,
        totalAmount: Number(totalAmount),
        currency: planCurrency,
        installmentCount: Number(installmentCount),
        description: description || null,
        status: 'active',
        createdById: req.user!.id,
        installments: { create: installmentsData },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        installments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment_plan', entityId: plan.id,
      action: 'created',
      description: `${patient.firstName} ${patient.lastName} için ${totalAmount} ${planCurrency} tutarında ${installmentCount} taksitli plan oluşturuldu`,
      patientId,
    });

    res.status(201).json(plan);
  } catch (err) {
    console.error('Create payment plan error:', err);
    res.status(500).json({ error: 'Failed to create payment plan' });
  }
});

// POST /api/payment-plans/:id/installments/:installmentId/pay
router.post(
  '/payment-plans/:id/installments/:installmentId/pay',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const planId = getParam(req, 'id');
    const installmentId = getParam(req, 'installmentId');
    const clinicId = req.user!.clinicId;
    const { paymentMethod, notes } = req.body;

    if (!paymentMethod) return res.status(400).json({ error: 'paymentMethod is required' });

    try {
      const plan = await prisma.paymentPlan.findFirst({
        where: { id: planId, clinicId },
        include: { installments: true },
      });
      if (!plan) return res.status(404).json({ error: 'Payment plan not found' });
      if (plan.status === 'cancelled') return res.status(400).json({ error: 'Plan is cancelled' });

      const installment = plan.installments.find(i => i.id === installmentId);
      if (!installment) return res.status(404).json({ error: 'Installment not found' });
      if (installment.status === 'paid') return res.status(400).json({ error: 'Already paid' });

      const now = new Date();

      // Create actual payment record
      const payment = await prisma.payment.create({
        data: {
          clinicId,
          patientId: plan.patientId,
          treatmentCaseId: plan.treatmentCaseId,
          amount: installment.amount,
          currency: plan.currency,
          paymentMethod,
          paymentStatus: 'paid',
          paidAt: now,
          notes: notes || `Taksit ${installment.installmentNo}/${plan.installmentCount}`,
          createdById: req.user!.id,
        },
      });

      // Update installment
      await prisma.paymentPlanInstallment.update({
        where: { id: installmentId },
        data: { status: 'paid', paymentId: payment.id, paidAt: now },
      });

      // Check if all installments paid → complete plan
      const unpaidCount = plan.installments.filter(i => i.id !== installmentId && i.status !== 'paid').length;
      if (unpaidCount === 0) {
        await prisma.paymentPlan.update({ where: { id: planId }, data: { status: 'completed' } });
      }

      await logActivity({
        clinicId, userId: req.user!.id, entityType: 'payment_plan', entityId: planId,
        action: 'installment_paid',
        description: `Installment ${installment.installmentNo}/${plan.installmentCount} paid: ${installment.amount} ${plan.currency}`,
        patientId: plan.patientId,
      });

      res.json({ payment, unpaidCount });
    } catch (err) {
      console.error('Pay installment error:', err);
      res.status(500).json({ error: 'Failed to mark installment as paid' });
    }
  }
);

// PATCH /api/payment-plans/:id/cancel
router.patch('/payment-plans/:id/cancel', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const plan = await prisma.paymentPlan.findFirst({ where: { id, clinicId } });
    if (!plan) return res.status(404).json({ error: 'Payment plan not found' });

    const updated = await prisma.paymentPlan.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'payment_plan', entityId: id,
      action: 'cancelled', description: `Taksit planı iptal edildi`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to cancel payment plan' });
  }
});

export default router;
