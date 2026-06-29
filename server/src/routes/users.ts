import crypto from 'crypto';
import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { sendMail } from '../services/emailService.js';
import { buildStaffWelcomeEmail } from '../services/emailTemplates.js';
import {
  formatClinicDateTime,
  getParam,
  getZonedDateParts,
  localDateTimeToClinicDate,
  timeToMinutes,
  validatePassword,
} from '../utils/helpers.js';
import { userCreateSchema, userUpdateSchema, availabilityBatchSchema, doctorOffDaySchema } from '../schemas/index.js';
import { checkUserLimit } from '../middleware/planLimits.js';
import { getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';

const router = express.Router();
const ACTIVE_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'rescheduled', 'in_progress'];

type AvailabilitySlotForConflictCheck = {
  weekday: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
};

const addDaysToDateString = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, '0'),
    String(result.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

const appointmentFitsAvailabilitySlots = (
  weekday: number,
  startMinutes: number,
  endMinutes: number,
  slots: AvailabilitySlotForConflictCheck[],
) => slots.some(slot => {
  if (slot.weekday !== weekday || slot.isActive === false) return false;
  return startMinutes >= timeToMinutes(slot.startTime) && endMinutes <= timeToMinutes(slot.endTime);
});

const findAppointmentsOutsideAvailability = async (
  clinicId: string,
  practitionerId: string,
  slots: AvailabilitySlotForConflictCheck[],
  timeZone: string,
) => {
  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      practitionerId,
      deletedAt: null,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      endTime: { gte: new Date() },
    },
    select: { id: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });

  return appointments.filter(appointment => {
    const start = getZonedDateParts(appointment.startTime, timeZone);
    const end = getZonedDateParts(appointment.endTime, timeZone);

    if (start.weekday !== end.weekday) return true;

    return !appointmentFitsAvailabilitySlots(start.weekday, start.minutes, end.minutes, slots);
  });
};

const countAppointmentsOnLocalDate = async (
  clinicId: string,
  practitionerId: string,
  date: string,
  timeZone: string,
) => {
  const dayStart = localDateTimeToClinicDate(date, '00:00', timeZone);
  const nextDay = localDateTimeToClinicDate(addDaysToDateString(date, 1), '00:00', timeZone);

  return prisma.appointment.count({
    where: {
      clinicId,
      practitionerId,
      deletedAt: null,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      startTime: { lt: nextDay },
      endTime: { gt: dayStart },
    },
  });
};

