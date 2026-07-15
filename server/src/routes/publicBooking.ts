import express, { Request, Response } from 'express';
import prisma from '../db.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import {
  checkPractitionerAvailabilityForSlot,
  acquireAppointmentSlotLock,
  assertSlotAvailable,
  SlotConflictError,
} from '../services/appointments/appointmentAvailabilityService.js';
import { buildAvailableSlots } from '../services/whatsappAvailability.js';
import { createRateLimiter } from '../utils/helpers.js';
import {
  resolvePublishedLegalProfile,
  issueOrReuseNoticeEvidence,
  validateNoticeEvidenceToken,
  linkNoticeEvidenceToRequest,
  normalizeNoticeLanguage,
} from '../services/publicBookingNoticeEvidence.js';

const router = express.Router();

// Unauthenticated write endpoint — throttle per IP to limit spam requests.
const bookingSubmitLimiter = createRateLimiter(10, 15 * 60 * 1000, 'public-booking');
const noticeEvidenceLimiter = createRateLimiter(30, 15 * 60 * 1000, 'public-booking-notice');
const slotsLimiter = createRateLimiter(60, 60 * 1000, 'public-booking-slots');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SAFE_UNAVAILABLE_ERROR = 'The online booking form is temporarily unavailable. Please contact the clinic directly.';

/** Thrown when a concurrent submission already consumed this evidence token — not a slot conflict. */
class NoticeEvidenceAlreadyLinkedError extends Error {}

// GET /api/public/booking/:clinicId — clinic info + active services + active doctors
router.get('/booking/:clinicId', async (req: Request, res: Response) => {
  const clinicId = req.params.clinicId as string;

  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, name: true, phone: true, email: true, address: true },
    });

    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const publishedProfile = await resolvePublishedLegalProfile(clinicId);

    const [services, doctors, availabilities, offDays, operatingPreferences] = await Promise.all([
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
      getClinicOperatingPreferences(clinicId),
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
      operatingPreferences,
      services,
      doctors: doctors.map((d) => ({
        ...d,
        availableWeekdays: doctorAvailability[d.id] ?? [],
        offDates: doctorOffDates[d.id] ?? [],
      })),
      // Privacy-notice DELIVERY metadata only — not consent, not an
      // acknowledgment. See services/publicBookingNoticeEvidence.ts.
      legalNotice: publishedProfile
        ? {
            available: true,
            controllerName: publishedProfile.controllerName,
            privacyContact: publishedProfile.privacyContact,
            noticeText: publishedProfile.noticeText,
            channelDisclosureText: publishedProfile.channelDisclosureText,
            noticeVersion: publishedProfile.noticeVersion,
            noticeEffectiveDate: publishedProfile.noticeEffectiveDate,
          }
        : { available: false },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch booking info' });
  }
});

