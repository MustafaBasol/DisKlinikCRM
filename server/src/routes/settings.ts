import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { logActivity } from '../utils/activity.js';
import {
  getNotificationPreferences,
  notificationPreferencesSchema,
  upsertNotificationPreferences,
} from '../services/notificationPreferences.js';
import {
  clinicOperatingPreferencesSchema,
  getClinicOperatingPreferences,
  upsertClinicOperatingPreferences,
} from '../services/clinicOperatingPreferences.js';

const router = express.Router();

router.get(
  '/settings/notification-preferences',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    try {
      const preferences = await getNotificationPreferences(clinicId);
      res.json({ clinicId, preferences });
    } catch {
      res.status(500).json({ error: 'Failed to load notification preferences' });
    }
  },
);

router.put(
  '/settings/notification-preferences',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const body = req.body as { preferences?: unknown };
    const parsed = notificationPreferencesSchema.safeParse(body.preferences ?? req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

    try {
      const preferences = await upsertNotificationPreferences(clinicId, parsed.data);

      await logActivity({
        clinicId,
        userId: req.user!.id,
        entityType: 'settings',
        entityId: clinicId,
        action: 'notification_preferences_updated',
        description: 'Notification preferences updated',
      });

      res.json({ clinicId, preferences });
    } catch {
      res.status(500).json({ error: 'Failed to save notification preferences' });
    }
  },
);

router.get(
  '/settings/clinic-operating-preferences',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    try {
      const preferences = await getClinicOperatingPreferences(clinicId);
      res.json({ clinicId, preferences });
    } catch {
      res.status(500).json({ error: 'Failed to load clinic operating preferences' });
    }
  },
);

router.put(
  '/settings/clinic-operating-preferences',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const body = req.body as { preferences?: unknown };
    const parsed = clinicOperatingPreferencesSchema.safeParse(body.preferences ?? req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

    try {
      const preferences = await upsertClinicOperatingPreferences(clinicId, parsed.data);

      await logActivity({
        clinicId,
        userId: req.user!.id,
        entityType: 'settings',
        entityId: clinicId,
        action: 'clinic_operating_preferences_updated',
        description: 'Clinic operating preferences updated',
      });

      res.json({ clinicId, preferences });
    } catch {
      res.status(500).json({ error: 'Failed to save clinic operating preferences' });
    }
  },
);

export default router;
