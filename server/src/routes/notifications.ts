import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';

const router = express.Router();

// ── Helper: upsert a computed notification into DB (preserves isRead state) ──
async function upsertNotification(clinicId: string, item: {
  externalId: string;
  type: string;
  title: string;
  subtitle?: string;
  link: string;
  createdAt: Date;
}) {
  try {
    await (prisma as any).notification.upsert({
      where: { clinicId_externalId: { clinicId, externalId: item.externalId } },
      create: {
        clinicId,
        externalId: item.externalId,
        type: item.type,
        title: item.title,
        subtitle: item.subtitle ?? null,
        link: item.link,
        isRead: false,
        createdAt: item.createdAt,
      },
      update: {
        // Only update mutable display fields — never reset isRead
        title: item.title,
        subtitle: item.subtitle ?? null,
      },
    });
  } catch {
    // silently fail if table not migrated yet
  }
}

// GET /api/notifications
router.get(
  '/notifications',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId;
    const role = req.user!.role;
    const userId = req.user!.id;
    const now = new Date();

    // ── 1. Upsert computed notifications ─────────────────────────────────────

    // Upcoming appointments (next 2h)
    if (['admin', 'receptionist', 'doctor'].includes(role)) {
      const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const apptWhere: any = {
        clinicId,
        startTime: { gte: now, lte: inTwoHours },
        status: { in: ['scheduled', 'confirmed'] },
      };
      if (role === 'doctor') apptWhere.practitionerId = userId;

      try {
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
          await upsertNotification(clinicId, {
            externalId: `appt-${a.id}`,
            type: 'upcoming_appointment',
            title: `${a.patient.firstName} ${a.patient.lastName}`,
            subtitle: `${a.appointmentType.name} — ${timeStr}`,
            link: '/appointments',
            createdAt: a.startTime,
          });
        }
      } catch { /* ignore */ }
    }

    // Overdue tasks
    if (['admin', 'receptionist', 'doctor'].includes(role)) {
      const taskWhere: any = {
        clinicId,
        dueDate: { lt: now },
        status: { notIn: ['completed', 'cancelled'] },
      };
      if (role === 'doctor') taskWhere.assignedToId = userId;
      try {
        const overdueTasks = await prisma.task.findMany({ where: taskWhere, orderBy: { dueDate: 'asc' }, take: 5 });
        for (const t of overdueTasks) {
          const daysAgo = Math.floor((now.getTime() - new Date(t.dueDate!).getTime()) / (1000 * 60 * 60 * 24));
          await upsertNotification(clinicId, {
            externalId: `task-${t.id}`,
            type: 'overdue_task',
            title: t.title,
            subtitle: `${daysAgo} gün gecikmiş`,
            link: '/tasks',
            createdAt: t.dueDate!,
          });
        }
      } catch { /* ignore */ }
    }

    // Pending appointment requests
    if (['admin', 'receptionist'].includes(role)) {
      try {
        const pendingRequests = await prisma.appointmentRequest.findMany({
          where: { clinicId, status: 'pending' },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        for (const r of pendingRequests) {
          await upsertNotification(clinicId, {
            externalId: `req-${r.id}`,
            type: 'appointment_request',
            title: 'Yeni randevu talebi',
            subtitle: r.patientName || r.phone,
            link: '/appointment-requests',
            createdAt: r.createdAt,
          });
        }
      } catch { /* ignore */ }
    }

    // ── 2. Fetch all DB notifications for this clinic ─────────────────────────
    try {
      const dbItems = await (prisma as any).notification.findMany({
        where: { clinicId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const unreadCount = dbItems.filter((n: any) => !n.isRead).length;
      res.json({ total: unreadCount, items: dbItems });
    } catch {
      res.json({ total: 0, items: [] });
    }
  },
);

// POST /api/notifications/mark-all-read
router.post(
  '/notifications/mark-all-read',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId;
    try {
      await (prisma as any).notification.updateMany({
        where: { clinicId, isRead: false },
        data: { isRead: true },
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to mark all read' });
    }
  },
);

// PATCH /api/notifications/:id/toggle-read
router.patch(
  '/notifications/:id/toggle-read',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = req.user!.clinicId;
    const { id } = req.params;
    try {
      const existing = await (prisma as any).notification.findFirst({ where: { id, clinicId } });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const updated = await (prisma as any).notification.update({
        where: { id },
        data: { isRead: !existing.isRead },
      });
      res.json(updated);
    } catch {
      res.status(500).json({ error: 'Failed to toggle read state' });
    }
  },
);

export default router;