// GET /api/public/booking/:clinicId/slots — real, conflict-checked available
// slots for a given date (+ optional service/practitioner). This is the
// canonical availability the widget must render — it applies the exact same
// Appointment-overlap and pending/approved AppointmentRequest rules that
// submit-time assertSlotAvailable enforces, so a slot shown here cannot be
// rejected at submission for a reason this endpoint should have caught.
router.get('/booking/:clinicId/slots', async (req: Request, res: Response) => {
  const clinicId = req.params.clinicId as string;

  const clientIp = req.ip || 'unknown';
  if (!(await slotsLimiter.check(clientIp))) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  await slotsLimiter.record(clientIp);

  const dateRaw = req.query.date;
  const serviceIdRaw = req.query.serviceId;
  const practitionerIdRaw = req.query.practitionerId;

  const date = typeof dateRaw === 'string' ? dateRaw : '';
  if (!ISO_DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Invalid or missing date (expected YYYY-MM-DD)' });
  }
  const serviceId = typeof serviceIdRaw === 'string' && serviceIdRaw ? serviceIdRaw : null;
  const practitionerId = typeof practitionerIdRaw === 'string' && practitionerIdRaw ? practitionerIdRaw : null;

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const slots = await buildAvailableSlots(prisma, clinicId, serviceId, date, practitionerId);
    if (slots === null) {
      return res.status(400).json({ error: 'Invalid serviceId' });
    }

    return res.json({
      slots: slots.map((slot) => ({
        practitionerId: slot.practitioner.id,
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        localStartTime: slot.localStartTime,
        localEndTime: slot.localEndTime,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load availability' });
  }
});

// POST /api/public/booking/:clinicId/notice-evidence — idempotently issue
// automatic notice-delivery evidence for this booking session. No
// acknowledgment/consent action is required or recorded here.
router.post('/booking/:clinicId/notice-evidence', async (req: Request, res: Response) => {
  const clinicId = req.params.clinicId as string;

  const clientIp = req.ip || 'unknown';
  if (!(await noticeEvidenceLimiter.check(clientIp))) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  await noticeEvidenceLimiter.record(clientIp);

  const sessionIdRaw = req.body?.sessionId;
  if (typeof sessionIdRaw !== 'string' || sessionIdRaw.trim().length < 8 || sessionIdRaw.length > 200) {
    return res.status(400).json({ error: 'Invalid session identifier' });
  }
  const sessionId = sessionIdRaw.trim();

  try {
    const profile = await resolvePublishedLegalProfile(clinicId);
    if (!profile) {
      return res.status(404).json({ error: SAFE_UNAVAILABLE_ERROR, code: 'blocked_missing_legal_profile' });
    }

    const language = normalizeNoticeLanguage(req.body?.language, 'tr');
    const evidence = await issueOrReuseNoticeEvidence({ sessionId, language, profile });

    return res.status(200).json({
      token: evidence.token,
      noticeVersion: evidence.noticeVersion,
      noticeEffectiveDate: evidence.noticeEffectiveDate,
      language: evidence.language,
      channel: evidence.channel,
      deliveredAt: evidence.deliveredAt,
    });
  } catch {
    return res.status(500).json({ error: SAFE_UNAVAILABLE_ERROR });
  }
});

// POST /api/public/booking/:clinicId — submit appointment request (no auth)
router.post('/booking/:clinicId', async (req: Request, res: Response) => {
  const clinicId = req.params.clinicId as string;

  const clientIp = req.ip || 'unknown';
  if (!(await bookingSubmitLimiter.check(clientIp))) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  await bookingSubmitLimiter.record(clientIp);

  const {
    patientName,
    phone,
    email,
    serviceId,
    practitionerId,
    preferredDate,   // ISO date string "YYYY-MM-DD"
    preferredTime,   // "HH:MM"
    notes,
    noticeEvidenceToken,
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

    // Do not collect/store patient data without server-validated evidence
    // that this clinic's published privacy notice was displayed for this
    // exact session. The client cannot substitute another clinic's token,
    // an expired token, or an arbitrary version string — only the opaque
    // token is trusted, and it is resolved against the database here.
    const evidenceCheck = await validateNoticeEvidenceToken(prisma, {
      clinicId,
      token: typeof noticeEvidenceToken === 'string' ? noticeEvidenceToken : '',
    });
    if (!evidenceCheck.ok || !evidenceCheck.evidence) {
      return res.status(400).json({
        error: 'Your booking session has expired. Please reload the page and try again.',
        code: 'INVALID_NOTICE_EVIDENCE',
      });
    }
    const evidenceId = evidenceCheck.evidence.id;

    // Validate optional FK references belong to this clinic.
    // Keep svc so we can compute preferredEndTime from durationMinutes.
    let svc: { durationMinutes: number } | null = null;
    if (serviceId) {
      svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
      if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
    }
    if (practitionerId) {
      const doc = await prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor' } });
      if (!doc) return res.status(400).json({ error: 'Invalid practitionerId' });
    }

    // Build preferredStartTime / preferredEndTime.
    let preferredStartTime: Date | undefined;
    let preferredEndTime: Date | undefined;
    if (preferredDate && preferredTime) {
      const dt = new Date(`${preferredDate}T${preferredTime}:00`);
      if (!isNaN(dt.getTime())) {
        preferredStartTime = dt;
        if (svc) {
          preferredEndTime = new Date(dt.getTime() + svc.durationMinutes * 60 * 1000);
        }
      }
    }

    // Try to match an existing patient by phone in this clinic
    const existingPatient = await prisma.patient.findFirst({
      where: { clinicId, phone: cleanPhone, deletedAt: null },
      select: { id: true },
    });

    // ── Slot safety (only when we have full slot info) ─────────────────────
    // Full slot info = practitionerId + preferredStartTime + preferredEndTime.
    // When any piece is missing the request is under-specified; staff will
    // assign the final slot during review, so no lock/overlap check needed.
    const hasFullSlotInfo = !!(practitionerId && preferredStartTime && preferredEndTime);

    if (hasFullSlotInfo) {
      // 1. Practitioner availability check (outside transaction — stable schedule data).
      const availability = await checkPractitionerAvailabilityForSlot(
        clinicId,
        practitionerId!,
        preferredStartTime!,
        preferredEndTime!,
      );
      if (!availability.ok) {
        return res.status(409).json({
          error: 'This slot is no longer available. Please choose another time.',
          code: 'SLOT_UNAVAILABLE',
        });
      }

      // 2. Advisory lock → overlap check → request conflict check → create (all in one tx).
      //    pg_advisory_xact_lock serializes concurrent public submissions for the same slot.
      try {
        const request = await prisma.$transaction(async (tx) => {
          await acquireAppointmentSlotLock(tx, {
            clinicId,
            practitionerId: practitionerId!,
            startTime: preferredStartTime!,
          });

          // assertSlotAvailable checks both Appointment overlap and
          // pending/approved AppointmentRequest conflict in a single call.
          await assertSlotAvailable(tx, {
            clinicId,
            practitionerId: practitionerId!,
            startTime: preferredStartTime!,
            endTime: preferredEndTime!,
          });

          const created = await tx.appointmentRequest.create({
            data: {
              clinicId,
              patientId: existingPatient?.id ?? null,
              patientName: cleanName,
              phone: cleanPhone,
              email: cleanEmail,
              appointmentTypeId: serviceId ?? null,
              practitionerId: practitionerId ?? null,
              preferredStartTime: preferredStartTime ?? null,
              preferredEndTime: preferredEndTime ?? null,
              requestType: 'appointment',
              source: 'widget',
              status: 'pending',
              notes: cleanNotes,
            },
          });

          const linked = await linkNoticeEvidenceToRequest(tx, {
            evidenceId,
            appointmentRequestId: created.id,
          });
          if (!linked) throw new NoticeEvidenceAlreadyLinkedError();

          return created;
        });

        return res.status(201).json({ success: true, requestId: request.id });
      } catch (slotErr) {
        if (slotErr instanceof SlotConflictError) {
          return res.status(409).json({
            error: 'This slot is no longer available. Please choose another time.',
            code: 'SLOT_UNAVAILABLE',
          });
        }
        if (slotErr instanceof NoticeEvidenceAlreadyLinkedError) {
          return res.status(409).json({
            error: 'Your booking session has expired. Please reload the page and try again.',
            code: 'INVALID_NOTICE_EVIDENCE',
          });
        }
        throw slotErr;
      }
    }

    // ── Partial request (no full slot info) — staff will review ────────────
    // No lock/overlap check: practitioner or slot is unresolved.
    try {
      const request = await prisma.$transaction(async (tx) => {
        const created = await tx.appointmentRequest.create({
          data: {
            clinicId,
            patientId: existingPatient?.id ?? null,
            patientName: cleanName,
            phone: cleanPhone,
            email: cleanEmail,
            appointmentTypeId: serviceId ?? null,
            practitionerId: practitionerId ?? null,
            preferredStartTime: preferredStartTime ?? null,
            preferredEndTime: preferredEndTime ?? null,
            requestType: 'appointment',
            source: 'widget',
            status: 'pending',
            notes: cleanNotes,
          },
        });

        const linked = await linkNoticeEvidenceToRequest(tx, {
          evidenceId,
          appointmentRequestId: created.id,
        });
        if (!linked) throw new NoticeEvidenceAlreadyLinkedError();

        return created;
      });

      return res.status(201).json({ success: true, requestId: request.id });
    } catch (err) {
      if (err instanceof NoticeEvidenceAlreadyLinkedError) {
        return res.status(409).json({
          error: 'Your booking session has expired. Please reload the page and try again.',
          code: 'INVALID_NOTICE_EVIDENCE',
        });
      }
      throw err;
    }
  } catch {
    return res.status(500).json({ error: 'Failed to submit booking request' });
  }
});

export default router;
