import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// GET /api/dashboard/stats
router.get('/dashboard/stats', async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
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
          clinicId, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      weekAppointments: prisma.appointment.count({
        where: {
          clinicId, startTime: { gte: weekStart }, status: { not: 'cancelled' },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      newPatientsMonth: prisma.patient.count({
        where: { clinicId, createdAt: { gte: firstDayOfMonth }, deletedAt: null },
      }),
      noShowsMonth: prisma.appointment.count({
        where: {
          clinicId, status: 'no_show', startTime: { gte: firstDayOfMonth },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      pendingTasks: prisma.task.count({
        where: {
          clinicId, status: { in: ['open', 'in_progress'] },
          ...(role === 'doctor' ? { assignedToId: userId } : {}),
        },
      }),
      overdueTasks: prisma.task.count({
        where: {
          clinicId, status: { in: ['open', 'in_progress'] }, dueDate: { lt: new Date() },
          ...(role === 'doctor' ? { assignedToId: userId } : {}),
        },
      }),
      openTreatments: prisma.treatmentCase.count({
        where: {
          clinicId, stage: { notIn: ['completed', 'lost'] },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
      }),
      treatmentValues: prisma.treatmentCase.aggregate({
        where: {
          clinicId, stage: { notIn: ['completed', 'lost'] },
          ...(role === 'doctor' ? { practitionerId: userId } : {}),
        },
        _sum: { estimatedAmount: true, acceptedAmount: true },
      }),
      monthlyRevenue: prisma.payment.aggregate({
        where: { clinicId, paymentStatus: { in: ['paid', 'partial'] }, paidAt: { gte: firstDayOfMonth } },
        _sum: { amount: true },
      }),
      pendingPayments: prisma.payment.aggregate({
        where: { clinicId, paymentStatus: 'pending' },
        _sum: { amount: true },
      }),
      preparedMessagesWeek: prisma.sentMessage.count({
        where: { clinicId, status: 'prepared', createdAt: { gte: weekStart } },
      }),
    };

    const results = await Promise.all(Object.values(statsPromises));
    const keys = Object.keys(statsPromises);
    const stats: any = {};
    keys.forEach((key, i) => { stats[key] = results[i]; });

    const agenda = await prisma.appointment.findMany({
      where: {
        clinicId, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' },
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
        clinicId,
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
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
