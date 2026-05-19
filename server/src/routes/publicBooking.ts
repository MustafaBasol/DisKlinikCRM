import express, { Request, Response } from 'express';
import prisma from '../db.js';

const router = express.Router();

// GET /api/public/booking/:clinicId — clinic info + active services + active doctors
router.get('/booking/:clinicId', async (req: Request, res: Response) => {
  const clinicId = req.params.clinicId as string;

  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, name: true, phone: true, email: true, address: true },
    });

    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const [services, doctors, availabilities, offDays] = await Promise.all([
      prisma.appointmentType.findMany({
        where: { clinicId, isActive: true, isService: true },
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          basePrice: true,
          currency: true,
          category: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { clinicId, role: 'doctor', isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
      prisma.doctorAvailability.findMany({
        where: { clinicId, isActive: true },
        select: { practitionerId: true, weekday: true, startTime: true, endTime: true },
      }),
      prisma.doctorOffDay.findMany({
        where: { clinicId },
        select: { practitionerId: true, date: true },
      }),
    ]);

    // Build doctor → available weekdays map
    const doctorAvailability: Record<string, number[]> = {};
    for (const av of availabilities) {
      if (!doctorAvailability[av.practitionerId]) doctorAvailability[av.practitionerId] = [];
      doctorAvailability[av.practitionerId].push(av.weekday);
    }

    // Build doctor → off dates map
    const doctorOffDates: Record<string, string[]> = {};
    for (const od of offDays) {
      if (!doctorOffDates[od.practitionerId]) doctorOffDates[od.practitionerId] = [];
      doctorOffDates[od.practitionerId].push(od.date);
    }

    return res.json({
      clinic,
      services,
      doctors: doctors.map((d) => ({
        ...d,
        availableWeekdays: doctorAvailability[d.id] ?? [],
        offDates: doctorOffDates[d.id] ?? [],
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch booking info' });
  }
});

// POST /api/public/booking/:clinicId — submit appointment request (no auth)
router.post('/booking/:clinicId', async (req: Request, res: Response) => {
  const clinicId = req.params.clinicId as string;
  const {
    patientName,
    phone,
    email,
    serviceId,
    practitionerId,
    preferredDate,   // ISO date string "YYYY-MM-DD"
    preferredTime,   // "HH:MM"
    notes,
  } = req.body;

  // Basic validation
  if (!patientName || typeof patientName !== 'string' || patientName.trim().length < 2) {
    return res.status(400).json({ error: 'patientName is required (min 2 chars)' });
  }
  if (!phone || typeof phone !== 'string' || phone.trim().length < 7) {
    return res.status(400).json({ error: 'phone is required (min 7 chars)' });
  }
  // Sanitise inputs
  const cleanName = patientName.trim().substring(0, 120);
  const cleanPhone = phone.trim().replace(/[^\d\s\-\+\(\)]/g, '').substring(0, 30);
  const cleanEmail = email && typeof email === 'string' ? email.trim().substring(0, 200) : undefined;
  const cleanNotes = notes && typeof notes === 'string' ? notes.trim().substring(0, 500) : undefined;

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    // Validate optional FK references belong to this clinic
    if (serviceId) {
      const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
      if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
    }
    if (practitionerId) {
      const doc = await prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor' } });
      if (!doc) return res.status(400).json({ error: 'Invalid practitionerId' });
    }

    // Build preferredStartTime
    let preferredStartTime: Date | undefined;
    if (preferredDate && preferredTime) {
      const dt = new Date(`${preferredDate}T${preferredTime}:00`);
      if (!isNaN(dt.getTime())) preferredStartTime = dt;
    }

    // Try to match an existing patient by phone in this clinic
    const existingPatient = await prisma.patient.findFirst({
      where: { clinicId, phone: cleanPhone, deletedAt: null },
      select: { id: true },
    });

    const request = await prisma.appointmentRequest.create({
      data: {
        clinicId,
        patientId: existingPatient?.id ?? null,
        patientName: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        appointmentTypeId: serviceId ?? null,
        practitionerId: practitionerId ?? null,
        preferredStartTime: preferredStartTime ?? null,
        requestType: 'appointment',
        source: 'widget',
        status: 'pending',
        notes: cleanNotes,
      },
    });

    return res.status(201).json({ success: true, requestId: request.id });
  } catch {
    return res.status(500).json({ error: 'Failed to submit booking request' });
  }
});

export default router;
