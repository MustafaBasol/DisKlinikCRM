/**
 * noShows.ts — No-show Tracking & Patient Recovery Routes (Sprint 18)
 *
 * Endpoints:
 *   PATCH /api/appointments/:id/no-show            — Mark appointment as no-show
 *   PATCH /api/appointments/:id/recovery-status    — Update recovery status
 *   GET   /api/no-shows/dashboard                  — No-show dashboard metrics
 *   POST  /api/appointments/:id/no-show/send-message — Send WhatsApp recovery msg
 *   POST  /api/appointments/:id/no-show/create-task — Create follow-up task
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { getAccessibleClinicIds } from '../utils/clinicScope.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';

const router = express.Router();

// ─── Permission guards ────────────────────────────────────────────────────────

const NO_SHOW_MARK_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'] as const;
const NO_SHOW_RECOVERY_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'] as const;
const NO_SHOW_DASHBOARD_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'] as const;

// ─── Helper: load appointment in org+clinic scope ─────────────────────────────

async function loadAppointment(id: string, user: AuthRequest['user']) {
  const accessibleIds = await getAccessibleClinicIds(user!);
  if (accessibleIds.length === 0) return null;
  return prisma.appointment.findFirst({
    where: { id, clinicId: { in: accessibleIds }, deletedAt: null },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      practitioner: { select: { id: true, firstName: true, lastName: true } },
      appointmentType: { select: { id: true, name: true, basePrice: true, currency: true } },
      clinic: { select: { id: true, name: true } },
    },
  });
}

// ─── PATCH /api/appointments/:id/no-show ─────────────────────────────────────

router.patch(
  '/appointments/:id/no-show',
  authorize([...NO_SHOW_MARK_ROLES]),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const { normalizedRole, id: userId } = req.user!;

    try {
      const appointment = await loadAppointment(id, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

      // DENTIST can only mark their own appointments
      if (normalizedRole === 'DENTIST' && appointment.practitionerId !== userId) {
        return res.status(403).json({ error: 'Forbidden: You can only mark your own appointments' });
      }

      if (appointment.status === 'cancelled') {
        return res.status(400).json({ error: 'Cannot mark a cancelled appointment as no-show' });
      }
      if (appointment.status === 'completed') {
        return res.status(400).json({ error: 'Cannot mark a completed appointment as no-show' });
      }
      if (appointment.status === 'no_show') {
        // Idempotent — return existing appointment
        return res.json(appointment);
      }

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          status: 'no_show',
          noShowMarkedAt: new Date(),
          noShowMarkedById: userId,
          recoveryStatus: 'unresolved',
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          practitioner: { select: { id: true, firstName: true, lastName: true } },
          appointmentType: { select: { id: true, name: true, basePrice: true, currency: true } },
          clinic: { select: { id: true, name: true } },
        },
      });

      await logActivity({
        clinicId: appointment.clinicId,
        userId,
        entityType: 'appointment',
        entityId: id,
        action: 'no_show',
        description: `Randevu no-show olarak işaretlendi: ${appointment.patient.firstName} ${appointment.patient.lastName}`,
        metadata: { previousStatus: appointment.status },
      });

      writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId: appointment.clinicId,
        actorUserId: userId,
        actorRole: req.user!.role,
        action: 'appointment_no_show',
        entityType: 'appointment',
        entityId: id,
        description: `Appointment marked as no-show: ${appointment.patient.firstName} ${appointment.patient.lastName}`,
        metadata: { previousStatus: appointment.status, patientId: appointment.patientId },
        ...extractRequestMeta(req),
      });

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to mark appointment as no-show' });
    }
  },
);

// ─── PATCH /api/appointments/:id/recovery-status ─────────────────────────────

router.patch(
  '/appointments/:id/recovery-status',
  authorize([...NO_SHOW_RECOVERY_ROLES]),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const { id: userId } = req.user!;
    const { status, note } = req.body as { status?: string; note?: string };

    const validStatuses = ['unresolved', 'contacted', 'recovered'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid recovery status. Must be one of: ${validStatuses.join(', ')}` });
    }

    try {
      const appointment = await loadAppointment(id, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      if (appointment.status !== 'no_show') {
        return res.status(400).json({ error: 'Recovery status can only be set for no-show appointments' });
      }

      const updateData: Record<string, unknown> = {
        recoveryStatus: status,
        recoveryNote: note ?? (appointment as any).recoveryNote,
      };

      if (status === 'contacted') {
        updateData.noShowMarkedAt = (appointment as any).noShowMarkedAt ?? new Date();
      }
      if (status === 'recovered') {
        updateData.recoveredAt = new Date();
        updateData.recoveredById = userId;
      }

      const updated = await prisma.appointment.update({
        where: { id },
        data: updateData as any,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          practitioner: { select: { id: true, firstName: true, lastName: true } },
          appointmentType: { select: { id: true, name: true, basePrice: true } },
          clinic: { select: { id: true, name: true } },
        },
      });

      await logActivity({
        clinicId: appointment.clinicId,
        userId,
        entityType: 'appointment',
        entityId: id,
        action: 'recovery_status_updated',
        description: `No-show recovery durumu güncellendi: ${status}`,
        metadata: { recoveryStatus: status, note },
      });

      writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId: appointment.clinicId,
        actorUserId: userId,
        actorRole: req.user!.role,
        action: 'appointment_recovery_status_updated',
        entityType: 'appointment',
        entityId: id,
        description: `Recovery status updated to ${status}`,
        metadata: { recoveryStatus: status },
        ...extractRequestMeta(req),
      });

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to update recovery status' });
    }
  },
);

// ─── GET /api/no-shows/dashboard ─────────────────────────────────────────────

router.get(
  '/no-shows/dashboard',
  authorize([...NO_SHOW_DASHBOARD_ROLES]),
  async (req: AuthRequest, res: Response) => {
    const { normalizedRole, organizationId } = req.user!;
    const { clinicId: selectedClinicId, range, from, to, doctorId, recoveryStatus } = req.query as Record<string, string>;

    try {
      // Determine accessible clinic IDs
      const accessibleIds = await getAccessibleClinicIds(req.user!);
      if (accessibleIds.length === 0) {
        return res.json(emptyDashboard());
      }

      // Build clinic filter
      let clinicFilter: string[];
      if (selectedClinicId && selectedClinicId !== 'all') {
        if (!accessibleIds.includes(selectedClinicId)) {
          return res.status(403).json({ error: 'Access denied to requested clinic' });
        }
        clinicFilter = [selectedClinicId];
      } else {
        clinicFilter = accessibleIds;
      }

      // DENTIST: restrict to own appointments only
      const isDentist = normalizedRole === 'DENTIST';

      // Build date range filter
      const dateFilter = buildDateFilter(range, from, to);

      // Base where for all appointments in scope + date range
      const baseWhere: any = {
        clinicId: { in: clinicFilter },
        deletedAt: null,
        organizationId: undefined, // appointments don't have organizationId, clinic scope covers it
      };
      // Remove undefined keys
      delete baseWhere.organizationId;

      if (dateFilter) baseWhere.startTime = dateFilter;
      if (isDentist) baseWhere.practitionerId = req.user!.id;
      if (doctorId) baseWhere.practitionerId = doctorId;

      // Total appointments in range
      const totalAppointments = await prisma.appointment.count({ where: baseWhere });

      // No-show where
      const noShowWhere: any = { ...baseWhere, status: 'no_show' };
      if (recoveryStatus) noShowWhere.recoveryStatus = recoveryStatus;

      const noShowAppointments = await prisma.appointment.findMany({
        where: noShowWhere,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          practitioner: { select: { id: true, firstName: true, lastName: true } },
          appointmentType: { select: { id: true, name: true, basePrice: true, currency: true } },
          clinic: { select: { id: true, name: true } },
          sentMessages: {
            where: { channel: 'whatsapp' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
        orderBy: { startTime: 'desc' },
        take: 100,
      });

      const noShowCount = noShowAppointments.length;
      const noShowRate = totalAppointments > 0 ? Math.round((noShowCount / totalAppointments) * 100 * 10) / 10 : 0;

      // Revenue estimate — use appointmentType.basePrice if available
      const estimatedLostRevenue = noShowAppointments.reduce((sum, a) => {
        return sum + (a.appointmentType?.basePrice ?? 0);
      }, 0);

      const contactedCount = noShowAppointments.filter(a => (a as any).recoveryStatus === 'contacted' || (a as any).recoveryStatus === 'recovered').length;
      const recoveredCount = noShowAppointments.filter(a => (a as any).recoveryStatus === 'recovered').length;
      const recoveryRate = noShowCount > 0 ? Math.round((recoveredCount / noShowCount) * 100 * 10) / 10 : 0;

      // By clinic breakdown
      const clinics = await prisma.clinic.findMany({
        where: { id: { in: clinicFilter } },
        select: { id: true, name: true },
      });

      const byClinicMap = new Map<string, { noShowCount: number; totalAppointments: number; estimatedLostRevenue: number }>();
      for (const c of clinics) {
        byClinicMap.set(c.id, { noShowCount: 0, totalAppointments: 0, estimatedLostRevenue: 0 });
      }

      // Count all appointments per clinic in range
      const clinicTotals = await prisma.appointment.groupBy({
        by: ['clinicId'],
        where: baseWhere,
        _count: { id: true },
      });
      for (const ct of clinicTotals) {
        const entry = byClinicMap.get(ct.clinicId);
        if (entry) entry.totalAppointments = ct._count.id;
      }

      for (const a of noShowAppointments) {
        const entry = byClinicMap.get(a.clinicId);
        if (entry) {
          entry.noShowCount++;
          entry.estimatedLostRevenue += a.appointmentType?.basePrice ?? 0;
        }
      }

      const byClinic = clinics.map(c => {
        const entry = byClinicMap.get(c.id) ?? { noShowCount: 0, totalAppointments: 0, estimatedLostRevenue: 0 };
        return {
          clinicId: c.id,
          clinicName: c.name,
          noShowCount: entry.noShowCount,
          totalAppointments: entry.totalAppointments,
          noShowRate: entry.totalAppointments > 0 ? Math.round((entry.noShowCount / entry.totalAppointments) * 100 * 10) / 10 : 0,
          estimatedLostRevenue: entry.estimatedLostRevenue,
        };
      });

      // By doctor breakdown
      const doctorMap = new Map<string, { firstName: string; lastName: string; noShowCount: number; totalAppointments: number }>();

      const doctorTotals = await prisma.appointment.groupBy({
        by: ['practitionerId'],
        where: baseWhere,
        _count: { id: true },
      });
      for (const dt of doctorTotals) {
        const user = await prisma.user.findFirst({
          where: { id: dt.practitionerId },
          select: { id: true, firstName: true, lastName: true },
        });
        if (user) {
          doctorMap.set(dt.practitionerId, {
            firstName: user.firstName,
            lastName: user.lastName,
            noShowCount: 0,
            totalAppointments: dt._count.id,
          });
        }
      }

      for (const a of noShowAppointments) {
        const entry = doctorMap.get(a.practitionerId);
        if (entry) entry.noShowCount++;
      }

      const byDoctor = Array.from(doctorMap.entries()).map(([doctorId, d]) => ({
        doctorId,
        doctorName: `${d.firstName} ${d.lastName}`,
        noShowCount: d.noShowCount,
        totalAppointments: d.totalAppointments,
        noShowRate: d.totalAppointments > 0 ? Math.round((d.noShowCount / d.totalAppointments) * 100 * 10) / 10 : 0,
      }));

      // Recent no-shows (up to 50)
      const recentNoShows = noShowAppointments.slice(0, 50).map(a => ({
        appointmentId: a.id,
        patientId: a.patientId,
        patientName: `${a.patient.firstName} ${a.patient.lastName}`,
        clinicId: a.clinicId,
        clinicName: a.clinic.name,
        practitionerId: a.practitionerId ?? null,
        doctorName: `${a.practitioner.firstName} ${a.practitioner.lastName}`,
        appointmentTypeId: a.appointmentTypeId ?? null,
        date: a.startTime.toISOString().split('T')[0],
        time: a.startTime.toISOString().split('T')[1]?.substring(0, 5),
        serviceName: a.appointmentType?.name ?? null,
        estimatedValue: a.appointmentType?.basePrice ?? 0,
        currency: a.appointmentType?.currency ?? null,
        recoveryStatus: (a as any).recoveryStatus ?? 'unresolved',
        lastContactAt: a.sentMessages[0]?.createdAt ?? null,
      }));

      return res.json({
        summary: {
          noShowCount,
          noShowRate,
          estimatedLostRevenue,
          contactedCount,
          recoveredCount,
          recoveryRate,
        },
        byClinic,
        byDoctor,
        recentNoShows,
      });
    } catch (err) {
      console.error('[NoShows] Dashboard error:', err);
      return res.status(500).json({ error: 'Failed to fetch no-show dashboard' });
    }
  },
);

// ─── POST /api/appointments/:id/no-show/send-message ─────────────────────────

router.post(
  '/appointments/:id/no-show/send-message',
  authorize([...NO_SHOW_RECOVERY_ROLES]),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const { id: userId } = req.user!;
    const { message: customMessage } = req.body as { message?: string };

    try {
      const appointment = await loadAppointment(id, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      if (appointment.status !== 'no_show') {
        return res.status(400).json({ error: 'Can only send recovery messages for no-show appointments' });
      }

      const patient = appointment.patient;
      if (!patient.phone) {
        return res.status(400).json({ error: 'Patient has no phone number on record' });
      }

      const patientName = `${patient.firstName} ${patient.lastName}`;
      const appointmentDate = appointment.startTime.toLocaleDateString('tr-TR');
      const appointmentTime = appointment.startTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

      const body = customMessage
        ?? `Merhaba ${patientName}, ${appointmentDate} ${appointmentTime} tarihindeki randevunuza katılamadığınızı gördük. Yeni bir randevu oluşturmak isterseniz size yardımcı olabiliriz.`;

      const result = await sendWhatsAppMessage(appointment.clinicId, { phone: patient.phone, text: body });

      if (!result.success) {
        return res.status(400).json({ error: result.error ?? 'WhatsApp message failed to send' });
      }

      // Log sent message
      await prisma.sentMessage.create({
        data: {
          clinicId: appointment.clinicId,
          patientId: appointment.patientId,
          appointmentId: id,
          channel: 'whatsapp',
          recipient: patient.phone,
          body,
          status: 'sent',
          sentAt: new Date(),
          createdById: userId,
          direction: 'outgoing',
        },
      });

      // Update recovery status to contacted
      await prisma.appointment.update({
        where: { id },
        data: { recoveryStatus: 'contacted' },
      });

      await logActivity({
        clinicId: appointment.clinicId,
        userId,
        entityType: 'appointment',
        entityId: id,
        action: 'no_show_recovery_message_sent',
        description: `No-show recovery WhatsApp mesajı gönderildi: ${patientName}`,
      });

      writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId: appointment.clinicId,
        actorUserId: userId,
        actorRole: req.user!.role,
        action: 'no_show_recovery_message_sent',
        entityType: 'appointment',
        entityId: id,
        description: `WhatsApp recovery message sent to ${patientName}`,
        ...extractRequestMeta(req),
      });

      return res.json({ success: true, message: 'Recovery message sent successfully' });
    } catch (err) {
      console.error('[NoShows] Send message error:', err);
      return res.status(500).json({ error: 'Failed to send recovery message' });
    }
  },
);

// ─── POST /api/appointments/:id/no-show/create-task ──────────────────────────

router.post(
  '/appointments/:id/no-show/create-task',
  authorize([...NO_SHOW_RECOVERY_ROLES]),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const { id: userId } = req.user!;
    const { dueDate, assignedToId } = req.body as { dueDate?: string; assignedToId?: string };

    try {
      const appointment = await loadAppointment(id, req.user);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      if (appointment.status !== 'no_show') {
        return res.status(400).json({ error: 'Can only create follow-up tasks for no-show appointments' });
      }

      const patientName = `${appointment.patient.firstName} ${appointment.patient.lastName}`;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);

      const task = await prisma.task.create({
        data: {
          clinicId: appointment.clinicId,
          patientId: appointment.patientId,
          appointmentId: id,
          createdById: userId,
          assignedToId: assignedToId ?? userId,
          title: `No-show takip: ${patientName}`,
          description: `${appointment.startTime.toLocaleDateString('tr-TR')} tarihli randevuya gelinmedi. Hastayı arayarak yeniden randevu alın.`,
          dueDate: dueDate ? new Date(dueDate) : tomorrow,
          status: 'open',
          priority: 'normal',
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await logActivity({
        clinicId: appointment.clinicId,
        userId,
        entityType: 'task',
        entityId: task.id,
        action: 'created',
        description: `No-show takip görevi oluşturuldu: ${patientName}`,
        metadata: { appointmentId: id },
      });

      return res.json(task);
    } catch {
      return res.status(500).json({ error: 'Failed to create follow-up task' });
    }
  },
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyDashboard() {
  return {
    summary: {
      noShowCount: 0,
      noShowRate: 0,
      estimatedLostRevenue: 0,
      contactedCount: 0,
      recoveredCount: 0,
      recoveryRate: 0,
    },
    byClinic: [],
    byDoctor: [],
    recentNoShows: [],
  };
}

function buildDateFilter(range?: string, from?: string, to?: string): Record<string, Date> | undefined {
  const now = new Date();

  if (from || to) {
    const filter: Record<string, Date> = {};
    if (from) filter.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      filter.lte = toDate;
    }
    return filter;
  }

  switch (range) {
    case 'today': {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      return { gte: start, lte: end };
    }
    case 'this_week': {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return { gte: start, lte: now };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { gte: start, lte: now };
    }
    case 'last_30_days':
    default: {
      const start = new Date(now);
      start.setDate(now.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { gte: start, lte: now };
    }
  }
}

export default router;
