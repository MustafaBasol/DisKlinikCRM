import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import {
  checkPractitionerAvailability,
  getParam,
  getZonedDateParts,
  localDateTimeToClinicDate,
  minutesToTime,
  timeToMinutes,
} from '../utils/helpers.js';
import { appointmentSchema, appointmentUpdateSchema } from '../schemas/index.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';

const router = express.Router();
const SLOT_STEP_MINUTES = 30;

const addDaysToDateString = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = result.getUTCFullYear();
  const nextMonth = String(result.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(result.getUTCDate()).padStart(2, '0');

  return `${nextYear}-${nextMonth}-${nextDay}`;
};

// GET /api/appointments
router.get('/appointments', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
const { start, end, status, practitionerId, patientId, search, treatmentCaseId, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope, deletedAt: null };

    if (normalizedRole === 'DENTIST') {
      where.practitionerId = userId;
    } else if (practitionerId) {
      where.practitionerId = String(practitionerId);
    }

    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);
    if (treatmentCaseId) where.treatmentCaseId = String(treatmentCaseId);

    if (start || end) {
      where.startTime = {};
      if (start) where.startTime.gte = new Date(String(start));
      if (end) where.startTime.lte = new Date(String(end));
    }

    if (search) {
      where.patient = {
        OR: [
          { firstName: { contains: String(search) } },
          { lastName: { contains: String(search) } },
        ],
      };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: { patient: true, practitioner: true, appointmentType: true, treatmentCase: { select: { id: true, title: true } } },
      orderBy: { startTime: 'asc' },
    });
    res.json(appointments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// GET /api/appointments/available-slots
router.get('/appointments/available-slots', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const doctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : '';
  const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : '';
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const excludeAppointmentId = typeof req.query.excludeAppointmentId === 'string' ? req.query.excludeAppointmentId : undefined;

  if (!doctorId || !serviceId || !date) {
    return res.status(400).json({ error: 'doctorId, serviceId and date are required' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must use YYYY-MM-DD format' });
  }

  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const [clinic, service, practitionerUser] = await Promise.all([
      prisma.clinic.findFirst({ where: { id: clinicId }, select: { id: true, timezone: true } }),
      prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId, isActive: true } }),
      prisma.user.findFirst({ where: { id: doctorId, isActive: true } }),
    ]);

    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    if (!service) return res.status(400).json({ error: 'Invalid service' });
    if (!practitionerUser) return res.status(400).json({ error: 'Invalid practitioner' });

    const isAssigned =
      practitionerUser.clinicId === clinicId ||
      !!(await prisma.userClinic.findFirst({ where: { userId: doctorId, clinicId, isActive: true } }));

    if (!isAssigned) {
      return res.status(400).json({ error: 'Practitioner is not assigned to this clinic' });
    }

    const timeZone = clinic.timezone || 'Europe/Istanbul';
    const weekday = getZonedDateParts(localDateTimeToClinicDate(date, '12:00', timeZone), timeZone).weekday;
    const dayStart = localDateTimeToClinicDate(date, '00:00', timeZone);
    const nextDay = localDateTimeToClinicDate(addDaysToDateString(date, 1), '00:00', timeZone);

    const [clinicHours, offDay, doctorSlots, existingAppointments] = await Promise.all([
      prisma.clinicWorkingHours.findUnique({
        where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: weekday } },
      }),
      prisma.doctorOffDay.findFirst({
        where: { clinicId, practitionerId: doctorId, date },
      }),
      prisma.doctorAvailability.findMany({
        where: { clinicId, practitionerId: doctorId, weekday, isActive: true },
        orderBy: { startTime: 'asc' },
      }),
      prisma.appointment.findMany({
        where: {
          clinicId,
          practitionerId: doctorId,
          deletedAt: null,
          status: { notIn: ['cancelled'] },
          ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
          startTime: { lt: nextDay },
          endTime: { gt: dayStart },
        },
        select: { id: true, startTime: true, endTime: true },
        orderBy: { startTime: 'asc' },
      }),
    ]);

    if (clinicHours?.isClosed) {
      return res.json({
        date,
        doctorId,
        serviceId,
        serviceDuration: service.durationMinutes,
        slotStepMinutes: SLOT_STEP_MINUTES,
        timeZone,
        slots: [],
        reason: 'clinic_closed',
      });
    }

    if (offDay) {
      return res.json({
        date,
        doctorId,
        serviceId,
        serviceDuration: service.durationMinutes,
        slotStepMinutes: SLOT_STEP_MINUTES,
        timeZone,
        slots: [],
        reason: 'off_day',
      });
    }

    if (doctorSlots.length === 0) {
      return res.json({
        date,
        doctorId,
        serviceId,
        serviceDuration: service.durationMinutes,
        slotStepMinutes: SLOT_STEP_MINUTES,
        timeZone,
        slots: [],
        reason: 'doctor_availability_missing',
      });
    }

    const slots: Array<{ start: string; end: string; startTime: string; endTime: string }> = [];
    const now = new Date();

    for (const availability of doctorSlots) {
      const availabilityStart = timeToMinutes(availability.startTime);
      const availabilityEnd = timeToMinutes(availability.endTime);

      for (
        let cursor = availabilityStart;
        cursor + service.durationMinutes <= availabilityEnd;
        cursor += SLOT_STEP_MINUTES
      ) {
        const slotEnd = cursor + service.durationMinutes;
        const start = minutesToTime(cursor);
        const end = minutesToTime(slotEnd);
        const startTime = localDateTimeToClinicDate(date, start, timeZone);
        const endTime = localDateTimeToClinicDate(date, end, timeZone);

        if (startTime <= now) continue;

        const overlaps = existingAppointments.some(appointment =>
          startTime < appointment.endTime && endTime > appointment.startTime
        );

        if (!overlaps) {
          slots.push({
            start,
            end,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          });
        }
      }
    }

    res.json({
      date,
      doctorId,
      serviceId,
      serviceDuration: service.durationMinutes,
      slotStepMinutes: SLOT_STEP_MINUTES,
      timeZone,
      slots,
    });
  } catch {
    res.status(500).json({ error: 'Failed to compute available slots' });
  }
});

