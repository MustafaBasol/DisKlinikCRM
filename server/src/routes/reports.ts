import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { validateAndGetClinicIdScope, clinicIdsFromScope } from '../utils/clinicScope.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';

const router = express.Router();

// GET /api/reports/revenue
router.get('/reports/revenue', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { dateFrom, dateTo, groupBy: rawGroupBy, practitionerId, paymentMethod, clinicId: selectedClinicId } = req.query;

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
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const baseWhere: any = {
      ...scope,
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
        where: { ...scope, paymentStatus: 'pending' },
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
    // Scope'taki TÜM klinik id'leri kullanılır (tek klinik veya `all` — asla
    // req.user.clinicId'ye sessizce daraltılmaz; bkz. KVKK-HIGH-006-S3 kapsam düzeltmesi)
    const groupByTrunc = groupBy; // already validated against whitelist
    const scopedClinicIds = clinicIdsFromScope(scope);
    const byPeriodQuery = `
      SELECT
        TO_CHAR(DATE_TRUNC('${groupByTrunc}', "paidAt"), 'YYYY-MM-DD') as period,
        COALESCE(SUM(amount), 0)::float as revenue,
        COUNT(*)::int as count
      FROM "Payment"
      WHERE "clinicId" = ANY($1::text[])
        AND "paymentStatus" IN ('paid', 'partial')
        AND "paidAt" >= $2
        AND "paidAt" <= $3
      GROUP BY DATE_TRUNC('${groupByTrunc}', "paidAt")
      ORDER BY DATE_TRUNC('${groupByTrunc}', "paidAt")
    `;
    const byPeriodRaw = await prisma.$queryRawUnsafe<{ period: string; revenue: number; count: number }[]>(
      byPeriodQuery, scopedClinicIds, from, to
    );

    // By practitioner — fetch commission rates separately (avoids select validation on old Prisma client)
    const [paymentsWithTC, doctorCommissions] = await Promise.all([
      prisma.payment.findMany({
        where: baseWhere,
        select: {
          amount: true,
          treatmentCase: {
            select: {
              practitioner: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: { ...scope, role: 'doctor', isActive: true },
        select: { id: true },
      }),
    ]);

    // Build commission rate map — safe regardless of whether commissionRate exists in client
    const commissionRateMap = new Map<string, number>();
    for (const doc of doctorCommissions) {
      commissionRateMap.set(doc.id, (doc as any).commissionRate ?? 0);
    }

    const byPractitionerMap: Record<string, { practitionerId: string; firstName: string; lastName: string; commissionRate: number; revenue: number; count: number }> = {};
    for (const p of paymentsWithTC) {
      const practitioner = p.treatmentCase?.practitioner;
      if (practitioner) {
        if (!byPractitionerMap[practitioner.id]) {
          byPractitionerMap[practitioner.id] = {
            practitionerId: practitioner.id,
            firstName: practitioner.firstName,
            lastName: practitioner.lastName,
            commissionRate: commissionRateMap.get(practitioner.id) ?? 0,
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
router.get('/reports/revenue/export.csv', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { dateFrom, dateTo, practitionerId, paymentMethod, clinicId: selectedClinicId } = req.query;

  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });

  const from = new Date(String(dateFrom));
  const to = new Date(String(dateTo));
  to.setHours(23, 59, 59, 999);

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = {
      ...scope,
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

    const operatingPreferences = await getClinicOperatingPreferences(
      typeof selectedClinicId === 'string' && selectedClinicId !== 'all' ? selectedClinicId : req.user!.clinicId,
    );
    const csvDateFormatter = new Intl.DateTimeFormat(operatingPreferences.locale, {
      timeZone: operatingPreferences.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const headers = ['Tarih', 'Hasta', 'Telefon', 'Tedavi', 'Hekim', 'Tutar', 'Para Birimi', 'Yöntem', 'Durum'];
    const rows = payments.map(p => [
      p.paidAt ? csvDateFormatter.format(new Date(p.paidAt)) : '',
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
router.get('/reports/doctor-performance', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { dateFrom, dateTo, clinicId: selectedClinicId } = req.query;

  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });

  const from = new Date(String(dateFrom));
  const to = new Date(String(dateTo));
  to.setHours(23, 59, 59, 999);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const doctors = await prisma.user.findMany({
      where: { ...scope, role: 'doctor', isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    // Pre-fetch all treatment case IDs grouped by practitioner (avoids nested relation
    // filter inside aggregate which is unreliable for nullable relations in Prisma)
    const allDoctorCases = await prisma.treatmentCase.findMany({
      where: { ...scope, practitionerId: { in: doctors.map(d => d.id) } },
      select: { id: true, practitionerId: true },
    });
    const caseIdsByDoctor = new Map<string, string[]>();
    for (const tc of allDoctorCases) {
      if (tc.practitionerId) {
        const list = caseIdsByDoctor.get(tc.practitionerId) ?? [];
        list.push(tc.id);
        caseIdsByDoctor.set(tc.practitionerId, list);
      }
    }

    const results = await Promise.all(doctors.map(async (doc) => {
      const doctorCaseIds = caseIdsByDoctor.get(doc.id) ?? [];

      const [appointmentCount, completedAppointments, noShowCount, treatmentCasesOpened, treatmentCasesCompleted, revenueAgg] = await Promise.all([
        prisma.appointment.count({
          where: { ...scope, practitionerId: doc.id, startTime: { gte: from, lte: to }, status: { not: 'cancelled' } },
        }),
        prisma.appointment.count({
          where: { ...scope, practitionerId: doc.id, startTime: { gte: from, lte: to }, status: 'completed' },
        }),
        prisma.appointment.count({
          where: { ...scope, practitionerId: doc.id, startTime: { gte: from, lte: to }, status: 'no_show' },
        }),
        prisma.treatmentCase.count({
          where: { ...scope, practitionerId: doc.id, createdAt: { gte: from, lte: to } },
        }),
        prisma.treatmentCase.count({
          where: { ...scope, practitionerId: doc.id, stage: 'completed', closedAt: { gte: from, lte: to } },
        }),
        doctorCaseIds.length > 0
          ? prisma.payment.aggregate({
              where: {
                ...scope,
                paymentStatus: { in: ['paid', 'partial'] },
                paidAt: { gte: from, lte: to },
                treatmentCaseId: { in: doctorCaseIds },
              },
              _sum: { amount: true },
              _count: { id: true },
            })
          : Promise.resolve({ _sum: { amount: null }, _count: { id: 0 } }),
      ]);

      const revenue = Number(revenueAgg._sum.amount) || 0;
      const commissionRate = (doc as any).commissionRate ?? 0;
      const commissionAmount = Math.round(revenue * commissionRate) / 100;

      return {
        id: doc.id,
        firstName: doc.firstName,
        lastName: doc.lastName,
        commissionRate,
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
  } catch (err: any) {
    console.error('Doctor performance report error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to generate doctor performance report' });
  }
});

// GET /api/reports/patient-sources
router.get('/reports/patient-sources', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { dateFrom, dateTo, clinicId: selectedClinicId } = req.query;

  const toDate = dateTo ? new Date(String(dateTo)) : new Date();
  toDate.setHours(23, 59, 59, 999);
  const fromDate = dateFrom ? new Date(String(dateFrom)) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const dateFilter = { gte: fromDate, lte: toDate };

    const [bySourceCount, allPatientsCount, paymentsWithSource] = await Promise.all([
      // Patient counts per source (by registration date)
      prisma.patient.groupBy({
        by: ['source'],
        where: { ...scope, createdAt: dateFilter },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      // Total patients in period
      prisma.patient.count({ where: { ...scope, createdAt: dateFilter } }),
      // Revenue grouped by patient source
      prisma.payment.findMany({
        where: {
          ...scope,
          paymentStatus: { in: ['paid', 'partial'] },
          paidAt: dateFilter,
        },
        select: {
          amount: true,
          patient: { select: { source: true } },
        },
      }),
    ]);

    // Aggregate revenue by source
    const revenueBySource: Record<string, number> = {};
    for (const p of paymentsWithSource) {
      const src = p.patient?.source || 'other';
      revenueBySource[src] = (revenueBySource[src] || 0) + p.amount;
    }

    // Merge counts + revenue
    const allSources = new Set([
      ...bySourceCount.map((s) => s.source || 'other'),
      ...Object.keys(revenueBySource),
    ]);

    const sources = Array.from(allSources)
      .map((source) => {
        const entry = bySourceCount.find((s) => (s.source || 'other') === source);
        const count = entry?._count.id || 0;
        const revenue = revenueBySource[source] || 0;
        return { source, count, revenue };
      })
      .sort((a, b) => b.count - a.count);

    res.json({ dateFrom: fromDate.toISOString(), dateTo: toDate.toISOString(), total: allPatientsCount, sources });
  } catch (err) {
    console.error('Patient sources report error:', err);
    res.status(500).json({ error: 'Failed to generate patient sources report' });
  }
});

// GET /api/reports/no-show-analysis
router.get('/reports/no-show-analysis', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { dateFrom, dateTo, clinicId: selectedClinicId } = req.query;

  const toDate = dateTo ? new Date(String(dateTo)) : new Date();
  toDate.setHours(23, 59, 59, 999);
  const fromDate = dateFrom ? new Date(String(dateFrom)) : new Date(toDate);
  if (!dateFrom) fromDate.setMonth(fromDate.getMonth() - 6);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const scopedClinicIds = clinicIdsFromScope(scope);

    // Monthly trend
    const monthlyTrend = await prisma.$queryRaw<
      { month: string; total: number; no_shows: number; cancellations: number }[]
    >`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "startTime"), 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE status != 'cancelled')::int   AS total,
        COUNT(*) FILTER (WHERE status = 'no_show')::int      AS no_shows,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int    AS cancellations
      FROM "Appointment"
      WHERE "clinicId" = ANY(${scopedClinicIds}::text[])
        AND "startTime" >= ${fromDate}
        AND "startTime" <= ${toDate}
      GROUP BY DATE_TRUNC('month', "startTime")
      ORDER BY DATE_TRUNC('month', "startTime")
    `;

    // By doctor
    const activeDoctors = await prisma.user.findMany({
      where: { ...scope, role: 'doctor', isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    const byDoctor = await Promise.all(
      activeDoctors.map(async (doc) => {
        const [total, noShows, cancellations] = await Promise.all([
          prisma.appointment.count({
            where: { ...scope, practitionerId: doc.id, startTime: { gte: fromDate, lte: toDate }, status: { not: 'cancelled' } },
          }),
          prisma.appointment.count({
            where: { ...scope, practitionerId: doc.id, startTime: { gte: fromDate, lte: toDate }, status: 'no_show' },
          }),
          prisma.appointment.count({
            where: { ...scope, practitionerId: doc.id, startTime: { gte: fromDate, lte: toDate }, status: 'cancelled' },
          }),
        ]);
        return {
          id: doc.id,
          firstName: doc.firstName,
          lastName: doc.lastName,
          total,
          noShows,
          cancellations,
          noShowRate: total > 0 ? Math.round((noShows / total) * 100) : 0,
        };
      })
    );

    // By day of week (0=Sunday … 6=Saturday)
    const byDayOfWeek = await prisma.$queryRaw<
      { day_of_week: number; total: number; no_shows: number }[]
    >`
      SELECT
        EXTRACT(DOW FROM "startTime")::int  AS day_of_week,
        COUNT(*) FILTER (WHERE status != 'cancelled')::int AS total,
        COUNT(*) FILTER (WHERE status = 'no_show')::int    AS no_shows
      FROM "Appointment"
      WHERE "clinicId" = ANY(${scopedClinicIds}::text[])
        AND "startTime" >= ${fromDate}
        AND "startTime" <= ${toDate}
      GROUP BY EXTRACT(DOW FROM "startTime")
      ORDER BY EXTRACT(DOW FROM "startTime")
    `;

    // By hour of day
    const byHour = await prisma.$queryRaw<
      { hour: number; total: number; no_shows: number }[]
    >`
      SELECT
        EXTRACT(HOUR FROM "startTime")::int AS hour,
        COUNT(*) FILTER (WHERE status != 'cancelled')::int AS total,
        COUNT(*) FILTER (WHERE status = 'no_show')::int    AS no_shows
      FROM "Appointment"
      WHERE "clinicId" = ANY(${scopedClinicIds}::text[])
        AND "startTime" >= ${fromDate}
        AND "startTime" <= ${toDate}
      GROUP BY EXTRACT(HOUR FROM "startTime")
      ORDER BY EXTRACT(HOUR FROM "startTime")
    `;

    res.json({
      dateFrom: fromDate.toISOString(),
      dateTo: toDate.toISOString(),
      monthlyTrend,
      byDoctor: byDoctor.sort((a, b) => b.noShowRate - a.noShowRate),
      byDayOfWeek,
      byHour,
    });
  } catch (err) {
    console.error('No-show analysis error:', err);
    res.status(500).json({ error: 'Failed to generate no-show analysis' });
  }
});

export default router;
