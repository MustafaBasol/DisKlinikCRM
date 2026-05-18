import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';

const router = express.Router();

// GET /api/notifications
router.get(
  '/notifications',
  authorize(['admin', 'receptionist', 'doctor', 'billing']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId;
    const role = req.user!.role;
    const userId = req.user!.id;

    try {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const items: Array<{
        id: string;
        type: string;
        title: string;
        subtitle?: string;
        link: string;
        createdAt: Date;
      }> = [];

      // 1 — Upcoming appointments in next 2 hours (admin, receptionist see all; doctor sees own)
      if (['admin', 'receptionist', 'doctor'].includes(role)) {
        const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const apptWhere: any = {
          clinicId,
          startTime: { gte: now, lte: inTwoHours },
          status: { in: ['scheduled', 'confirmed'] },
        };
        if (role === 'doctor') apptWhere.practitionerId = userId;

        const upcomingAppts = await prisma.appointment.findMany({
          where: apptWhere,
          include: {
            patient: { select: { firstName: true, lastName: true } },
            appointmentType: { select: { name: true } },
          },
          orderBy: { startTime: 'asc' },
          take: 5,
        });

        for (const a of upcomingAppts) {
          const timeStr = new Date(a.startTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
          items.push({
            id: `appt-${a.id}`,
            type: 'upcoming_appointment',
            title: `${a.patient.firstName} ${a.patient.lastName}`,
            subtitle: `${a.appointmentType.name} — ${timeStr}`,
            link: `/appointments`,
            createdAt: a.startTime,
          });
        }
      }

      // 2 — Overdue tasks (due < now, not completed/cancelled)
      if (['admin', 'receptionist', 'doctor'].includes(role)) {
        const taskWhere: any = {
          clinicId,
          dueDate: { lt: now },
          status: { notIn: ['completed', 'cancelled'] },
        };
        if (role === 'doctor') taskWhere.assignedToId = userId;

        const overdueTasks = await prisma.task.findMany({
          where: taskWhere,
          orderBy: { dueDate: 'asc' },
          take: 5,
        });

        for (const t of overdueTasks) {
          const daysAgo = Math.floor((now.getTime() - new Date(t.dueDate!).getTime()) / (1000 * 60 * 60 * 24));
          items.push({
            id: `task-${t.id}`,
            type: 'overdue_task',
            title: t.title,
            subtitle: `${daysAgo} gün gecikmiş`,
            link: `/tasks`,
            createdAt: t.dueDate!,
          });
        }
      }

      // 3 — Pending appointment requests (admin + receptionist only)
      if (['admin', 'receptionist'].includes(role)) {
        const pendingRequests = await prisma.appointmentRequest.findMany({
          where: { clinicId, status: 'pending' },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });

        for (const r of pendingRequests) {
          items.push({
            id: `req-${r.id}`,
            type: 'appointment_request',
            title: `Yeni randevu talebi`,
            subtitle: r.patientName || r.phone,
            link: `/appointment-requests`,
            createdAt: r.createdAt,
          });
        }
      }

      // Sort by createdAt desc, limit 10
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const limited = items.slice(0, 10);

      res.json({ total: limited.length, items: limited });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  },
);

export default router;