// GET /api/appointments/:id
router.get('/appointments/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const { normalizedRole, id: userId } = req.user!;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const appointment = await prisma.appointment.findFirst({
      where: { id, clinicId: { in: accessibleIds }, deletedAt: null },
      include: {
        patient: true,
        practitioner: true,
        appointmentType: true,
        treatmentCase: { select: { id: true, title: true } },
        activityLogs: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    if (normalizedRole === 'DENTIST' && appointment.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden: Access to other doctors appointments is restricted' });
    }

    res.json(appointment);
  } catch {
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// POST /api/appointments
router.post('/appointments', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  // ?clinicId query param varsa doğrula, yoksa defaultClinicId kullan
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const validation = appointmentSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { patientId, practitionerId, appointmentTypeId, startTime, endTime } = validation.data;

  try {
    const [patient, practitionerUser, type] = await Promise.all([
      prisma.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } }),
      prisma.user.findFirst({ where: { id: practitionerId } }),
      prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } }),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (!practitionerUser) return res.status(400).json({ error: 'Invalid practitioner' });
    if (!type) return res.status(400).json({ error: 'Invalid appointment type' });

    // Çok şubeli kontrol: doktor bu klinikle UserClinic veya legacy User.clinicId üzerinden ilişkili olmalı
    const isAssigned =
      practitionerUser.clinicId === clinicId ||
      !!(await prisma.userClinic.findFirst({ where: { userId: practitionerId, clinicId, isActive: true } }));
    if (!isAssigned) {
      return res.status(400).json({ error: 'Practitioner is not assigned to this clinic' });
    }
    const practitioner = practitionerUser;

    const availability = await checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
    if (!availability.ok) {
      return res.status(409).json({
        error: 'Appointment is outside practitioner availability',
        code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
        reason: availability.reason,
        availability: availability.slots,
      });
    }

    const overlap = await prisma.appointment.findFirst({
      where: {
        clinicId, practitionerId, deletedAt: null, status: { notIn: ['cancelled'] },
        OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
      },
    });

    if (overlap) {
      return res.status(409).json({ error: 'Practitioner already has an appointment during this time', code: 'APPOINTMENT_OVERLAP' });
    }

    const appointment = await prisma.appointment.create({
      data: { ...validation.data, clinicId, status: 'confirmed' },
      include: { patient: true, practitioner: true, appointmentType: true },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'appointment', entityId: appointment.id,
      action: 'created',
      description: `${patient.firstName} ${patient.lastName} için Dr. ${practitioner.lastName} ile randevu oluşturuldu`,
      metadata: { patientName: `${patient.firstName} ${patient.lastName}`, practitioner: `Dr. ${practitioner.lastName}` },
    });

    writeAuditLog({
      organizationId: req.user!.organizationId,
      clinicId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'appointment_created',
      entityType: 'appointment',
      entityId: appointment.id,
      description: `Appointment created for ${patient.firstName} ${patient.lastName}`,
      metadata: { patientId, practitionerId, startTime: String(startTime), endTime: String(endTime) },
      ...extractRequestMeta(req),
    });

    res.json(appointment);
  } catch {
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// PUT /api/appointments/:id
router.put('/appointments/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const { normalizedRole, id: userId } = req.user!;

  const validation = appointmentUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.appointment.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });
    const clinicId = existing.clinicId;

    if (normalizedRole === 'DENTIST' && existing.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (validation.data.status && validation.data.status !== existing.status) {
      const validTransitions: Record<string, string[]> = {
        'scheduled': ['confirmed', 'cancelled', 'rescheduled', 'no_show', 'completed'],
        'confirmed': ['completed', 'cancelled', 'rescheduled', 'no_show'],
        'rescheduled': ['confirmed', 'cancelled', 'no_show', 'completed'],
        'completed': [],
        'cancelled': [],
        'no_show': ['rescheduled', 'cancelled'],
      };

      if (!validTransitions[existing.status]?.includes(validation.data.status)) {
        return res.status(400).json({ error: `Invalid status transition from ${existing.status} to ${validation.data.status}` });
      }

      if (normalizedRole === 'DENTIST' && validation.data.status !== 'completed') {
        return res.status(403).json({ error: 'Doctors can only mark appointments as completed' });
      }
    }

    const nextPractitionerId = validation.data.practitionerId || existing.practitionerId;
    const nextStartTime = validation.data.startTime || existing.startTime;
    const nextEndTime = validation.data.endTime || existing.endTime;
    const timeOrPractitionerChanged =
      nextPractitionerId !== existing.practitionerId ||
      nextStartTime.getTime() !== existing.startTime.getTime() ||
      nextEndTime.getTime() !== existing.endTime.getTime();

    if (timeOrPractitionerChanged) {
      const availability = await checkPractitionerAvailability(clinicId, nextPractitionerId, nextStartTime, nextEndTime);
      if (!availability.ok) {
        return res.status(409).json({
          error: 'Appointment is outside practitioner availability',
          code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
          reason: availability.reason,
          availability: availability.slots,
        });
      }

      const overlap = await prisma.appointment.findFirst({
        where: {
          id: { not: id }, clinicId, practitionerId: nextPractitionerId, deletedAt: null,
          status: { notIn: ['cancelled'] },
          OR: [{ startTime: { lt: nextEndTime }, endTime: { gt: nextStartTime } }],
        },
      });

      if (overlap) return res.status(409).json({ error: 'Overlap detected with another appointment' });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: validation.data,
      include: { patient: true, practitioner: true },
    });

    if (validation.data.status && validation.data.status !== existing.status) {
      await logActivity({
        clinicId, userId, entityType: 'appointment', entityId: id,
        action: validation.data.status,
        description: `Randevu durumu güncellendi: ${existing.status} → ${validation.data.status}`,
      });
      writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: validation.data.status === 'cancelled' ? 'appointment_cancelled' : 'appointment_updated',
        entityType: 'appointment',
        entityId: id,
        description: `Appointment status: ${existing.status} → ${validation.data.status}`,
        metadata: { previousStatus: existing.status, newStatus: validation.data.status },
        ...extractRequestMeta(req),
      });
    } else {
      await logActivity({
        clinicId, userId, entityType: 'appointment', entityId: id,
        action: 'updated', description: 'Randevu bilgileri güncellendi',
      });
      writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'appointment_updated',
        entityType: 'appointment',
        entityId: id,
        description: `Appointment updated`,
        ...extractRequestMeta(req),
      });
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// PATCH /api/appointments/:id/treatment-case — link or unlink a treatment case
router.patch('/appointments/:id/treatment-case', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const { treatmentCaseId } = req.body; // null to unlink

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.appointment.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });
    const clinicId = existing.clinicId;

    if (treatmentCaseId) {
      const tc = await prisma.treatmentCase.findFirst({ where: { id: treatmentCaseId, clinicId } });
      if (!tc) return res.status(400).json({ error: 'Invalid treatment case' });
      // ensure appointment belongs to same patient
      if (tc.patientId !== existing.patientId) {
        return res.status(400).json({ error: 'Treatment case does not belong to this appointment\'s patient' });
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { treatmentCaseId: treatmentCaseId ?? null },
      include: { patient: true, practitioner: true, appointmentType: true, treatmentCase: { select: { id: true, title: true } } },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'appointment', entityId: id,
      action: 'updated',
      description: treatmentCaseId ? `Randevu tedavi dosyasına bağlandı` : 'Randevunun tedavi dosyası bağlantısı kaldırıldı',
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update treatment case link' });
  }
});

export default router;
