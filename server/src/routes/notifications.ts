import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import {
  getEnabledInAppNotificationTypes,
  getNotificationPreferences,
} from '../services/notificationPreferences.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { PRE_RECEIPT_STATUSES } from '../services/labOrders/labOrderStatusTransitions.js';

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
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
    const role = req.user!.normalizedRole;
    const userId = req.user!.id;
    const now = new Date();
    const [preferences, operatingPreferences] = await Promise.all([
      getNotificationPreferences(clinicId),
      getClinicOperatingPreferences(clinicId),
    ]);
    const enabledTypes = getEnabledInAppNotificationTypes(preferences);

    // ── 1. Upsert computed notifications ─────────────────────────────────────

    // Upcoming appointments
    if (
      preferences.inApp.upcomingAppointments.enabled &&
      ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'].includes(role)
    ) {
      const leadMs = preferences.inApp.upcomingAppointments.leadHours * 60 * 60 * 1000;
      const inLeadWindow = new Date(now.getTime() + leadMs);
      const apptWhere: any = {
        clinicId,
        startTime: { gte: now, lte: inLeadWindow },
        status: { in: ['scheduled', 'confirmed'] },
      };
      if (role === 'DENTIST') apptWhere.practitionerId = userId;

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
          const timeStr = new Intl.DateTimeFormat(operatingPreferences.locale, {
            timeZone: operatingPreferences.timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: operatingPreferences.timeFormat === '12h',
          }).format(new Date(a.startTime));
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
    if (
      preferences.inApp.overdueTasks.enabled &&
      ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'].includes(role)
    ) {
      const taskWhere: any = {
        clinicId,
        dueDate: { lt: now },
        status: { notIn: ['completed', 'cancelled'] },
      };
      if (role === 'DENTIST') taskWhere.assignedToId = userId;
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
    if (
      preferences.inApp.appointmentRequests.enabled &&
      ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'].includes(role)
    ) {
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

    // Overdue lab work orders (past expectedReturnDate, still not received from the lab)
    if (
      preferences.inApp.labOrdersOverdue.enabled &&
      ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT'].includes(role)
    ) {
      try {
        const overdueLabOrders = await prisma.labWorkOrder.findMany({
          where: {
            clinicId,
            deletedAt: null,
            expectedReturnDate: { lt: now },
            status: { in: [...PRE_RECEIPT_STATUSES] },
          },
          include: {
            patient: { select: { firstName: true, lastName: true } },
            laboratory: { select: { name: true } },
          },
          orderBy: { expectedReturnDate: 'asc' },
          take: 5,
        });
        for (const o of overdueLabOrders) {
          const daysAgo = Math.floor((now.getTime() - new Date(o.expectedReturnDate!).getTime()) / (1000 * 60 * 60 * 24));
          await upsertNotification(clinicId, {
            externalId: `lab-overdue-${o.id}`,
            type: 'lab_case_overdue',
            title: `${o.patient.firstName} ${o.patient.lastName} — ${o.laboratory.name}`,
            subtitle: `${daysAgo} gün gecikmiş`,
            link: '/lab-orders',
            createdAt: o.expectedReturnDate!,
          });
        }
      } catch { /* ignore */ }
    }

    // ── 2. Fetch all DB notifications for this clinic ─────────────────────────
    try {
      if (enabledTypes.length === 0) {
        return res.json({ total: 0, items: [] });
      }

      const dbItems = await (prisma as any).notification.findMany({
        where: { clinicId, type: { in: enabledTypes } },
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
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
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
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
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
