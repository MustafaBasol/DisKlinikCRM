import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam, checkPractitionerAvailability } from '../utils/helpers.js';
import {
  checkAppointmentOverlap,
  checkAppointmentRequestConflict,
} from '../services/appointments/appointmentAvailabilityService.js';
import { appointmentRequestStatusSchema, appointmentRequestConvertSchema, appointmentRequestUpdateSchema } from '../schemas/index.js';
import { patientContactSelect, userPublicSelect } from '../utils/prismaSelects.js';
import { findUserAssignedToClinic } from '../utils/relationGuards.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { sendAppointmentRequestConfirmationNotification } from '../services/appointmentRequestNotification.js';

const router = express.Router();

function appointmentRequestSourceLabel(source: string | null | undefined) {
  const normalized = String(source ?? '').toLowerCase();
  if (normalized === 'instagram') return 'Instagram';
  if (normalized === 'manual') return 'Manual';
  return 'WhatsApp';
}

export function resolveAppointmentRequestSourceFilter(query: { source?: unknown; channel?: unknown }) {
  const value = query.channel || query.source;
  return value ? String(value) : null;
}

export function shouldIncludeLegacyWhatsappAppointmentRows(query: {
  source?: unknown;
  channel?: unknown;
  status?: unknown;
  requestType?: unknown;
}) {
  const sourceFilter = resolveAppointmentRequestSourceFilter(query);
  return (!sourceFilter || sourceFilter === 'whatsapp') &&
    (!query.status || String(query.status) === 'converted') &&
    (!query.requestType || String(query.requestType) === 'appointment');
}

