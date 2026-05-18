import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// GET /api/reports/revenue
router.get('/reports/revenue', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { dateFrom, dateTo, groupBy: rawGroupBy, practitionerId, paymentMethod } = req.query;

  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: 'dateFrom and dateTo are required' });
  }

  const from = new Date(String(dateFrom));
  const to = new Date(String(dateTo));
  to.setHours(23, 59, 59, 999);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  const validGroupByValues = ['day', 'week', 'month'];
  const groupBy = validGroupByValues.includes(String(rawGroupBy)) ? String(rawGroupBy) : 'month';

  try {
    const baseWhere: any = {
      clinicId,
      paymentStatus: { in: ['paid', 'partial'] },
      paidAt: { gte: from, lte: to },
    };

    if (practitionerId) {
      baseWhere.treatmentCase = { practitionerId: String(practitionerId) };
    }
    if (paymentMethod) {
      baseWhere.paymentMethod = String(paymentMethod);
    }

    const [summary, pendingPayments, byMethod] = await Promise.all([
      prisma.payment.aggregate({
        where: baseWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.payment.aggregate({
        where: { clinicId, paymentStatus: 'pending' },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: baseWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
    ]);

    const totalRevenue = summary._sum.amount || 0;
    const totalCount = summary._count.id || 0;

    // By period — raw SQL for DATE_TRUNC (validated groupBy, parameterized values)
    const groupByTrunc = groupBy; // already validated against whitelist
    const byPeriodQuery = `
      SELECT
        TO_CHAR(DATE_TRUNC('${groupByTrunc}', "paidAt"), 'YYYY-MM-DD') as period,
        COALESCE(SUM(amount), 0)::float as revenue,
        COUNT(*)::int as count
      FROM "Payment"
      WHERE "clinicId" = $1
        AND "paymentStatus" IN ('paid', 'partial')
        AND "paidAt" >= $2
        AND "paidAt" <= $3
      GROUP BY DATE_TRUNC('${groupByTrunc}', "paidAt")
      ORDER BY DATE_TRUNC('${groupByTrunc}', "paidAt")
    `;
    const byPeriodRaw = await prisma.$queryRawUnsafe<{ period: string; revenue: number; count: number }[]>(
      byPeriodQuery, clinicId, from, to
    );

    // By practitioner — via treatmentCase link
    const paymentsWithTC = await prisma.payment.findMany({
      where: baseWhere,
      select: {
        amount: true,
        treatmentCase: {
          select: {
            practitioner: {
              select: { id: true, firstName: true, lastName: true, commissionRate: true },
            },
          },
        },
      },
    });

    const byPractitionerMap: Record<string, { practitionerId: string; firstName: string; lastName: string; commissionRate: number; revenue: number; count: number }> = {};
    for (const p of paymentsWithTC) {
      const practitioner = p.treatmentCase?.practitioner;
      if (practitioner) {
        if (!byPractitionerMap[practitioner.id]) {
          byPractitionerMap[practitioner.id] = {
            practitionerId: practitioner.id,
            firstName: practitioner.firstName,
            lastName: practitioner.lastName,
            commissionRate: practitioner.commissionRate,
            revenue: 0,
            count: 0,
          };
        }
        byPractitionerMap[practitioner.id].revenue += p.amount;
        byPractitionerMap[practitioner.id].count += 1;
      }
    }

    const byPractitioner = Object.values(byPractitionerMap).map(d => ({
      ...d,
      commissionAmount: Math.round(d.revenue * d.commissionRate) / 100,
    }));

    res.json({
      summary: {
        totalRevenue,
        totalCount,
        avgPerPayment: totalCount > 0 ? Math.round(totalRevenue / totalCount * 100) / 100 : 0,
        pendingAmount: pendingPayments._sum.amount || 0,
        pendingCount: pendingPayments._count.id || 0,
      },
      byPeriod: byPeriodRaw,
      byMethod: byMethod.map(m => ({
        method: m.paymentMethod,
        revenue: m._sum.amount || 0,
        count: m._count.id || 0,
      })),
      byPractitioner,
    });
  } catch (err) {
    console.error('Revenue report error:', err);
    res.status(500).json({ error: 'Failed to generate revenue report' });
  }
});

// GET /api/reports/revenue/export.csv
router.get('/reports/revenue/export.csv', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { dateFrom, dateTo, practitionerId, paymentMethod } = req.query;

  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });

  const from = new Date(String(dateFrom));
  const to = new Date(String(dateTo));
  to.setHours(23, 59, 59, 999);

  try {
    const where: any = {
      clinicId,
      paymentStatus: { in: ['paid', 'partial'] },
      paidAt: { gte: from, lte: to },
    };
    if (practitionerId) where.treatmentCase = { practitionerId: String(practitionerId) };
    if (paymentMethod) where.paymentMethod = String(paymentMethod);

    const payments = await prisma.payment.findMany({
      where,
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        treatmentCase: { select: { title: true, practitioner: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { paidAt: 'asc' },
    });

    const headers = ['Tarih', 'Hasta', 'Telefon', 'Tedavi', 'Hekim', 'Tutar', 'Para Birimi', 'Yöntem', 'Durum'];
    const rows = payments.map(p => [
      p.paidAt ? new Date(p.paidAt).toLocaleDateString('tr-TR') : '',
      `${p.patient.firstName} ${p.patient.lastName}`,
      p.patient.phone || '',
      p.treatmentCase?.title || '',
      p.treatmentCase?.practitioner ? `${p.treatmentCase.practitioner.firstName} ${p.treatmentCase.practitioner.lastName}` : '',
      p.amount.toString(),
      p.currency,
      p.paymentMethod,
      p.paymentStatus,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `gelir-raporu-${String(dateFrom)}-${String(dateTo)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM for Excel Turkish character support
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// GET /api/reports/doctor-performance
router.get('/reports/doctor-performance', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { dateFrom, dateTo } = req.query;

  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });

  const from = new Date(String(dateFrom));
  const to = new Date(String(dateTo));
  to.setHours(23, 59, 59, 999);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  try {
    const doctors = await prisma.user.findMany({
      where: { clinicId, role: 'doctor', isActive: true },
      select: { id: true, firstName: true, lastName: true, commissionRate: true },
    });

    const results = await Promise.all(doctors.map(async (doc) => {
      const [appointmentCount, completedAppointments, noShowCount, treatmentCasesOpened, treatmentCasesCompleted, revenueAgg] = await Promise.all([
        prisma.appointment.count({
          where: { clinicId, practitionerId: doc.id, startTime: { gte: from, lte: to }, status: { not: 'cancelled' } },
        }),
        prisma.appointment.count({
          where: { clinicId, practitionerId: doc.id, startTime: { gte: from, lte: to }, status: 'completed' },
        }),
        prisma.appointment.count({
          where: { clinicId, practitionerId: doc.id, startTime: { gte: from, lte: to }, status: 'no_show' },
        }),
        prisma.treatmentCase.count({
          where: { clinicId, practitionerId: doc.id, createdAt: { gte: from, lte: to } },
        }),
        prisma.treatmentCase.count({
          where: { clinicId, practitionerId: doc.id, stage: 'completed', closedAt: { gte: from, lte: to } },
        }),
        prisma.payment.aggregate({
          where: {
            clinicId,
            paymentStatus: { in: ['paid', 'partial'] },
            paidAt: { gte: from, lte: to },
            treatmentCase: { practitionerId: doc.id },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
      ]);

      const revenue = revenueAgg._sum.amount || 0;
      const commissionAmount = Math.round(revenue * doc.commissionRate) / 100;

      return {
        id: doc.id,
        firstName: doc.firstName,
        lastName: doc.lastName,
        commissionRate: doc.commissionRate,
        metrics: {
          appointmentCount,
          completedAppointments,
          noShowCount,
          completionRate: appointmentCount > 0 ? Math.round(completedAppointments / appointmentCount * 100) : 0,
          treatmentCasesOpened,
          treatmentCasesCompleted,
          revenue,
          revenueCount: revenueAgg._count.id || 0,
          commissionAmount,
          avgRevenuePerAppointment: completedAppointments > 0 ? Math.round(revenue / completedAppointments) : 0,
        },
      };
    }));

    res.json({ dateFrom: from.toISOString(), dateTo: to.toISOString(), doctors: results });
  } catch (err) {
    console.error('Doctor performance report error:', err);
    res.status(500).json({ error: 'Failed to generate doctor performance report' });
  }
});

export default router;
