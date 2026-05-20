import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { practitionerPayoutSchema } from '../schemas/index.js';

const router = express.Router();

const payoutInclude = {
  practitioner: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  earnings: {
    select: {
      id: true, earningAmount: true, adminAdjustmentAmount: true,
      status: true, periodMonth: true, periodYear: true,
      patient: { select: { firstName: true, lastName: true } },
      service: { select: { name: true } },
    },
  },
};

// GET /api/practitioner-payouts
router.get('/practitioner-payouts', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { practitionerId, periodMonth, periodYear } = req.query;

  try {
    const where: any = { clinicId };
    if (practitionerId) where.practitionerId = String(practitionerId);
    if (periodMonth) where.periodMonth = Number(periodMonth);
    if (periodYear) where.periodYear = Number(periodYear);

    const payouts = await prisma.practitionerPayout.findMany({
      where, include: payoutInclude,
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(payouts);
  } catch {
    res.status(500).json({ error: 'Failed to fetch practitioner payouts' });
  }
});

// POST /api/practitioner-payouts
router.post('/practitioner-payouts', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = practitionerPayoutSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const practitioner = await prisma.user.findFirst({
      where: { id: validation.data.practitionerId, clinicId, role: 'doctor' },
    });
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    const { earningIds, ...payoutData } = validation.data;

    const payout = await prisma.practitionerPayout.create({
      data: { ...payoutData, clinicId, createdById: req.user!.id },
    });

    // Mark specified approved earnings as paid and link to this payout
    if (earningIds && earningIds.length > 0) {
      await prisma.practitionerEarning.updateMany({
        where: {
          id: { in: earningIds },
          clinicId,
          practitionerId: validation.data.practitionerId,
          status: 'approved',
        },
        data: { status: 'paid', payoutId: payout.id, paidAt: validation.data.paymentDate },
      });
    }

    const result = await prisma.practitionerPayout.findUnique({ where: { id: payout.id }, include: payoutInclude });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'practitioner_payout', entityId: payout.id,
      action: 'created',
      description: `${practitioner.firstName} ${practitioner.lastName} için ${payout.amount} tutarında ödeme kaydedildi. ${earningIds?.length ?? 0} kazanç ödendi olarak işaretlendi.`,
    });

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to create practitioner payout' });
  }
});

// GET /api/practitioner-payouts/:id
router.get('/practitioner-payouts/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const payout = await prisma.practitionerPayout.findFirst({ where: { id, clinicId }, include: payoutInclude });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    res.json(payout);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payout' });
  }
});

// DELETE /api/practitioner-payouts/:id
router.delete('/practitioner-payouts/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const payout = await prisma.practitionerPayout.findFirst({ where: { id, clinicId } });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });

    // Un-link earnings from this payout (revert to approved)
    await prisma.practitionerEarning.updateMany({
      where: { payoutId: id, clinicId },
      data: { status: 'approved', payoutId: null, paidAt: null },
    });

    await prisma.practitionerPayout.delete({ where: { id } });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'practitioner_payout', entityId: id,
      action: 'deleted', description: `Ödeme kaydı silindi, bağlı kazançlar onaylı duruma geri döndürüldü`,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete payout' });
  }
});

export default router;