// GET /api/appointment-requests
router.get('/appointment-requests', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { status, requestType, source, channel, clinicId: selectedClinicId } = req.query;
  const sourceFilter = resolveAppointmentRequestSourceFilter({ source, channel });

  const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
  if (scope === false) return;

  try {
    const requests = await prisma.appointmentRequest.findMany({
      where: {
        ...scope,
        ...(status ? { status: String(status) } : {}),
        // When no explicit requestType filter is set, exclude staff-handoff-only records
        // (requestType 'info') — those now live in ContactRequest.
        ...(requestType
          ? { requestType: String(requestType) }
          : { requestType: { not: 'info' } }),
        ...(sourceFilter ? { source: sourceFilter } : {}),
      },
      include: {
        clinic: { select: { id: true, name: true } },
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const shouldIncludeLegacyWhatsappAppointments = shouldIncludeLegacyWhatsappAppointmentRows({
      source,
      channel,
      status,
      requestType,
    });

    if (!shouldIncludeLegacyWhatsappAppointments) return res.json(requests);

    const legacyAppointments = await prisma.appointment.findMany({
      where: {
        ...scope,
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
      clinicId: appointment.clinicId,
      clinic: null,
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
      externalSenderId: appointment.patient.phone,
      sourceConnectionId: null,
      sourceInboxEntryId: null,
      sourceConversationId: appointment.patient.phone,
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

// GET /api/appointment-requests/counts
router.get('/appointment-requests/counts', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const scope = await validateAndGetClinicIdScope(req.user!, req.query.clinicId as string | undefined, res);
  if (scope === false) return;
  try {
    const pending = await prisma.appointmentRequest.count({
      where: { ...scope, status: 'pending', requestType: { not: 'info' } },
    });
    res.json({ pending });
  } catch {
    res.status(500).json({ error: 'Failed to fetch appointment request counts' });
  }
});

// PUT /api/appointment-requests/:id/status
router.put('/appointment-requests/:id/status', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = appointmentRequestStatusSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    // Organizasyon kapsamında ara; erişim kliniğe göre (aşağıda) ayrıca doğrulanır —
    // req.user.clinicId (varsayılan klinik) burada asla filtre olarak kullanılmaz.
    const existing = await prisma.appointmentRequest.findFirst({
      where: { id, clinic: { organizationId: req.user!.organizationId } },
    });
    if (!existing) return res.status(404).json({ error: 'Appointment request not found' });
    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(existing.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this appointment request' });
    }
    const clinicId = existing.clinicId; // kayıt kaynaklı — asla req.user.clinicId'ye düşmez
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
      description: `Appointment request marked as ${validation.data.status}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update appointment request' });
  }
});

// POST /api/appointment-requests/:id/convert
router.post('/appointment-requests/:id/convert', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = appointmentRequestConvertSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    // Organizasyon kapsamında ara; kayıtın SAHİP OLDUĞU klinik aşağıda erişim
    // kontrolü için kullanılır. req.user.clinicId (varsayılan klinik) burada
    // ASLA hedef klinik olarak varsayılmaz — talep başka bir izinli şubeye
    // aitse dönüşüm o şubede gerçekleşir.
    const request = await prisma.appointmentRequest.findFirst({
      where: { id, clinic: { organizationId: req.user!.organizationId } },
      include: { patient: { select: patientContactSelect } },
    });

    if (!request) return res.status(404).json({ error: 'Appointment request not found' });
    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(request.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this appointment request' });
    }
    const clinicId = request.clinicId; // kayıt kaynaklı — hasta/randevu bu klinige yazılır
    if (request.status === 'converted') return res.status(400).json({ error: 'Appointment request is already converted' });
    if (request.requestType === 'cancel') return res.status(400).json({ error: 'Cancel requests cannot be converted to appointments' });

    const appointmentTypeId = validation.data.appointmentTypeId || request.appointmentTypeId;
    const practitionerId = validation.data.practitionerId || request.practitionerId;
    const startTime = validation.data.startTime || request.preferredStartTime;
    const endTime = validation.data.endTime || request.preferredEndTime;

    if (!appointmentTypeId || !practitionerId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Service, practitioner, start time, and end time are required for conversion', code: 'MISSING_REQUIRED_FIELDS' });
    }

    const [service, practitioner] = await Promise.all([
      prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } }),
      findUserAssignedToClinic(practitionerId, clinicId, { roles: ['DENTIST'] }),
    ]);

    if (!service) return res.status(400).json({ error: 'Invalid appointment type' });
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    let patientId = validation.data.patientId || request.patientId;
    // Yeni hasta oluşturma verisi hazırlanır ama YAZILMAZ — asıl create çağrısı
    // aşağıdaki transaction içinde yapılır (randevu ve talep güncellemesiyle atomik).
    let newPatientData: {
      clinicId: string;
      organizationId: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      email: string | null;
      source: string;
      communicationConsent: boolean;
      notes: string;
    } | null = null;
    if (patientId) {
      const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } });
      if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    } else {
      const [firstName, ...lastNameParts] = request.patientName.trim().split(/\s+/);
      newPatientData = {
        clinicId,
        // Organizasyon zaten yukarıdaki organizasyon-kapsamlı sorguyla doğrulandı —
        // ekstra bir clinic lookup'a gerek yok.
        organizationId: req.user!.organizationId,
        firstName: firstName || request.patientName,
        lastName: lastNameParts.join(' ') || '-',
        phone: request.phone,
        email: request.email,
        source: request.source || 'whatsapp',
        communicationConsent: true,
        notes: `${appointmentRequestSourceLabel(request.source)} randevu talebinden oluşturuldu.`,
      };
    }

    const availability = await checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
    if (!availability.ok) {
      return res.status(409).json({
        error: 'Appointment is outside practitioner availability',
        code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
        availability: availability.slots,
      });
    }

    const overlap = await checkAppointmentOverlap(prisma, {
      clinicId,
      practitionerId,
      startTime,
      endTime,
    });

    if (overlap) {
      return res.status(409).json({ error: 'Practitioner already has an appointment during this time', code: 'APPOINTMENT_OVERLAP' });
    }

    const requestConflict = await checkAppointmentRequestConflict(prisma, {
      clinicId,
      practitionerId,
      startTime,
      endTime,
      excludeRequestId: id, // do not conflict with the request being converted
    });

    if (requestConflict) {
      return res.status(409).json({
        error: 'This slot already has a pending or approved appointment request.',
        code: 'APPOINTMENT_REQUEST_CONFLICT',
      });
    }

    // Hasta oluşturma (varsa), randevu oluşturma ve talep güncellemesi tek bir
    // transaction içinde çalışır — herhangi bir adım başarısız olursa hepsi
    // geri alınır (kısmi hasta/randevu durumu bırakılmaz).
    const { appointment, updatedRequest } = await prisma.$transaction(async (tx) => {
      if (newPatientData) {
        const createdPatient = await tx.patient.create({ data: newPatientData });
        patientId = createdPatient.id;
      }

      const appointment = await tx.appointment.create({
        data: {
          clinicId,
          patientId: patientId!,
          practitionerId,
          appointmentTypeId,
          startTime,
          endTime,
          status: 'scheduled',
          notes: validation.data.notes || request.notes || `${appointmentRequestSourceLabel(request.source)} randevu talebinden oluşturuldu.`,
          createdById: req.user!.id,
        },
        include: { patient: { select: patientContactSelect }, practitioner: { select: userPublicSelect }, appointmentType: true },
      });

      const updatedRequest = await tx.appointmentRequest.update({
        where: { id },
        data: {
          status: 'converted',
          patientId: patientId!,
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

      return { appointment, updatedRequest };
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'appointment_request', entityId: id,
      action: 'converted',
      description: `${appointmentRequestSourceLabel(request.source)} appointment request converted to appointment`,
      appointmentId: appointment.id,
    });

    res.status(201).json({ appointment, request: updatedRequest });

    sendAppointmentRequestConfirmationNotification({
      clinicId,
      source: request.source,
      phone: request.phone,
      externalSenderId: request.externalSenderId,
      sourceConnectionId: request.sourceConnectionId,
      patientName: request.patientName,
      organizationId: req.user!.organizationId,
      patientId: patientId!,
      appointment: {
        startTime: appointment.startTime,
        appointmentType: { name: appointment.appointmentType.name },
        practitioner: {
          firstName: appointment.practitioner.firstName,
          lastName: appointment.practitioner.lastName,
        },
      },
    }).catch(err => console.error('[appointment-confirmation] notification failed', err));
  } catch {
    res.status(500).json({ error: 'Failed to convert appointment request' });
  }
});

// PUT /api/appointment-requests/:id
router.put('/appointment-requests/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = appointmentRequestUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.appointmentRequest.findFirst({
      where: { id, clinic: { organizationId: req.user!.organizationId } },
    });
    if (!existing) return res.status(404).json({ error: 'Appointment request not found', code: 'NOT_FOUND' });
    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(existing.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this appointment request', code: 'FORBIDDEN' });
    }
    const clinicId = existing.clinicId; // kayıt kaynaklı
    if (existing.status === 'converted') {
      return res.status(400).json({ error: 'Converted requests cannot be edited', code: 'ALREADY_CONVERTED' });
    }

    const d = validation.data;
    const patchData: Record<string, unknown> = {};
    if (d.appointmentTypeId !== undefined) patchData.appointmentTypeId = d.appointmentTypeId;
    if (d.practitionerId !== undefined) patchData.practitionerId = d.practitionerId;
    if (d.preferredStartTime !== undefined) patchData.preferredStartTime = d.preferredStartTime ? new Date(d.preferredStartTime) : null;
    if (d.preferredEndTime !== undefined) patchData.preferredEndTime = d.preferredEndTime ? new Date(d.preferredEndTime) : null;
    if (d.notes !== undefined) patchData.notes = d.notes;

    const updated = await prisma.appointmentRequest.update({
      where: { id },
      data: patchData,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'appointment_request', entityId: id,
      action: 'updated',
      description: 'Appointment request details updated by staff',
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update appointment request' });
  }
});

export default router;
