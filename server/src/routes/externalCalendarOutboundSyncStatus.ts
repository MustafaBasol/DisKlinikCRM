/**
 * externalCalendarOutboundSyncStatus.ts — clinic-scoped endpoints to view an
 * appointment's outbound external-calendar synchronization status and to
 * manually retry a failed one.
 *
 * Provider-agnostic and generic on purpose: no DigiDentiS-specific parsing
 * or error handling lives here (per the Phase 2 boundary — that stays inside
 * services/externalCalendar/digidentis/). This is only a thin, authorized
 * read/retry surface over ExternalCalendarAppointmentLink for a future
 * staff-UI task; it deliberately does not add any UI itself.
 *
 * Authorization mirrors the existing appointment-scoped routes
 * (appointments.ts's GET /appointments/:id): clinic access via
 * getAccessibleClinicIds(), soft-deleted appointments excluded, and a
 * DENTIST may only see their own appointments. Manual retry additionally
 * restricts to the same staff roles allowed to convert an AppointmentRequest
 * in the first place (OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST) — it is
 * an administrative action, not a read.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';
import { getAccessibleClinicIds } from '../utils/clinicScope.js';
import {
  attemptExternalCalendarSync,
  requeueSyncLinkForManualRetry,
} from '../services/externalCalendar/externalCalendarOutboundSync.js';

const router = express.Router();

type SyncLinkRow = {
  id: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  lastError: string | null;
  externalAppointmentId: string | null;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSyncStatusDto(link: SyncLinkRow) {
  return {
    id: link.id,
    status: link.status,
    attempts: link.attempts,
    errorCode: link.errorCode,
    lastError: link.lastError,
    externalAppointmentId: link.externalAppointmentId,
    nextAttemptAt: link.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: link.lastAttemptAt?.toISOString() ?? null,
    lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

async function findAccessibleAppointment(req: AuthRequest, id: string) {
  const accessibleIds = await getAccessibleClinicIds(req.user!);
  if (accessibleIds.length === 0) return null;
  return prisma.appointment.findFirst({
    where: { id, clinicId: { in: accessibleIds }, deletedAt: null },
    select: { id: true, clinicId: true, practitionerId: true },
  });
}

// GET /api/appointments/:id/external-calendar-sync
router.get(
  '/appointments/:id/external-calendar-sync',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    try {
      const appointment = await findAccessibleAppointment(req, id);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

      const { normalizedRole, id: userId } = req.user!;
      if (normalizedRole === 'DENTIST' && appointment.practitionerId !== userId) {
        return res.status(403).json({ error: 'Forbidden: Access to other doctors appointments is restricted' });
      }

      const link = await prisma.externalCalendarAppointmentLink.findFirst({
        where: { appointmentId: appointment.id, clinicId: appointment.clinicId },
        orderBy: { createdAt: 'desc' },
      });

      if (!link) return res.json({ sync: null });
      res.json({ sync: toSyncStatusDto(link) });
    } catch {
      res.status(500).json({ error: 'Failed to fetch external calendar sync status' });
    }
  },
);

// POST /api/appointments/:id/external-calendar-sync/retry
router.post(
  '/appointments/:id/external-calendar-sync/retry',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    try {
      const appointment = await findAccessibleAppointment(req, id);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

      const link = await prisma.externalCalendarAppointmentLink.findFirst({
        where: { appointmentId: appointment.id, clinicId: appointment.clinicId },
        orderBy: { createdAt: 'desc' },
      });
      if (!link) {
        return res.status(404).json({ error: 'No external calendar sync record exists for this appointment' });
      }
      if (link.status === 'synced') {
        return res.status(400).json({ error: 'This appointment is already synchronized', code: 'ALREADY_SYNCED' });
      }
      if (link.status === 'cancelled') {
        return res.status(400).json({ error: 'This synchronization record has been cancelled', code: 'SYNC_CANCELLED' });
      }

      const { requeued } = await requeueSyncLinkForManualRetry(link.id);
      if (!requeued) {
        // Lost the race to the automatic retry job or another manual retry —
        // it is being processed right now, not an error.
        return res.status(409).json({ error: 'A synchronization attempt is already in progress', code: 'SYNC_IN_PROGRESS' });
      }

      const result = await attemptExternalCalendarSync(link.id);
      const updated = await prisma.externalCalendarAppointmentLink.findUnique({ where: { id: link.id } });
      res.json({ result: result.outcome, sync: updated ? toSyncStatusDto(updated) : null });
    } catch {
      res.status(500).json({ error: 'Failed to retry external calendar synchronization' });
    }
  },
);

export default router;
