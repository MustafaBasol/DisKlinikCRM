/**
 * sms.ts — SMS add-on module routes.
 *
 * All endpoints are clinic-scoped and role-protected:
 *  - Settings (read-only status): OWNER, ORG_ADMIN, CLINIC_MANAGER
 *  - Usage summary: management roles + BILLING (read-only)
 *  - Manual sending: operational roles (no DENTIST/ASSISTANT)
 *  - History: management + RECEPTIONIST
 *
 * NoraMedi sells SMS as a centrally managed add-on: the platform admin owns
 * all provider/routing configuration (see platformAdmin.ts sms-providers and
 * sms-addon routes). Clinics only ever see status/usage/history here — there
 * is no clinic-facing endpoint to set providers or sender names.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { Prisma } from '@prisma/client';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { smsSendSchema } from '../schemas/index.js';
import { resolveEffectiveClinicId, validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { sendClinicSms } from '../services/sms/smsService.js';
import { getSmsEntitlement, getSmsMonthlyUsage, currentSmsPeriod, type SmsEntitlement } from '../services/sms/smsEntitlement.js';
import { getSmsProvider } from '../services/sms/smsProviders.js';
import { patientContactSelect, userNameSelect } from '../utils/prismaSelects.js';

const router = express.Router();

const SETTINGS_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];
const USAGE_ROLES = [...SETTINGS_ROLES, 'BILLING'];
const SEND_ROLES = [...SETTINGS_ROLES, 'RECEPTIONIST'];
const HISTORY_ROLES = [...SETTINGS_ROLES, 'RECEPTIONIST'];

/**
 * Region availability for the clinic status page: true when a provider will
 * actually resolve for a send (clinic-level override or platform default) —
 * without exposing the provider's identity to the clinic.
 */
async function isRegionAvailable(region: 'tr' | 'eu', entitlement: SmsEntitlement): Promise<boolean> {
  const overrideKey = region === 'tr' ? entitlement.settings?.turkeyProvider : entitlement.settings?.europeProvider;
  if (overrideKey && getSmsProvider(overrideKey)) return true;
  const platformRow = await prisma.platformSmsProvider.findFirst({
    where: { region, isActive: true },
    select: { id: true },
  });
  return Boolean(platformRow);
}

async function buildStatusPayload(clinicId: string) {
  const entitlement = await getSmsEntitlement(clinicId);
  const period = currentSmsPeriod();
  const used = await getSmsMonthlyUsage(clinicId, period);
  const [trAvailable, euAvailable] = await Promise.all([
    isRegionAvailable('tr', entitlement),
    isRegionAvailable('eu', entitlement),
  ]);
  return {
    addonActive: entitlement.enabled,
    addonSource: entitlement.source,
    period,
    monthlyQuota: entitlement.monthlyQuota,
    usedThisMonth: used,
    remaining: Math.max(0, entitlement.monthlyQuota - used),
    regions: {
      tr: { available: trAvailable },
      eu: { available: euAvailable },
    },
    // Read-only — providers/regions/routing are managed by platform admin only.
    turkeyAllowed: entitlement.settings?.turkeyAllowed ?? false,
    europeAllowed: entitlement.settings?.europeAllowed ?? false,
    routingPolicy: entitlement.settings?.routingPolicy ?? 'automatic_by_recipient_phone_region',
  };
}

// GET /api/sms/settings — add-on status, quota/usage, read-only routing availability
router.get('/sms/settings', authorize(SETTINGS_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    res.json(await buildStatusPayload(clinicId));
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS settings' });
  }
});

// GET /api/sms/usage — usage/quota summary (BILLING may read; no message content)
router.get('/sms/usage', authorize(USAGE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const entitlement = await getSmsEntitlement(clinicId);
    const period = currentSmsPeriod();
    const used = await getSmsMonthlyUsage(clinicId, period);

    res.json({
      addonActive: entitlement.enabled,
      period,
      monthlyQuota: entitlement.monthlyQuota,
      usedThisMonth: used,
      remaining: Math.max(0, entitlement.monthlyQuota - used),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS usage' });
  }
});

// GET /api/sms/history — clinic-scoped send history (statuses incl. blocked reasons)
router.get('/sms/history', authorize(HISTORY_ROLES), async (req: AuthRequest, res: Response) => {
  const { patientId, status, purpose, clinicId: selectedClinicId } = req.query;

  const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
  if (scope === false) return;

  try {
    const where: Prisma.SmsMessageWhereInput = { ...scope };
    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);
    if (purpose) where.purpose = String(purpose);

    const take = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
    const messages = await prisma.smsMessage.findMany({
      where,
      include: {
        patient: { select: patientContactSelect },
        createdBy: { select: userNameSelect },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS history' });
  }
});

// POST /api/sms/send — manual patient SMS through the full safety pipeline
router.post('/sms/send', authorize(SEND_ROLES), async (req: AuthRequest, res: Response) => {
  const validation = smsSendSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { patientId, clinicId: bodyClinicId, appointmentId, templateId, purpose, body } = validation.data;

  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, bodyClinicId ?? undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const result = await sendClinicSms({
      organizationId: req.user!.organizationId,
      clinicId,
      patientId,
      appointmentId: appointmentId ?? null,
      templateId: templateId ?? null,
      purpose,
      body: body ?? null,
      createdById: req.user!.id,
    });

    if (!result.ok) {
      const statusByCode: Record<string, number> = {
        addon_disabled: 402,
        quota_exceeded: 402,
        consent_blocked: 403,
        invalid_phone: 400,
        region_unsupported: 400,
        unresolved_variables: 400,
        template_invalid: 400,
        duplicate: 409,
        provider_not_configured: 422,
        send_failed: 502,
      };
      return res.status(statusByCode[result.code] ?? 400).json({
        error: result.error,
        code: result.code,
        smsMessageId: result.messageId ?? null,
      });
    }

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'sms_message', entityId: result.messageId,
      action: 'sent', description: `Hastaya SMS gönderildi (${purpose})`,
      patientId,
    });

    res.json({ id: result.messageId, status: 'sent', provider: result.provider, region: result.region });
  } catch (error: unknown) {
    console.error('[sms] send error:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

export default router;
