import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { validateAndGetScope, toClinicOnlyScope } from '../utils/clinicScope.js';

const router = express.Router();

// GET /api/dashboard/stats
router.get('/dashboard/stats', async (req: AuthRequest, res: Response) => {
  const { role, id: userId } = req.user!;
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
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      weekAppointments: prisma.appointment.count({
        where: {
          ...clinicIdWhere, startTime: { gte: weekStart }, status: { not: 'cancelled' },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      newPatientsMonth: prisma.patient.count({
        where: { ...clinicWhere, createdAt: { gte: firstDayOfMonth }, deletedAt: null },
      }),
      noShowsMonth: prisma.appointment.count({
        where: {
          ...clinicIdWhere, status: 'no_show', startTime: { gte: firstDayOfMonth },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      pendingTasks: prisma.task.count({
        where: {
          ...clinicIdWhere, status: { in: ['open', 'in_progress'] },
          ...(role === 'doctor' ? { assignedToId: userId } : {}),
        },
      }),
      overdueTasks: prisma.task.count({
        where: {
          ...clinicIdWhere, status: { in: ['open', 'in_progress'] }, dueDate: { lt: new Date() },
          ...(role === 'doctor' ? { assignedToId: userId } : {}),
        },
      }),
      openTreatments: prisma.treatmentCase.count({
        where: {
          ...clinicIdWhere, stage: { notIn: ['completed', 'lost'] },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      treatmentValues: prisma.treatmentCase.aggregate({
        where: {
          ...clinicIdWhere, stage: { notIn: ['completed', 'lost'] },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
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
        ...(role === 'doctor' ? { practitionerId: userId } : {}),
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
    if (stats.pendingPayments._sum.amount > 0) {
      alerts.push({ type: 'info', icon: 'DollarSign', title: 'pendingCollections', value: stats.pendingPayments._sum.amount, link: '/payments?status=pending' });
    }

    const activities = await prisma.activityLog.findMany({
      where: {
        ...clinicIdWhere,
        ...(role === 'doctor' ? {
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
    if (role === 'doctor') {
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
          if (seen.has(a.patient.id)) return false;
          seen.add(a.patient.id);
          return true;
        })
        .slice(0, 5)
        .map((a: any) => ({
          ...a.patient,
          lastService: a.appointmentType.name,
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
        todayAppointments: stats.todayAppointments,
        weekAppointments: stats.weekAppointments,
        newPatientsMonth: stats.newPatientsMonth,
        noShowsMonth: stats.noShowsMonth,
        pendingTasks: stats.pendingTasks,
        overdueTasks: stats.overdueTasks,
        openTreatments: stats.openTreatments,
        estimatedValue: stats.treatmentValues._sum.estimatedAmount || 0,
        acceptedValue: stats.treatmentValues._sum.acceptedAmount || 0,
        monthlyRevenue: stats.monthlyRevenue._sum.amount || 0,
        pendingAmount: stats.pendingPayments._sum.amount || 0,
        preparedMessages: stats.preparedMessagesWeek,
      },
      agenda,
      alerts,
      activities,
      doctorExtras,
      charts: role !== 'doctor' ? await buildChartData(prisma, clinicIdWhere, today, tomorrow, firstDayOfMonth) : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;

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
  monthAppts.forEach((a: { appointmentType: { name: string; color: string | null } }) => {
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