// GET /api/users
router.get('/users', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { role, clinicId: selectedClinicId } = req.query;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    // selectedClinicId varsa doğrula ve kullan
    let clinicIdFilter: string | { in: string[] };
    if (selectedClinicId && String(selectedClinicId) !== 'all') {
      if (!accessibleIds.includes(String(selectedClinicId))) {
        return res.status(403).json({ error: 'Access denied to requested clinic' });
      }
      clinicIdFilter = String(selectedClinicId);
    } else {
      clinicIdFilter = accessibleIds.length === 1 ? accessibleIds[0] : { in: accessibleIds };
    }

    const where: any = { clinicId: clinicIdFilter };
    if (role) where.role = String(role);

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
      orderBy: { firstName: 'asc' },
    });
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users
router.post('/users', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), checkUserLimit as express.RequestHandler, async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const validation = userCreateSchema.safeParse(req.body);

  if (!validation.success) {
    const passwordError = validation.error.flatten();
    if (passwordError.fieldErrors.password) {
      const passwordValidation = validatePassword(req.body.password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordValidation.errors });
      }
    }
    return res.status(400).json({ error: validation.error.format() });
  }

  const passwordValidation = validatePassword(validation.data.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordValidation.errors });
  }

  try {
    const existingGlobal = await prisma.user.findFirst({
      where: { email: { equals: validation.data.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingGlobal) {
      return res.status(409).json({
        error: 'Bu e-posta adresi başka bir kullanıcı hesabında kullanılıyor. Lütfen farklı bir e-posta adresi kullanın.',
        code: 'EMAIL_ALREADY_EXISTS',
      });
    }

    const passwordHash = await bcrypt.hash(validation.data.password, 12);
    const user = await prisma.user.create({
      data: {
        clinicId,
        organizationId: req.user!.organizationId,
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        email: validation.data.email.toLowerCase().trim(),
        phone: validation.data.phone,
        role: validation.data.role,
        passwordHash,
        isActive: validation.data.isActive,
        emailVerifiedAt: null,
      },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'user', entityId: user.id,
      action: 'created', description: `${user.email} kullanıcısı oluşturuldu`,
    });

    let emailSent = false;
    try {
      const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.noramedi.com';
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
      const verifyUrl = `${appBaseUrl}/verify-email?token=${rawToken}`;
      const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true } });
      const { subject, html, text } = buildStaffWelcomeEmail({
        firstName: user.firstName,
        clinicName: clinic?.name ?? 'NoraMedi',
        verifyUrl,
      });
      const mailResult = await sendMail({ to: user.email, subject, html, text });
      emailSent = mailResult.sent;
    } catch {
      // non-blocking — user is created regardless
    }

    res.status(201).json({ ...user, _emailSent: emailSent });
  } catch {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id
router.put('/users/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = userUpdateSchema.safeParse(req.body);

  if (!validation.success) {
    const passwordError = validation.error.flatten();
    if (passwordError.fieldErrors.password && req.body.password) {
      const passwordValidation = validatePassword(req.body.password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordValidation.errors });
      }
    }
    return res.status(400).json({ error: validation.error.format() });
  }

  if (validation.data.password) {
    const passwordValidation = validatePassword(validation.data.password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordValidation.errors });
    }
  }

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.user.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const clinicId = existing.clinicId;

    if (validation.data.email && validation.data.email.toLowerCase().trim() !== existing.email.toLowerCase()) {
      const emailOwner = await prisma.user.findFirst({
        where: { email: { equals: validation.data.email, mode: 'insensitive' }, id: { not: id } },
        select: { id: true },
      });
      if (emailOwner) {
        return res.status(409).json({
          error: 'Bu e-posta adresi başka bir kullanıcı hesabında kullanılıyor. Lütfen farklı bir e-posta adresi kullanın.',
          code: 'EMAIL_ALREADY_EXISTS',
        });
      }
    }

    if (id === req.user!.id && validation.data.isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const { password, ...rest } = validation.data;
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
      },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'user', entityId: user.id,
      action: 'updated', description: `${user.email} kullanıcısı güncellendi`,
    });

    res.json(user);
  } catch {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /api/doctor-availabilities
router.get('/doctor-availabilities', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const requestedPractitionerId = req.query.practitionerId ? String(req.query.practitionerId) : undefined;
  const practitionerId = normalizedRole === 'DENTIST' ? userId : requestedPractitionerId;
  const selectedClinicId = req.query.clinicId as string | undefined;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    let clinicFilter: any = { in: accessibleIds };
    if (selectedClinicId && selectedClinicId !== 'all') {
      if (!accessibleIds.includes(selectedClinicId)) return res.status(403).json({ error: 'Access denied to requested clinic' });
      clinicFilter = selectedClinicId;
    }

    const availabilities = await prisma.doctorAvailability.findMany({
      where: {
        clinicId: clinicFilter,
        ...(practitionerId ? { practitionerId } : {}),
        practitioner: { role: 'doctor', isActive: true },
      },
      include: {
        practitioner: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true },
        },
      },
      orderBy: [{ practitioner: { firstName: 'asc' } }, { weekday: 'asc' }, { startTime: 'asc' }],
    });
    res.json(availabilities);
  } catch {
    res.status(500).json({ error: 'Failed to fetch doctor availabilities' });
  }
});

