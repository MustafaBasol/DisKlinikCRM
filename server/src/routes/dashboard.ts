import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { validateAndGetScope, toClinicOnlyScope } from '../utils/clinicScope.js';

const router = express.Router();

// GET /api/dashboard/stats
router.get('/dashboard/stats', async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const selectedClinicId = req.query.clinicId as string | undefined;

  try {
    const scope = await validateAndGetScope(req.user!, selectedClinicId, res);
    if (scope === false) return;

    // clinicWhere: organizationId içerir — yalnızca organizationId alanı olan modeller için (Patient)
    const clinicWhere = scope;
    // clinicIdWhere: organizationId içermez — Appointment, Task, Payment, TreatmentCase, ActivityLog vb. için
    const clinicIdWhere = await toClinicOnlyScope(scope);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const statsPromises: any = {
      todayAppointments: prisma.appointment.count({
        where: {
          ...clinicIdWhere, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' },
          ...(normalizedRole === 'DENTIST' ? { practitionerId: userId } : {}),
        },
      }),
      weekAppointments: prisma.appointment.count({
        where: {
          ...clinicIdWhere, startTime: { gte: weekStart }, status: { not: 'cancelled' },
          ...(normalizedRole === 'DENTIST' ? { practitionerId: userId } : {}),
        },
      }),
      newPatientsMonth: prisma.patient.count({
        where: { ...clinicWhere, createdAt: { gte: firstDayOfMonth }, deletedAt: null },
      }),
      noShowsMonth: prisma.appointment.count({
        where: {
          ...clinicIdWhere, status: 'no_show', startTime: { gte: firstDayOfMonth },
          ...(normalizedRole === 'DENTIST' ? { practitionerId: userId } : {}),
        },
      }),
      pendingTasks: prisma.task.count({
        where: {
          ...clinicIdWhere, status: { in: ['open', 'in_progress'] },
          ...(normalizedRole === 'DENTIST' ? { assignedToId: userId } : {}),
        },
      }),
      overdueTasks: prisma.task.count({
        where: {
          ...clinicIdWhere, status: { in: ['open', 'in_progress'] }, dueDate: { lt: new Date() },
          ...(normalizedRole === 'DENTIST' ? { assignedToId: userId } : {}),
        },
      }),
      openTreatments: prisma.treatmentCase.count({
        where: {
          ...clinicIdWhere, stage: { notIn: ['completed', 'lost'] },
          ...(normalizedRole === 'DENTIST' ? { practitionerId: userId } : {}),
        },
      }),
      treatmentValues: prisma.treatmentCase.aggregate({
        where: {
          ...clinicIdWhere, stage: { notIn: ['completed', 'lost'] },
          ...(normalizedRole === 'DENTIST' ? { practitionerId: userId } : {}),
        },
        _sum: { estimatedAmount: true, acceptedAmount: true },
      }),
      monthlyRevenue: prisma.payment.aggregate({
        where: { ...clinicIdWhere, paymentStatus: { in: ['paid', 'partial'] }, paidAt: { gte: firstDayOfMonth } },
        _sum: { amount: true },
      }),
      pendingPayments: prisma.payment.aggregate({
        where: { ...clinicIdWhere, paymentStatus: 'pending' },
        _sum: { amount: true },
      }),
      preparedMessagesWeek: prisma.sentMessage.count({
        where: { ...clinicIdWhere, status: 'prepared', createdAt: { gte: weekStart } },
      }),
    };

    const results = await Promise.all(Object.values(statsPromises));
    const keys = Object.keys(statsPromises);
    const stats: any = {};
    keys.forEach((key, i) => { stats[key] = results[i]; });

    const agenda = await prisma.appointment.findMany({
      where: {
        ...clinicIdWhere, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' },
        ...(normalizedRole === 'DENTIST' ? { practitionerId: userId } : {}),
      },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        practitioner: { select: { firstName: true, lastName: true } },
        appointmentType: { select: { name: true, color: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    });

    const alerts: any[] = [];
    if (stats.overdueTasks > 0) {
      alerts.push({ type: 'danger', icon: 'Clock', title: 'overdueTasks', count: stats.overdueTasks, link: '/tasks?overdue=true' });
    }
    if (stats.noShowsMonth > 0) {
      alerts.push({ type: 'warning', icon: 'UserMinus', title: 'noShowFollowUp', count: stats.noShowsMonth, link: '/appointments?status=no_show' });
    }
    const pendingAmount = stats.pendingPayments?._sum?.amount ?? 0;
    if (pendingAmount > 0) {
      alerts.push({ type: 'info', icon: 'DollarSign', title: 'pendingCollections', value: pendingAmount, link: '/payments?status=pending' });
    }

    const activities = await prisma.activityLog.findMany({
      where: {
        ...clinicIdWhere,
        ...(normalizedRole === 'DENTIST' ? {
          OR: [
            { userId },
            { entityType: 'appointment', appointment: { practitionerId: userId } },
            { entityType: 'treatment_case', treatmentCase: { practitionerId: userId } },
          ],
        } : {}),
      },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // ── Doctor-specific extra data ─────────────────────────────────────
    let doctorExtras: any = null;
    if (normalizedRole === 'DENTIST') {
      const nextWeek = new Date(tomorrow);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const [upcomingAppts, pipeline, recentPatientsRaw, earningsSummary] = await Promise.all([
        // Next 7 days appointments
        prisma.appointment.findMany({
          where: {
            ...clinicIdWhere,
            practitionerId: userId,
            startTime: { gte: tomorrow, lt: nextWeek },
            status: { not: 'cancelled' },
          },
          include: {
            patient: { select: { id: true, firstName: true, lastName: true } },
            appointmentType: { select: { name: true, color: true } },
          },
          orderBy: { startTime: 'asc' },
          take: 20,
        }),
        // Active treatment pipeline grouped by stage
        prisma.treatmentCase.groupBy({
          by: ['stage'],
          where: { ...clinicIdWhere, practitionerId: userId, stage: { notIn: ['completed', 'lost'] } },
          _count: { stage: true },
        }),
        // Recent distinct patients seen by this doctor
        prisma.appointment.findMany({
          where: {
            ...clinicIdWhere,
            practitionerId: userId,
            startTime: { lt: tomorrow },
            status: { in: ['completed', 'confirmed', 'in_progress'] },
          },
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
            appointmentType: { select: { name: true } },
          },
          orderBy: { startTime: 'desc' },
          take: 30,
        }),
        // Pending + approved earnings
        prisma.practitionerEarning.groupBy({
          by: ['status'],
          where: { ...clinicIdWhere, practitionerId: userId, status: { in: ['pending', 'approved'] } },
          _sum: { earningAmount: true },
        }),
      ]);

      // Deduplicate patients, keep most recent visit per patient
      const seen = new Set<string>();
      const recentPatients = recentPatientsRaw
        .filter((a: any) => {
          if (!a.patient) return false; // null-safe guard
          if (seen.has(a.patient.id)) return false;
          seen.add(a.patient.id);
          return true;
        })
        .slice(0, 5)
        .map((a: any) => ({
          ...a.patient,
          lastService: a.appointmentType?.name ?? null, // null-safe: appointmentType may be missing
          lastVisit: a.startTime,
        }));

      const earningMap: Record<string, number> = {};
      earningsSummary.forEach((e: any) => { earningMap[e.status] = e._sum.earningAmount || 0; });

      doctorExtras = {
        upcomingWeek: upcomingAppts,
        treatmentPipeline: pipeline.map((p: any) => ({ stage: p.stage, count: p._count.stage })),
        recentPatients,
        pendingEarnings: (earningMap['pending'] || 0) + (earningMap['approved'] || 0),
      };
    }

    res.json({
      stats: {
        todayAppointments: stats.todayAppointments ?? 0,
        weekAppointments: stats.weekAppointments ?? 0,
        newPatientsMonth: stats.newPatientsMonth ?? 0,
        noShowsMonth: stats.noShowsMonth ?? 0,
        pendingTasks: stats.pendingTasks ?? 0,
        overdueTasks: stats.overdueTasks ?? 0,
        openTreatments: stats.openTreatments ?? 0,
        estimatedValue: stats.treatmentValues?._sum?.estimatedAmount ?? 0,
        acceptedValue: stats.treatmentValues?._sum?.acceptedAmount ?? 0,
        monthlyRevenue: stats.monthlyRevenue?._sum?.amount ?? 0,
        pendingAmount: stats.pendingPayments?._sum?.amount ?? 0,
        preparedMessages: stats.preparedMessagesWeek ?? 0,
      },
      agenda,
      alerts,
      activities,
      doctorExtras,
      charts: normalizedRole !== 'DENTIST' ? await buildChartData(prisma, clinicIdWhere, today, tomorrow, firstDayOfMonth) : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;

/**
 * Converts raw Prisma aggregate results into the safe stats response shape.
 * All counts default to 0, all sums default to 0 when null.
 * Exported for unit testing.
 */
export function buildSafeStats(raw: {
  todayAppointments?: number | null;
  weekAppointments?: number | null;
  newPatientsMonth?: number | null;
  noShowsMonth?: number | null;
  pendingTasks?: number | null;
  overdueTasks?: number | null;
  openTreatments?: number | null;
  treatmentValues?: { _sum?: { estimatedAmount?: number | null; acceptedAmount?: number | null } } | null;
  monthlyRevenue?: { _sum?: { amount?: number | null } } | null;
  pendingPayments?: { _sum?: { amount?: number | null } } | null;
  preparedMessagesWeek?: number | null;
}) {
  return {
    todayAppointments: raw.todayAppointments ?? 0,
    weekAppointments: raw.weekAppointments ?? 0,
    newPatientsMonth: raw.newPatientsMonth ?? 0,
    noShowsMonth: raw.noShowsMonth ?? 0,
    pendingTasks: raw.pendingTasks ?? 0,
    overdueTasks: raw.overdueTasks ?? 0,
    openTreatments: raw.openTreatments ?? 0,
    estimatedValue: raw.treatmentValues?._sum?.estimatedAmount ?? 0,
    acceptedValue: raw.treatmentValues?._sum?.acceptedAmount ?? 0,
    monthlyRevenue: raw.monthlyRevenue?._sum?.amount ?? 0,
    pendingAmount: raw.pendingPayments?._sum?.amount ?? 0,
    preparedMessages: raw.preparedMessagesWeek ?? 0,
  };
}

async function buildChartData(prisma: any, clinicIdWhere: Record<string, any>, today: Date, tomorrow: Date, firstDayOfMonth: Date) {
  // ── 1) Son 7 günlük günlük randevu sayısı ────────────────────────────────────────────
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const weekAppts = await prisma.appointment.findMany({
    where: { ...clinicIdWhere, startTime: { gte: sevenDaysAgo, lt: tomorrow }, status: { not: 'cancelled' } },
    select: { startTime: true },
  });

  const dailyMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dailyMap[d.toISOString().slice(0, 10)] = 0;
  }
  weekAppts.forEach((a: { startTime: Date }) => {
    const key = new Date(a.startTime).toISOString().slice(0, 10);
    if (dailyMap[key] !== undefined) dailyMap[key]++;
  });
  const dailyTrend = Object.entries(dailyMap).map(([date, count]) => ({
    date: new Date(date).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' }),
    count,
  }));

  // ── 2) Bu ay hizmet bazlı randevu dağılımı ────────────────────────
  const monthAppts = await prisma.appointment.findMany({
    where: { ...clinicIdWhere, startTime: { gte: firstDayOfMonth }, status: { not: 'cancelled' } },
    select: { appointmentType: { select: { name: true, color: true } } },
  });

  const typeMap: Record<string, { name: string; color: string; value: number }> = {};
  monthAppts.forEach((a: { appointmentType: { name: string; color: string | null } | null }) => {
    if (!a.appointmentType) return; // null-safe: data inconsistency guard
    const key = a.appointmentType.name;
    if (!typeMap[key]) typeMap[key] = { name: key, color: a.appointmentType.color || '#6366f1', value: 0 };
    typeMap[key].value++;
  });
  const appointmentsByType = Object.values(typeMap).sort((a, b) => b.value - a.value).slice(0, 6);

  // ── 3) Son 6 aylık gelir trendi ───────────────────────────────────
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const payments6m = await prisma.payment.findMany({
    where: { ...clinicIdWhere, paymentStatus: { in: ['paid', 'partial'] }, paidAt: { gte: sixMonthsAgo } },
    select: { paidAt: true, amount: true },
  });

  const revenueMap: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i);
    revenueMap[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
  }
  payments6m.forEach((p: { paidAt: Date | null; amount: number }) => {
    if (!p.paidAt) return;
    const d = new Date(p.paidAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (revenueMap[key] !== undefined) revenueMap[key] += p.amount;
  });
  const monthlyRevenueTrend = Object.entries(revenueMap).map(([month, revenue]) => ({
    month: new Date(month + '-01').toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }),
    revenue,
  }));

  return { dailyTrend, appointmentsByType, monthlyRevenueTrend };
}
