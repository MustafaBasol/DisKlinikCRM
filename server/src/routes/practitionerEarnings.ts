import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { earningAdjustSchema } from '../schemas/index.js';

const router = express.Router();

const earningInclude = {
  practitioner: { select: { id: true, firstName: true, lastName: true } },
  patient: { select: { id: true, firstName: true, lastName: true } },
  treatmentCase: { select: { id: true, title: true } },
  service: { select: { id: true, name: true } },
  payout: { select: { id: true, paymentDate: true, amount: true, method: true } },
};

// GET /api/practitioner-earnings
// Admin/billing: all earnings; doctor: own only
router.get('/practitioner-earnings', authorize(['admin', 'billing', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { practitionerId, status, periodMonth, periodYear, page, limit } = req.query;

  const take = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  try {
    const where: any = { clinicId };

    if (role === 'doctor') {
      where.practitionerId = userId;
    } else if (practitionerId) {
      where.practitionerId = String(practitionerId);
    }

    if (status) where.status = String(status);
    if (periodMonth) where.periodMonth = Number(periodMonth);
    if (periodYear) where.periodYear = Number(periodYear);

    const [earnings, total] = await Promise.all([
      prisma.practitionerEarning.findMany({
        where, include: earningInclude,
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
        take, skip,
      }),
      prisma.practitionerEarning.count({ where }),
    ]);

    res.json({ earnings, total, page: Number(page) || 1, limit: take });
  } catch {
    res.status(500).json({ error: 'Failed to fetch practitioner earnings' });
  }
});

// GET /api/practitioner-earnings/summary — period-based summary per practitioner
router.get('/practitioner-earnings/summary', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { periodMonth, periodYear, practitionerId } = req.query;

  try {
    const where: any = { clinicId };
    if (periodMonth) where.periodMonth = Number(periodMonth);
    if (periodYear) where.periodYear = Number(periodYear);
    if (practitionerId) where.practitionerId = String(practitionerId);

    const earnings = await prisma.practitionerEarning.findMany({
      where,
      include: { practitioner: { select: { id: true, firstName: true, lastName: true } } },
    });

    // Aggregate per practitioner
    const map = new Map<string, any>();
    for (const e of earnings) {
      const pid = e.practitionerId;
      if (!map.has(pid)) {
        map.set(pid, {
          practitionerId: pid,
          practitionerName: `${e.practitioner.firstName} ${e.practitioner.lastName}`,
          totalGross: 0, totalCollected: 0, totalEarning: 0,
          approvedEarning: 0, paidEarning: 0, pendingEarning: 0,
          count: 0,
        });
      }
      const agg = map.get(pid)!;
      agg.totalGross += e.grossAmount;
      agg.totalCollected += e.collectedAmount;
      const amount = e.adminAdjustmentAmount ?? e.earningAmount;
      agg.totalEarning += amount;
      if (e.status === 'approved') agg.approvedEarning += amount;
      else if (e.status === 'paid') agg.paidEarning += amount;
      else if (e.status === 'pending') agg.pendingEarning += amount;
      agg.count++;
    }

    res.json(Array.from(map.values()));
  } catch {
    res.status(500).json({ error: 'Failed to fetch earnings summary' });
  }
});

// GET /api/practitioner-earnings/:id
router.get('/practitioner-earnings/:id', authorize(['admin', 'billing', 'doctor']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const earning = await prisma.practitionerEarning.findFirst({
      where: { id, clinicId },
      include: earningInclude,
    });
    if (!earning) return res.status(404).json({ error: 'Earning not found' });

    if (role === 'doctor' && earning.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(earning);
  } catch {
    res.status(500).json({ error: 'Failed to fetch earning' });
  }
});

// PATCH /api/practitioner-earnings/:id/approve
router.patch('/practitioner-earnings/:id/approve', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const earning = await prisma.practitionerEarning.findFirst({ where: { id, clinicId } });
    if (!earning) return res.status(404).json({ error: 'Earning not found' });
    if (earning.status !== 'pending') return res.status(400).json({ error: 'Only pending earnings can be approved' });

    const updated = await prisma.practitionerEarning.update({
      where: { id },
      data: { status: 'approved', approvedAt: new Date(), approvedById: req.user!.id },
      include: earningInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'practitioner_earning', entityId: id,
      action: 'approved',
      description: `Earning of ${earning.earningAmount.toFixed(2)} approved for ${updated.practitioner.firstName} ${updated.practitioner.lastName}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to approve earning' });
  }
});

// PATCH /api/practitioner-earnings/:id/adjust
router.patch('/practitioner-earnings/:id/adjust', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  const validation = earningAdjustSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const earning = await prisma.practitionerEarning.findFirst({
      where: { id, clinicId },
      include: { practitioner: { select: { firstName: true, lastName: true } } },
    });
    if (!earning) return res.status(404).json({ error: 'Earning not found' });
    if (earning.status === 'paid' || earning.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot adjust a paid or cancelled earning' });
    }

    const { adminAdjustmentAmount, adminAdjustmentReason } = validation.data;

    const updated = await prisma.practitionerEarning.update({
      where: { id },
      data: { adminAdjustmentAmount, adminAdjustmentReason },
      include: earningInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'practitioner_earning', entityId: id,
      action: 'adjusted',
      description: `Admin adjusted earning for ${earning.practitioner.firstName} ${earning.practitioner.lastName} from ${earning.earningAmount.toFixed(2)} to ${adminAdjustmentAmount.toFixed(2)}. Reason: ${adminAdjustmentReason}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to adjust earning' });
  }
});

// PATCH /api/practitioner-earnings/:id/cancel
router.patch('/practitioner-earnings/:id/cancel', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const earning = await prisma.practitionerEarning.findFirst({ where: { id, clinicId } });
    if (!earning) return res.status(404).json({ error: 'Earning not found' });
    if (earning.status === 'paid') return res.status(400).json({ error: 'Cannot cancel a paid earning' });

    const updated = await prisma.practitionerEarning.update({
      where: { id },
      data: { status: 'cancelled' },
      include: earningInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'practitioner_earning', entityId: id,
      action: 'cancelled', description: `Earning cancelled`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to cancel earning' });
  }
});

// PATCH /api/practitioner-earnings/:id/mark-paid
router.patch('/practitioner-earnings/:id/mark-paid', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const earning = await prisma.practitionerEarning.findFirst({ where: { id, clinicId } });
    if (!earning) return res.status(404).json({ error: 'Earning not found' });
    if (earning.status !== 'approved') return res.status(400).json({ error: 'Only approved earnings can be marked as paid' });

    const updated = await prisma.practitionerEarning.update({
      where: { id },
      data: { status: 'paid', paidAt: new Date() },
      include: earningInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'practitioner_earning', entityId: id,
      action: 'paid', description: `Earning marked as paid`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to mark earning as paid' });
  }
});

export default router;