// PUT /api/doctor-availabilities/:practitionerId
router.put('/doctor-availabilities/:practitionerId', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const { normalizedRole, id: userId } = req.user!;
  const practitionerId = getParam(req, 'practitionerId');

  if (normalizedRole === 'DENTIST' && practitionerId !== userId) {
    return res.status(403).json({ error: 'Doctors can only update their own availability' });
  }

  const validation = availabilityBatchSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const [practitioner, clinic] = await Promise.all([
      prisma.user.findFirst({
        where: { id: practitionerId, clinicId, role: 'doctor', isActive: true },
      }),
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { timezone: true },
      }),
    ]);
    if (!practitioner) return res.status(404).json({ error: 'Practitioner not found' });

    const timeZone = clinic?.timezone || 'Europe/Istanbul';
    const conflictingAppointments = await findAppointmentsOutsideAvailability(
      clinicId,
      practitionerId,
      validation.data.slots.filter(slot => slot.isActive !== false),
      timeZone,
    );

    if (conflictingAppointments.length > 0) {
      const dates = Array.from(new Set(
        conflictingAppointments.map(appointment => formatClinicDateTime(appointment.startTime, timeZone).date),
      ));

      return res.status(409).json({
        error: 'Availability cannot be restricted while existing appointments fall outside the new schedule',
        code: 'AVAILABILITY_HAS_APPOINTMENTS',
        appointmentCount: conflictingAppointments.length,
        dates: dates.slice(0, 5),
      });
    }

    const updated = await prisma.$transaction(async tx => {
      await tx.doctorAvailability.deleteMany({ where: { clinicId, practitionerId } });

      if (validation.data.slots.length > 0) {
        await tx.doctorAvailability.createMany({
          data: validation.data.slots.map(slot => ({
            clinicId, practitionerId,
            weekday: slot.weekday,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isActive: slot.isActive,
          })),
        });
      }

      return tx.doctorAvailability.findMany({
        where: { clinicId, practitionerId },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      });
    });

    await logActivity({
      clinicId, userId, entityType: 'doctor_availability', entityId: practitionerId,
      action: 'updated',
      description: `${practitioner.firstName} ${practitioner.lastName} müsaitlik bilgisi güncellendi`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update doctor availability' });
  }
});

// GET /api/doctor-off-days
router.get('/doctor-off-days', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const requestedPractitionerId = req.query.practitionerId ? String(req.query.practitionerId) : undefined;
  const practitionerId = normalizedRole === 'DENTIST' ? userId : requestedPractitionerId;
  const selectedClinicId = req.query.clinicId as string | undefined;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    let clinicFilter: any = { in: accessibleIds };
    if (selectedClinicId && selectedClinicId !== 'all') {
      if (!accessibleIds.includes(selectedClinicId)) return res.status(403).json({ error: 'Access denied to requested clinic' });
      clinicFilter = selectedClinicId;
    }

    const offDays = await prisma.doctorOffDay.findMany({
      where: {
        clinicId: clinicFilter,
        ...(practitionerId ? { practitionerId } : {}),
      },
      orderBy: { date: 'asc' },
    });
    res.json(offDays);
  } catch {
    res.status(500).json({ error: 'Failed to fetch doctor off days' });
  }
});

// POST /api/doctor-off-days
router.post('/doctor-off-days', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const { normalizedRole, id: userId } = req.user!;

  const validation = doctorOffDaySchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { practitionerId, date, reason } = validation.data;

  if (normalizedRole === 'DENTIST' && practitionerId !== userId) {
    return res.status(403).json({ error: 'Doctors can only manage their own off days' });
  }

  try {
    const [practitioner, clinic] = await Promise.all([
      prisma.user.findFirst({
        where: { id: practitionerId, clinicId, role: 'doctor', isActive: true },
      }),
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { timezone: true },
      }),
    ]);
    if (!practitioner) return res.status(404).json({ error: 'Practitioner not found' });

    const timeZone = clinic?.timezone || 'Europe/Istanbul';
    const appointmentCount = await countAppointmentsOnLocalDate(clinicId, practitionerId, date, timeZone);
    if (appointmentCount > 0) {
      return res.status(409).json({
        error: 'Off day cannot be added while appointments exist on this date',
        code: 'OFF_DAY_HAS_APPOINTMENTS',
        appointmentCount,
        date,
      });
    }

    const offDay = await prisma.doctorOffDay.upsert({
      where: { clinicId_practitionerId_date: { clinicId, practitionerId, date } },
      create: { clinicId, practitionerId, date, reason: reason ?? null },
      update: { reason: reason ?? null },
    });

    await logActivity({
      clinicId, userId, entityType: 'doctor_off_day', entityId: offDay.id,
      action: 'created',
      description: `${practitioner.firstName} ${practitioner.lastName} için ${date} tarihinde izin/tatil günü eklendi`,
    });

    res.status(201).json(offDay);
  } catch {
    res.status(500).json({ error: 'Failed to add off day' });
  }
});

// DELETE /api/doctor-off-days/:id
router.delete('/doctor-off-days/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const offDay = await prisma.doctorOffDay.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!offDay) return res.status(404).json({ error: 'Off day not found' });
    const clinicId = offDay.clinicId;

    if (normalizedRole === 'DENTIST' && offDay.practitionerId !== userId) {
      return res.status(403).json({ error: 'Doctors can only delete their own off days' });
    }

    await prisma.doctorOffDay.delete({ where: { id } });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Failed to delete off day' });
  }
});

export default router;
