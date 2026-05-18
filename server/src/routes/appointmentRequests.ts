import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam, checkPractitionerAvailability } from '../utils/helpers.js';
import { appointmentRequestStatusSchema, appointmentRequestConvertSchema } from '../schemas/index.js';

const router = express.Router();

// GET /api/appointment-requests
router.get('/appointment-requests', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { status, requestType, source } = req.query;

  try {
    const requests = await prisma.appointmentRequest.findMany({
      where: {
        clinicId,
        ...(status ? { status: String(status) } : {}),
        ...(requestType ? { requestType: String(requestType) } : {}),
        ...(source ? { source: String(source) } : {}),
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const shouldIncludeLegacyWhatsappAppointments =
      String(source ?? '') === 'whatsapp' &&
      (!status || String(status) === 'converted') &&
      (!requestType || String(requestType) === 'appointment');

    if (!shouldIncludeLegacyWhatsappAppointments) return res.json(requests);

    const legacyAppointments = await prisma.appointment.findMany({
      where: {
        clinicId,
        deletedAt: null,
        notes: { contains: 'WhatsApp assistant üzerinden oluşturuldu.' },
        sourceRequests: { none: {} },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const legacyRequestRows = legacyAppointments.map(appointment => ({
      id: `legacy-${appointment.id}`,
      clinicId,
      patientId: appointment.patientId,
      patient: appointment.patient,
      patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim(),
      phone: appointment.patient.phone,
      email: appointment.patient.email,
      appointmentTypeId: appointment.appointmentTypeId,
      appointmentType: appointment.appointmentType,
      practitionerId: appointment.practitionerId,
      practitioner: appointment.practitioner,
      preferredStartTime: appointment.startTime,
      preferredEndTime: appointment.endTime,
      requestType: 'appointment',
      source: 'whatsapp',
      status: 'converted',
      rawMessage: null,
      notes: appointment.notes,
      rejectionReason: null,
      convertedAppointmentId: appointment.id,
      convertedAppointment: { id: appointment.id, startTime: appointment.startTime, status: appointment.status },
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
    }));

    const combined = [...requests, ...legacyRequestRows]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    res.json(combined);
  } catch {
    res.status(500).json({ error: 'Failed to fetch appointment requests' });
  }
});

// PUT /api/appointment-requests/:id/status
router.put('/appointment-requests/:id/status', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  const validation = appointmentRequestStatusSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.appointmentRequest.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Appointment request not found' });
    if (existing.status === 'converted') {
      return res.status(400).json({ error: 'Converted requests cannot be changed from this endpoint' });
    }

    const updated = await prisma.appointmentRequest.update({
      where: { id },
      data: {
        status: validation.data.status,
        notes: validation.data.notes ?? existing.notes,
        rejectionReason: validation.data.rejectionReason,
      },
      include: {
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'appointment_request', entityId: id,
      action: validation.data.status,
      description: `WhatsApp appointment request marked as ${validation.data.status}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update appointment request' });
  }
});

// POST /api/appointment-requests/:id/convert
router.post('/appointment-requests/:id/convert', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  const validation = appointmentRequestConvertSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const request = await prisma.appointmentRequest.findFirst({
      where: { id, clinicId },
      include: { patient: true },
    });

    if (!request) return res.status(404).json({ error: 'Appointment request not found' });
    if (request.status === 'converted') return res.status(400).json({ error: 'Appointment request is already converted' });
    if (request.requestType === 'cancel') return res.status(400).json({ error: 'Cancel requests cannot be converted to appointments' });

    const appointmentTypeId = validation.data.appointmentTypeId || request.appointmentTypeId;
    const practitionerId = validation.data.practitionerId || request.practitionerId;
    const startTime = validation.data.startTime || request.preferredStartTime;
    const endTime = validation.data.endTime || request.preferredEndTime;

    if (!appointmentTypeId || !practitionerId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Service, practitioner, start time, and end time are required for conversion' });
    }

    const [service, practitioner] = await Promise.all([
      prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } }),
      prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor', isActive: true } }),
    ]);

    if (!service) return res.status(400).json({ error: 'Invalid appointment type' });
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    let patientId = validation.data.patientId || request.patientId;
    if (patientId) {
      const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } });
      if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    } else {
      const [firstName, ...lastNameParts] = request.patientName.trim().split(/\s+/);
      const patient = await prisma.patient.create({
        data: {
          clinicId,
          firstName: firstName || request.patientName,
          lastName: lastNameParts.join(' ') || '-',
          phone: request.phone,
          email: request.email,
          source: 'whatsapp',
          communicationConsent: true,
          notes: 'WhatsApp randevu talebinden oluşturuldu.',
        },
      });
      patientId = patient.id;
    }

    const availability = await checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
    if (!availability.ok) {
      return res.status(409).json({
        error: 'Appointment is outside practitioner availability',
        code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
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
      data: {
        clinicId,
        patientId,
        practitionerId,
        appointmentTypeId,
        startTime,
        endTime,
        status: 'scheduled',
        notes: validation.data.notes || request.notes || 'WhatsApp randevu talebinden oluşturuldu.',
        createdById: req.user!.id,
      },
      include: { patient: true, practitioner: true, appointmentType: true },
    });

    const updatedRequest = await prisma.appointmentRequest.update({
      where: { id },
      data: {
        status: 'converted',
        patientId,
        convertedAppointmentId: appointment.id,
        notes: validation.data.notes ?? request.notes,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'appointment_request', entityId: id,
      action: 'converted',
      description: 'WhatsApp appointment request converted to appointment',
      appointmentId: appointment.id,
    });

    res.status(201).json({ appointment, request: updatedRequest });
  } catch {
    res.status(500).json({ error: 'Failed to convert appointment request' });
  }
});

export default router;
