import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam, validatePassword } from '../utils/helpers.js';
import { userCreateSchema, userUpdateSchema, availabilityBatchSchema, doctorOffDaySchema } from '../schemas/index.js';

const router = express.Router();

// GET /api/users
router.get('/users', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role } = req.query;

  try {
    const where: any = { clinicId };
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
router.post('/users', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
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

  try {
    const existing = await prisma.user.findUnique({ where: { email: validation.data.email } });
    if (existing) return res.status(409).json({ error: 'Email is already in use' });

    const passwordHash = await bcrypt.hash(validation.data.password, 12);
    const user = await prisma.user.create({
      data: {
        clinicId,
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        email: validation.data.email,
        phone: validation.data.phone,
        role: validation.data.role,
        passwordHash,
        isActive: validation.data.isActive,
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

    res.status(201).json(user);
  } catch {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id
router.put('/users/:id', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
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

  try {
    const existing = await prisma.user.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (validation.data.email && validation.data.email !== existing.email) {
      const emailOwner = await prisma.user.findUnique({ where: { email: validation.data.email } });
      if (emailOwner) return res.status(409).json({ error: 'Email is already in use' });
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
router.get('/doctor-availabilities', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const requestedPractitionerId = req.query.practitionerId ? String(req.query.practitionerId) : undefined;
  const practitionerId = role === 'doctor' ? userId : requestedPractitionerId;

  try {
    const availabilities = await prisma.doctorAvailability.findMany({
      where: {
        clinicId,
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
router.put('/doctor-availabilities/:practitionerId', authorize(['admin', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const practitionerId = getParam(req, 'practitionerId');

  if (role === 'doctor' && practitionerId !== userId) {
    return res.status(403).json({ error: 'Doctors can only update their own availability' });
  }

  const validation = availabilityBatchSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const practitioner = await prisma.user.findFirst({
      where: { id: practitionerId, clinicId, role: 'doctor', isActive: true },
    });
    if (!practitioner) return res.status(404).json({ error: 'Practitioner not found' });

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
router.get('/doctor-off-days', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const requestedPractitionerId = req.query.practitionerId ? String(req.query.practitionerId) : undefined;
  const practitionerId = role === 'doctor' ? userId : requestedPractitionerId;

  try {
    const offDays = await prisma.doctorOffDay.findMany({
      where: {
        clinicId,
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
router.post('/doctor-off-days', authorize(['admin', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  const validation = doctorOffDaySchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { practitionerId, date, reason } = validation.data;

  if (role === 'doctor' && practitionerId !== userId) {
    return res.status(403).json({ error: 'Doctors can only manage their own off days' });
  }

  try {
    const practitioner = await prisma.user.findFirst({
      where: { id: practitionerId, clinicId, role: 'doctor', isActive: true },
    });
    if (!practitioner) return res.status(404).json({ error: 'Practitioner not found' });

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
router.delete('/doctor-off-days/:id', authorize(['admin', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const id = getParam(req, 'id');

  try {
    const offDay = await prisma.doctorOffDay.findFirst({ where: { id, clinicId } });
    if (!offDay) return res.status(404).json({ error: 'Off day not found' });

    if (role === 'doctor' && offDay.practitionerId !== userId) {
      return res.status(403).json({ error: 'Doctors can only delete their own off days' });
    }

    await prisma.doctorOffDay.delete({ where: { id } });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Failed to delete off day' });
  }
});

export default router;
