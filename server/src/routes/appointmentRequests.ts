import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam, checkPractitionerAvailability } from '../utils/helpers.js';
import {
  checkAppointmentOverlap,
  checkAppointmentRequestConflict,
  acquireAppointmentSlotLock,
  acquireAppointmentRequestConversionLock,
  SlotConflictError,
} from '../services/appointments/appointmentAvailabilityService.js';
import { appointmentRequestStatusSchema, appointmentRequestConvertSchema, appointmentRequestUpdateSchema } from '../schemas/index.js';
import { patientContactSelect, userPublicSelect } from '../utils/prismaSelects.js';
import { findUserAssignedToClinic } from '../utils/relationGuards.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { sendAppointmentRequestConfirmationNotification } from '../services/appointmentRequestNotification.js';

const router = express.Router();

// ── Convert-handler transaction errors ──────────────────────────────────────
// Thrown INSIDE the prisma.$transaction callback in POST /:id/convert to
// trigger an automatic rollback, then caught outside to map back onto the
// exact pre-existing response status/body for each condition — no
// client-visible response contract change from wrapping the writes in a
// transaction. SlotConflictError is reused from appointmentAvailabilityService
// (already the established type for this exact condition elsewhere in the
// codebase, e.g. publicBooking.ts).
class AlreadyConvertedError extends Error {}
class AppointmentRequestNotFoundError extends Error {}
class InvalidPatientError extends Error {}

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

  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (scope === false) return;

  try {
    const existing = await prisma.appointmentRequest.findFirst({ where: { ...scope, id } });
    if (!existing) return res.status(404).json({ error: 'Appointment request not found' });
    const clinicId = existing.clinicId;
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

  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (scope === false) return;

  try {
    const request = await prisma.appointmentRequest.findFirst({
      where: { ...scope, id },
      include: { patient: { select: patientContactSelect } },
    });

    if (!request) return res.status(404).json({ error: 'Appointment request not found' });
    if (request.status === 'converted') return res.status(400).json({ error: 'Appointment request is already converted' });
    if (request.requestType === 'cancel') return res.status(400).json({ error: 'Cancel requests cannot be converted to appointments' });

    // Every downstream lookup/write below uses the request's own clinicId
    // (found within the caller's validated scope) — never re-derived from
    // req.user.clinicId — so the target clinic can never diverge from the
    // request being converted.
    const clinicId = request.clinicId;

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

    // Resolve-only pre-check (fast, common-case 400 without opening a
    // transaction). Not a write — Patient/Appointment creation happens only
    // inside the transaction below.
    const requestedPatientId = validation.data.patientId || request.patientId;
    let organizationIdForNewPatient: string | null = null;
    if (requestedPatientId) {
      const patient = await prisma.patient.findFirst({ where: { id: requestedPatientId, clinicId, deletedAt: null } });
      if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    } else {
      organizationIdForNewPatient = (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { organizationId: true } }))!.organizationId;
    }

    // Working-hours/off-day/clinic-schedule check — stable configuration data,
    // not subject to the same booking race as overlap/conflict below, so (per
    // the same convention already established in publicBooking.ts) it stays
    // outside the transaction.
    const availability = await checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
    if (!availability.ok) {
      return res.status(409).json({
        error: 'Appointment is outside practitioner availability',
        code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
        availability: availability.slots,
      });
    }

    // Fast pre-check outside the transaction: gives the common case (no
    // contention) an immediate 409 without paying for a transaction + advisory
    // lock. Not authoritative by itself — the same checks run again below,
    // inside the transaction, after the lock is held.
    const overlap = await checkAppointmentOverlap(prisma, { clinicId, practitionerId, startTime, endTime });
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

    let appointment, updatedRequest;
    try {
      const result = await prisma.$transaction(async (tx) => {
        // MUST be first, before acquireAppointmentSlotLock: serializes ALL
        // concurrent conversion attempts of THIS request, regardless of which
        // slot each attempt targets. A slot lock alone is not sufficient here
        // — two concurrent conversions of the same request can be given
        // different slot overrides (different practitioner/startTime in the
        // request body), so they would compute different slot lock keys and
        // both proceed to create an Appointment for the same request. Locking
        // on the request's own id first closes that gap. Lock order (request
        // lock, then slot lock) must stay consistent across every conversion
        // path in the codebase — see acquireAppointmentRequestConversionLock's
        // doc comment in appointmentRequestSafety.ts.
        await acquireAppointmentRequestConversionLock(tx, id);

        // Re-read the request under the same accepted scope, lock-protected —
        // this is the authoritative duplicate-conversion guard. The read at
        // the top of the handler is only a fast pre-check; two concurrent
        // conversions of the same request now serialize on the request lock
        // above, and the second to reach this point observes
        // status: 'converted' and aborts cleanly.
        const freshRequest = await tx.appointmentRequest.findFirst({ where: { ...scope, id } });
        if (!freshRequest) throw new AppointmentRequestNotFoundError();
        if (freshRequest.status === 'converted') throw new AlreadyConvertedError();

        // Second: serializes concurrent writes for this exact slot — the same
        // advisory lock every other booking-creation path in this codebase
        // (publicBooking.ts, whatsapp.ts, Instagram/Meta AI flows) acquires
        // via appointmentRequestSafety.ts before its own overlap check.
        await acquireAppointmentSlotLock(tx, { clinicId, practitionerId, startTime });

        // Authoritative, lock-protected re-check of the same two conditions
        // pre-checked above — closes the TOCTOU window between the fast
        // pre-check and lock acquisition.
        const [txOverlap, txRequestConflict] = await Promise.all([
          checkAppointmentOverlap(tx, { clinicId, practitionerId, startTime, endTime }),
          checkAppointmentRequestConflict(tx, { clinicId, practitionerId, startTime, endTime, excludeRequestId: id }),
        ]);
        if (txOverlap) throw new SlotConflictError('APPOINTMENT_OVERLAP');
        if (txRequestConflict) throw new SlotConflictError('APPOINTMENT_REQUEST_CONFLICT');

        let patientId = requestedPatientId;
        if (patientId) {
          // Re-resolve inside the transaction — closes the race where the
          // patient was deleted between the pre-check above and lock
          // acquisition.
          const patient = await tx.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } });
          if (!patient) throw new InvalidPatientError();
        } else {
          const [firstName, ...lastNameParts] = request.patientName.trim().split(/\s+/);
          const patient = await tx.patient.create({
            data: {
              clinicId,
              organizationId: organizationIdForNewPatient!,
              firstName: firstName || request.patientName,
              lastName: lastNameParts.join(' ') || '-',
              phone: request.phone,
              email: request.email,
              source: request.source || 'whatsapp',
              communicationConsent: true,
              notes: `${appointmentRequestSourceLabel(request.source)} randevu talebinden oluşturuldu.`,
            },
          });
          patientId = patient.id;
        }

        const appointment = await tx.appointment.create({
          data: {
            clinicId,
            patientId,
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

        return { appointment, updatedRequest };
      });
      appointment = result.appointment;
      updatedRequest = result.updatedRequest;
    } catch (txErr) {
      // Every branch below maps 1:1 onto the exact status/body the
      // pre-transaction version of this handler already returned for the
      // same condition — no response-contract change.
      if (txErr instanceof AlreadyConvertedError) {
        return res.status(400).json({ error: 'Appointment request is already converted' });
      }
      if (txErr instanceof AppointmentRequestNotFoundError) {
        return res.status(404).json({ error: 'Appointment request not found' });
      }
      if (txErr instanceof InvalidPatientError) {
        return res.status(400).json({ error: 'Invalid patient' });
      }
      if (txErr instanceof SlotConflictError) {
        if (txErr.kind === 'APPOINTMENT_OVERLAP') {
          return res.status(409).json({ error: 'Practitioner already has an appointment during this time', code: 'APPOINTMENT_OVERLAP' });
        }
        return res.status(409).json({
          error: 'This slot already has a pending or approved appointment request.',
          code: 'APPOINTMENT_REQUEST_CONFLICT',
        });
      }
      throw txErr;
    }

    // logActivity uses its own separate PrismaClient instance (activity.ts)
    // and cannot participate in the transaction above; called only after
    // commit, consistent with its existing best-effort/fire-and-forget
    // semantics elsewhere in this codebase.
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
      patientId: updatedRequest.patientId!,
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

  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (scope === false) return;

  try {
    const existing = await prisma.appointmentRequest.findFirst({ where: { ...scope, id } });
    if (!existing) return res.status(404).json({ error: 'Appointment request not found', code: 'NOT_FOUND' });
    const clinicId = existing.clinicId;
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
